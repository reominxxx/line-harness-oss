import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';
import { recordFailedAuth } from './rate-limit.js';

function clientIp(c: Context<Env>): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  if (!path.startsWith('/api/')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    // agency-examples の画像配信 (<img src> 経由で取得するため認証なし)
    path.startsWith('/api/agency-examples/image/') ||
    // AI 生成された配信画像の配信 (<img src> 経由で取得するため認証なし)
    path.startsWith('/api/broadcast-images/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    (path === '/api/csp-report' && c.req.method === 'POST') ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+\/opened$/) ||
    path.match(/^\/api\/forms\/[^/]+\/partial$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    (path === '/api/inquiries' && c.req.method === 'POST') || // LP からの問い合わせ受付
    path.startsWith('/api/coupons/public/') || // 顧客向けクーポン閲覧 / 使用 (LIFF)
    path.startsWith('/reports/render/') // 公開レポート閲覧（顧客が PDF 保存用に開く）
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    recordFailedAuth(clientIp(c));
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check staff_members table first (ハッシュ照合 → 旧平文フォールバック lazy migration)
  const hashSecret = (c.env as { API_KEY_HASH_SECRET?: string }).API_KEY_HASH_SECRET;
  const staff = await getStaffByApiKey(c.env.DB, token, hashSecret);
  if (staff) {
    // Origin / Role enforcement: 顧客向け URL (app.line-port.com 等) からのリクエストは
    // customer role のみ。team.line-port.com / pages.dev / localhost からは staff 以上のみ。
    // これにより「app の URL に admin がログインしても /api を叩けない」物理ガードになる。
    const denial = enforceOriginRole(c, staff.role);
    if (denial) return denial;
    // customer role は assigned_line_account_id にスコープを固定する。
    // 明示的に別アカウントを指定してくるリクエストは 403 で弾く物理ガード。
    if (staff.role === 'customer') {
      const scopeDenial = enforceCustomerScope(c, staff.assigned_line_account_id);
      if (scopeDenial) return scopeDenial;
    }
    c.set('staff', {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      assignedLineAccountId: staff.assigned_line_account_id,
    });
    return next();
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    const denial = enforceOriginRole(c, 'owner');
    if (denial) return denial;
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Uses the same staff.id as primary so /api/staff/me's special-case keeps
  // working. Logs accept_via=LEGACY_API_KEY so operators can confirm zero
  // legacy usage before deleting the secret to revoke the old key.
  // Same-value guard: if both env vars are set to the same secret, the
  // primary check above already accepts it; this branch must skip to avoid
  // false LEGACY counters.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    const denial = enforceOriginRole(c, 'owner');
    if (denial) return denial;
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return next();
  }

  recordFailedAuth(clientIp(c));
  return c.json({ success: false, error: 'Unauthorized' }, 401);
}

/**
 * Origin / role 整合性チェック。
 * - 顧客向け URL (app.line-port.com / staging.line-port.com / *.l-port-admin*.pages.dev)
 *   からのリクエストは customer role のみ許可。staff 以上は admin URL から来るべき。
 * - 運用チーム URL (team.line-port.com / staging-team.line-port.com / l-port-team.pages.dev /
 *   旧 line-harness pages / localhost) は customer 以外を許可。
 * - その他不明 Origin は通常通り (CORS で別途弾く)。
 *
 * 戻り値: 拒否時は 403 レスポンスを返す。null なら通過 OK。
 */
function enforceOriginRole(c: Context<Env>, role: string): Response | null {
  const origin = c.req.header('origin');
  if (!origin) return null; // 同一オリジン / curl / webhook 等は origin なし
  // CUSTOMER 専用 surface (顧客が触る URL)
  const isCustomerSurface =
    origin === 'https://app.line-port.com' ||
    origin === 'https://staging.line-port.com' ||
    origin === 'https://line-port.com' ||
    /^https:\/\/[a-z0-9]+\.l-port-admin\.pages\.dev$/.test(origin) ||
    /^https:\/\/[a-z0-9]+\.l-port-admin-staging\.pages\.dev$/.test(origin) ||
    origin === 'https://l-port-admin.pages.dev' ||
    origin === 'https://l-port-admin-staging.pages.dev';
  if (isCustomerSurface && role !== 'customer') {
    console.warn('[auth] customer-surface admin attempt blocked', { origin, role });
    return c.json({ success: false, error: 'Forbidden: admin access not allowed from customer URL' }, 403);
  }
  // TEAM 専用 surface (staff/admin/owner)
  const isTeamSurface =
    origin === 'https://team.line-port.com' ||
    origin === 'https://staging-team.line-port.com' ||
    origin === 'https://l-port-team.pages.dev' ||
    origin === 'https://l-port-team-staging.pages.dev' ||
    /^https:\/\/[a-z0-9]+\.l-port-team\.pages\.dev$/.test(origin) ||
    /^https:\/\/[a-z0-9]+\.l-port-team-staging\.pages\.dev$/.test(origin) ||
    /^https:\/\/[a-z0-9]+\.line-harness-test-admin-fdb73abf\.pages\.dev$/.test(origin) ||
    origin === 'https://line-harness-test-admin-fdb73abf.pages.dev' ||
    origin === 'https://line-harness-staging-admin.pages.dev' ||
    origin === 'http://localhost:3001' ||
    origin === 'http://127.0.0.1:3001';
  if (isTeamSurface && role === 'customer') {
    console.warn('[auth] team-surface customer attempt blocked', { origin, role });
    return c.json({ success: false, error: 'Forbidden: customer cannot access team URL' }, 403);
  }
  return null;
}

/**
 * customer role が到達してよい API パスのホワイトリスト (デフォルト拒否)。
 * お客様画面 (app.line-port.com 等) は「読み取り専用ダッシュボード」なので、
 * 実際に叩く GET エンドポイントだけを列挙する。ここに無いパスは 403。
 * これにより friends/:id・chats/:id・coupons・tracked-links・conversions・forms 等の
 * リソース ID 直引き (IDOR) を一括で遮断する。
 * requiresAccount=true のパスは x-line-account-id / lineAccountId の指定を必須にし、
 * 省略時に「全アカウント返却」へフォールバックする一覧系の越境を防ぐ。
 */
const CUSTOMER_ALLOWLIST: Array<{ re: RegExp; requiresAccount: boolean }> = [
  { re: /^\/api\/staff\/me$/, requiresAccount: false },
  { re: /^\/api\/line-accounts$/, requiresAccount: false },
  { re: /^\/api\/line-accounts\/lite$/, requiresAccount: false },
  { re: /^\/api\/friends\/count$/, requiresAccount: true },
  { re: /^\/api\/chats$/, requiresAccount: true },
  { re: /^\/api\/broadcasts$/, requiresAccount: true },
  { re: /^\/api\/broadcasts\/[^/]+\/insight$/, requiresAccount: true },
  { re: /^\/api\/broadcasts\/[^/]+\/related-messages$/, requiresAccount: true },
  { re: /^\/api\/exports\/manifest$/, requiresAccount: true },
  { re: /^\/api\/exports\/[^/]+$/, requiresAccount: true },
];

/**
 * customer role のアカウントスコープ強制 (デフォルト拒否ゲート)。
 * - assigned_line_account_id が無い customer キーは何も見られない (403)。
 * - customer は読み取り専用。GET 以外は一律 403。
 * - CUSTOMER_ALLOWLIST に無いパスは 403 (IDOR 遮断の要)。
 * - 明示アカウント指定 (x-line-account-id / lineAccountId) が割当と不一致なら 403。
 * - requiresAccount のパスでアカウント未指定なら 403 (一覧系の全件越境防止)。
 */
function enforceCustomerScope(c: Context<Env>, assigned: string | null): Response | null {
  if (!assigned) {
    console.warn('[auth] customer key without assigned account blocked', { path: new URL(c.req.url).pathname });
    return c.json({ success: false, error: 'Forbidden: no account assigned to this key' }, 403);
  }
  const url = new URL(c.req.url);
  const path = url.pathname;
  const headerAccount = c.req.header('x-line-account-id');
  const queryAccount = url.searchParams.get('lineAccountId');
  // 差し替え検知: 割当と異なるアカウントを指定してきたら弾く。
  for (const requested of [headerAccount, queryAccount]) {
    if (requested && requested !== assigned) {
      console.warn('[auth] customer cross-account access blocked', { assigned, requested });
      return c.json({ success: false, error: 'Forbidden: account not in scope' }, 403);
    }
  }
  // 読み取り専用: 書き込み系は一切許可しない。
  if (c.req.method !== 'GET') {
    console.warn('[auth] customer non-GET blocked', { method: c.req.method, path });
    return c.json({ success: false, error: 'Forbidden: read-only access for customer key' }, 403);
  }
  const entry = CUSTOMER_ALLOWLIST.find((e) => e.re.test(path));
  if (!entry) {
    console.warn('[auth] customer path not in allowlist', { path });
    return c.json({ success: false, error: 'Forbidden: not permitted for this key' }, 403);
  }
  if (entry.requiresAccount && !headerAccount && !queryAccount) {
    console.warn('[auth] customer scoped path without account', { path });
    return c.json({ success: false, error: 'Forbidden: account must be specified' }, 403);
  }
  return null;
}
