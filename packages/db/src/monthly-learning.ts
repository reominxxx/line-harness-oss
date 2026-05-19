/**
 * 月次学習ノート (Big Move 5 - PDCA フィードバックループ)
 *
 * analyze-broadcast-performance ハンドラが月次で生成する学習サマリを保持し、
 * 次月の generate-broadcast / plan-monthly-broadcasts に context として注入する。
 */

import { jstNow } from './utils.js';

export interface MonthlyLearningNoteRow {
  id: string;
  line_account_id: string;
  year_month: string;
  total_broadcasts: number;
  avg_open_rate: number | null;
  avg_click_rate: number | null;
  best_send_hour: number | null;
  best_send_weekday: string | null;
  insights_summary: string | null;
  successful_patterns_json: string | null;
  failed_patterns_json: string | null;
  recommendations_json: string | null;
  ab_test_suggestions_json: string | null;
  generated_by: string | null;
  generation_model: string | null;
  generation_cost_yen_x100: number;
  created_at: string;
  updated_at: string;
}

export async function getMonthlyLearningNote(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
): Promise<MonthlyLearningNoteRow | null> {
  return db
    .prepare(`SELECT * FROM monthly_learning_notes WHERE line_account_id = ? AND year_month = ?`)
    .bind(lineAccountId, yearMonth)
    .first<MonthlyLearningNoteRow>();
}

/** 直近 N 月の学習ノートを取得 (新しい順) */
export async function listRecentLearningNotes(
  db: D1Database,
  lineAccountId: string,
  limit = 3,
): Promise<MonthlyLearningNoteRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM monthly_learning_notes
        WHERE line_account_id = ?
        ORDER BY year_month DESC LIMIT ?`,
    )
    .bind(lineAccountId, limit)
    .all<MonthlyLearningNoteRow>();
  return result.results;
}

export interface UpsertLearningNoteInput {
  lineAccountId: string;
  yearMonth: string;
  totalBroadcasts?: number;
  avgOpenRate?: number | null;
  avgClickRate?: number | null;
  bestSendHour?: number | null;
  bestSendWeekday?: string | null;
  insightsSummary?: string | null;
  successfulPatterns?: unknown;
  failedPatterns?: unknown;
  recommendations?: unknown;
  abTestSuggestions?: unknown;
  generatedBy?: string;
  generationModel?: string;
  generationCostYenX100?: number;
}

export async function upsertMonthlyLearningNote(
  db: D1Database,
  input: UpsertLearningNoteInput,
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO monthly_learning_notes (
         id, line_account_id, year_month,
         total_broadcasts, avg_open_rate, avg_click_rate,
         best_send_hour, best_send_weekday,
         insights_summary, successful_patterns_json, failed_patterns_json,
         recommendations_json, ab_test_suggestions_json,
         generated_by, generation_model, generation_cost_yen_x100,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, year_month) DO UPDATE SET
         total_broadcasts = excluded.total_broadcasts,
         avg_open_rate = excluded.avg_open_rate,
         avg_click_rate = excluded.avg_click_rate,
         best_send_hour = excluded.best_send_hour,
         best_send_weekday = excluded.best_send_weekday,
         insights_summary = excluded.insights_summary,
         successful_patterns_json = excluded.successful_patterns_json,
         failed_patterns_json = excluded.failed_patterns_json,
         recommendations_json = excluded.recommendations_json,
         ab_test_suggestions_json = excluded.ab_test_suggestions_json,
         generated_by = excluded.generated_by,
         generation_model = excluded.generation_model,
         generation_cost_yen_x100 = excluded.generation_cost_yen_x100,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.yearMonth,
      input.totalBroadcasts ?? 0,
      input.avgOpenRate ?? null,
      input.avgClickRate ?? null,
      input.bestSendHour ?? null,
      input.bestSendWeekday ?? null,
      input.insightsSummary ?? null,
      input.successfulPatterns ? JSON.stringify(input.successfulPatterns) : null,
      input.failedPatterns ? JSON.stringify(input.failedPatterns) : null,
      input.recommendations ? JSON.stringify(input.recommendations) : null,
      input.abTestSuggestions ? JSON.stringify(input.abTestSuggestions) : null,
      input.generatedBy ?? null,
      input.generationModel ?? null,
      input.generationCostYenX100 ?? 0,
      now,
      now,
    )
    .run();
}

/**
 * generate-broadcast / plan-monthly-broadcasts に注入する用の "context テキスト" を生成。
 * 直近 N ヶ月の学習を平易な文字列に変換する。
 */
export function formatLearningContextText(notes: MonthlyLearningNoteRow[]): string {
  if (notes.length === 0) return '';
  const lines: string[] = ['【テナント固有の学習 (PDCA で蓄積された知見)】'];
  for (const note of notes.slice(0, 2)) {
    lines.push(`\n■ ${note.year_month} の振り返り`);
    if (note.total_broadcasts > 0) {
      const op = note.avg_open_rate != null ? `開封 ${note.avg_open_rate.toFixed(1)}%` : '';
      const cl = note.avg_click_rate != null ? `クリック ${note.avg_click_rate.toFixed(1)}%` : '';
      lines.push(`配信 ${note.total_broadcasts} 本 / ${op}${op && cl ? ' / ' : ''}${cl}`);
    }
    if (note.best_send_hour != null) {
      lines.push(`最も開封率が高かった時刻: ${note.best_send_hour}:00 (JST)${note.best_send_weekday ? ` / 曜日: ${note.best_send_weekday}` : ''}`);
    }
    if (note.insights_summary) lines.push(`要点: ${note.insights_summary}`);
    if (note.successful_patterns_json) {
      try {
        const arr = JSON.parse(note.successful_patterns_json);
        if (Array.isArray(arr) && arr.length > 0) {
          lines.push(`成功パターン: ${arr.slice(0, 3).map((s) => String(s)).join(' / ')}`);
        }
      } catch {
        /* ignore */
      }
    }
    if (note.failed_patterns_json) {
      try {
        const arr = JSON.parse(note.failed_patterns_json);
        if (Array.isArray(arr) && arr.length > 0) {
          lines.push(`避けるパターン: ${arr.slice(0, 3).map((s) => String(s)).join(' / ')}`);
        }
      } catch {
        /* ignore */
      }
    }
    if (note.recommendations_json) {
      try {
        const arr = JSON.parse(note.recommendations_json);
        if (Array.isArray(arr) && arr.length > 0) {
          lines.push(`次月への改善提案: ${arr.slice(0, 3).map((s) => String(s)).join(' / ')}`);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return lines.join('\n');
}
