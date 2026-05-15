/**
 * 週次ミニレポート（月次の補完）
 * 週末（日曜）に走り、その週の数字 + 来週へのヒントを提示
 */

import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウント運用の週次レポート担当です。
直近 7 日間のサマリーを Markdown でコンパクトに（800 字程度）まとめます。

【構成】
1. 今週のハイライト（数字込み）
2. 良かった点
3. 来週に活かしたいポイント
4. 来週の配信ネタ案 3 つ

【書き方】
- 日本語の自然な事業者向けトーン
- 数字を踏まえた示唆
- 過度な箇条書きを避ける`;

export async function handleGenerateWeeklyReport(ctx: JobContext): Promise<JobResult> {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

  // 直近 7 日の配信数
  let broadcasts = 0;
  let friendsAdded = 0;
  try {
    const b = await ctx.db
      .prepare(`SELECT COUNT(*) as c FROM broadcasts WHERE created_at >= ?`)
      .bind(weekAgo.toISOString())
      .first<{ c: number }>();
    broadcasts = b?.c ?? 0;
    const f = await ctx.db
      .prepare(`SELECT COUNT(*) as c FROM friends WHERE created_at >= ?`)
      .bind(weekAgo.toISOString())
      .first<{ c: number }>();
    friendsAdded = f?.c ?? 0;
  } catch {
    /* ignore */
  }

  return runAiJob(ctx, {
    feature: 'report',
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    user: `期間: ${weekAgo.toISOString().slice(0, 10)} 〜 ${today.toISOString().slice(0, 10)}
- 配信本数: ${broadcasts} 本
- 友だち追加: ${friendsAdded} 人

週次ミニレポートを Markdown で書いてください。`,
    parseJson: false, // Markdown をそのまま返す
    extraOutput: { broadcasts, friendsAdded, period: { start: weekAgo.toISOString(), end: today.toISOString() } },
  });
}
