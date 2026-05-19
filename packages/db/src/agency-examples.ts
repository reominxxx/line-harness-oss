/**
 * 業界横断・全テナント共有の配信実例ライブラリ
 *
 * 用途:
 *  - 運用代行ノウハウ (YouTube 解説の要約・Web 記事) と他社の実配信スクショを溜める
 *  - AI 配信生成 (generate-broadcast) で業界・テーマ・時間帯でキーワード検索 → context として参照
 *  - テナント横断で参照される (is_public = 1)
 */

import { jstNow } from './utils.js';

export type AgencyIndustry =
  | 'beauty'
  | 'chiropractic'
  | 'ecommerce'
  | 'school'
  | 'legal'
  | 'other';

export type AgencyBroadcastType =
  | 'campaign'        // セール / 集客
  | 'reminder'        // リマインド (予約・来店)
  | 'newsletter'      // ニュースレター・近況報告
  | 'event'           // イベント告知
  | 'limited_offer'   // 期間限定オファー
  | 'aftercare'       // アフターケア
  | 'welcome'         // 友だち追加直後
  | 'reactivation';   // 休眠掘り起こし

export type AgencyTimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export type AgencyWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type AgencySeason = 'spring' | 'summer' | 'autumn' | 'winter' | 'newyear' | 'xmas';

export interface AgencyExampleRow {
  id: string;
  industry: AgencyIndustry | null;
  broadcast_type: AgencyBroadcastType | null;
  time_of_day: AgencyTimeOfDay | null;
  weekday: AgencyWeekday | null;
  season: AgencySeason | null;
  title: string | null;
  content: string;
  image_url: string | null;
  source_url: string | null;
  notes: string | null;
  tags_json: string | null;
  is_public: number;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListAgencyExamplesOptions {
  industry?: AgencyIndustry;
  broadcastType?: AgencyBroadcastType;
  timeOfDay?: AgencyTimeOfDay;
  q?: string;
  limit?: number;
  offset?: number;
  includePrivate?: boolean;
}

export async function listAgencyExamples(
  db: D1Database,
  opts: ListAgencyExamplesOptions = {},
): Promise<{ rows: AgencyExampleRow[]; total: number }> {
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (!opts.includePrivate) conditions.push('is_public = 1');
  if (opts.industry) {
    conditions.push('industry = ?');
    binds.push(opts.industry);
  }
  if (opts.broadcastType) {
    conditions.push('broadcast_type = ?');
    binds.push(opts.broadcastType);
  }
  if (opts.timeOfDay) {
    conditions.push('time_of_day = ?');
    binds.push(opts.timeOfDay);
  }
  if (opts.q) {
    conditions.push('(content LIKE ? OR title LIKE ? OR notes LIKE ?)');
    const pattern = `%${opts.q}%`;
    binds.push(pattern, pattern, pattern);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [rowsResult, countResult] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM agency_examples ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, limit, offset)
      .all<AgencyExampleRow>(),
    db
      .prepare(`SELECT COUNT(*) AS c FROM agency_examples ${where}`)
      .bind(...binds)
      .first<{ c: number }>(),
  ]);

  return { rows: rowsResult.results, total: countResult?.c ?? 0 };
}

export async function getAgencyExample(
  db: D1Database,
  id: string,
): Promise<AgencyExampleRow | null> {
  return db.prepare(`SELECT * FROM agency_examples WHERE id = ?`).bind(id).first<AgencyExampleRow>();
}

export interface CreateAgencyExampleInput {
  industry?: AgencyIndustry | null;
  broadcastType?: AgencyBroadcastType | null;
  timeOfDay?: AgencyTimeOfDay | null;
  weekday?: AgencyWeekday | null;
  season?: AgencySeason | null;
  title?: string | null;
  content: string;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
  tags?: string[];
  isPublic?: boolean;
  addedBy?: string | null;
}

export async function createAgencyExample(
  db: D1Database,
  input: CreateAgencyExampleInput,
): Promise<AgencyExampleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO agency_examples (
         id, industry, broadcast_type, time_of_day, weekday, season,
         title, content, image_url, source_url, notes, tags_json,
         is_public, added_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.industry ?? null,
      input.broadcastType ?? null,
      input.timeOfDay ?? null,
      input.weekday ?? null,
      input.season ?? null,
      input.title ?? null,
      input.content,
      input.imageUrl ?? null,
      input.sourceUrl ?? null,
      input.notes ?? null,
      input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
      input.isPublic === false ? 0 : 1,
      input.addedBy ?? null,
      now,
      now,
    )
    .run();
  const row = await getAgencyExample(db, id);
  if (!row) throw new Error('agency_example insert failed');
  return row;
}

export async function updateAgencyExample(
  db: D1Database,
  id: string,
  input: Partial<CreateAgencyExampleInput>,
): Promise<AgencyExampleRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(val);
  };
  if (input.industry !== undefined) push('industry', input.industry);
  if (input.broadcastType !== undefined) push('broadcast_type', input.broadcastType);
  if (input.timeOfDay !== undefined) push('time_of_day', input.timeOfDay);
  if (input.weekday !== undefined) push('weekday', input.weekday);
  if (input.season !== undefined) push('season', input.season);
  if (input.title !== undefined) push('title', input.title);
  if (input.content !== undefined) push('content', input.content);
  if (input.imageUrl !== undefined) push('image_url', input.imageUrl);
  if (input.sourceUrl !== undefined) push('source_url', input.sourceUrl);
  if (input.notes !== undefined) push('notes', input.notes);
  if (input.tags !== undefined) {
    push('tags_json', input.tags.length > 0 ? JSON.stringify(input.tags) : null);
  }
  if (input.isPublic !== undefined) push('is_public', input.isPublic ? 1 : 0);
  if (sets.length === 0) return getAgencyExample(db, id);
  push('updated_at', jstNow());

  await db
    .prepare(`UPDATE agency_examples SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return getAgencyExample(db, id);
}

export async function deleteAgencyExample(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM agency_examples WHERE id = ?`).bind(id).run();
}

/**
 * 配信生成時に呼ばれる検索。業界・配信種別・時間帯で関連例を取得。
 * AI が context として使うため公開 (is_public=1) のみ返す。
 */
export async function searchAgencyExamplesForBroadcast(
  db: D1Database,
  filters: {
    industry?: AgencyIndustry;
    broadcastType?: AgencyBroadcastType;
    timeOfDay?: AgencyTimeOfDay;
    season?: AgencySeason;
    keywords?: string[];
  },
  limit = 3,
): Promise<AgencyExampleRow[]> {
  // 優先順位: industry 一致 > broadcast_type 一致 > 時間帯一致 > キーワード一致
  // シンプルに条件付き ORDER BY でスコアリング
  const conditions: string[] = ['is_public = 1'];
  const binds: unknown[] = [];
  const scoreParts: string[] = [];

  if (filters.industry) {
    scoreParts.push(`CASE WHEN industry = ? THEN 4 ELSE 0 END`);
    binds.push(filters.industry);
  }
  if (filters.broadcastType) {
    scoreParts.push(`CASE WHEN broadcast_type = ? THEN 2 ELSE 0 END`);
    binds.push(filters.broadcastType);
  }
  if (filters.timeOfDay) {
    scoreParts.push(`CASE WHEN time_of_day = ? THEN 1 ELSE 0 END`);
    binds.push(filters.timeOfDay);
  }
  if (filters.season) {
    scoreParts.push(`CASE WHEN season = ? THEN 1 ELSE 0 END`);
    binds.push(filters.season);
  }
  for (const kw of filters.keywords ?? []) {
    if (kw.length < 2) continue;
    scoreParts.push(`CASE WHEN content LIKE ? THEN 1 ELSE 0 END`);
    binds.push(`%${kw}%`);
  }
  const scoreExpr = scoreParts.length > 0 ? scoreParts.join(' + ') : '0';

  const sql = `SELECT *, (${scoreExpr}) AS score FROM agency_examples
               WHERE ${conditions.join(' AND ')}
               ORDER BY score DESC, created_at DESC
               LIMIT ?`;
  binds.push(limit);
  const result = await db.prepare(sql).bind(...binds).all<AgencyExampleRow & { score: number }>();
  // score が 0 のものは関係性なしと判断、除外
  return result.results.filter((r) => r.score > 0);
}
