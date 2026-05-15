/**
 * 新規シナリオ作成 handler
 * デフォルト: review 必須（人間が最終チェック → 承認後に scenarios + scenario_steps へ挿入）
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildCreateScenarioPrompt } from '../prompts/scenario/create.js';
import type { JobContext, JobResult } from '../types.js';

export async function handleCreateScenario(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as {
    goal?: string;
    targetSegment?: string;
    stepCount?: number;
    industry?: string;
    triggerHint?: string;
  };

  if (!input.goal) {
    return {
      output: { error: 'goal is required' },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  const { system, user } = buildCreateScenarioPrompt({
    brandSystemPrompt,
    goal: input.goal,
    targetSegment: input.targetSegment,
    stepCount: input.stepCount,
    industry: input.industry,
    triggerHint: input.triggerHint,
  });

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3000,
    temperature: 0.7,
  });

  await recordUsage(db, {
    lineAccountId,
    feature: 'copy_gen',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  let parsed: Record<string, unknown> = { raw: result.text };
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    /* fallback */
  }

  return {
    output: {
      ...parsed,
      goal: input.goal,
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100,
    forceStatus: 'review',
  };
}
