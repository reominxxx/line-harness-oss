import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 配信の最適時間帯分析の専門家です。
過去の開封データから、曜日別 / 時間帯別の最適配信スケジュールを提案します。

【出力 JSON】
{
  "bestSlots": [
    { "dayOfWeek": "火", "hour": 19, "rationale": "..." }
  ],
  "avoidSlots": [{ "dayOfWeek": "...", "hour": N, "rationale": "..." }],
  "weeklyPlan": "1 週間の理想的な配信パターン",
  "monthlyRhythm": "月内のリズム提案"
}`;

export async function handleOptimizeSchedule(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { yearMonth?: string };
  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    user: `業界一般の知見と直近の配信成績から、最適な配信スケジュールを提案してください。JSON で返してください。`,
    extraOutput: { yearMonth: input.yearMonth },
  });
}
