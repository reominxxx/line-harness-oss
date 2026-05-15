import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウント運用の集客プランナーです。
事業者のブランドを踏まえて、新規友だち追加を増やすキャンペーン施策を 1 つ設計します。

【出力 JSON】
{
  "campaignName": "キャンペーン名",
  "concept": "コンセプト（80 字以内）",
  "incentive": "友だち追加で提供する特典（具体的）",
  "channels": ["告知チャネル案 1", "案 2"],
  "kpiTarget": "獲得人数の目安",
  "rationale": "選定理由"
}`;

export async function handleGenerateAcquisitionCampaign(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { target?: number; yearMonth?: string; industry?: string };
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `目標: 今月 ${input.target ?? 50} 人の新規友だち獲得。
${input.industry ? `業界: ${input.industry}\n` : ''}
集客キャンペーンを 1 つ設計してください。JSON で返してください。`,
    forceStatus: 'review',
    extraOutput: { target: input.target, yearMonth: input.yearMonth },
  });
}
