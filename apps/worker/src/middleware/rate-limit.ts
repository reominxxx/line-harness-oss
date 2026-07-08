/**
 * In-memory sliding window rate limiter for Cloudflare Workers.
 *
 * Cloudflare Workers have per-isolate memory that persists across
 * requests to the same instance. Counters are lost on cold start,
 * which is acceptable — this guards against burst abuse, not
 * long-term quota enforcement.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Core rate-limit logic
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const PRUNE_INTERVAL = 60_000;
let lastPrune = Date.now();

function prune(windowMs: number): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

function check(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  prune(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= max) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: max - entry.timestamps.length, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Paths that are unauthenticated (lower limit, keyed by IP)
// ---------------------------------------------------------------------------

const UNAUTHENTICATED_PATTERNS: Array<string | RegExp> = [
  '/webhook',
  /^\/api\/forms\/[^/]+\/submit$/,
];

function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED_PATTERNS.some((p) =>
    typeof p === 'string' ? path === p : p.test(path),
  );
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

const AUTHENTICATED_MAX = 1000;
const AUTHENTICATED_WINDOW = 60_000; // 1 min

const UNAUTHENTICATED_MAX = 100;
const UNAUTHENTICATED_WINDOW = 60_000; // 1 min

// AI 系エンドポイントは LLM / 画像生成 API を叩くのでコスト爆発防止に低めに絞る。
// 認証済みでも 1 user が 1 分に 60 リクエスト以上叩く正常ユースケースはない。
const AI_PATH_PATTERNS: RegExp[] = [
  /^\/api\/ai-/,
  /^\/api\/.+\/generate(\/|$)/,
  /^\/api\/.+\/ai\//,
];
const AI_MAX = 60;
const AI_WINDOW = 60_000;

// 認証失敗のブルートフォース対策。401 を返すたびに別カウンタを進め、
// 一定回数を超えた IP を一時的にブロックする。
const FAILED_AUTH_MAX = 10;
const FAILED_AUTH_WINDOW = 15 * 60_000; // 15 min

function isAiPath(path: string): boolean {
  return AI_PATH_PATTERNS.some((re) => re.test(path));
}

export function recordFailedAuth(ip: string): void {
  check(`failed_auth:${ip}`, FAILED_AUTH_MAX, FAILED_AUTH_WINDOW);
}

export function isLockedOut(ip: string): boolean {
  // peek without recording: count existing timestamps in window
  const entry = store.get(`failed_auth:${ip}`);
  if (!entry) return false;
  const cutoff = Date.now() - FAILED_AUTH_WINDOW;
  const recent = entry.timestamps.filter((t) => t > cutoff).length;
  return recent >= FAILED_AUTH_MAX;
}

export async function rateLimitMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;

  // Skip rate limiting for docs / static assets
  if (path === '/docs' || path === '/openapi.json' || path.startsWith('/r/')) {
    return next();
  }

  // ブルートフォース対策: 認証失敗が連発している IP は短期間ブロック
  const ip = getClientIp(c);
  if (isLockedOut(ip)) {
    return c.json(
      { success: false, error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': '900' } },
    );
  }

  let key: string;
  let max: number;
  let windowMs: number;

  if (isUnauthenticatedPath(path)) {
    // Key by IP for unauthenticated endpoints
    key = `ip:${ip}`;
    max = UNAUTHENTICATED_MAX;
    windowMs = UNAUTHENTICATED_WINDOW;
  } else if (isAiPath(path)) {
    // AI 系: API key 別に厳しい制限
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    key = token ? `ai:${token.slice(0, 16)}` : `ai:ip:${ip}`;
    max = AI_MAX;
    windowMs = AI_WINDOW;
  } else {
    // Key by API key for authenticated endpoints
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      key = `key:${token.slice(0, 16)}`;
      max = AUTHENTICATED_MAX;
      windowMs = AUTHENTICATED_WINDOW;
    } else {
      key = `ip:${ip}`;
      max = UNAUTHENTICATED_MAX;
      windowMs = UNAUTHENTICATED_WINDOW;
    }
  }

  const result = check(key, max, windowMs);

  if (!result.ok) {
    return c.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }

  // Proceed and attach rate-limit headers to the response
  await next();

  c.header('X-RateLimit-Remaining', String(result.remaining));
}
