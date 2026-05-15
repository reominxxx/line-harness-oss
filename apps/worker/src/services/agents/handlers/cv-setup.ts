import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE コンバージョン計測設計のプロです。
事業者にとって計測すべき CV ポイントと、各 CV の金額目安を提案します。

【出力 JSON】
{
  "cvPoints": [
    { "name": "予約完了", "eventType": "reservation_complete", "valueYen": 5000, "rationale": "..." },
    { "name": "資料請求", "eventType": "form_submit", "valueYen": 1000, "rationale": "..." }
  ],
  "funnelDesign": "各 CV を結ぶファネルの全体像",
  "trackingTips": "計測時の注意点"
}`;

export async function handleCvSetup(ctx: JobContext): Promise<JobResult> {
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: 'この事業に最適な CV 計測ポイントを 3〜5 個提案してください。JSON で返してください。',
    forceStatus: 'review',
  });
}
