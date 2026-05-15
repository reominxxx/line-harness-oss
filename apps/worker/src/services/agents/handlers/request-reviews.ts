/**
 * Google レビュー獲得依頼の文面生成
 * 直近来店 / 利用済み friend を対象に、自然な依頼文を個別生成
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは事業者の「中の人」として、Google レビュー記入をお願いするメッセージを書きます。

【絶対ルール】
- 押し付けがましくならない
- お礼を最初に言う
- 「お時間ある時で構いません」という言い回し
- レビュー URL を末尾に貼る前提で「URL は別途お送りします」と書く
- 短く、120 字以内
- 絵文字 1 つまで

【出力 JSON】
{
  "messageTemplate": "メッセージ本文（{{name}} で呼びかけ可）",
  "subject": "管理用件名"
}`;

export async function handleRequestReviews(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { target?: number; yearMonth?: string };
  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user: `今月 ${input.target ?? 5} 件の Google レビュー獲得を狙いたいです。直近に来店された満足度の高そうな顧客向けの依頼文テンプレを作成してください。JSON で返してください。`,
    forceStatus: 'review',
    extraOutput: { target: input.target, yearMonth: input.yearMonth },
  });
}
