/**
 * KPI 目標（kpi_goals）のクエリヘルパー。
 * 事業者が月初に設定する KPI を管理し、AI 自動化エンジンの起点になる。
 */

import { jstNow } from './utils.js';

export type KpiMetric =
  | 'broadcast_count'
  | 'friend_growth'
  | 'cv_count'
  | 'reactivation_count'
  | 'open_rate'
  | 'click_rate'
  | 'nps'
  | 'reservation_count'
  | 'review_count';

export const KPI_METRICS: KpiMetric[] = [
  'broadcast_count',
  'friend_growth',
  'cv_count',
  'reactivation_count',
  'open_rate',
  'click_rate',
  'nps',
  'reservation_count',
  'review_count',
];

export interface KpiGoalRow {
  id: string;
  line_account_id: string;
  year_month: string;
  metric: KpiMetric;
  target_value: number;
  current_value: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listKpiGoals(
  db: D1Database,
  lineAccountId: string,
  yearMonth?: string,
): Promise<KpiGoalRow[]> {
  const sql = yearMonth
    ? `SELECT * FROM kpi_goals WHERE line_account_id = ? AND year_month = ? ORDER BY metric`
    : `SELECT * FROM kpi_goals WHERE line_account_id = ? ORDER BY year_month DESC, metric`;
  const stmt = yearMonth
    ? db.prepare(sql).bind(lineAccountId, yearMonth)
    : db.prepare(sql).bind(lineAccountId);
  const result = await stmt.all<KpiGoalRow>();
  return result.results;
}

export async function getKpiGoal(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
  metric: KpiMetric,
): Promise<KpiGoalRow | null> {
  return db
    .prepare(
      `SELECT * FROM kpi_goals WHERE line_account_id = ? AND year_month = ? AND metric = ?`,
    )
    .bind(lineAccountId, yearMonth, metric)
    .first<KpiGoalRow>();
}

export async function upsertKpiGoal(
  db: D1Database,
  input: {
    lineAccountId: string;
    yearMonth: string;
    metric: KpiMetric;
    targetValue: number;
    notes?: string;
    createdBy?: string;
  },
): Promise<KpiGoalRow> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO kpi_goals (id, line_account_id, year_month, metric, target_value, current_value, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, year_month, metric) DO UPDATE SET
         target_value = excluded.target_value,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineAccountId,
      input.yearMonth,
      input.metric,
      input.targetValue,
      input.notes ?? null,
      input.createdBy ?? null,
      now,
      now,
    )
    .run();
  return (await getKpiGoal(db, input.lineAccountId, input.yearMonth, input.metric))!;
}

export async function incrementKpiCurrent(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
  metric: KpiMetric,
  delta = 1,
): Promise<void> {
  await db
    .prepare(
      `UPDATE kpi_goals SET current_value = current_value + ?, updated_at = ?
       WHERE line_account_id = ? AND year_month = ? AND metric = ?`,
    )
    .bind(delta, jstNow(), lineAccountId, yearMonth, metric)
    .run();
}

export async function deleteKpiGoal(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM kpi_goals WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .run();
}
