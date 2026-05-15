/**
 * 休眠掘り起こし handler
 *
 * 90 日以上未接触の友だちから N 名選出して、それぞれに個別文面を生成。
 * デフォルト: review 必須
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildWakeDormantPrompt } from '../prompts/friends/wake-dormant.js';
import type { JobContext, JobResult } from '../types.js';

const BATCH_SIZE = 5;
const DORMANT_DAYS = 90;

export async function handleWakeDormant(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as { batchIndex?: number; yearMonth?: string };
  const offset = (input.batchIndex ?? 0) * BATCH_SIZE;

  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // 休眠友だち N 件取得（最終 updated_at が古い順）
  const dormantDate = new Date();
  dormantDate.setUTCDate(dormantDate.getUTCDate() - DORMANT_DAYS);
  const dormantFriends = await db
    .prepare(
      `SELECT id, display_name, updated_at
       FROM friends
       WHERE is_following = 1 AND updated_at <= ?
       ORDER BY updated_at ASC LIMIT ? OFFSET ?`,
    )
    .bind(dormantDate.toISOString(), BATCH_SIZE, offset)
    .all<{ id: string; display_name: string | null; updated_at: string }>();

  if (dormantFriends.results.length === 0) {
    return {
      output: { messages: [], note: 'no dormant friends found' },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  const messages: Array<{
    friend_id: string;
    display_name: string | null;
    days_dormant: number;
    message: string;
    rationale?: string;
    suggested_coupon?: string | null;
  }> = [];
  let totalCost = 0;

  for (const friend of dormantFriends.results) {
    const lastDate = new Date(friend.updated_at);
    const daysDormant = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    // タグ取得（簡易）
    let tags: string[] = [];
    try {
      const tagsResult = await db
        .prepare(
          `SELECT t.name FROM friend_tags ft
           INNER JOIN tags t ON ft.tag_id = t.id
           WHERE ft.friend_id = ? LIMIT 5`,
        )
        .bind(friend.id)
        .all<{ name: string }>();
      tags = tagsResult.results.map((r) => r.name);
    } catch {
      /* テーブル無 OK */
    }

    const { system, user } = buildWakeDormantPrompt({
      brandSystemPrompt,
      friendProfile: {
        displayName: friend.display_name,
        daysSinceLastInteraction: daysDormant,
        tags,
      },
    });

    try {
      const result = await callClaude({
        apiKey,
        model: 'claude-haiku-4-5-20251001', // 個別文面は Haiku で十分
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 600,
        temperature: 0.7,
      });
      totalCost += result.costYenX100;

      let parsed: { message?: string; rationale?: string; suggestedCoupon?: string | null } = {};
      try {
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        parsed = { message: result.text };
      }

      messages.push({
        friend_id: friend.id,
        display_name: friend.display_name,
        days_dormant: daysDormant,
        message: parsed.message ?? result.text,
        rationale: parsed.rationale,
        suggested_coupon: parsed.suggestedCoupon ?? null,
      });

      await recordUsage(db, {
        lineAccountId,
        friendId: friend.id,
        feature: 'copy_gen',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costYenX100: result.costYenX100,
      });
    } catch (e) {
      console.error(`[wake-dormant] failed for friend ${friend.id}:`, e);
    }
  }

  return {
    output: {
      messages,
      batchIndex: input.batchIndex ?? 0,
      processedCount: messages.length,
    },
    costYenX100: totalCost,
    forceStatus: 'review', // 顧客に直接届くため必ずレビュー
  };
}
