/**
 * AI 顧客シグナル（ai_friend_signals）と AI 使用ログ（ai_usage_log）、
 * テナント計量（tenant_metering）のクエリヘルパー。
 *
 * 既存の friend_scores（行動ベース）と並列で「AI 推定値」を保持する。
 */

import { jstNow, addMonthsJst } from './utils.js';

// ---------------------------------------------------------------------------
// ai_friend_signals
// ---------------------------------------------------------------------------

export type VipRank = 'vip' | 'warm' | 'cold' | 'dormant' | 'new';
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
  /** 営業時に個別に決めた月額料金 (運用代行費)。NULL ならプランのデフォルト料金を UI で提示 */
  monthly_fee_yen: number | null;
  /** 1 友だち / 暦月あたりの課金 AI 応答上限。NULL = 無制限 */
  per_friend_monthly_cap: number | null;
  /** AI が回答できなかった時に返す固定文。NULL / 空 = システム既定文を使う */
  ai_fallback_message: string | null;
  /** CSV 一括取り込みで生成した統合 system prompt。NULL / 空 = prompt_modules 合成を使う */
  ai_custom_system_prompt: string | null;
  /** アカウント単位の AI 自動返信トグル。0 = このアカウントでは AI 接客自動返信を発火しない (全手動) */
  ai_auto_reply_enabled: number;
  /** 計量サイクルの開始日時 (JST ISO)。NULL = 未設定 → 暦月リセット */
  cycle_started_at: string | null;
  /** 次回リセット日時 (JST ISO)。この時刻を過ぎたアクセスで used_* / overage を 0 に戻す */
  cycle_resets_at: string | null;
  updated_at: string;
}

/**
 * ある友だちが sinceJst 以降に受け取った「課金された (cached=0)」AI 接客応答の回数。
 * chat / vision の両方を数える (画像理解も課金されるため)。
 * 月次上限の判定では sinceJst に「当月 1 日 00:00 (JST)」を渡す。
 * created_at は JST ISO 文字列 (固定オフセット) なので、同形式のしきい値との
 * 文字列比較で正しく範囲指定できる。
 */
export async function countFriendAiChatSince(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  sinceJst: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_usage_log
       WHERE line_account_id = ?
         AND friend_id = ?
         AND feature IN ('chat', 'vision')
         AND cached = 0
         AND created_at >= ?`,
    )
    .bind(lineAccountId, friendId, sinceJst)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 営業時に個別決定した料金 / 配信枠を直接書き換える */
export async function updateTenantMeteringCustom(
  db: D1Database,
  lineAccountId: string,
  input: {
    monthlyFeeYen?: number | null;
    monthlyBroadcastQuota?: number;
    monthlyChatQuota?: number;
    monthlyVisionQuota?: number;
    monthlyImagegenQuota?: number;
    monthlyKbDocQuota?: number;
    monthlyBudgetCapYen?: number | null;
    /** 計量サイクルの開始日時 (JST ISO)。null で暦月リセットへ戻す */
    cycleStartedAt?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(val);
  };
  if (input.monthlyFeeYen !== undefined) push('monthly_fee_yen', input.monthlyFeeYen);
  if (input.monthlyBroadcastQuota !== undefined) push('monthly_broadcast_quota', input.monthlyBroadcastQuota);
  if (input.monthlyChatQuota !== undefined) push('monthly_chat_quota', input.monthlyChatQuota);
  if (input.monthlyVisionQuota !== undefined) push('monthly_vision_quota', input.monthlyVisionQuota);
  if (input.monthlyImagegenQuota !== undefined) push('monthly_imagegen_quota', input.monthlyImagegenQuota);
  if (input.monthlyKbDocQuota !== undefined) push('monthly_kb_doc_quota', input.monthlyKbDocQuota);
  if (input.monthlyBudgetCapYen !== undefined) push('monthly_budget_cap_yen', input.monthlyBudgetCapYen);
  if (input.cycleStartedAt !== undefined) {
    push('cycle_started_at', input.cycleStartedAt);
    if (input.cycleStartedAt) {
      // 開始日時を基準に「現在をまだ過ぎていない最初の月次境界」を次回リセットに据える。
      // 既存の使用量はここでは消さない (誤設定での消失を防ぐ)。リセットは境界到達時に行う。
      const nowEpoch = Date.now();
      let resets = addMonthsJst(input.cycleStartedAt, 1);
      while (new Date(resets).getTime() <= nowEpoch) {
        resets = addMonthsJst(resets, 1);
      }
      push('cycle_resets_at', resets);
    } else {
      push('cycle_resets_at', null);
    }
  }

  if (sets.length === 0) return;
  push('updated_at', jstNow());

  await db
    .prepare(`UPDATE tenant_metering SET ${sets.join(', ')} WHERE line_account_id = ?`)
    .bind(...binds, lineAccountId)
    .run();
}

/**
 * AI が回答できない時の固定フォールバック文を更新する。
 * 空文字 / 空白のみは NULL に正規化し、「設定なし (システム既定文を使う)」状態に戻す。
 */
export async function setAiFallbackMessage(
  db: D1Database,
  lineAccountId: string,
  message: string | null,
): Promise<void> {
  const normalized = message && message.trim().length > 0 ? message : null;
  await db
    .prepare(
      `UPDATE tenant_metering SET ai_fallback_message = ?, updated_at = ? WHERE line_account_id = ?`,
    )
    .bind(normalized, jstNow(), lineAccountId)
    .run();
}

/**
 * CSV 一括取り込みで生成した統合 system prompt を保存する。
 * 空文字 / 空白のみは NULL に正規化し、prompt_modules 合成モードに戻す。
 */
export async function setAiCustomSystemPrompt(
  db: D1Database,
  lineAccountId: string,
  prompt: string | null,
): Promise<void> {
  const normalized = prompt && prompt.trim().length > 0 ? prompt : null;
  await db
    .prepare(
      `UPDATE tenant_metering SET ai_custom_system_prompt = ?, updated_at = ? WHERE line_account_id = ?`,
    )
    .bind(normalized, jstNow(), lineAccountId)
    .run();
}

/**
 * アカウント単位の AI 自動返信 ON/OFF を更新する。
 * false にすると、そのアカウントの全友だちで webhook の AI 接客自動返信を発火しない。
 */
export async function setAiAutoReplyEnabled(
  db: D1Database,
  lineAccountId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE tenant_metering SET ai_auto_reply_enabled = ?, updated_at = ? WHERE line_account_id = ?`,
    )
    .bind(enabled ? 1 : 0, jstNow(), lineAccountId)
    .run();
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
 * 計量サイクルの境界を過ぎていれば使用量 / 超過課金をリセットし、最新行を返す。
 *
 *  - cycle_resets_at が設定されている (= 開始日時ベース): now がその時刻を過ぎていたら
 *    used_* / overage_charge_yen を 0 にし、cycle_resets_at を now を超えるまで +1 ヶ月進める。
 *  - cycle_resets_at が NULL (= 未設定): 従来どおり暦月 (current_month) でリセット。
 *
 * AI アクセス経路 (checkBudget / incrementMeter) の冒頭で呼ぶことで、新しい周期に
 * 入った瞬間に予算ガードが解除され、AI 応答が自動再開する。
 */
export async function rolloverMeterIfNeeded(
  db: D1Database,
  lineAccountId: string,
): Promise<TenantMeteringRow | null> {
  const m = await getTenantMetering(db, lineAccountId);
  if (!m) return null;

  const now = jstNow();
  const nowEpoch = new Date(now).getTime();
  const resetFields = {
    used_broadcast: 0,
    used_chat: 0,
    used_vision: 0,
    used_imagegen: 0,
    used_kb_doc: 0,
    overage_charge_yen: 0,
  };

  // 開始日時ベース: 周期境界を過ぎたらリセットして次の境界へ進める
  if (m.cycle_resets_at) {
    if (nowEpoch < new Date(m.cycle_resets_at).getTime()) return m; // まだ周期内
    let nextReset = m.cycle_resets_at;
    while (nowEpoch >= new Date(nextReset).getTime()) {
      nextReset = addMonthsJst(nextReset, 1);
    }
    await db
      .prepare(
        `UPDATE tenant_metering SET
           used_broadcast = 0, used_chat = 0, used_vision = 0,
           used_imagegen = 0, used_kb_doc = 0,
           overage_charge_yen = 0,
           cycle_resets_at = ?,
           current_month = ?,
           updated_at = ?
         WHERE line_account_id = ?`,
      )
      .bind(nextReset, now.slice(0, 7), now, lineAccountId)
      .run();
    return { ...m, ...resetFields, cycle_resets_at: nextReset, current_month: now.slice(0, 7) };
  }

  // 暦月ベース (後方互換)
  const yearMonth = now.slice(0, 7);
  if (m.current_month !== yearMonth) {
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
      .bind(yearMonth, now, lineAccountId)
      .run();
    return { ...m, ...resetFields, current_month: yearMonth };
  }

  return m;
}

/**
 * 計量カウンタを 1 増やす。超過分があれば overage_charge_yen に加算。
 * サイクル境界 (開始日時ベース or 暦月) を過ぎていたら先にリセットする。
 */
export async function incrementMeter(
  db: D1Database,
  lineAccountId: string,
  axis: MeterAxis,
  delta = 1,
): Promise<{ withinQuota: boolean; overageYen: number }> {
  const m = await rolloverMeterIfNeeded(db, lineAccountId);
  if (!m) return { withinQuota: false, overageYen: 0 };

  const usedField =
    axis === 'broadcast' ? 'used_broadcast' :
    axis === 'chat' ? 'used_chat' :
    axis === 'vision' ? 'used_vision' :
    axis === 'imagegen' ? 'used_imagegen' :
    'used_kb_doc';

  const currentUsed =
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
