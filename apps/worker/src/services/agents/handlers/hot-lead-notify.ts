/**
 * ホットリード通知 handler
 * intent_score >= 70 の友だちを抽出し、事業者向けに「今すぐ連絡すべき人リスト」を生成。
 * デフォルト: 自動公開（提案だけ、顧客には届かない）
 */

import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウント運用の「攻めの営業判断」アドバイザーです。
購入意欲が高い顧客リストを見て、優先連絡すべき順 + 推奨アクションを提示します。

【出力 JSON】
{
  "summary": "全体の状況",
  "topPriorities": [
    { "friend_id": "...", "displayName": "...", "intent": N, "recommendedAction": "...", "suggestedMessage": "事業者から送る一言案" }
  ],
  "batchAction": "全員にまとめて送るべき施策があれば"
}`;

export async function handleHotLeadNotify(ctx: JobContext): Promise<JobResult> {
  let leads: Array<{ friend_id: string; display_name: string | null; purchase_intent: number; signal_summary: string | null }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT s.friend_id, f.display_name, s.purchase_intent, s.signal_summary
         FROM ai_friend_signals s
         INNER JOIN friends f ON f.id = s.friend_id
         WHERE s.line_account_id = ? AND s.purchase_intent >= 70 AND f.is_following = 1
         ORDER BY s.purchase_intent DESC LIMIT 10`,
      )
      .bind(ctx.lineAccountId)
      .all<{ friend_id: string; display_name: string | null; purchase_intent: number; signal_summary: string | null }>();
    leads = result.results;
  } catch {
    /* fallback */
  }

  if (leads.length === 0) {
    return {
      output: { message: 'no hot leads', topPriorities: [] },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  const list = leads
    .map((l) => `- ${l.display_name ?? l.friend_id.slice(0, 8)} (intent ${l.purchase_intent}): ${l.signal_summary ?? '（要約なし）'}`)
    .join('\n');

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    user: `購入意欲スコア 70 以上の顧客リスト：\n${list}\n\n優先連絡先と推奨メッセージを JSON で返してください。`,
    extraOutput: { hotLeadsCount: leads.length },
  });
}
