/**
 * ウォームリード掘り起こし handler
 *
 * ai_friend_signals.purchase_intent が 30-60 の友だちに個別文面を生成。
 * デフォルト: review 必須
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildWakeWarmLeadPrompt } from '../prompts/friends/wake-warm-leads.js';
import type { JobContext, JobResult } from '../types.js';

const MIN_INTENT = 30;
const MAX_INTENT = 60;

export async function handleWakeWarmLeads(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as { target?: number; yearMonth?: string };
  const target = Math.min(input.target ?? 5, 20);

  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // ウォームリード取得
  let warmLeads: Array<{ friend_id: string; purchase_intent: number; display_name: string | null }> = [];
  try {
    const result = await db
      .prepare(
        `SELECT s.friend_id, s.purchase_intent, f.display_name
         FROM ai_friend_signals s
         INNER JOIN friends f ON f.id = s.friend_id
         WHERE s.line_account_id = ?
           AND s.purchase_intent BETWEEN ? AND ?
           AND f.is_following = 1
         ORDER BY s.purchase_intent DESC LIMIT ?`,
      )
      .bind(lineAccountId, MIN_INTENT, MAX_INTENT, target)
      .all<{ friend_id: string; purchase_intent: number; display_name: string | null }>();
    warmLeads = result.results;
  } catch {
    /* ai_friend_signals 未準備の場合は空 */
  }

  if (warmLeads.length === 0) {
    return {
      output: { messages: [], note: 'no warm leads found' },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  const messages: Array<{
    friend_id: string;
    display_name: string | null;
    purchase_intent: number;
    message: string;
    call_to_action?: string;
  }> = [];
  let totalCost = 0;

  for (const lead of warmLeads) {
    const { system, user } = buildWakeWarmLeadPrompt({
      brandSystemPrompt,
      friendProfile: {
        displayName: lead.display_name,
        purchaseIntent: lead.purchase_intent,
      },
    });

    try {
      const result = await callClaude({
        apiKey,
        model: 'claude-sonnet-4-6', // 一押しは精度重視
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 600,
        temperature: 0.7,
      });
      totalCost += result.costYenX100;

      let parsed: { message?: string; callToAction?: string } = {};
      try {
        const match = result.text.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        parsed = { message: result.text };
      }

      messages.push({
        friend_id: lead.friend_id,
        display_name: lead.display_name,
        purchase_intent: lead.purchase_intent,
        message: parsed.message ?? result.text,
        call_to_action: parsed.callToAction,
      });

      await recordUsage(db, {
        lineAccountId,
        friendId: lead.friend_id,
        feature: 'copy_gen',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costYenX100: result.costYenX100,
      });
    } catch (e) {
      console.error(`[wake-warm-leads] failed for ${lead.friend_id}:`, e);
    }
  }

  return {
    output: { messages, processedCount: messages.length },
    costYenX100: totalCost,
    forceStatus: 'review',
  };
}
