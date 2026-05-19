import { runAiJob } from './_shared.js';
import { upsertMonthlyLearningNote } from '@line-crm/db';
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

  // 開封率の集計 (時刻別) - 単純集計、AI 不要
  let bestSendHour: number | null = null;
  let avgOpenRate: number | null = null;
  let avgClickRate: number | null = null;
  try {
    const hourly = await ctx.db
      .prepare(
        `SELECT substr(b.scheduled_at, 12, 2) AS hour_str, AVG(bi.open_rate) AS avg_rate
           FROM broadcasts b
           LEFT JOIN broadcast_insights bi ON bi.broadcast_id = b.id
          WHERE substr(b.created_at, 1, 7) = ?
            AND bi.open_rate IS NOT NULL
          GROUP BY hour_str
          ORDER BY avg_rate DESC LIMIT 1`,
      )
      .bind(yearMonth)
      .first<{ hour_str: string | null; avg_rate: number | null }>();
    if (hourly?.hour_str) {
      // UTC → JST (+9)
      const utcHour = parseInt(hourly.hour_str, 10);
      if (Number.isFinite(utcHour)) {
        bestSendHour = (utcHour + 9) % 24;
      }
    }
  } catch {
    /* ignore */
  }
  if (stats.length > 0) {
    const openSum = stats.reduce((s, r) => s + (r.open_rate ?? 0), 0);
    const clickSum = stats.reduce((s, r) => s + (r.click_rate ?? 0), 0);
    const validOpenCount = stats.filter((r) => r.open_rate != null).length;
    const validClickCount = stats.filter((r) => r.click_rate != null).length;
    avgOpenRate = validOpenCount > 0 ? openSum / validOpenCount : null;
    avgClickRate = validClickCount > 0 ? clickSum / validClickCount : null;
  }

  const result = await runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    user: `${yearMonth} の配信パフォーマンス：

${table}

${input.focus ? `特に ${input.focus} の改善に集中してください。\n` : ''}
分析と改善案を JSON で返してください。`,
    extraOutput: { yearMonth, statsCount: stats.length },
  });

  // Big Move 5: 学習を monthly_learning_notes に保存
  try {
    const output = result.output as Record<string, unknown> & {
      summary?: string;
      topPerformers?: Array<Record<string, unknown>>;
      bottomPerformers?: Array<Record<string, unknown>>;
      improvements?: string[];
      experimentSuggestion?: string;
    };
    const successful = Array.isArray(output.topPerformers)
      ? output.topPerformers.map((t) => `${t.title}: ${t.successFactor ?? ''}`).filter(Boolean)
      : [];
    const failed = Array.isArray(output.bottomPerformers)
      ? output.bottomPerformers.map((t) => `${t.title}: ${t.issue ?? ''}`).filter(Boolean)
      : [];
    await upsertMonthlyLearningNote(ctx.db, {
      lineAccountId: ctx.lineAccountId,
      yearMonth,
      totalBroadcasts: stats.length,
      avgOpenRate,
      avgClickRate,
      bestSendHour,
      insightsSummary: typeof output.summary === 'string' ? output.summary : null,
      successfulPatterns: successful,
      failedPatterns: failed,
      recommendations: Array.isArray(output.improvements) ? output.improvements : [],
      abTestSuggestions:
        typeof output.experimentSuggestion === 'string' ? [output.experimentSuggestion] : [],
      generatedBy: 'analyze-broadcast-performance',
      generationModel: 'claude-sonnet-4-6',
      generationCostYenX100: result.costYenX100,
    });
  } catch (e) {
    console.error('[analyze-broadcast-performance] upsert learning note failed:', e);
  }

  return result;
}
