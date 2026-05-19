/**
 * 友だち個別の長期プロファイル要約
 *
 * AI 接客チャット・配信生成で「この顧客は誰か」を深く理解させるための
 * 日次バッチ要約データ。messages_log や conversion_events を毎回直接 AI に
 * 渡すとコストが爆発するので、Haiku で要約 + 集計値を持つ。
 *
 * 関連:
 *   - 更新ハンドラ: apps/worker/src/services/agents/handlers/summarize-friend-profile.ts
 *   - 利用: apps/worker/src/services/friend-context.ts (AI 接客で参照)
 */

import { jstNow } from './utils.js';

export interface FriendProfileSummaryRow {
  friend_id: string;
  line_account_id: string;
  purchase_history_json: string | null;
  total_purchases: number;
  total_spent_yen: number;
  days_since_last_purchase: number | null;
  chat_topic_summary: string | null;
  interest_tags_json: string | null;
  last_significant_event: string | null;
  last_significant_at: string | null;
  total_messages: number;
  total_link_clicks: number;
  total_form_submissions: number;
  summarized_at: string;
  summary_model: string | null;
  summary_cost_yen_x100: number;
  created_at: string;
  updated_at: string;
}

export interface PurchaseHistoryItem {
  name: string;
  price_yen: number | null;
  occurred_at: string;
}

/** 友だちの長期プロファイル要約を取得 */
export async function getFriendProfileSummary(
  db: D1Database,
  friendId: string,
): Promise<FriendProfileSummaryRow | null> {
  return db
    .prepare(`SELECT * FROM friend_profile_summary WHERE friend_id = ?`)
    .bind(friendId)
    .first<FriendProfileSummaryRow>();
}

export interface UpsertFriendProfileSummaryInput {
  friendId: string;
  lineAccountId: string;
  purchaseHistory?: PurchaseHistoryItem[];
  totalPurchases?: number;
  totalSpentYen?: number;
  daysSinceLastPurchase?: number | null;
  chatTopicSummary?: string | null;
  interestTags?: string[];
  lastSignificantEvent?: string | null;
  lastSignificantAt?: string | null;
  totalMessages?: number;
  totalLinkClicks?: number;
  totalFormSubmissions?: number;
  summaryModel?: string;
  summaryCostYenX100?: number;
}

export async function upsertFriendProfileSummary(
  db: D1Database,
  input: UpsertFriendProfileSummaryInput,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_profile_summary (
         friend_id, line_account_id,
         purchase_history_json, total_purchases, total_spent_yen, days_since_last_purchase,
         chat_topic_summary, interest_tags_json,
         last_significant_event, last_significant_at,
         total_messages, total_link_clicks, total_form_submissions,
         summarized_at, summary_model, summary_cost_yen_x100,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(friend_id) DO UPDATE SET
         line_account_id = excluded.line_account_id,
         purchase_history_json = excluded.purchase_history_json,
         total_purchases = excluded.total_purchases,
         total_spent_yen = excluded.total_spent_yen,
         days_since_last_purchase = excluded.days_since_last_purchase,
         chat_topic_summary = excluded.chat_topic_summary,
         interest_tags_json = excluded.interest_tags_json,
         last_significant_event = excluded.last_significant_event,
         last_significant_at = excluded.last_significant_at,
         total_messages = excluded.total_messages,
         total_link_clicks = excluded.total_link_clicks,
         total_form_submissions = excluded.total_form_submissions,
         summarized_at = excluded.summarized_at,
         summary_model = excluded.summary_model,
         summary_cost_yen_x100 = excluded.summary_cost_yen_x100,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.friendId,
      input.lineAccountId,
      input.purchaseHistory && input.purchaseHistory.length > 0
        ? JSON.stringify(input.purchaseHistory)
        : null,
      input.totalPurchases ?? 0,
      input.totalSpentYen ?? 0,
      input.daysSinceLastPurchase ?? null,
      input.chatTopicSummary ?? null,
      input.interestTags && input.interestTags.length > 0 ? JSON.stringify(input.interestTags) : null,
      input.lastSignificantEvent ?? null,
      input.lastSignificantAt ?? null,
      input.totalMessages ?? 0,
      input.totalLinkClicks ?? 0,
      input.totalFormSubmissions ?? 0,
      now,
      input.summaryModel ?? null,
      input.summaryCostYenX100 ?? 0,
      now,
      now,
    )
    .run();
}

/**
 * 過去 N 日にメッセージがある friend で、まだ要約していない or 古い要約のものを
 * 取得 (バッチ再生成のターゲット選定用)
 */
export async function listFriendsNeedingSummary(
  db: D1Database,
  lineAccountId: string,
  options: { recentDays?: number; staleThresholdDays?: number; limit?: number } = {},
): Promise<Array<{ friend_id: string; last_message_at: string; summarized_at: string | null }>> {
  const recentDays = options.recentDays ?? 30;
  const staleThresholdDays = options.staleThresholdDays ?? 7;
  const limit = options.limit ?? 50;

  const result = await db
    .prepare(
      `SELECT f.id AS friend_id,
              MAX(ml.created_at) AS last_message_at,
              fps.summarized_at AS summarized_at
         FROM friends f
         LEFT JOIN messages_log ml
           ON ml.friend_id = f.id AND ml.line_account_id = f.line_account_id
         LEFT JOIN friend_profile_summary fps
           ON fps.friend_id = f.id
        WHERE f.line_account_id = ?
          AND ml.created_at >= datetime('now', ?, '+9 hours')
        GROUP BY f.id
       HAVING (fps.summarized_at IS NULL)
           OR (fps.summarized_at < datetime('now', ?, '+9 hours'))
        ORDER BY MAX(ml.created_at) DESC
        LIMIT ?`,
    )
    .bind(
      lineAccountId,
      `-${recentDays} days`,
      `-${staleThresholdDays} days`,
      limit,
    )
    .all<{ friend_id: string; last_message_at: string; summarized_at: string | null }>();

  return result.results;
}
