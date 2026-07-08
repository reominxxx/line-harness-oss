/**
 * アカウント別カスタムセグメントタグ + AI 自動付与
 *
 * - segment_tags: ユーザー (店舗オーナー) がヒアリングに基づいて定義する
 *   業界特化セグメント。criteria に AI 判定基準を自然文で書く。
 * - friend_segment_tags: 友だちごとのタグ付与結果。assigned_by で AI / 手動を区別。
 */

import { jstNow } from './utils.js';

export interface SegmentTag {
  id: string;
  line_account_id: string;
  name: string;
  criteria: string;
  color: string;
  is_ai_managed: number;
  last_run_at: string | null;
  assigned_count: number;
  lstep_tag_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendSegmentTag {
  friend_id: string;
  segment_tag_id: string;
  line_account_id: string;
  assigned_by: 'ai' | 'manual';
  confidence: number | null;
  reason: string | null;
  assigned_at: string;
}

export interface CreateSegmentTagInput {
  lineAccountId: string;
  name: string;
  criteria: string;
  color?: string;
  isAiManaged?: boolean;
}

export async function listSegmentTags(
  db: D1Database,
  lineAccountId: string,
): Promise<SegmentTag[]> {
  const result = await db
    .prepare(
      `SELECT * FROM segment_tags WHERE line_account_id = ? ORDER BY created_at ASC`,
    )
    .bind(lineAccountId)
    .all<SegmentTag>();
  return result.results;
}

export async function getSegmentTag(
  db: D1Database,
  id: string,
): Promise<SegmentTag | null> {
  return await db
    .prepare(`SELECT * FROM segment_tags WHERE id = ?`)
    .bind(id)
    .first<SegmentTag>();
}

export async function createSegmentTag(
  db: D1Database,
  input: CreateSegmentTagInput,
): Promise<SegmentTag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO segment_tags
         (id, line_account_id, name, criteria, color, is_ai_managed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.criteria,
      input.color ?? '#3B82F6',
      input.isAiManaged === false ? 0 : 1,
      now,
      now,
    )
    .run();
  return (await getSegmentTag(db, id))!;
}

export interface UpdateSegmentTagInput {
  name?: string;
  criteria?: string;
  color?: string;
  isAiManaged?: boolean;
}

export async function updateSegmentTag(
  db: D1Database,
  id: string,
  input: UpdateSegmentTagInput,
): Promise<SegmentTag | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.criteria !== undefined) {
    fields.push('criteria = ?');
    values.push(input.criteria);
  }
  if (input.color !== undefined) {
    fields.push('color = ?');
    values.push(input.color);
  }
  if (input.isAiManaged !== undefined) {
    fields.push('is_ai_managed = ?');
    values.push(input.isAiManaged ? 1 : 0);
  }
  if (fields.length === 0) return await getSegmentTag(db, id);
  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db
    .prepare(`UPDATE segment_tags SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return await getSegmentTag(db, id);
}

export async function deleteSegmentTag(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM segment_tags WHERE id = ?`).bind(id).run();
}

/** AI 判定実行後の last_run_at / assigned_count を更新 */
export async function markSegmentTagRun(
  db: D1Database,
  id: string,
  assignedCount: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE segment_tags SET last_run_at = ?, assigned_count = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(jstNow(), assignedCount, jstNow(), id)
    .run();
}

/** 友だちにセグメントタグを付与 (上書き) */
export async function assignFriendSegmentTag(
  db: D1Database,
  input: {
    friendId: string;
    segmentTagId: string;
    lineAccountId: string;
    assignedBy: 'ai' | 'manual';
    confidence?: number | null;
    reason?: string | null;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_segment_tags
         (friend_id, segment_tag_id, line_account_id, assigned_by, confidence, reason, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(friend_id, segment_tag_id) DO UPDATE SET
         assigned_by = excluded.assigned_by,
         confidence  = excluded.confidence,
         reason      = excluded.reason,
         assigned_at = excluded.assigned_at`,
    )
    .bind(
      input.friendId,
      input.segmentTagId,
      input.lineAccountId,
      input.assignedBy,
      input.confidence ?? null,
      input.reason ?? null,
      now,
    )
    .run();
}

export async function removeFriendSegmentTag(
  db: D1Database,
  friendId: string,
  segmentTagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM friend_segment_tags WHERE friend_id = ? AND segment_tag_id = ?`,
    )
    .bind(friendId, segmentTagId)
    .run();
}

/** タグごとの友だち一覧 (UI 表示用、簡易) */
export async function listFriendsBySegmentTag(
  db: D1Database,
  segmentTagId: string,
  limit = 200,
): Promise<
  Array<{
    friend_id: string;
    display_name: string | null;
    picture_url: string | null;
    confidence: number | null;
    reason: string | null;
    assigned_by: 'ai' | 'manual';
    assigned_at: string;
  }>
> {
  const result = await db
    .prepare(
      `SELECT fst.friend_id, f.display_name, f.picture_url,
              fst.confidence, fst.reason, fst.assigned_by, fst.assigned_at
       FROM friend_segment_tags fst
       INNER JOIN friends f ON f.id = fst.friend_id
       WHERE fst.segment_tag_id = ?
       ORDER BY fst.assigned_at DESC
       LIMIT ?`,
    )
    .bind(segmentTagId, limit)
    .all<{
      friend_id: string;
      display_name: string | null;
      picture_url: string | null;
      confidence: number | null;
      reason: string | null;
      assigned_by: 'ai' | 'manual';
      assigned_at: string;
    }>();
  return result.results;
}

/** あるタグの付与済 friend_id 一覧 (配信ターゲット解決用) */
export async function listFriendIdsBySegmentTag(
  db: D1Database,
  segmentTagId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT friend_id FROM friend_segment_tags WHERE segment_tag_id = ?`,
    )
    .bind(segmentTagId)
    .all<{ friend_id: string }>();
  return result.results.map((r) => r.friend_id);
}

/** 配信用: タグ付与済の Friend エンティティを取得 */
export async function getFriendsBySegmentTag(
  db: D1Database,
  segmentTagId: string,
  lineAccountId?: string | null,
): Promise<Array<{
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  status_message: string | null;
  is_following: number;
  user_id: string | null;
  ig_igsid: string | null;
  score: number;
  created_at: string;
  updated_at: string;
}>> {
  const accountFilter = lineAccountId ? ' AND f.line_account_id = ?' : '';
  const binds: unknown[] = lineAccountId ? [segmentTagId, lineAccountId] : [segmentTagId];
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_segment_tags fst ON fst.friend_id = f.id
       WHERE fst.segment_tag_id = ?${accountFilter}
       ORDER BY f.created_at DESC`,
    )
    .bind(...binds)
    .all<{
      id: string;
      line_user_id: string;
      display_name: string | null;
      picture_url: string | null;
      status_message: string | null;
      is_following: number;
      user_id: string | null;
      ig_igsid: string | null;
      score: number;
      created_at: string;
      updated_at: string;
    }>();
  return result.results;
}

/** タグごとの付与人数を再計算 */
export async function recountSegmentTagAssignments(
  db: D1Database,
  segmentTagId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as c FROM friend_segment_tags WHERE segment_tag_id = ?`,
    )
    .bind(segmentTagId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}
