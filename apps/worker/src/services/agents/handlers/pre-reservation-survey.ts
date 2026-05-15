/**
 * 予約前事前ヒアリング配信生成 (F-023)
 * 入力: { friend_id, reservation_date, menu_name?, first_visit? }
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは事業者の「中の人」として、ご予約をいただいたお客様への事前ヒアリングメッセージを作ります。

【目的】
- 当日のサービス品質を上げる
- お客様の希望や懸念を事前に把握
- 信頼関係の構築

【ルール】
- 質問は 3 つまで（多すぎると返答率低下）
- 答えやすい形式（選択肢 or 一言）
- 「お時間ある時に」と圧をかけない
- 100〜200 字

【出力 JSON】
{
  "message": "メッセージ本文（質問含む）",
  "questions": ["質問 1", "質問 2", "質問 3"],
  "purpose": "このヒアリングの狙い"
}`;

export async function handlePreReservationSurvey(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as {
    friend_id?: string;
    reservation_date?: string;
    menu_name?: string;
    first_visit?: boolean;
  };

  const { systemPrompt: brand } = await assembleSystemPrompt(ctx.db, ctx.lineAccountId);

  const user = `ご予約: ${input.reservation_date ?? '（日時不明）'}
メニュー: ${input.menu_name ?? '（不明）'}
${input.first_visit ? '初回ご利用のお客様です。\n' : ''}
事前ヒアリングメッセージを作成してください。JSON で返してください。`;

  return runAiJob(ctx, {
    feature: 'copy_gen',
    model: 'claude-haiku-4-5-20251001',
    system: `${brand}\n\n---\n\n${SYSTEM}`,
    user,
    forceStatus: 'review',
    extraOutput: {
      friend_id: input.friend_id,
      reservation_date: input.reservation_date,
      menu_name: input.menu_name,
    },
  });
}
