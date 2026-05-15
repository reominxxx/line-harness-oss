/**
 * ファネル分析 handler
 *
 * シナリオ各ステップの離脱率を集計 → AI で改善提案を生成。
 * デフォルト: 自動公開（提案だけなので顧客には届かない）
 */

import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildFunnelPrompt } from '../prompts/analytics/analyze-funnel.js';
import type { JobContext, JobResult } from '../types.js';

export async function handleAnalyzeFunnel(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as { yearMonth?: string; scenarioId?: string };

  // 対象シナリオの選定（指定なし or 不明なら最も友だちが入ってる active シナリオ）
  let scenarioId = input.scenarioId;
  let scenarioName = '';
  if (!scenarioId) {
    const top = await db
      .prepare(
        `SELECT s.id, s.name, COUNT(fs.id) as friend_count
         FROM scenarios s
         LEFT JOIN friend_scenarios fs ON fs.scenario_id = s.id
         GROUP BY s.id ORDER BY friend_count DESC LIMIT 1`,
      )
      .first<{ id: string; name: string; friend_count: number }>();
    if (!top) {
      return { output: { note: 'no scenario found' }, costYenX100: 0, forceStatus: 'completed' };
    }
    scenarioId = top.id;
    scenarioName = top.name;
  } else {
    const s = await db
      .prepare(`SELECT name FROM scenarios WHERE id = ?`)
      .bind(scenarioId)
      .first<{ name: string }>();
    scenarioName = s?.name ?? '(unknown)';
  }

  // ステップ別統計
  let stepStats: Array<{
    stepIndex: number;
    stepName: string;
    enteredCount: number;
    completedCount: number;
    dropOffRate: number;
  }> = [];
  try {
    const steps = await db
      .prepare(
        `SELECT id, step_index, name FROM scenario_steps WHERE scenario_id = ? ORDER BY step_index`,
      )
      .bind(scenarioId)
      .all<{ id: string; step_index: number; name: string }>();

    for (const step of steps.results) {
      const entered = await db
        .prepare(
          `SELECT COUNT(*) as c FROM friend_scenarios WHERE scenario_id = ? AND current_step >= ?`,
        )
        .bind(scenarioId, step.step_index)
        .first<{ c: number }>();
      const completed = await db
        .prepare(
          `SELECT COUNT(*) as c FROM friend_scenarios WHERE scenario_id = ? AND current_step > ?`,
        )
        .bind(scenarioId, step.step_index)
        .first<{ c: number }>();
      const enteredCount = entered?.c ?? 0;
      const completedCount = completed?.c ?? 0;
      const dropOff =
        enteredCount > 0 ? ((enteredCount - completedCount) / enteredCount) * 100 : 0;
      stepStats.push({
        stepIndex: step.step_index,
        stepName: step.name,
        enteredCount,
        completedCount,
        dropOffRate: dropOff,
      });
    }
  } catch (e) {
    console.warn('[analyze-funnel] step stats query failed:', e);
  }

  if (stepStats.length === 0) {
    return {
      output: { note: 'no step stats available', scenarioName },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  const { system, user } = buildFunnelPrompt({ scenarioName, stepStats });

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 1500,
    temperature: 0.4, // 分析系は低め
  });

  await recordUsage(db, {
    lineAccountId,
    feature: 'batch_analysis',
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
    /* fallback to raw */
  }

  return {
    output: {
      ...parsed,
      scenarioId,
      scenarioName,
      stepStats,
      yearMonth: input.yearMonth,
    },
    costYenX100: result.costYenX100,
  };
}
