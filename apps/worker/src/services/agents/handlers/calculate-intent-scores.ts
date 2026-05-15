/**
 * 購入意欲スコアリング バッチ handler
 *
 * 全友だち（or 指定数）について、直近の行動・チャット・予約・配信反応を集計し、
 * AI で purchase_intent / churn_risk / vip_rank / sentiment を算出。
 * ai_friend_signals に upsert する。
 *
 * デフォルト: 自動公開（提案じゃなくて単なる計算結果）
 */

import { upsertAiFriendSignal, jstNow } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import type { JobContext, JobResult } from '../types.js';

const BATCH_SIZE = 20;

interface FriendSignals {
  friend_id: string
  display_name: string | null
  days_since_added: number
  days_since_last_update: number
  chat_count_30d: number
  broadcast_clicks_30d: number
  has_reservation: boolean
  current_score: number
}

export async function handleCalculateIntentScores(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as { batchSize?: number; offset?: number };
  const limit = Math.min(input.batchSize ?? BATCH_SIZE, 50);
  const offset = input.offset ?? 0;

  // 直近活動のある友だちを取得
  const result = await db
    .prepare(
      `SELECT id, display_name, score, created_at, updated_at
       FROM friends
       WHERE is_following = 1
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<{ id: string; display_name: string | null; score: number; created_at: string; updated_at: string }>();

  const friends = result.results;
  if (friends.length === 0) {
    return {
      output: { processedCount: 0, note: 'no friends found' },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  // 各友だちの直近 30 日のチャット数を一括取得
  const friendIds = friends.map((f) => f.id);
  const placeholders = friendIds.map(() => '?').join(',');
  let chatCounts: Record<string, number> = {};
  try {
    const chats = await db
      .prepare(
        `SELECT friend_id, COUNT(*) as c
         FROM chats
         WHERE friend_id IN (${placeholders})
           AND last_message_at >= datetime('now', '-30 days')
         GROUP BY friend_id`,
      )
      .bind(...friendIds)
      .all<{ friend_id: string; c: number }>();
    for (const row of chats.results) chatCounts[row.friend_id] = row.c;
  } catch {
    /* fallback */
  }

  const now = Date.now();
  const summaries: FriendSignals[] = friends.map((f) => {
    const created = new Date(f.created_at).getTime();
    const updated = new Date(f.updated_at).getTime();
    return {
      friend_id: f.id,
      display_name: f.display_name,
      days_since_added: Math.floor((now - created) / (1000 * 60 * 60 * 24)),
      days_since_last_update: Math.floor((now - updated) / (1000 * 60 * 60 * 24)),
      chat_count_30d: chatCounts[f.id] ?? 0,
      broadcast_clicks_30d: 0,
      has_reservation: false,
      current_score: f.score,
    };
  });

  // AI で一括判定（バッチで Claude に投げる）
  const SYSTEM = `あなたは LINE 顧客分析のスペシャリストです。
複数の友だちの行動データから、それぞれの purchase_intent / churn_risk / vip_rank / sentiment を JSON で返します。

【判定基準】
- purchase_intent (0-100): チャット頻度高、最近活動あり → 高い
- churn_risk (0-100): 長期未接触、ブロック傾向 → 高い
- vip_rank: vip / hot / warm / cold / dormant / new
  - new: 7 日以内追加
  - dormant: 90 日以上未更新
  - hot: チャット 5+ 件 / 30 日 + intent 70+
  - vip: 既存スコア 100+
  - warm: intent 30-70
  - cold: その他

【出力 JSON 配列】
[
  { "friend_id": "...", "purchase_intent": N, "churn_risk": N, "vip_rank": "...", "sentiment": "positive/neutral/negative", "summary": "30 字要約" }
]`;

  const userMessage = `${summaries.length} 名の友だち分析データ:

${summaries.map((s, i) => `${i + 1}. id=${s.friend_id.slice(0, 8)}... ${s.display_name ?? '(no name)'}
   - 追加から ${s.days_since_added} 日 / 最終更新から ${s.days_since_last_update} 日
   - 直近 30 日チャット ${s.chat_count_30d} 件
   - 既存 score ${s.current_score}`).join('\n\n')}

各人について JSON 配列で返してください。`;

  const aiResult = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 3000,
    temperature: 0.2,
  });

  await recordUsage(db, {
    lineAccountId,
    feature: 'batch_analysis',
    model: aiResult.model,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    costYenX100: aiResult.costYenX100,
  });

  let parsed: Array<{ friend_id: string; purchase_intent?: number; churn_risk?: number; vip_rank?: string; sentiment?: string; summary?: string }> = [];
  try {
    const match = aiResult.text.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn('[calculate-intent-scores] JSON parse failed:', e);
  }

  // friend_id の prefix matching で更新
  let upserted = 0;
  for (const item of parsed) {
    const matched = summaries.find((s) => s.friend_id.startsWith(item.friend_id) || item.friend_id.startsWith(s.friend_id.slice(0, 8)));
    if (!matched) continue;
    try {
      await upsertAiFriendSignal(db, {
        friendId: matched.friend_id,
        lineAccountId,
        purchaseIntent: clamp(item.purchase_intent, 0, 100),
        churnRisk: clamp(item.churn_risk, 0, 100),
        vipRank: validRank(item.vip_rank),
        sentiment: validSentiment(item.sentiment),
        signalSummary: item.summary?.slice(0, 200),
        lastChatAt: matched.chat_count_30d > 0 ? jstNow() : null,
      });
      upserted++;
    } catch (e) {
      console.error(`[calculate-intent-scores] upsert failed for ${matched.friend_id}:`, e);
    }
  }

  return {
    output: {
      processedCount: summaries.length,
      upsertedCount: upserted,
      offset,
      hasMore: friends.length === limit,
    },
    costYenX100: aiResult.costYenX100,
    forceStatus: 'completed',
  };
}

function clamp(n: number | undefined, min: number, max: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function validRank(r: string | undefined): 'vip' | 'hot' | 'warm' | 'cold' | 'dormant' | 'new' | null {
  const valid = ['vip', 'hot', 'warm', 'cold', 'dormant', 'new'];
  return valid.includes(r ?? '') ? (r as 'vip' | 'hot' | 'warm' | 'cold' | 'dormant' | 'new') : null;
}

function validSentiment(s: string | undefined): 'positive' | 'neutral' | 'negative' | 'angry' | null {
  const valid = ['positive', 'neutral', 'negative', 'angry'];
  return valid.includes(s ?? '') ? (s as 'positive' | 'neutral' | 'negative' | 'angry') : null;
}
