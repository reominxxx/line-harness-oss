import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウントのリードスコアリング設計のプロです。
事業者の業種に合わせた、行動別のスコア設計案を提示します。

【出力 JSON】
{
  "rules": [
    { "eventType": "open_message", "scoreValue": 1, "rationale": "..." },
    { "eventType": "click_link", "scoreValue": 5, "rationale": "..." }
  ],
  "thresholds": {
    "hot": 50,
    "warm": 20,
    "cold": 5
  },
  "actionByThreshold": {
    "hot": "即時通知 + パーソナライズ配信",
    "warm": "段階的なナーチャリング配信",
    "cold": "一般的な情報提供配信"
  }
}`;

export async function handleScoringDesign(ctx: JobContext): Promise<JobResult> {
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: 'この事業に最適なリードスコアリング設計を提案してください。JSON で返してください。',
    forceStatus: 'review',
  });
}
