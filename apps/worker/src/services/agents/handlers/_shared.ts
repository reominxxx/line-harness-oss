/**
 * ハンドラ共通ヘルパー
 *
 * 全ハンドラの「Claude 呼ぶ → 使用ログ → JSON パース → 返却」の繰り返しを共通化。
 */

import { callClaude, type ClaudeModel } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import type { AiFeature } from '@line-crm/db';
import type { JobContext, JobResult } from '../types.js';

export async function runAiJob(
  ctx: JobContext,
  options: {
    feature: AiFeature;
    model?: ClaudeModel;
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    forceStatus?: 'review' | 'completed';
    parseJson?: boolean;
    extraOutput?: Record<string, unknown>;
  },
): Promise<JobResult> {
  const result = await callClaude({
    apiKey: ctx.apiKey,
    model: options.model ?? 'claude-haiku-4-5-20251001',
    system: options.system,
    messages: [{ role: 'user', content: options.user }],
    maxTokens: options.maxTokens ?? 1500,
    temperature: options.temperature ?? 0.5,
  });

  await recordUsage(ctx.db, {
    lineAccountId: ctx.lineAccountId,
    feature: options.feature,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  let parsed: Record<string, unknown> = {};
  if (options.parseJson !== false) {
    try {
      const match = result.text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } else {
        parsed = { content: result.text };
      }
    } catch {
      parsed = { content: result.text };
    }
  } else {
    parsed = { content: result.text };
  }

  return {
    output: {
      ...parsed,
      ...(options.extraOutput ?? {}),
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100,
    forceStatus: options.forceStatus,
  };
}
