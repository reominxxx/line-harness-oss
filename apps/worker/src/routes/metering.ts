/**
 * テナント計量・コスト管理 API routes
 *
 * GET    /api/metering                    現プランの含有枠・使用量・超過課金
 * POST   /api/metering/init                プラン初期化（Owner のみ）
 * GET    /api/metering/usage               AI 使用ログサマリー（月別）
 * GET    /api/metering/usage/log           直近の AI 使用ログ詳細
 */

import { Hono } from 'hono';
import {
  getTenantMetering,
  initTenantMetering,
  getAiUsageSummary,
  PLAN_QUOTAS,
  PLAN_OVERAGE_RATES,
  type Plan,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const metering = new Hono<Env>();

const VALID_PLANS: Plan[] = ['lite', 'standard', 'pro', 'enterprise'];

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

metering.get('/api/metering', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const m = await getTenantMetering(c.env.DB, lineAccountId);
  if (!m) {
    return c.json({
      success: true,
      metering: null,
      hint: 'POST /api/metering/init で初期化してください',
    });
  }
  // 派生情報を含めて返す
  return c.json({
    success: true,
    metering: m,
    derived: {
      remaining_broadcast: Math.max(m.monthly_broadcast_quota - m.used_broadcast, 0),
      remaining_chat: Math.max(m.monthly_chat_quota - m.used_chat, 0),
      remaining_vision: Math.max(m.monthly_vision_quota - m.used_vision, 0),
      remaining_imagegen: Math.max(m.monthly_imagegen_quota - m.used_imagegen, 0),
      remaining_kb: Math.max(m.monthly_kb_doc_quota - m.used_kb_doc, 0),
      overage_rates: PLAN_OVERAGE_RATES[m.plan],
    },
  });
});

metering.post('/api/metering/init', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  if (staff?.role !== 'owner') {
    return c.json({ success: false, error: 'Owner role required' }, 403);
  }
  const body = await c.req.json<{ plan: Plan }>();
  if (!body.plan || !VALID_PLANS.includes(body.plan)) {
    return c.json({ success: false, error: 'Invalid plan' }, 400);
  }
  await initTenantMetering(c.env.DB, lineAccountId, body.plan);
  const m = await getTenantMetering(c.env.DB, lineAccountId);
  return c.json({ success: true, metering: m });
});

metering.get('/api/metering/usage', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const yearMonth = c.req.query('year_month') ?? new Date().toISOString().slice(0, 7);
  const summary = await getAiUsageSummary(c.env.DB, lineAccountId, yearMonth);
  return c.json({ success: true, year_month: yearMonth, summary });
});

metering.get('/api/metering/usage/log', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500);
  const feature = c.req.query('feature');

  let sql = `SELECT * FROM ai_usage_log WHERE line_account_id = ?`;
  const values: unknown[] = [lineAccountId];
  if (feature) {
    sql += ` AND feature = ?`;
    values.push(feature);
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  values.push(limit);

  const result = await c.env.DB.prepare(sql).bind(...values).all();
  return c.json({ success: true, logs: result.results });
});

metering.get('/api/metering/plans', async (c) => {
  return c.json({
    success: true,
    plans: VALID_PLANS.map((p) => ({
      key: p,
      quotas: PLAN_QUOTAS[p],
      overage_rates: PLAN_OVERAGE_RATES[p],
    })),
  });
});
