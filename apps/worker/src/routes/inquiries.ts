/**
 * 無料相談・問い合わせ受付 API
 *
 * POST /api/inquiries         公開 endpoint（LP からの問い合わせ受付、認証不要）
 * GET  /api/inquiries         reo さん側で一覧取得（認証必要）
 * GET  /api/inquiries/:id     詳細取得（認証必要）
 * PATCH /api/inquiries/:id    ステータス更新（認証必要）
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const inquiries = new Hono<Env>();

const ALLOWED_SOURCES = ['lp_free_consult', 'lp_document_request', 'lp_other'] as const;
const ALLOWED_PLANS = ['lite', 'standard', 'pro', 'unknown'] as const;
const ALLOWED_STATUSES = ['new', 'contacted', 'meeting_scheduled', 'closed_won', 'closed_lost', 'spam'] as const;

type Source = (typeof ALLOWED_SOURCES)[number];
type Plan = (typeof ALLOWED_PLANS)[number];
type Status = (typeof ALLOWED_STATUSES)[number];

// 公開 endpoint（認証不要）
inquiries.post('/api/inquiries', async (c) => {
  let body: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    industry?: string;
    planInterest?: string;
    message?: string;
    preferredDates?: string;
    source?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON' }, 400);
  }

  // バリデーション
  if (!body.contactName || body.contactName.length < 1 || body.contactName.length > 100) {
    return c.json({ success: false, error: 'contactName required (1-100 chars)' }, 400);
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ success: false, error: 'valid email required' }, 400);
  }
  if (!body.message || body.message.length < 1 || body.message.length > 5000) {
    return c.json({ success: false, error: 'message required (1-5000 chars)' }, 400);
  }
  const source = (ALLOWED_SOURCES as readonly string[]).includes(body.source ?? '')
    ? (body.source as Source)
    : 'lp_other';
  const planInterest = (ALLOWED_PLANS as readonly string[]).includes(body.planInterest ?? '')
    ? (body.planInterest as Plan)
    : 'unknown';

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
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
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
