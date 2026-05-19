import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE リッチメニュー設計のプロです。
業界トーンに合った、タップしたくなる短い文言を提案してください。

【出力 JSON】
{
  "menuName": "メニュー名（例: メインメニュー）",
  "chatBarText": "トーク画面下のバー文言（14 字以内）",
  "labels": [
    { "position": 1, "label": "短いラベル", "actionHint": "リンク先や用途のヒント" }
  ],
  "rationale": "なぜこの構成にしたかの 1 文説明"
}

【厳守】
- ラベルは 6 字以内（例: 予約する, メニュー, アクセス）
- 業界に合った言葉選び
- 絵文字は 1〜2 個まで控えめに
`;

export async function handleRichMenuLabels(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as {
    tabCount?: number;
    purpose?: string;
  };
  const tabCount = Number(input.tabCount) || 6;
  const purpose = input.purpose ?? '一般用途';
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `タブ数: ${tabCount}\n用途: ${purpose}\n\n上記に合うリッチメニュー文言を JSON で返してください。labels 配列の length は ${tabCount} にしてください。`,
  });
}
