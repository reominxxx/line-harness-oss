import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 配信のデータアナリストです。
配信ごとの開封率 / CTR を分析し、伸ばすための具体的な改善案を提示します。

【出力 JSON】
{
  "summary": "全体の傾向（80 字）",
  "topPerformers": [{ "title": "...", "openRate": N, "successFactor": "なぜ良かった" }],
  "bottomPerformers": [{ "title": "...", "openRate": N, "issue": "なぜ低かった" }],
  "improvements": ["改善案 1", "改善案 2", "改善案 3"],
  "experimentSuggestion": "今すぐ試すべき A/B テスト案"
}`;

export async function handleAnalyzeBroadcastPerformance(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { yearMonth?: string; focus?: string };
  const yearMonth = input.yearMonth ?? new Date().toISOString().slice(0, 7);

  // 直近月の配信データ
  let stats: Array<{ title: string; open_rate: number | null; click_rate: number | null }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT b.title, bi.open_rate, bi.click_rate
         FROM broadcasts b
         LEFT JOIN broadcast_insights bi ON bi.broadcast_id = b.id
         WHERE substr(b.created_at, 1, 7) = ?
         ORDER BY bi.open_rate DESC LIMIT 20`,
      )
      .bind(yearMonth)
      .all<{ title: string; open_rate: number | null; click_rate: number | null }>();
    stats = result.results;
  } catch {
    /* fallback to empty */
  }

  const table = stats.length > 0
    ? stats.map((s) => `- ${s.title}: 開封 ${s.open_rate?.toFixed(1) ?? '—'}% / CTR ${s.click_rate?.toFixed(1) ?? '—'}%`).join('\n')
    : 'データなし';

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    user: `${yearMonth} の配信パフォーマンス：

${table}

${input.focus ? `特に ${input.focus} の改善に集中してください。\n` : ''}
分析と改善案を JSON で返してください。`,
    extraOutput: { yearMonth, statsCount: stats.length },
  });
}
