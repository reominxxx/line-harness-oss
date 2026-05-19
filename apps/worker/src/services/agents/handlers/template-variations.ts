import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 配信文のコピーライターです。
渡されたテンプレート文を元に、異なるトーンの派生案を複数生成してください。

【出力 JSON】
{
  "variations": [
    { "tone": "親しみ系", "content": "..." },
    { "tone": "フォーマル", "content": "..." },
    { "tone": "カジュアル", "content": "..." }
  ]
}

【厳守】
- 各 variation は元の文意を保つ
- 業界規制（薬機法・景表法）を守る
- 1 案あたり 300 字以内
`;

export async function handleTemplateVariations(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as {
    baseText?: string;
    count?: number;
  };
  const baseText = input.baseText ?? '';
  const count = Math.min(Math.max(Number(input.count) || 5, 1), 10);
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `元のテンプレート:\n"""\n${baseText}\n"""\n\n${count} 案、異なるトーンで JSON 返却してください。`,
  });
}
