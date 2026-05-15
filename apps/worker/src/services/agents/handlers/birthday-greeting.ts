/**
 * 誕生月お祝い配信生成 (F-005)
 * 入力: { friend_id, display_name?, birth_month? }
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは事業者の「中の人」として、お客様に誕生月のお祝いメッセージを送ります。

【ルール】
- 押し付けがましくならない、温かい一言
- 当店からの感謝を一言添える
- 誕生月特典（クーポン / プレゼント等）を 1 つ提案
- 100〜180 字
- 絵文字は 1 個まで（自然な場面で）

【出力 JSON】
{
  "message": "メッセージ本文",
  "suggestedCoupon": "推奨特典（任意）",
  "callToAction": "次の小さな一歩"
}`;

export async function handleBirthdayGreeting(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as {
    friend_id?: string;
    display_name?: string;
    birth_month?: string;
  };

  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  const user = `お客様 ${input.display_name ?? '（お名前不明）'} の${input.birth_month ?? '今月'}が誕生月です。お祝いメッセージを作成してください。JSON で返してください。`;

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user,
    forceStatus: 'review',
    extraOutput: { friend_id: input.friend_id, birth_month: input.birth_month },
  });
}
