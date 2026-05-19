/**
 * 友だち長期プロファイル要約 handler (Big Move 3)
 *
 * 1 ジョブで 1 アカウントの友だち全員を再要約する。
 * 「過去 30 日に新規メッセージがあり、最後の要約が 7 日以上前 or 未要約」の friend だけ対象。
 *
 * 1 friend につき:
 *  - 過去 6 ヶ月の messages_log を取得
 *  - conversion_events / link_clicks / form_submissions を集計
 *  - Haiku に「過去 6 ヶ月の会話テーマ要約 + 興味タグ抽出」を依頼
 *  - friend_profile_summary に upsert
 *
 * Haiku 1 friend あたり ~¥0.3、100 friend で ~¥30 程度。日次バッチ向け。
 */

import {
  listFriendsNeedingSummary,
  upsertFriendProfileSummary,
  type PurchaseHistoryItem,
} from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import type { JobContext, JobResult } from '../types.js';

const SUMMARY_SYSTEM = `あなたは顧客プロファイルアナリストです。
LINE 公式アカウントでのお客様との会話履歴を読み、長期的な顧客像を要約します。

【出力 JSON】
{
  "topicSummary": "過去半年の会話テーマを 150〜250 字で要約 (どんな悩みを抱え、どんな関心がある人か)",
  "interestTags": ["興味タグ最大 5 個 (短く具体的に: '乾燥対策', 'メンズ向け', '価格重視', '夜型' 等)"]
}

ルール:
- 個人情報 (氏名・電話・メール・住所) は要約に含めない
- 推測しすぎず、会話に出てきた事実だけを根拠にする
- 興味タグは検索しやすい短い単語で
- JSON のみを出力 (前後の説明文を付けない)`;

interface SummaryOutput {
  topicSummary?: string;
  interestTags?: string[];
}

export async function handleSummarizeFriendProfile(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as {
    limit?: number;
    recentDays?: number;
    staleThresholdDays?: number;
  };
  const limit = Math.min(input.limit ?? 50, 200);

  const targets = await listFriendsNeedingSummary(db, lineAccountId, {
    recentDays: input.recentDays ?? 30,
    staleThresholdDays: input.staleThresholdDays ?? 7,
    limit,
  });

  if (targets.length === 0) {
    return {
      output: { processed: 0, skipped: 0, message: '要約対象の friend なし' },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  let totalCostX100 = 0;
  let processed = 0;
  let failed = 0;
  const errors: Array<{ friendId: string; error: string }> = [];

  for (const target of targets) {
    try {
      const r = await summarizeOneFriend(db, apiKey, lineAccountId, target.friend_id);
      totalCostX100 += r.costYenX100;
      processed++;
    } catch (e) {
      failed++;
      errors.push({
        friendId: target.friend_id,
        error: e instanceof Error ? e.message : 'unknown',
      });
      if (errors.length >= 10) {
        // 大量エラー時は中断
        break;
      }
    }
  }

  return {
    output: {
      processed,
      failed,
      total: targets.length,
      totalCostYen: totalCostX100 / 100,
      errors: errors.slice(0, 10),
    },
    costYenX100: totalCostX100,
    forceStatus: 'completed',
  };
}

async function summarizeOneFriend(
  db: D1Database,
  apiKey: string,
  lineAccountId: string,
  friendId: string,
): Promise<{ costYenX100: number }> {
  // 1. 過去 180 日の messages_log を取得
  const messages = await db
    .prepare(
      `SELECT direction, content, message_type, created_at
         FROM messages_log
        WHERE line_account_id = ? AND friend_id = ?
          AND message_type = 'text'
          AND created_at >= datetime('now', '-180 days', '+9 hours')
        ORDER BY created_at ASC
        LIMIT 200`,
    )
    .bind(lineAccountId, friendId)
    .all<{ direction: string; content: string; message_type: string; created_at: string }>();

  // 2. conversion_events を集計
  const conversions = await db
    .prepare(
      `SELECT ce.metadata AS metadata, ce.created_at AS occurred_at,
              cp.name AS conversion_name, cp.point_type AS point_type
         FROM conversion_events ce
         LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
        WHERE ce.line_account_id = ? AND ce.friend_id = ?
        ORDER BY ce.created_at DESC
        LIMIT 20`,
    )
    .bind(lineAccountId, friendId)
    .all<{ metadata: string | null; occurred_at: string; conversion_name: string | null; point_type: string | null }>()
    .catch(() => ({ results: [] as Array<{ metadata: string | null; occurred_at: string; conversion_name: string | null; point_type: string | null }> }));

  // 3. 購入履歴を抽出 (purchase 系の conversion を最大 12 件)
  const purchases: PurchaseHistoryItem[] = [];
  for (const c of conversions.results) {
    if (purchases.length >= 12) break;
    if (c.point_type !== 'purchase' && c.point_type !== 'booking') continue;
    let priceYen: number | null = null;
    try {
      const meta = c.metadata ? JSON.parse(c.metadata) : {};
      if (typeof meta.price_yen === 'number') priceYen = meta.price_yen;
      else if (typeof meta.amount === 'number') priceYen = meta.amount;
    } catch {
      /* ignore */
    }
    purchases.push({
      name: c.conversion_name ?? '購入',
      price_yen: priceYen,
      occurred_at: c.occurred_at,
    });
  }

  // 4. 集計値
  const totalSpentYen = purchases.reduce((sum, p) => sum + (p.price_yen ?? 0), 0);
  const totalPurchases = purchases.length;
  const daysSinceLastPurchase =
    purchases.length > 0
      ? Math.floor((Date.now() - new Date(purchases[0].occurred_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

  // link_clicks と form_submissions の件数
  const [linkClicksRow, formSubsRow] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM link_clicks WHERE friend_id = ?`,
      )
      .bind(friendId)
      .first<{ c: number }>()
      .catch(() => ({ c: 0 })),
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM form_submissions WHERE friend_id = ?`,
      )
      .bind(friendId)
      .first<{ c: number }>()
      .catch(() => ({ c: 0 })),
  ]);
  const totalLinkClicks = linkClicksRow?.c ?? 0;
  const totalFormSubmissions = formSubsRow?.c ?? 0;

  // 5. 最後の重要イベント (最新の conversion)
  const lastSignificant = conversions.results[0];
  const lastSignificantEvent = lastSignificant
    ? `${lastSignificant.point_type ?? 'event'}: ${lastSignificant.conversion_name ?? '記録あり'}`
    : null;
  const lastSignificantAt = lastSignificant?.occurred_at ?? null;

  // 6. Haiku で会話テーマ要約 + 興味タグ抽出
  let topicSummary: string | null = null;
  let interestTags: string[] = [];
  let summaryCostX100 = 0;
  let summaryModel = 'haiku-4-5-20251001';

  if (messages.results.length >= 3) {
    const transcript = messages.results
      .map((m) => `[${m.direction === 'incoming' ? '客' : '店'}] ${m.content.slice(0, 200)}`)
      .join('\n');
    try {
      const result = await callClaude({
        apiKey,
        model: 'claude-haiku-4-5-20251001',
        system: SUMMARY_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `下記はあるお客様との過去半年の LINE トーク履歴です。\n要約と興味タグを JSON で返してください。\n\n---\n${transcript.slice(0, 8000)}`,
          },
        ],
        maxTokens: 400,
        temperature: 0.3,
      });
      summaryCostX100 = result.costYenX100;
      summaryModel = result.model;
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed: SummaryOutput = JSON.parse(jsonMatch[0]);
          if (typeof parsed.topicSummary === 'string') topicSummary = parsed.topicSummary.slice(0, 500);
          if (Array.isArray(parsed.interestTags)) {
            interestTags = parsed.interestTags.filter((t) => typeof t === 'string').slice(0, 5);
          }
        } catch {
          /* ignore parse error */
        }
      }
    } catch (e) {
      console.error('[summarize-friend-profile] callClaude failed:', e);
    }
  }

  // コスト記録
  if (summaryCostX100 > 0) {
    await recordUsage(db, {
      lineAccountId,
      friendId,
      feature: 'batch_analysis',
      model: summaryModel,
      inputTokens: 0,
      outputTokens: 0,
      costYenX100: summaryCostX100,
    });
  }

  // 7. upsert
  await upsertFriendProfileSummary(db, {
    friendId,
    lineAccountId,
    purchaseHistory: purchases,
    totalPurchases,
    totalSpentYen,
    daysSinceLastPurchase,
    chatTopicSummary: topicSummary,
    interestTags,
    lastSignificantEvent,
    lastSignificantAt,
    totalMessages: messages.results.length,
    totalLinkClicks,
    totalFormSubmissions,
    summaryModel,
    summaryCostYenX100: summaryCostX100,
  });

  return { costYenX100: summaryCostX100 };
}
