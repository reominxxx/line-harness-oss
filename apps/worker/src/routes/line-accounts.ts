import { Hono } from 'hono';
import {
  getLineAccounts,
  getLineAccountsLite,
  getLineAccountById,
  createLineAccount,
  updateLineAccount,
  updateLineAccountFields,
  updateLineAccountOrder,
  deleteLineAccount,
  saveLineAccountProfile,
  initTenantMetering,
  createStaffMember,
  getCustomerKeysByAccount,
  getStaffById,
  deleteStaffMember,
  regenerateStaffApiKey,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount, LineAccountLite, StaffMember } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { getRemainingQuota } from '../services/quota-guard.js';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const lineAccounts = new Hono<Env>();

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    country: row.country,
    role: row.role,
    displayOrder: row.display_order,
    // login_channel_id and liff_id are non-secret identifiers (visible in
    // LINE Developers console, embedded in public LIFF URLs). Safe to expose
    // in list responses so the admin UI can show "Login/LIFF configured?"
    // without a separate fetch.
    loginChannelId: row.login_channel_id,
    liffId: row.liff_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Intentionally omit channelAccessToken / channelSecret / loginChannelSecret
    // from list responses (secrets).
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: row.channel_access_token,
    channelSecret: row.channel_secret,
    loginChannelSecret: row.login_channel_secret,
  };
}

function serializeLineAccountLite(row: LineAccountLite) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    country: row.country,
    role: row.role,
    displayOrder: row.display_order,
    liffId: row.liff_id,
    // 表示名やアイコンは LINE Messaging API から取得して DB にキャッシュ済みのものを返す。
    // フル取得 (/api/line-accounts) を一度叩くと cache が温まる。
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    basicId: row.basic_id,
  };
}

// Lite キャッシュキー: アカウント書き込み時にバストする
const LITE_CACHE_URL = 'https://cache.line-harness.internal/line-accounts/lite';
const LITE_CACHE_TTL_SECONDS = 60;

async function bustLiteCache() {
  try {
    const cache = (globalThis as unknown as { caches?: CacheStorage }).caches?.default as Cache | undefined;
    if (cache) await cache.delete(LITE_CACHE_URL);
  } catch {
    // best-effort
  }
}

// Fetch bot profile (displayName, pictureUrl) from LINE API
async function fetchBotProfile(accessToken: string): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = await res.json() as { displayName?: string; pictureUrl?: string; basicId?: string };
    return { displayName: data.displayName, pictureUrl: data.pictureUrl, basicId: data.basicId };
  } catch {
    return {};
  }
}

// GET /api/line-accounts/lite - selector 用軽量リスト(no LINE API / no stats)
// アカウント数 1000+ でも軽快に動くよう Cache API で 60 秒キャッシュ。
// 書き込み系(create/update/delete/reorder)で bustLiteCache() を呼んでバスト。
lineAccounts.get('/api/line-accounts/lite', async (c) => {
  try {
    // customer role は割当アカウントのみ。グローバルキャッシュは全アカウント混在なので
    // 共有せず、DB から割当分だけ取り出して返す (テナント越え防止)。
    const staff = c.get('staff');
    if (staff?.role === 'customer') {
      const assigned = staff.assignedLineAccountId ?? null;
      const items = (await getLineAccountsLite(c.env.DB)).filter((a) => a.id === assigned);
      return c.json({ success: true, data: items.map(serializeLineAccountLite) });
    }

    const cache = (globalThis as unknown as { caches?: CacheStorage }).caches?.default as Cache | undefined;
    if (cache) {
      const cached = await cache.match(LITE_CACHE_URL);
      if (cached) return new Response(cached.body, cached);
    }

    const items = await getLineAccountsLite(c.env.DB);
    const payload = { success: true, data: items.map(serializeLineAccountLite) };
    const res = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${LITE_CACHE_TTL_SECONDS}`,
      },
    });
    if (cache) {
      // clone を put(レスポンス本体は呼び出し元に返すため)
      c.executionCtx.waitUntil(cache.put(LITE_CACHE_URL, res.clone()));
    }
    return res;
  } catch (err) {
    console.error('GET /api/line-accounts/lite error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts - list all (with LINE profile + stats)
lineAccounts.get('/api/line-accounts', async (c) => {
  try {
    const db = c.env.DB;
    const staff = c.get('staff');
    let items = await getLineAccounts(db);
    // customer role は割当アカウントのみに絞る (テナント越え防止)。
    if (staff?.role === 'customer') {
      const assigned = staff.assignedLineAccountId ?? null;
      items = items.filter((a) => a.id === assigned);
    }

    // Get stats for all accounts in parallel
    const results = await Promise.all(
      items.map(async (item) => {
        const [profile, friendCount, scenarioCount, msgCount] = await Promise.all([
          fetchBotProfile(item.channel_access_token),
          db.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM friend_scenarios fs
             INNER JOIN friends f ON f.id = fs.friend_id
             WHERE fs.status = 'active' AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
          db.prepare(
            // 「今月送信」(messagesThisMonth) は LINE 公式ダッシュボードの「配信済みの無料メッセージ数」と
            // 揃える設計: push 系のみ + 当月 1 日 00:00 以降。reply API 経由 (1-on-1 chat) は LINE quota 外なので
            // delivery_type='push' で除外。以前は date('now', '-30 days') の rolling window で月初に bias 残って
            // 公式 dashboard と数桁ズレてた (例: 公式 10 通 vs UI 10,609 通) → start of month に揃えた。
            `SELECT COUNT(*) as count FROM messages_log ml
             INNER JOIN friends f ON f.id = ml.friend_id
             WHERE ml.direction = 'outgoing' AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push') AND ml.created_at >= date('now', 'start of month') AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
        ]);

        // LINE Messaging API から取得した最新 profile を DB にキャッシュしておく。
        // Lite endpoint (/api/line-accounts/lite) が同じ表示名を返せるようにするため。
        // 失敗してもレスポンスは止めない (best-effort)。
        if (profile.displayName || profile.pictureUrl || profile.basicId) {
          c.executionCtx.waitUntil(
            saveLineAccountProfile(db, item.id, profile).catch((err) => {
              console.error('[line-accounts] persist profile failed', item.id, err);
            }),
          );
        }

        return {
          ...serializeLineAccount(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          stats: {
            friendCount: friendCount?.count ?? 0,
            activeScenarios: scenarioCount?.count ?? 0,
            messagesThisMonth: msgCount?.count ?? 0,
          },
        };
      }),
    );
    // フル取得で profile を更新したので Lite キャッシュを温め直す。
    c.executionCtx.waitUntil(bustLiteCache());
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id/quota - LINE 課金メッセージの残枠 (配信上限接近の通知用)
lineAccounts.get('/api/line-accounts/:id/quota', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    const staff = c.get('staff');
    if (staff?.role === 'customer' && staff.assignedLineAccountId !== id) {
      return c.json({ success: false, error: 'Forbidden: account not in scope' }, 403);
    }
    const account = await getLineAccountById(db, id);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const lineClient = new LineClient(account.channel_access_token);
    const quota = await getRemainingQuota(lineClient);
    // remaining/limit が読める limited プランのときだけ使用率を返す。
    const usedRatio =
      quota.limited && quota.limit && quota.limit > 0 && quota.used != null
        ? Math.min(1, quota.used / quota.limit)
        : null;
    return c.json({ success: true, data: { ...quota, usedRatio } });
  } catch (err) {
    console.error('GET /api/line-accounts/:id/quota error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id - get single (secrets only for owner/admin)
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const staffScope = c.get('staff');
    if (staffScope?.role === 'customer' && staffScope.assignedLineAccountId !== id) {
      return c.json({ success: false, error: 'Forbidden: account not in scope' }, 403);
    }
    const account = await getLineAccountById(c.env.DB, id);
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const staff = c.get('staff');
    const data = staff?.role === 'staff'
      ? serializeLineAccount(account)
      : serializeLineAccountFull(account);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---- 顧客アクセスキー (customer role) の発行 / 一覧 / 失効 ----
// 各 LINE アカウントに対して「お客様ログイン用のキー」を発行する。発行された
// キーは customer role + assigned_line_account_id=このアカウント で作られ、
// enforceCustomerScope により他アカウントは一切見られない。
function serializeCustomerKey(row: StaffMember) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: Boolean(row.is_active),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    // apiKey は発行直後の 1 度だけ返す (一覧では返さない)。
  };
}

// GET 一覧 (owner/admin のみ)
lineAccounts.get('/api/line-accounts/:id/customer-keys', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const keys = await getCustomerKeysByAccount(c.env.DB, id);
    return c.json({ success: true, data: keys.map(serializeCustomerKey) });
  } catch (err) {
    console.error('GET /api/line-accounts/:id/customer-keys error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST 発行 (owner/admin のみ)
lineAccounts.post('/api/line-accounts/:id/customer-keys', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const account = await getLineAccountById(c.env.DB, id);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    const body = await c.req
      .json<{ name?: string; email?: string | null }>()
      .catch(() => ({}) as { name?: string; email?: string | null });
    const name = (body.name ?? '').trim() || `${account.name} お客様ログイン`;
    const hashSecret = (c.env as { API_KEY_HASH_SECRET?: string }).API_KEY_HASH_SECRET;
    const created = await createStaffMember(
      c.env.DB,
      { name, email: body.email ?? null, role: 'customer', assigned_line_account_id: id },
      hashSecret,
    );
    return c.json({
      success: true,
      data: { ...serializeCustomerKey(created), apiKey: created.plainApiKey },
    });
  } catch (err) {
    console.error('POST /api/line-accounts/:id/customer-keys error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST 再発行 (owner/admin のみ) — 旧キーは無効化され新キーを 1 度だけ返す
lineAccounts.post('/api/line-accounts/:id/customer-keys/:keyId/regenerate', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const keyId = c.req.param('keyId')!;
    const key = await getStaffById(c.env.DB, keyId);
    if (!key || key.role !== 'customer' || key.assigned_line_account_id !== id) {
      return c.json({ success: false, error: 'customer key not found' }, 404);
    }
    const hashSecret = (c.env as { API_KEY_HASH_SECRET?: string }).API_KEY_HASH_SECRET;
    const newKey = await regenerateStaffApiKey(c.env.DB, keyId, hashSecret);
    return c.json({ success: true, data: { id: keyId, apiKey: newKey } });
  } catch (err) {
    console.error('POST customer-keys regenerate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE 失効 (owner/admin のみ)
lineAccounts.delete('/api/line-accounts/:id/customer-keys/:keyId', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const keyId = c.req.param('keyId')!;
    const key = await getStaffById(c.env.DB, keyId);
    if (!key || key.role !== 'customer' || key.assigned_line_account_id !== id) {
      return c.json({ success: false, error: 'customer key not found' }, 404);
    }
    await deleteStaffMember(c.env.DB, keyId);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/line-accounts/:id/customer-keys/:keyId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Normalize optional string inputs from the UI:
//   undefined → undefined (caller skips the column)
//   null      → null      (explicit clear)
//   ""        → null      (UI cleared the field)
//   non-string → undefined (defensive: silently drop bad input)
//
// Defined here (and in PATCH below) rather than shared, because the create
// path treats undefined and "" identically (both "no value provided"), while
// the partial-update path needs to distinguish "field absent" (no change)
// from "field cleared" (set to null). Keep the helper local so future
// behavior changes don't accidentally couple the two paths.
function normalizeOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

// Pair-validate Login Channel ID / Secret. Required because the OAuth flow
// asymmetrically gates on the two columns:
//   /auth/line       — switches to account-specific client_id as soon as
//                      login_channel_id is set (regardless of secret)
//   /auth/callback   — only uses account-specific creds when BOTH are set
// → an account with id-only or secret-only ends up half-configured: looks
// fine in the list, breaks token exchange for new friend-add flows.
//
// Rule: within a single request, the two fields must end up consistent.
// "current" reflects the state already stored (used on update paths so the
// caller can leave the secret unchanged when only renaming the ID).
function validateLoginChannelPair(
  next: { loginChannelId?: string | null | undefined; loginChannelSecret?: string | null | undefined },
  current: { login_channel_id: string | null; login_channel_secret: string | null } | null,
): string | null {
  // Resolve the post-update state for each field.
  // undefined = "not in request" → keep current value
  // null/string = "explicit set"  → use as-is
  const finalId =
    next.loginChannelId === undefined
      ? current?.login_channel_id ?? null
      : next.loginChannelId;
  const finalSecret =
    next.loginChannelSecret === undefined
      ? current?.login_channel_secret ?? null
      : next.loginChannelSecret;

  const idSet = finalId !== null && finalId !== '';
  const secretSet = finalSecret !== null && finalSecret !== '';

  if (idSet !== secretSet) {
    return idSet
      ? 'loginChannelSecret must be provided when loginChannelId is set'
      : 'loginChannelId must be provided when loginChannelSecret is set';
  }
  return null;
}

// Reject duplicate login_channel_id / liff_id across accounts.
// /auth/callback and /api/liff/config both resolve the row with `.first()`
// after a `WHERE col = ?` lookup, so duplicates would silently bind events
// to whichever row D1 happens to return first. App-level check (no DB UNIQUE
// constraint) so we can tighten without a migration on a busy production DB.
async function checkUniqueLoginAndLiff(
  db: D1Database,
  values: { loginChannelId?: string | null | undefined; liffId?: string | null | undefined },
  excludeId: string | null,
): Promise<string | null> {
  // Only check fields we're explicitly setting to non-null.
  const checks: Array<{ column: string; value: string; label: string }> = [];
  if (typeof values.loginChannelId === 'string' && values.loginChannelId !== '') {
    checks.push({ column: 'login_channel_id', value: values.loginChannelId, label: 'loginChannelId' });
  }
  if (typeof values.liffId === 'string' && values.liffId !== '') {
    checks.push({ column: 'liff_id', value: values.liffId, label: 'liffId' });
  }
  for (const { column, value, label } of checks) {
    const row = excludeId
      ? await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? AND id != ? LIMIT 1`)
          .bind(value, excludeId)
          .first<{ id: string }>()
      : await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? LIMIT 1`)
          .bind(value)
          .first<{ id: string }>();
    if (row) {
      return `${label} '${value}' is already assigned to another account`;
    }
  }
  return null;
}

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
    }>();

    if (!body.channelId || !body.name || !body.channelAccessToken || !body.channelSecret) {
      return c.json(
        { success: false, error: 'channelId, name, channelAccessToken, and channelSecret are required' },
        400,
      );
    }

    // Optional fields: empty string from UI = "not provided" → store NULL.
    // Trim whitespace defensively (LINE IDs/secrets shouldn't have spaces;
    // accidental spaces from copy-paste would silently break OAuth otherwise).
    const loginChannelId = normalizeOptionalString(body.loginChannelId) ?? null;
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret) ?? null;
    const liffId = normalizeOptionalString(body.liffId) ?? null;

    const pairError = validateLoginChannelPair(
      { loginChannelId, loginChannelSecret },
      null,
    );
    if (pairError) return c.json({ success: false, error: pairError }, 400);

    const dupError = await checkUniqueLoginAndLiff(c.env.DB, { loginChannelId, liffId }, null);
    if (dupError) return c.json({ success: false, error: dupError }, 409);

    const account = await createLineAccount(c.env.DB, {
      channelId: body.channelId,
      name: body.name,
      channelAccessToken: body.channelAccessToken,
      channelSecret: body.channelSecret,
      loginChannelId,
      loginChannelSecret,
      liffId,
    });

    // Auto-enroll new account into the 'main' traffic pool.
    // If migration 039 ran before any LINE accounts existed (fresh tenant),
    // the 'main' pool was never seeded — create it on the first account.
    // createTrafficPool already mirrors activeAccountId into pool_accounts,
    // so we only call addPoolAccount when the pool already exists.
    // Non-fatal: account creation succeeds even if pool enrollment fails.
    try {
      const { getTrafficPoolBySlug, createTrafficPool, addPoolAccount } = await import(
        '@line-crm/db'
      );
      const existingMain = await getTrafficPoolBySlug(c.env.DB, 'main');
      if (!existingMain) {
        await createTrafficPool(c.env.DB, {
          slug: 'main',
          name: 'メインプール',
          activeAccountId: account.id,
        });
        console.log(`[line-accounts] created main pool (first-account bootstrap)`);
      } else {
        await addPoolAccount(c.env.DB, existingMain.id, account.id);
        console.log(`[line-accounts] enrolled new account ${account.id} into main pool`);
      }
    } catch (err) {
      console.error('[line-accounts] failed to auto-enroll into main pool', err);
    }

    // Initialize AI metering so the account isn't silently stuck on the
    // "auto-reply paused" fallback. Without a tenant_metering row,
    // checkBudget() returns allowed=false (reason: no_metering) and every AI
    // reply degrades to the canned escalation message. Default to 'lite';
    // owner can change the plan later via /api/metering/init. Non-fatal.
    try {
      await initTenantMetering(c.env.DB, account.id, 'lite');
    } catch (err) {
      console.error('[line-accounts] failed to init tenant metering', err);
    }

    c.executionCtx.waitUntil(bustLiteCache());
    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    // D1 surfaces UNIQUE-constraint violations as a thrown error. Surface
    // those as 409 so idempotent callers (e.g. create-line-harness retry
    // loop) can treat "already registered" as a non-fatal success.
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) {
      return c.json({ success: false, error: 'channelId already registered' }, 409);
    }
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Authorization split:
//   PUT  (credentials replace)                                       -> owner only
//   PATCH /:id   (metadata: country/role/is_active/display_order)    -> owner|admin
//   PATCH /order (display_order bulk reorder)                        -> owner|admin
// Rationale: PUT replaces channel_access_token / channel_secret which is high-risk
// (mistake or misuse can stop production). PATCH only edits display metadata that
// is operationally safe for admins to change without owner intervention.

// PATCH /api/line-accounts/order — bulk update display_order
// IMPORTANT: must be declared BEFORE /:id so Hono matches the literal "order" first.
lineAccounts.patch(
  '/api/line-accounts/order',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{
        ordered: Array<{ id: string; displayOrder: number }>;
      }>();

      if (!Array.isArray(body.ordered)) {
        return c.json({ success: false, error: 'ordered: array required' }, 400);
      }
      for (const item of body.ordered) {
        if (typeof item.id !== 'string' || typeof item.displayOrder !== 'number') {
          return c.json(
            { success: false, error: 'ordered[].id (string) and displayOrder (number) required' },
            400,
          );
        }
      }

      await updateLineAccountOrder(c.env.DB, body.ordered);
      c.executionCtx.waitUntil(bustLiteCache());
      return c.json({ success: true });
    } catch (err) {
      console.error('PATCH /api/line-accounts/order error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PATCH /api/line-accounts/:id — partial update of metadata + optional Login/LIFF wiring.
// Scope: name, isActive, country, role, loginChannelId, loginChannelSecret, liffId.
// Out-of-scope (use PUT instead): channelAccessToken, channelSecret — those are
// production-impacting credentials and require owner-only PUT.
//
// Why loginChannelSecret is allowed via PATCH (admin) but channelSecret isn't:
// rotating the LINE Login secret only breaks the auth/friend-add flow for new
// users (recoverable). Rotating the Messaging channelSecret breaks webhook
// verification for *all* incoming events from LINE → silent message loss, no
// observability until users complain. Different blast radius, different role.
lineAccounts.patch(
  '/api/line-accounts/:id',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const id = c.req.param('id')!;
      const body = await c.req.json<{
        name?: string;
        isActive?: boolean;
        country?: string | null;
        role?: string | null;
        loginChannelId?: string | null;
        loginChannelSecret?: string | null;
        liffId?: string | null;
      }>();

      // Normalize: trim non-empty strings; treat empty/whitespace-only as null.
      // Empty-string-from-UI represents "user cleared the field" — store as NULL,
      // not as empty string, so countryFlag() lookup degrades gracefully.
      const country = normalizeOptionalString(body.country);
      const role = normalizeOptionalString(body.role);
      const loginChannelId = normalizeOptionalString(body.loginChannelId);
      const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
      const liffId = normalizeOptionalString(body.liffId);

      // Pre-validate Login pair + uniqueness against the existing row so the
      // caller gets a clean error before we mutate. Skip the lookup entirely
      // if the request doesn't touch any of the fields we'd validate, to
      // avoid a wasted SELECT on the toggle-isActive hot path.
      //
      // The pair check only runs when the request itself touches Login
      // fields. That matters because the setup CLI (packages/create-line-
      // harness/.../setup.ts:646-665) persists `login_channel_id` without
      // `login_channel_secret` as a best-effort step, so accounts in the
      // wild can have a half-set Login pair. A LIFF-only dashboard save
      // shouldn't be blocked by that pre-existing inconsistency.
      const touchesLogin =
        loginChannelId !== undefined || loginChannelSecret !== undefined;
      const touchesLoginOrLiff = touchesLogin || liffId !== undefined;
      if (touchesLoginOrLiff) {
        const current = await getLineAccountById(c.env.DB, id);
        if (!current) return c.json({ success: false, error: 'not found' }, 404);
        if (touchesLogin) {
          const pairError = validateLoginChannelPair(
            { loginChannelId, loginChannelSecret },
            current,
          );
          if (pairError) return c.json({ success: false, error: pairError }, 400);
        }
        const dupError = await checkUniqueLoginAndLiff(
          c.env.DB,
          { loginChannelId, liffId },
          id,
        );
        if (dupError) return c.json({ success: false, error: dupError }, 409);
      }

      const fieldsTouched =
        country !== undefined ||
        role !== undefined ||
        body.isActive !== undefined ||
        touchesLoginOrLiff;

      // Route to the fields helper when name is not being changed.
      if (body.name === undefined && fieldsTouched) {
        const updated = await updateLineAccountFields(c.env.DB, id, {
          country,
          role,
          isActive: body.isActive,
          loginChannelId,
          loginChannelSecret,
          liffId,
        });
        if (!updated) return c.json({ success: false, error: 'not found' }, 404);
        c.executionCtx.waitUntil(bustLiteCache());
        return c.json({ success: true, data: serializeLineAccount(updated) });
      }

      // name is present — use the full updateLineAccount path
      const updated = await updateLineAccount(c.env.DB, id, {
        name: body.name,
        is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        login_channel_id: loginChannelId,
        login_channel_secret: loginChannelSecret,
        liff_id: liffId,
      });
      if (!updated) return c.json({ success: false, error: 'LINE account not found' }, 404);
      c.executionCtx.waitUntil(bustLiteCache());
      return c.json({ success: true, data: serializeLineAccount(updated) });
    } catch (err) {
      console.error('PATCH /api/line-accounts/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PUT /api/line-accounts/:id - update
// Despite the verb, behaves as a partial update (only provided fields are
// touched). Kept on PUT + owner-only because it's the entry point for
// rotating Messaging credentials (channelAccessToken / channelSecret).
// Also accepts the metadata fields that PATCH handles so an owner can update
// "everything" in one call (e.g. AccountSettingsSection sends country/role
// through this same `api.lineAccounts.update` helper). Without this, country
// and role were silently dropped because PUT used to ignore them.
lineAccounts.put('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      isActive?: boolean;
      country?: string | null;
      role?: string | null;
    }>();

    const country = normalizeOptionalString(body.country);
    const role = normalizeOptionalString(body.role);
    const loginChannelId = normalizeOptionalString(body.loginChannelId);
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
    const liffId = normalizeOptionalString(body.liffId);

    // Validate Login pair + uniqueness identically to PATCH. PUT is the
    // owner-only credential rotation endpoint, so the same correctness
    // guarantees should apply here.
    const putTouchesLogin =
      loginChannelId !== undefined || loginChannelSecret !== undefined;
    if (putTouchesLogin || liffId !== undefined) {
      const current = await getLineAccountById(c.env.DB, id);
      if (!current) return c.json({ success: false, error: 'LINE account not found' }, 404);
      if (putTouchesLogin) {
        const pairError = validateLoginChannelPair(
          { loginChannelId, loginChannelSecret },
          current,
        );
        if (pairError) return c.json({ success: false, error: pairError }, 400);
      }
      const dupError = await checkUniqueLoginAndLiff(
        c.env.DB,
        { loginChannelId, liffId },
        id,
      );
      if (dupError) return c.json({ success: false, error: dupError }, 409);
    }

    // Two-step update because metadata (country/role) lives on a separate
    // helper from the credentials/name path. Skip whichever step has nothing
    // to do so we don't bump updated_at gratuitously.
    const credentialsTouched =
      body.name !== undefined ||
      body.channelAccessToken !== undefined ||
      body.channelSecret !== undefined ||
      loginChannelId !== undefined ||
      loginChannelSecret !== undefined ||
      liffId !== undefined ||
      body.isActive !== undefined;

    let updated = credentialsTouched
      ? await updateLineAccount(c.env.DB, id, {
          name: body.name,
          channel_access_token: body.channelAccessToken,
          channel_secret: body.channelSecret,
          login_channel_id: loginChannelId,
          login_channel_secret: loginChannelSecret,
          liff_id: liffId,
          is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        })
      : await getLineAccountById(c.env.DB, id);

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    if (country !== undefined || role !== undefined) {
      updated = await updateLineAccountFields(c.env.DB, id, {
        country,
        role,
      });
      if (!updated) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
    }

    c.executionCtx.waitUntil(bustLiteCache());
    return c.json({ success: true, data: serializeLineAccountFull(updated) });
  } catch (err) {
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/line-accounts/:id - delete
lineAccounts.delete('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    await deleteLineAccount(c.env.DB, c.req.param('id')!);
    c.executionCtx.waitUntil(bustLiteCache());
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { lineAccounts };
