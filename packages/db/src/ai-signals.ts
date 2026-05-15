/**
 * AI 顧客シグナル（ai_friend_signals）と AI 使用ログ（ai_usage_log）、
 * テナント計量（tenant_metering）のクエリヘルパー。
 *
 * 既存の friend_scores（行動ベース）と並列で「AI 推定値」を保持する。
 */

import { jstNow } from './utils.js';

// ---------------------------------------------------------------------------
// ai_friend_signals
// ---------------------------------------------------------------------------

export type VipRank = 'vip' | 'hot' | 'warm' | 'cold' | 'dormant' | 'new';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'angry';

export interface AiFriendSignalRow {
  friend_id: string;
  line_account_id: string;
  purchase_intent: number;
  churn_risk: number;
  ltv_estimate_yen: number | null;
  vip_rank: VipRank | null;
  sentiment: Sentiment | null;
  signal_summary: string | null;
  last_chat_at: string | null;
  last_calculated_at: string;
}

export async function getAiFriendSignal(
  db: D1Database,
  friendId: string,
): Promise<AiFriendSignalRow | null> {
  return db
    .prepare(`SELECT * FROM ai_friend_signals WHERE friend_id = ?`)
    .bind(friendId)
    .first<AiFriendSignalRow>();
}

export async function upsertAiFriendSignal(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId: string;
    purchaseIntent?: number;
    churnRisk?: number;
    ltvEstimateYen?: number | null;
    vipRank?: VipRank | null;
    sentiment?: Sentiment | null;
    signalSummary?: string | null;
    lastChatAt?: string | null;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO ai_friend_signals (
         friend_id, line_account_id, purchase_intent, churn_risk, ltv_estimate_yen,
         vip_rank, sentiment, signal_summary, last_chat_at, last_calculated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(friend_id) DO UPDATE SET
         line_account_id = excluded.line_account_id,
         purchase_intent = excluded.purchase_intent,
         churn_risk = excluded.churn_risk,
         ltv_estimate_yen = excluded.ltv_estimate_yen,
         vip_rank = excluded.vip_rank,
         sentiment = excluded.sentiment,
         signal_summary = excluded.signal_summary,
         last_chat_at = excluded.last_chat_at,
         last_calculated_at = excluded.last_calculated_at`,
    )
    .bind(
      input.friendId,
      input.lineAccountId,
      input.purchaseIntent ?? 0,
      input.churnRisk ?? 0,
      input.ltvEstimateYen ?? null,
      input.vipRank ?? null,
      input.sentiment ?? null,
      input.signalSummary ?? null,
      input.lastChatAt ?? null,
      now,
    )
    .run();
}

export async function listHotLeads(
  db: D1Database,
  lineAccountId: string,
  minIntent = 60,
  limit = 50,
): Promise<AiFriendSignalRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ai_friend_signals
       WHERE line_account_id = ? AND purchase_intent >= ?
       ORDER BY purchase_intent DESC LIMIT ?`,
    )
    .bind(lineAccountId, minIntent, limit)
    .all<AiFriendSignalRow>();
  return result.results;
}

export async function listByVipRank(
  db: D1Database,
  lineAccountId: string,
  rank: VipRank,
  limit = 100,
): Promise<AiFriendSignalRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ai_friend_signals
       WHERE line_account_id = ? AND vip_rank = ?
       ORDER BY last_calculated_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, rank, limit)
    .all<AiFriendSignalRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// ai_usage_log
// ---------------------------------------------------------------------------

export type AiFeature =
  | 'chat'
  | 'report'
  | 'copy_gen'
  | 'vision'
  | 'intent'
  | 'image_gen'
  | 'batch_analysis'
  | 'embedding'
  | 'moderation';

export interface AiUsageLogRow {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  feature: AiFeature;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_yen_x100: number;
  cached: number;
  request_id: string | null;
  created_at: string;
}

export async function logAiUsage(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId?: string | null;
    feature: AiFeature;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costYenX100: number;
    cached?: boolean;
    requestId?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_usage_log (id, line_account_id, friend_id, feature, model, input_tokens, output_tokens, cost_yen_x100, cached, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineAccountId,
      input.friendId ?? null,
      input.feature,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.costYenX100,
      input.cached ? 1 : 0,
      input.requestId ?? null,
      jstNow(),
    )
    .run();
}

export interface AiUsageSummary {
  total_cost_yen: number;
  total_calls: number;
  cached_calls: number;
  by_feature: Record<string, { calls: number; cost_yen: number }>;
}

export async function getAiUsageSummary(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string, // 'YYYY-MM'
): Promise<AiUsageSummary> {
  const result = await db
    .prepare(
      `SELECT feature, COUNT(*) as calls, SUM(cost_yen_x100) as cost,
              SUM(cached) as cached_calls
       FROM ai_usage_log
       WHERE line_account_id = ?
         AND substr(created_at, 1, 7) = ?
       GROUP BY feature`,
    )
    .bind(lineAccountId, yearMonth)
    .all<{ feature: string; calls: number; cost: number; cached_calls: number }>();

  let totalCost = 0;
  let totalCalls = 0;
  let totalCached = 0;
  const byFeature: AiUsageSummary['by_feature'] = {};

  for (const row of result.results) {
    const costYen = (row.cost ?? 0) / 100;
    totalCost += costYen;
    totalCalls += row.calls;
    totalCached += row.cached_calls;
    byFeature[row.feature] = { calls: row.calls, cost_yen: costYen };
  }

  return {
    total_cost_yen: totalCost,
    total_calls: totalCalls,
    cached_calls: totalCached,
    by_feature: byFeature,
  };
}

// ---------------------------------------------------------------------------
// tenant_metering
// ---------------------------------------------------------------------------

export type Plan = 'lite' | 'standard' | 'pro' | 'enterprise';

export interface TenantMeteringRow {
  line_account_id: string;
  plan: Plan;
  monthly_broadcast_quota: number;
  monthly_chat_quota: number;
  monthly_vision_quota: number;
  monthly_imagegen_quota: number;
  monthly_kb_doc_quota: number;
  current_month: string;
  used_broadcast: number;
  used_chat: number;
  used_vision: number;
  used_imagegen: number;
  used_kb_doc: number;
  overage_charge_yen: number;
  monthly_budget_cap_yen: number | null;
  alert_threshold_yen: number | null;
  auto_fallback_at_limit: number;
  updated_at: string;
}

/** プラン別の含有枠デフォルト */
export const PLAN_QUOTAS: Record<Plan, {
  broadcast: number; chat: number; vision: number; imagegen: number; kb: number;
}> = {
  lite: { broadcast: 5000, chat: 500, vision: 50, imagegen: 20, kb: 100 },
  standard: { broadcast: 20000, chat: 3000, vision: 300, imagegen: 100, kb: 500 },
  pro: { broadcast: 80000, chat: 12000, vision: 1500, imagegen: 500, kb: 3000 },
  enterprise: { broadcast: 999999, chat: 999999, vision: 999999, imagegen: 999999, kb: 999999 },
};

/** プラン別の超過単価（円） */
export const PLAN_OVERAGE_RATES: Record<Plan, {
  broadcast: number; chat: number; vision: number; imagegen: number; kb: number;
}> = {
  lite: { broadcast: 3, chat: 10, vision: 30, imagegen: 50, kb: 100 },
  standard: { broadcast: 2, chat: 7, vision: 25, imagegen: 40, kb: 80 },
  pro: { broadcast: 1.5, chat: 5, vision: 20, imagegen: 30, kb: 60 },
  enterprise: { broadcast: 1, chat: 3, vision: 15, imagegen: 20, kb: 40 },
};

export async function getTenantMetering(
  db: D1Database,
  lineAccountId: string,
): Promise<TenantMeteringRow | null> {
  return db
    .prepare(`SELECT * FROM tenant_metering WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .first<TenantMeteringRow>();
}

export async function initTenantMetering(
  db: D1Database,
  lineAccountId: string,
  plan: Plan,
): Promise<void> {
  const quota = PLAN_QUOTAS[plan];
  const yearMonth = jstNow().slice(0, 7);
  await db
    .prepare(
      `INSERT INTO tenant_metering (
         line_account_id, plan,
         monthly_broadcast_quota, monthly_chat_quota, monthly_vision_quota,
         monthly_imagegen_quota, monthly_kb_doc_quota,
         current_month, used_broadcast, used_chat, used_vision, used_imagegen, used_kb_doc,
         overage_charge_yen, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(line_account_id) DO UPDATE SET
         plan = excluded.plan,
         monthly_broadcast_quota = excluded.monthly_broadcast_quota,
         monthly_chat_quota = excluded.monthly_chat_quota,
         monthly_vision_quota = excluded.monthly_vision_quota,
         monthly_imagegen_quota = excluded.monthly_imagegen_quota,
         monthly_kb_doc_quota = excluded.monthly_kb_doc_quota,
         updated_at = excluded.updated_at`,
    )
    .bind(
      lineAccountId,
      plan,
      quota.broadcast,
      quota.chat,
      quota.vision,
      quota.imagegen,
      quota.kb,
      yearMonth,
      jstNow(),
    )
    .run();
}

export type MeterAxis = 'broadcast' | 'chat' | 'vision' | 'imagegen' | 'kb';

/**
 * 計量カウンタを 1 増やす。超過分があれば overage_charge_yen に加算。
 * 月が変わったらカウンタをリセット。
 */
export async function incrementMeter(
  db: D1Database,
  lineAccountId: string,
  axis: MeterAxis,
  delta = 1,
): Promise<{ withinQuota: boolean; overageYen: number }> {
  const m = await getTenantMetering(db, lineAccountId);
  if (!m) return { withinQuota: false, overageYen: 0 };

  const yearMonth = jstNow().slice(0, 7);
  const monthChanged = m.current_month !== yearMonth;

  // 月初リセット
  if (monthChanged) {
    await db
      .prepare(
        `UPDATE tenant_metering SET
           current_month = ?,
           used_broadcast = 0, used_chat = 0, used_vision = 0,
           used_imagegen = 0, used_kb_doc = 0,
           overage_charge_yen = 0,
           updated_at = ?
         WHERE line_account_id = ?`,
      )
      .bind(yearMonth, jstNow(), lineAccountId)
      .run();
  }

  const usedField =
    axis === 'broadcast' ? 'used_broadcast' :
    axis === 'chat' ? 'used_chat' :
    axis === 'vision' ? 'used_vision' :
    axis === 'imagegen' ? 'used_imagegen' :
    'used_kb_doc';
  const quotaField =
    axis === 'broadcast' ? 'monthly_broadcast_quota' :
    axis === 'chat' ? 'monthly_chat_quota' :
    axis === 'vision' ? 'monthly_vision_quota' :
    axis === 'imagegen' ? 'monthly_imagegen_quota' :
    'monthly_kb_doc_quota';

  const currentUsed = monthChanged ? 0 :
    axis === 'broadcast' ? m.used_broadcast :
    axis === 'chat' ? m.used_chat :
    axis === 'vision' ? m.used_vision :
    axis === 'imagegen' ? m.used_imagegen :
    m.used_kb_doc;

  const quota =
    axis === 'broadcast' ? m.monthly_broadcast_quota :
    axis === 'chat' ? m.monthly_chat_quota :
    axis === 'vision' ? m.monthly_vision_quota :
    axis === 'imagegen' ? m.monthly_imagegen_quota :
    m.monthly_kb_doc_quota;

  const newUsed = currentUsed + delta;
  const overageCount = Math.max(0, newUsed - quota);
  const previousOverage = Math.max(0, currentUsed - quota);
  const newOverageCount = Math.max(0, overageCount - previousOverage);

  const rate = PLAN_OVERAGE_RATES[m.plan][axis];
  const overageYen = Math.round(newOverageCount * rate);

  await db
    .prepare(
      `UPDATE tenant_metering SET
         ${usedField} = ${usedField} + ?,
         overage_charge_yen = overage_charge_yen + ?,
         updated_at = ?
       WHERE line_account_id = ?`,
    )
    .bind(delta, overageYen, jstNow(), lineAccountId)
    .run();

  return {
    withinQuota: newUsed <= quota,
    overageYen,
  };
}
