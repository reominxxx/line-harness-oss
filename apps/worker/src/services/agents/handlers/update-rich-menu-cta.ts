import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE リッチメニュー設計のプロです。
友だち追加直後 / 既存リピーター向けの最適な 6 枠リッチメニュー構成案を提示します。

【出力 JSON】
{
  "menuName": "メニュー名",
  "audience": "対象（新規 / リピーター / VIP 等）",
  "tiles": [
    { "position": "上段左", "label": "ボタン文言", "action": "uri | message | postback", "payload": "URL or テキスト", "rationale": "なぜこの位置にこの内容か" }
  ],
  "abTestSuggestion": "A/B テスト推奨ポイント"
}`;

export async function handleUpdateRichMenuCta(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { audience?: string; yearMonth?: string };
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `対象: ${input.audience ?? '友だち追加直後の新規'}
6 枠（上段 3 + 下段 3）のリッチメニュー構成を設計してください。JSON で返してください。`,
    forceStatus: 'review',
    extraOutput: { yearMonth: input.yearMonth },
  });
}
