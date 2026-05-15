import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE オートメーション（IF-THEN ルール）設計のプロです。
事業者が今すぐ導入すべきオートメーションルールを提案します。

【出力 JSON】
{
  "rules": [
    {
      "name": "ルール名",
      "eventType": "friend_added/tag_added/score_threshold/keyword_match 等",
      "condition": "発火条件",
      "action": "実行アクション",
      "priority": 1-10,
      "expectedImpact": "期待される効果"
    }
  ],
  "implementationOrder": "導入順序の提案",
  "monitoringMetric": "効果測定の指標"
}`;

export async function handleAutomationDesign(ctx: JobContext): Promise<JobResult> {
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: 'この事業で今すぐ導入すべきオートメーションルールを 5 個提案してください。JSON で返してください。',
    forceStatus: 'review',
  });
}
