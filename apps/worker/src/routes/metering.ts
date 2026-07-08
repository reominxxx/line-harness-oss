/**
 * テナント計量・コスト管理 API routes
 *
 * GET    /api/metering                    現プランの含有枠・使用量・超過課金
 * POST   /api/metering/init                プラン初期化（Owner のみ）
 * PUT    /api/metering                    個別料金・配信枠を直接編集（Owner のみ）
 * GET    /api/metering/usage               AI 使用ログサマリー（月別）
 * GET    /api/metering/usage/log           直近の AI 使用ログ詳細
 */

import { Hono } from 'hono';
import {
  getTenantMetering,
  initTenantMetering,
  updateTenantMeteringCustom,
  getAiUsageSummary,
  PLAN_QUOTAS,
  PLAN_OVERAGE_RATES,
  type Plan,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const metering = new Hono<Env>();

const VALID_PLANS: Plan[] = ['lite', 'standard', 'pro', 'enterprise'];

/**
 * UI から来る開始日時を JST ISO (+09:00) に正規化する。
 *  - 空文字 / 空白 → null (= 暦月リセットに戻す)
 *  - 'YYYY-MM-DDTHH:mm' (datetime-local) → 秒・ミリ秒・+09:00 を補完
 *  - すでにオフセット (+hh:mm / Z) 付き → そのまま
 */
function normalizeCycleStartedAt(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '') return null;
  if (/[+-]\d{2}:\d{2}$/.test(s) || /Z$/.test(s)) return s;
  let body = s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) body = `${s}:00.000`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) body = `${s}.000`;
  return `${body}+09:00`;
}

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

/**
 * 個別料金 / 配信枠を直接編集する (営業で個別見積もりを取った後、運用代行側で
 * 値を書き換える想定)。プラン選択 UI に依存しない自由入力フォーム経由で呼ぶ。
 */
metering.put('/api/metering', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  if (staff?.role !== 'owner') {
    return c.json({ success: false, error: 'Owner role required' }, 403);
  }
  const existing = await getTenantMetering(c.env.DB, lineAccountId);
  if (!existing) {
    return c.json(
      { success: false, error: 'Metering not initialized. POST /api/metering/init first.' },
      404,
    );
  }
  type UpdateBody = {
    monthly_fee_yen?: number | null;
    monthly_broadcast_quota?: number;
    monthly_chat_quota?: number;
    monthly_vision_quota?: number;
    monthly_imagegen_quota?: number;
    monthly_kb_doc_quota?: number;
    monthly_budget_cap_yen?: number | null;
    /** datetime-local ('YYYY-MM-DDTHH:mm') / JST ISO / 空文字。空文字 or null で暦月リセットに戻す */
    cycle_started_at?: string | null;
  };
  const body = (await c.req.json<UpdateBody>().catch(() => ({}))) as UpdateBody;

  await updateTenantMeteringCustom(c.env.DB, lineAccountId, {
    monthlyFeeYen: body.monthly_fee_yen,
    monthlyBroadcastQuota: body.monthly_broadcast_quota,
    monthlyChatQuota: body.monthly_chat_quota,
    monthlyVisionQuota: body.monthly_vision_quota,
    monthlyImagegenQuota: body.monthly_imagegen_quota,
    monthlyKbDocQuota: body.monthly_kb_doc_quota,
    monthlyBudgetCapYen: body.monthly_budget_cap_yen,
    cycleStartedAt:
      body.cycle_started_at === undefined
        ? undefined
        : normalizeCycleStartedAt(body.cycle_started_at),
  });

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
