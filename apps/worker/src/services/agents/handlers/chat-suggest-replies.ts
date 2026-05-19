import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウントの顧客対応のプロです。
お客様からのメッセージに対する返信案を 3 つ提案してください。

【出力 JSON】
{
  "replies": [
    { "tone": "丁寧 / 親しみ / フォーマル", "content": "返信本文" },
    { "tone": "...", "content": "..." },
    { "tone": "...", "content": "..." }
  ],
  "intent": "お客様の意図の要約（1 文）"
}

【厳守】
- 200 字以内 / 案
- 業界規制（薬機法・景表法）を守る
- 個人情報の質問は避ける
`;

export async function handleChatSuggestReplies(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as {
    customerMessage?: string;
    tone?: string;
  };
  const customerMessage = input.customerMessage ?? '';
  const tone = input.tone ?? '丁寧';
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `お客様メッセージ:\n"""\n${customerMessage}\n"""\n\n基本トーン: ${tone}\n\nJSON 形式で 3 案返してください。`,
  });
}
