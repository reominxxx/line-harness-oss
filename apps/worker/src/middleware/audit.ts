/**
 * 監査ログ middleware
 *
 * 全 mutating エンドポイント (POST / PUT / PATCH / DELETE) の呼び出しを
 * audit_log テーブルに記録する。
 *
 * 記録内容:
 *  - 誰が (staff_id)
 *  - いつ (created_at)
 *  - どこから (ip_address, user_agent)
 *  - 何をした (method + path → action にマップ)
 *  - どのリソースに対して (resource_type, resource_id を path から抽出)
 *  - 結果 (success / failed / denied)
 *
 * 設計判断:
 *  - 失敗時 (4xx / 5xx) も記録する（攻撃検知に必要）
 *  - レスポンスボディは記録しない（PII が含まれる可能性 + サイズ）
 *  - リクエストボディの一部 (パラメータ概要) は details_json に
 */

import type { Context, Next } from 'hono';
import type { Env } from '../index.js';
import { jstNow } from '@line-crm/db';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const AUDIT_SKIP_PATTERNS: Array<string | RegExp> = [
  '/webhook',
  '/health',
  /^\/api\/forms\/[^/]+\/submit$/,
  /^\/api\/forms\/[^/]+\/opened$/,
  /^\/api\/forms\/[^/]+\/partial$/,
  /^\/t\//,
  /^\/r\//,
];

function shouldSkip(path: string): boolean {
  return AUDIT_SKIP_PATTERNS.some((p) =>
    typeof p === 'string' ? path === p : p.test(path),
  );
}

/**
 * Path から action と resource_type を抽出。
 * 例: POST /api/kb/documents → action="kb.create", resource_type="kb_document"
 */
function extractActionAndResource(method: string, path: string): {
  action: string;
  resourceType: string | null;
  resourceId: string | null;
} {
  const segments = path.split('/').filter(Boolean);
  // /api/<resource>/<id?>/<subresource?>
  if (segments[0] !== 'api') {
    return { action: `${method.toLowerCase()}:${path}`, resourceType: null, resourceId: null };
  }
  const resource = segments[1] ?? 'unknown';
  const id = segments[2] ?? null;
  const sub = segments[3] ?? null;

  const verb =
    method === 'POST' ? 'create' :
    method === 'PUT' ? 'update' :
    method === 'PATCH' ? 'update' :
    method === 'DELETE' ? 'delete' :
    method.toLowerCase();

  const action = sub ? `${resource}.${sub}.${verb}` : `${resource}.${verb}`;

  return {
    action,
    resourceType: resource,
    resourceId: id && id.length < 100 ? id : null,
  };
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

export async function auditMiddleware(c: Context<Env>, next: Next): Promise<void> {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  // 非 mutating はスキップ
  if (!MUTATING_METHODS.has(method) || shouldSkip(path)) {
    return next();
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  c.set('requestId' as never, requestId as never);

  let result: 'success' | 'failed' | 'denied' = 'success';
  let errorMessage: string | null = null;

  try {
    await next();
    const status = c.res?.status ?? 500;
    if (status === 401 || status === 403) result = 'denied';
    else if (status >= 400) result = 'failed';
  } catch (err) {
    result = 'failed';
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // 監査ログ書き込みはレスポンスを止めずに非同期で
    const staff = c.get('staff');
    const { action, resourceType, resourceId } = extractActionAndResource(method, path);

    const details = {
      method,
      path,
      status: c.res?.status ?? null,
      durationMs: Date.now() - startedAt,
      error: errorMessage,
    };

    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO audit_log (id, line_account_id, staff_id, action, resource_type, resource_id, ip_address, user_agent, request_id, details_json, result, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        staff?.id ?? null,
        action,
        resourceType,
        resourceId,
        getClientIp(c),
        c.req.header('user-agent') ?? null,
        requestId,
        JSON.stringify(details),
        result,
        jstNow(),
      ).run().catch((e) => {
        // 監査ログの書き込み失敗自体でリクエストを失敗させない
        console.error('[audit] write failed:', e);
      }),
    );
  }
}
