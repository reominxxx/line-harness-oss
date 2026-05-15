import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE リマインダー配信設計のプロです。
セミナー / 予約 / イベント等のリマインダー構成を提案します。

【出力 JSON】
{
  "reminderName": "...",
  "purpose": "用途",
  "steps": [
    { "name": "Step 名", "offsetType": "before/after", "offsetUnit": "day/hour", "offsetValue": N, "messageContent": "..." }
  ],
  "audience": "対象セグメント案",
  "kpi": "成果指標"
}`;

export async function handleReminderSetup(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { eventType?: string };
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `${input.eventType ?? '一般的な予約'} に対するリマインダー配信ステップを設計してください。JSON で返してください。`,
    forceStatus: 'review',
  });
}
