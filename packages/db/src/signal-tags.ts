/**
 * シグナル → friend_tags 自動同期
 *
 * ai_friend_signals.vip_rank が変わった時、対応する「★VIP / ★ウォーム /
 * ★コールド / ★休眠 / ★NEW」タグを friend_tags に upsert する。
 * これにより、友だちリストのタグフィルタや一斉配信のセグメント指定で、
 * AI シグナルをそのまま絞り込みに使えるようになる。
 *
 * - タグ名は "★" prefix で固定 (システム管理であることを明示)
 * - 1 人につき 1 つの ★ タグだけが付く (他のシグナルタグは外す)
 * - tags テーブルにレコードがなければ自動作成
 */

import { jstNow } from './utils.js';
import type { VipRank } from './ai-signals.js';

interface SignalTagSpec {
  rank: VipRank;
  name: string;
  color: string;
}

const SIGNAL_TAGS: SignalTagSpec[] = [
  { rank: 'vip', name: '★VIP', color: '#8B5CF6' }, // purple
  { rank: 'warm', name: '★ウォーム', color: '#F97316' }, // orange
  { rank: 'cold', name: '★コールド', color: '#3B82F6' }, // blue
  { rank: 'dormant', name: '★休眠', color: '#6B7280' }, // gray
  { rank: 'new', name: '★NEW', color: '#10B981' }, // green
];

const ALL_SIGNAL_TAG_NAMES = SIGNAL_TAGS.map((t) => t.name);

/** システムタグの id を確実に取得 (なければ作成) */
async function ensureSignalTag(db: D1Database, spec: SignalTagSpec): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM tags WHERE name = ? LIMIT 1`)
    .bind(spec.name)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, spec.name, spec.color, jstNow())
    .run();
  return id;
}

/**
 * 1 人の友だちに対して、現在の vip_rank に合った ★ タグを 1 つだけ付け、
 * 他の ★ シグナルタグは外す。vip_rank=null の時は全 ★ タグを外す。
 */
export async function syncSignalTagForFriend(
  db: D1Database,
  friendId: string,
  vipRank: VipRank | null,
): Promise<void> {
  // 既存の ★ シグナルタグ ID をまとめて取得
  const placeholders = ALL_SIGNAL_TAG_NAMES.map(() => '?').join(',');
  const existingTags = await db
    .prepare(`SELECT id, name FROM tags WHERE name IN (${placeholders})`)
    .bind(...ALL_SIGNAL_TAG_NAMES)
    .all<{ id: string; name: string }>();
  const tagByName = new Map(existingTags.results.map((t) => [t.name, t.id]));

  // 付けるべき ★ タグ (vip_rank があれば 1 つ、なければ null)
  const targetSpec = vipRank ? SIGNAL_TAGS.find((s) => s.rank === vipRank) : null;
  let targetTagId: string | null = null;
  if (targetSpec) {
    targetTagId = tagByName.get(targetSpec.name) ?? (await ensureSignalTag(db, targetSpec));
  }

  const now = jstNow();

  // 1. 付けるべきタグ (targetTagId) を upsert
  if (targetTagId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`,
      )
      .bind(friendId, targetTagId, now)
      .run();
  }

  // 2. それ以外の ★ シグナルタグはこの友だちから外す
  const otherTagIds = existingTags.results
    .filter((t) => t.id !== targetTagId)
    .map((t) => t.id);
  if (otherTagIds.length > 0) {
    const otherPlaceholders = otherTagIds.map(() => '?').join(',');
    await db
      .prepare(
        `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id IN (${otherPlaceholders})`,
      )
      .bind(friendId, ...otherTagIds)
      .run();
  }
}

/** ★ シグナルタグ一覧 (UI などで表示色を引きたい時用) */
export function listSignalTagSpecs(): readonly SignalTagSpec[] {
  return SIGNAL_TAGS;
}
