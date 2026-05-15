import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは予約商売（美容 / 整体 / 飲食 / 教室）の予約獲得プランナーです。
今月の予約数目標達成のための具体的な施策を提示します。

【出力 JSON】
{
  "summary": "今月の戦略サマリー（80 字）",
  "actions": [
    { "name": "施策名", "description": "実施内容", "channel": "配信 / リッチメニュー / LIFF / 広告", "timing": "実施タイミング", "expectedReservations": N }
  ],
  "vacantSlotPromotion": "空き枠の活用案",
  "rebookingHook": "再予約のフック案"
}`;

export async function handleOptimizeBookingPromotion(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { target?: number; yearMonth?: string };
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `今月の予約獲得目標: ${input.target ?? 30} 件
予約獲得を最大化する施策を 3 つ提案してください。JSON で返してください。`,
    forceStatus: 'review',
    extraOutput: { target: input.target, yearMonth: input.yearMonth },
  });
}
