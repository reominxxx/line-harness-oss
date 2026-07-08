/**
 * ヒアリング → 運用設計書 (Blueprint) の DB アクセス。
 *
 * 入力: 文字起こし + ヒアリングシート CSV + 月配信本数。
 * 出力: AI が生成した Blueprint JSON。
 */
import { jstNow } from './utils.js';

// pending = cron が拾うのを待っている状態。POST /generate 直後に必ずこの状態に遷移する。
// generating = cron / handler が現在処理中。stalled なら再度 pending に戻す。
export type HearingStatus = 'draft' | 'pending' | 'generating' | 'ready' | 'error';

export interface HearingRow {
  id: string;
  line_account_id: string;
  title: string;
  transcript_text: string | null;
  csv_text: string | null;
  csv_filename: string | null;
  blueprint_json: string | null;
  ai_cost_yen_x100: number;
  monthly_broadcast_count: number;
  status: HearingStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface HearingListItem {
  id: string;
  title: string;
  status: HearingStatus;
  ai_cost_yen_x100: number;
  created_at: string;
  updated_at: string;
}

export async function listHearings(
  db: D1Database,
  lineAccountId: string,
  limit = 50,
): Promise<HearingListItem[]> {
  const rs = await db
    .prepare(
      `SELECT id, title, status, ai_cost_yen_x100, created_at, updated_at
       FROM hearings WHERE line_account_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, limit)
    .all<HearingListItem>();
  return rs.results ?? [];
}

export async function getHearing(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<HearingRow | null> {
  return await db
    .prepare(`SELECT * FROM hearings WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<HearingRow>();
}

export interface CreateHearingInput {
  lineAccountId: string;
  title: string;
  transcriptText?: string | null;
  csvText?: string | null;
  csvFilename?: string | null;
}

export async function createHearing(
  db: D1Database,
  input: CreateHearingInput,
): Promise<HearingRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO hearings (id, line_account_id, title, transcript_text, csv_text, csv_filename, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.title,
      input.transcriptText ?? null,
      input.csvText ?? null,
      input.csvFilename ?? null,
      now,
      now,
    )
    .run();
  const row = await db
    .prepare(`SELECT * FROM hearings WHERE id = ?`)
    .bind(id)
    .first<HearingRow>();
  if (!row) throw new Error('hearing insert failed');
  return row;
}

export async function updateHearingStatus(
  db: D1Database,
  id: string,
  status: HearingStatus,
  errorMessage?: string | null,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE hearings SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(status, errorMessage ?? null, now, id)
    .run();
}

export async function saveHearingBlueprint(
  db: D1Database,
  id: string,
  blueprintJson: string,
  costYenX100: number,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE hearings
       SET blueprint_json = ?, ai_cost_yen_x100 = ?, status = 'ready', error_message = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(blueprintJson, costYenX100, now, id)
    .run();
}

export async function deleteHearing(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM hearings WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * cron 用: 次に処理すべき pending hearing を 1 件だけ atomically 取得する。
 * SELECT → UPDATE の競合を避けるため、UPDATE ... WHERE id = (SELECT ...) で 1 回の SQL で予約する。
 *
 * 戻り値: 取得できた hearing。なければ null。
 */
export async function claimNextPendingHearing(db: D1Database): Promise<HearingRow | null> {
  // 1. id を 1 件決める (pending, created_at 昇順)
  const row = await db
    .prepare(`SELECT id FROM hearings WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
    .first<{ id: string }>();
  if (!row) return null;
  // 2. atomic に generating へ。同時に他の cron が拾っていたら 0 行更新で空振り。
  const updateRes = await db
    .prepare(
      `UPDATE hearings SET status = 'generating', updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(jstNow(), row.id)
    .run();
  if (!updateRes.meta?.changes) return null;
  return await db
    .prepare(`SELECT * FROM hearings WHERE id = ?`)
    .bind(row.id)
    .first<HearingRow>();
}

/**
 * generating で 5 分以上 updated_at が止まっている stale hearing を pending に戻す。
 * waitUntil で詰まったり worker が落ちたケースの救済。
 */
export async function recoverStalledHearings(db: D1Database): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE hearings
         SET status = 'pending', updated_at = ?
       WHERE status = 'generating'
         AND julianday('now', '+9 hours') - julianday(updated_at) > 5.0 / (24 * 60)`,
    )
    .bind(jstNow())
    .run();
  return res.meta?.changes ?? 0;
}

export async function setHearingPending(
  db: D1Database,
  id: string,
  monthlyBroadcastCount: number,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE hearings
         SET status = 'pending',
             monthly_broadcast_count = ?,
             error_message = ?,
             updated_at = ?
       WHERE id = ?`,
    )
    .bind(monthlyBroadcastCount, '[進捗] cron 待機中 (最大 1 分)', now, id)
    .run();
}
