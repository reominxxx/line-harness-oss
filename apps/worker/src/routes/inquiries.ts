/**
 * 無料相談・問い合わせ受付 API
 *
 * POST /api/inquiries         公開 endpoint（LP からの問い合わせ受付、認証不要）
 * GET  /api/inquiries         reo さん側で一覧取得（認証必要）
 * GET  /api/inquiries/:id     詳細取得（認証必要）
 * PATCH /api/inquiries/:id    ステータス更新（認証必要）
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index.js';

export const inquiries = new Hono<Env>();

const ALLOWED_SOURCES = ['lp_free_consult', 'lp_document_request', 'lp_other'] as const;
const ALLOWED_PLANS = ['lite', 'standard', 'pro', 'unknown'] as const;
const ALLOWED_STATUSES = ['new', 'contacted', 'meeting_scheduled', 'closed_won', 'closed_lost', 'spam'] as const;

type Source = (typeof ALLOWED_SOURCES)[number];
type Plan = (typeof ALLOWED_PLANS)[number];
type Status = (typeof ALLOWED_STATUSES)[number];

// 公開フォームへの入力は外部から自由に投げ込めるため、宣言的なバリデーションで
// 文字長・形式を強制する。DoS / DB 汚染 / XSS への一次防御。
const inquirySchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  contactName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional(),
  industry: z.string().trim().max(100).optional(),
  planInterest: z.enum(ALLOWED_PLANS).optional(),
  message: z.string().trim().min(1).max(5000),
  preferredDates: z.string().trim().max(500).optional(),
  source: z.enum(ALLOWED_SOURCES).optional(),
  turnstileToken: z.string().max(2000).optional(),
});

/**
 * Cloudflare Turnstile token を検証。
 * - 本番環境では Turnstile widget が token を発行し、フロントからこの POST body に乗せる
 * - TURNSTILE_SECRET_KEY 未設定の場合は検証スキップ (開発環境)
 * - 失敗時 false、成功時 true
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
async function verifyTurnstile(token: string | undefined, secret: string | undefined, remoteIp: string | null): Promise<boolean> {
  if (!secret) return true; // secret 未設定 = 検証スキップ (開発時用)
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (remoteIp) params.append('remoteip', remoteIp);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
    });
    const json = (await res.json()) as { success: boolean };
    return json.success === true;
  } catch (e) {
    console.warn('[inquiries] turnstile verify failed:', e);
    return false;
  }
}

// 公開 endpoint（認証不要）
inquiries.post('/api/inquiries', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON' }, 400);
  }

  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: 'validation_failed',
        // production では詳細を返さない方が安全だが、フォーム改善のためフィールド名のみ返す
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      },
      400,
    );
  }
  const body = parsed.data;

  // Turnstile (CAPTCHA) 検証 — 公開エンドポイントなのでスパム/ボット対策必須
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const turnstileSecret = (c.env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY;
  const captchaOk = await verifyTurnstile(body.turnstileToken, turnstileSecret, ip);
  if (!captchaOk) {
    return c.json({ success: false, error: 'captcha_failed' }, 400);
  }

  const source: Source = body.source ?? 'lp_other';
  const planInterest: Plan = body.planInterest ?? 'unknown';

  // 軽い重複防止: 直近 5 分の同じメールアドレスを拒否
  const recent = await c.env.DB
    .prepare(
      `SELECT id FROM inquiries WHERE email = ?
         AND created_at >= datetime('now', '-5 minutes', '+9 hours')
       LIMIT 1`,
    )
    .bind(body.email)
    .first();
  if (recent) {
    return c.json({ success: false, error: 'rate_limited' }, 429);
  }

  const id = crypto.randomUUID();
  const ua = c.req.header('user-agent')?.slice(0, 500) ?? null;

  await c.env.DB
    .prepare(
      `INSERT INTO inquiries
       (id, company_name, contact_name, email, phone, industry, plan_interest, message,
        preferred_dates, source, status, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    )
    .bind(
      id,
      body.companyName ?? null,
      body.contactName,
      body.email,
      body.phone ?? null,
      body.industry ?? null,
      planInterest,
      body.message,
      body.preferredDates ?? null,
      source,
      ip,
      ua,
    )
    .run();

  // reo さん側への通知は best-effort（LINE Webhook / Email 連携は別途）
  console.log('[inquiries] new:', { id, source, email: body.email });

  return c.json({ success: true, id });
});

// 以下は管理画面用（認証は middleware で別途）
inquiries.get('/api/inquiries', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

  let sql = `SELECT id, company_name, contact_name, email, phone, industry, plan_interest,
                    message, preferred_dates, source, status, staff_note, assigned_to,
                    created_at, updated_at
             FROM inquiries`;
  const params: (string | number)[] = [];
  if (status && (ALLOWED_STATUSES as readonly string[]).includes(status)) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const res = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ success: true, inquiries: res.results });
});

inquiries.get('/api/inquiries/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare(
      `SELECT id, company_name, contact_name, email, phone, industry, plan_interest, message,
              preferred_dates, source, status, staff_note, assigned_to, ip_address,
              created_at, updated_at
       FROM inquiries WHERE id = ?`,
    )
    .bind(id)
    .first();
  if (!row) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, inquiry: row });
});

inquiries.patch('/api/inquiries/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string; staffNote?: string; assignedTo?: string | null }>();

  const updates: string[] = [];
  const params: (string | null)[] = [];

  if (body.status) {
    if (!(ALLOWED_STATUSES as readonly string[]).includes(body.status)) {
      return c.json({ success: false, error: 'invalid status' }, 400);
    }
    updates.push('status = ?');
    params.push(body.status as Status);
  }
  if (body.staffNote !== undefined) {
    updates.push('staff_note = ?');
    params.push(body.staffNote);
  }
  if (body.assignedTo !== undefined) {
    updates.push('assigned_to = ?');
    params.push(body.assignedTo);
  }
  if (updates.length === 0) {
    return c.json({ success: false, error: 'no updates' }, 400);
  }

  updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`);
  params.push(id);

  await c.env.DB.prepare(`UPDATE inquiries SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  return c.json({ success: true });
});
