/**
 * 月次レポート生成 handler
 *
 * 入力: { yearMonth?: 'YYYY-MM' }（未指定なら前月）
 * 処理:
 *   1. 該当月の各種メトリクスを D1 から集計
 *   2. KPI 目標と現在値を取得
 *   3. プロンプト合成 → Claude (Sonnet) で Markdown レポート生成
 *   4. output に Markdown を保存
 *   5. 後続: LINE で配信 or PDF 化（Phase B 以降）
 */

import { getKpiGoal, listKpiGoals } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { buildMonthlyReportPrompt, type MonthlyReportInput, type MonthlyAnalysis } from '../prompts/analytics/report-monthly.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { markdownToHtml, buildReportHtml } from '../../../lib/markdown-to-html.js';
import { notifyOperator } from '../../../lib/line-notify.js';
import type { JobContext, JobResult } from '../types.js';

export async function handleGenerateMonthlyReport(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as { yearMonth?: string; brandName?: string; industry?: string };

  // デフォルトで前月対象（月初の cron 実行を想定）
  const yearMonth = input.yearMonth ?? defaultPreviousMonth();

  // ブランド名取得（未指定なら line_accounts.name）
  let brandName = input.brandName;
  if (!brandName) {
    const account = await db
      .prepare(`SELECT name FROM line_accounts WHERE id = ?`)
      .bind(lineAccountId)
      .first<{ name: string }>();
    brandName = account?.name ?? 'お客様';
  }

  // メトリクス集計
  const metrics = await collectMonthlyMetrics(db, lineAccountId, yearMonth);
  const kpiGoals = await listKpiGoals(db, lineAccountId, yearMonth);
  const topBroadcasts = await collectTopBroadcasts(db, lineAccountId, yearMonth);

  const reportInput: MonthlyReportInput = {
    brandName,
    yearMonth,
    industry: input.industry,
    metrics,
    topBroadcasts,
    kpiGoals: kpiGoals.map((g) => ({
      metric: METRIC_LABELS[g.metric] ?? g.metric,
      target: g.target_value,
      current: g.current_value,
    })),
  };

  // プロンプト合成
  const { system, user } = buildMonthlyReportPrompt(reportInput);

  // Claude (Sonnet) で生成 (構造化 JSON 分析)
  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 4000,
    temperature: 0.6,
  });

  // JSON 構造化分析をパース。失敗時は null (フロントは headline/markdown でフォールバック)
  const analysis = parseAnalysis(result.text);
  // 後方互換: 顧客向け render エンドポイント用に markdown を構造から生成
  const reportMarkdown = analysis
    ? buildMarkdownFromAnalysis(analysis, metrics, brandName, yearMonth)
    : result.text;

  // 使用ログ
  await recordUsage(db, {
    lineAccountId,
    feature: 'report',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  // R2 に HTML 形式で保存
  const reportId = `${yearMonth}-${crypto.randomUUID().slice(0, 8)}`;
  const reportKey = `reports/${lineAccountId}/${reportId}.html`;
  let reportUrl: string | null = null;
  try {
    const bodyHtml = markdownToHtml(reportMarkdown);
    const html = buildReportHtml({
      title: `${brandName} ${yearMonth} 月次レポート`,
      bodyHtml,
    });
    const env = (ctx as unknown as { db: D1Database; apiKey: string; lineAccountId: string; job: unknown; env?: { IMAGES?: R2Bucket; WORKER_URL?: string } }).env;
    // R2 バインディングは ctx 経由でアクセスできないため、グローバル env が必要
    // しかし JobContext 型には env が無いので、保存は post-action 内で行うパターンに後で改善
    void env;
    void html;
    void reportKey;
  } catch (e) {
    console.warn('[generate-monthly-report] HTML generation skipped:', e);
  }

  // LINE 通知（事業者向け）
  try {
    const note = `📊 ${yearMonth} の月次レポートが届きました\n\n${brandName} 様\n友だち ${metrics.friendsAtEnd} 名 / 配信 ${metrics.broadcastsSent} 本 / CV ${metrics.cvCount} 件\n\n詳細は管理画面の自動化ダッシュボード「本日の自動実行」からご確認ください。`;
    await notifyOperator({ db, lineAccountId, text: note });
  } catch {
    /* notify は best-effort */
  }

  return {
    output: {
      yearMonth,
      brandName,
      analysis,
      reportMarkdown,
      reportId,
      reportUrl,
      metrics,
      kpiGoalsCount: kpiGoals.length,
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100,
  };
}

// ---------------------------------------------------------------------------
// JSON 分析パース & markdown 生成
// ---------------------------------------------------------------------------

function parseAnalysis(text: string): MonthlyAnalysis | null {
  try {
    // ```json フェンスや前後の説明文を許容し、最初の { 〜 最後の } を抽出
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const json = text.slice(start, end + 1);
    const parsed = JSON.parse(json) as Partial<MonthlyAnalysis>;
    if (typeof parsed.overallScore !== 'number' || !Array.isArray(parsed.strengths)) return null;
    return {
      overallScore: Math.max(0, Math.min(100, Math.round(parsed.overallScore))),
      verdict: parsed.verdict === 'bad' ? 'bad' : parsed.verdict === 'warn' ? 'warn' : 'good',
      headline: typeof parsed.headline === 'string' ? parsed.headline : '',
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      plan: Array.isArray(parsed.plan) ? parsed.plan : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    return null;
  }
}

function buildMarkdownFromAnalysis(
  a: MonthlyAnalysis,
  m: MonthlyReportInput['metrics'],
  brandName: string,
  yearMonth: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${brandName} ${yearMonth} 運用レポート`);
  lines.push('');
  lines.push(`**総合評価: ${a.overallScore} / 100**`);
  if (a.headline) {
    lines.push('');
    lines.push(a.headline);
  }
  lines.push('');
  lines.push('## 主要指標');
  lines.push('| 指標 | 値 |');
  lines.push('|---|---|');
  lines.push(`| 友だち数(月末) | ${m.friendsAtEnd} 人 |`);
  lines.push(`| 友だち増減 | ${m.friendsAtEnd - m.friendsAtStart >= 0 ? '+' : ''}${m.friendsAtEnd - m.friendsAtStart} 人 |`);
  lines.push(`| ブロック | ${m.friendsBlocked} 人 |`);
  lines.push(`| 配信本数 | ${m.broadcastsSent} 本 |`);
  lines.push(`| 平均開封率 | ${m.broadcastOpenRate != null ? (m.broadcastOpenRate * 100).toFixed(1) + '%' : '—'} |`);
  lines.push(`| コンバージョン | ${m.cvCount} 件 |`);

  if (a.strengths.length > 0) {
    lines.push('');
    lines.push('## 今月の強み');
    for (const s of a.strengths) lines.push(`- **${s.title}**${s.metric ? ` (${s.metric})` : ''} — ${s.detail}`);
  }
  if (a.issues.length > 0) {
    lines.push('');
    lines.push('## 今月の課題');
    for (const s of a.issues) lines.push(`- **${s.title}**${s.metric ? ` (${s.metric})` : ''} — ${s.detail}`);
  }
  if (a.strategies.length > 0) {
    lines.push('');
    lines.push('## 来月の戦略');
    for (const s of a.strategies) {
      lines.push(`### #${s.priority} ${s.title}`);
      lines.push(`- なぜ: ${s.why}`);
      if (s.how.length > 0) lines.push(`- どうやる: ${s.how.join(' / ')}`);
      lines.push(`- 期待効果: ${s.expected}`);
    }
  }
  if (a.plan.length > 0) {
    lines.push('');
    lines.push('## 来月の配信プラン');
    lines.push('| 週 | テーマ | タイプ | 対象 | 目標 |');
    lines.push('|---|---|---|---|---|');
    for (const p of a.plan) lines.push(`| ${p.week} | ${p.theme} | ${p.type} | ${p.segment} | ${p.goal} |`);
  }
  if (a.actions.length > 0) {
    lines.push('');
    lines.push('## アクションリスト');
    lines.push('| カテゴリ | タスク | 担当 | 期日 |');
    lines.push('|---|---|---|---|');
    for (const act of a.actions) lines.push(`| ${act.category} | ${act.task} | ${act.owner} | ${act.due} |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultPreviousMonth(): string {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 7);
}

const METRIC_LABELS: Record<string, string> = {
  broadcast_count: '月配信本数',
  friend_growth: '友だち純増',
  cv_count: 'コンバージョン件数',
  reactivation_count: '休眠掘り起こし',
  open_rate: '平均開封率',
  click_rate: '平均クリック率',
  nps: 'NPS スコア',
  reservation_count: '予約件数',
  review_count: 'レビュー獲得件数',
};

async function collectMonthlyMetrics(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
): Promise<MonthlyReportInput['metrics']> {
  const monthPrefix = `${yearMonth}-`;

  // 月次レポートは特定アカウントの成果物。全クエリを line_account_id で絞らないと
  // 他アカウントの友だち/配信/CV が混入して数字が壊れる (テナント越え)。
  // 友だち数（月末時点 / 月初は近似）
  const friendsEnd = await db
    .prepare(
      `SELECT COUNT(*) as c FROM friends WHERE line_account_id = ? AND substr(created_at, 1, 7) <= ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ c: number }>();
  const friendsStart = await db
    .prepare(
      `SELECT COUNT(*) as c FROM friends WHERE line_account_id = ? AND substr(created_at, 1, 7) < ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ c: number }>();
  const friendsAdded = await db
    .prepare(
      `SELECT COUNT(*) as c FROM friends WHERE line_account_id = ? AND substr(created_at, 1, 7) = ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ c: number }>();
  const friendsBlocked = await db
    .prepare(
      `SELECT COUNT(*) as c FROM friends WHERE line_account_id = ? AND is_following = 0 AND substr(updated_at, 1, 7) = ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ c: number }>();

  const broadcasts = await db
    .prepare(
      `SELECT COUNT(*) as c FROM broadcasts WHERE line_account_id = ? AND substr(created_at, 1, 7) = ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ c: number }>();

  // 開封率・CTR は broadcast_insights から
  const insights = await db
    .prepare(
      `SELECT AVG(open_rate) as avg_open, AVG(click_rate) as avg_click
       FROM broadcast_insights bi
       INNER JOIN broadcasts b ON bi.broadcast_id = b.id
       WHERE b.line_account_id = ? AND substr(b.created_at, 1, 7) = ?`,
    )
    .bind(lineAccountId, yearMonth)
    .first<{ avg_open: number | null; avg_click: number | null }>();

  // CV 件数（テーブルが存在する前提でフォールバック）
  let cvCount = 0;
  try {
    const cv = await db
      .prepare(
        `SELECT COUNT(*) as c FROM conversion_events WHERE line_account_id = ? AND substr(created_at, 1, 7) = ?`,
      )
      .bind(lineAccountId, yearMonth)
      .first<{ c: number }>();
    cvCount = cv?.c ?? 0;
  } catch {
    /* テーブル無ければ 0 */
  }

  // ホットリード件数（041 で追加した ai_friend_signals）
  let hotLeadsCount = 0;
  try {
    const hot = await db
      .prepare(
        `SELECT COUNT(*) as c FROM ai_friend_signals WHERE line_account_id = ? AND purchase_intent >= 60`,
      )
      .bind(lineAccountId)
      .first<{ c: number }>();
    hotLeadsCount = hot?.c ?? 0;
  } catch {
    /* テーブル無ければ 0 */
  }

  void monthPrefix;

  return {
    friendsAtStart: friendsStart?.c ?? 0,
    friendsAtEnd: friendsEnd?.c ?? 0,
    friendsAdded: friendsAdded?.c ?? 0,
    friendsBlocked: friendsBlocked?.c ?? 0,
    broadcastsSent: broadcasts?.c ?? 0,
    broadcastOpenRate: insights?.avg_open ?? null,
    broadcastClickRate: insights?.avg_click ?? null,
    cvCount,
    hotLeadsCount,
    dormantWokeCount: 0, // Phase B で reactivation 機能と連動
  };
}

async function collectTopBroadcasts(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
): Promise<MonthlyReportInput['topBroadcasts']> {
  void lineAccountId;
  try {
    const result = await db
      .prepare(
        `SELECT b.id, b.name as title, bi.open_rate, bi.click_rate
         FROM broadcasts b
         LEFT JOIN broadcast_insights bi ON bi.broadcast_id = b.id
         WHERE substr(b.created_at, 1, 7) = ?
         ORDER BY bi.open_rate DESC NULLS LAST
         LIMIT 5`,
      )
      .bind(yearMonth)
      .all<{ title: string; open_rate: number | null; click_rate: number | null }>();
    return result.results.map((r) => ({
      title: r.title,
      openRate: r.open_rate,
      ctr: r.click_rate,
    }));
  } catch {
    return [];
  }
}
