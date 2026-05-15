import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 配信テンプレート設計のプロです。
事業者がよく使う場面別のテンプレートをまとめて作成します。

【出力 JSON】
{
  "templates": [
    { "category": "挨拶", "name": "...", "messageType": "text", "content": "..." },
    { "category": "キャンペーン", "name": "...", "messageType": "text", "content": "..." },
    { "category": "通知", "name": "...", "messageType": "text", "content": "..." },
    { "category": "フォローアップ", "name": "...", "messageType": "text", "content": "..." }
  ],
  "usageGuide": "各テンプレートの使い分けガイド"
}`;

export async function handleTemplateCreate(ctx: JobContext): Promise<JobResult> {
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);
  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-sonnet-4-6',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: '挨拶 / キャンペーン / 通知 / フォローアップの 4 カテゴリで、計 8 本のテンプレートを作成してください。JSON で返してください。',
    forceStatus: 'review',
  });
}
