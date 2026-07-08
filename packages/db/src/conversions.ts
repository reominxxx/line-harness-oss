import { jstNow } from './utils.js';
// =============================================================================
// Conversion Points & Events — CV Tracking
// =============================================================================

export interface ConversionPoint {
  id: string;
  name: string;
  event_type: string;
  value: number | null;
  line_account_id: string | null;
  created_at: string;
}

export interface ConversionEvent {
  id: string;
  conversion_point_id: string;
  friend_id: string;
  user_id: string | null;
  affiliate_code: string | null;
  metadata: string | null;
  line_account_id: string | null;
  created_at: string;
}

// ── Conversion Points CRUD ──────────────────────────────────────────────────

// lineAccountId を渡すとそのアカウントの CV ポイントだけ返す (テナント分離)。
// 未指定 (admin / MCP / レガシー経路) は従来どおり全件。
export async function getConversionPoints(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<ConversionPoint[]> {
  if (lineAccountId) {
    const result = await db
      .prepare(`SELECT * FROM conversion_points WHERE line_account_id = ? ORDER BY created_at DESC`)
      .bind(lineAccountId)
      .all<ConversionPoint>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM conversion_points ORDER BY created_at DESC`)
    .all<ConversionPoint>();
  return result.results;
}

export async function getConversionPointById(
  db: D1Database,
  id: string,
): Promise<ConversionPoint | null> {
  return db
    .prepare(`SELECT * FROM conversion_points WHERE id = ?`)
    .bind(id)
    .first<ConversionPoint>();
}

export interface CreateConversionPointInput {
  name: string;
  eventType: string;
  value?: number | null;
  lineAccountId?: string | null;
}

export async function createConversionPoint(
  db: D1Database,
  input: CreateConversionPointInput,
): Promise<ConversionPoint> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO conversion_points (id, name, event_type, value, line_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.eventType, input.value ?? null, input.lineAccountId ?? null, now)
    .run();

  return (await getConversionPointById(db, id))!;
}

export async function deleteConversionPoint(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM conversion_points WHERE id = ?`).bind(id).run();
}

// ── Conversion Events ───────────────────────────────────────────────────────

export interface TrackConversionInput {
  conversionPointId: string;
  friendId: string;
  userId?: string | null;
  affiliateCode?: string | null;
  metadata?: string | null;
  lineAccountId?: string | null;
}

export async function trackConversion(
  db: D1Database,
  input: TrackConversionInput,
): Promise<ConversionEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, user_id, affiliate_code, metadata, line_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.conversionPointId,
      input.friendId,
      input.userId ?? null,
      input.affiliateCode ?? null,
      input.metadata ?? null,
      input.lineAccountId ?? null,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM conversion_events WHERE id = ?`)
    .bind(id)
    .first<ConversionEvent>())!;
}

export async function getConversionEvents(
  db: D1Database,
  opts: {
    conversionPointId?: string;
    friendId?: string;
    affiliateCode?: string;
    lineAccountId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ConversionEvent[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.lineAccountId) {
    conditions.push('line_account_id = ?');
    values.push(opts.lineAccountId);
  }
  if (opts.conversionPointId) {
    conditions.push('conversion_point_id = ?');
    values.push(opts.conversionPointId);
  }
  if (opts.friendId) {
    conditions.push('friend_id = ?');
    values.push(opts.friendId);
  }
  if (opts.affiliateCode) {
    conditions.push('affiliate_code = ?');
    values.push(opts.affiliateCode);
  }
  if (opts.startDate) {
    conditions.push('created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('created_at <= ?');
    values.push(opts.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  values.push(limit, offset);

  const result = await db
    .prepare(
      `SELECT * FROM conversion_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<ConversionEvent>();
  return result.results;
}

export interface ConversionReport {
  conversionPointId: string;
  conversionPointName: string;
  eventType: string;
  totalCount: number;
  totalValue: number;
}

export async function getConversionReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string; lineAccountId?: string } = {},
): Promise<ConversionReport[]> {
  // 日付条件は JOIN の ON 句に乗せる (LEFT JOIN を保つため)。アカウント条件は
  // cp 側を WHERE で絞る = そのアカウントの CV ポイントだけ集計対象にする。
  const joinConditions: string[] = [];
  const joinValues: unknown[] = [];

  if (opts.startDate) {
    joinConditions.push('ce.created_at >= ?');
    joinValues.push(opts.startDate);
  }
  if (opts.endDate) {
    joinConditions.push('ce.created_at <= ?');
    joinValues.push(opts.endDate);
  }

  const whereConditions: string[] = [];
  const whereValues: unknown[] = [];
  if (opts.lineAccountId) {
    whereConditions.push('cp.line_account_id = ?');
    whereValues.push(opts.lineAccountId);
  }

  const joinExtra = joinConditions.length > 0 ? `AND ${joinConditions.join(' AND ')}` : '';
  const where = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const result = await db
    .prepare(
      `SELECT
         cp.id as conversion_point_id,
         cp.name as conversion_point_name,
         cp.event_type,
         COUNT(ce.id) as total_count,
         COALESCE(SUM(CASE WHEN ce.id IS NOT NULL THEN cp.value ELSE 0 END), 0) as total_value
       FROM conversion_points cp
       LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id ${joinExtra}
       ${where}
       GROUP BY cp.id
       ORDER BY total_count DESC`,
    )
    .bind(...joinValues, ...whereValues)
    .all<{
      conversion_point_id: string;
      conversion_point_name: string;
      event_type: string;
      total_count: number;
      total_value: number;
    }>();

  return result.results.map((r) => ({
    conversionPointId: r.conversion_point_id,
    conversionPointName: r.conversion_point_name,
    eventType: r.event_type,
    totalCount: r.total_count,
    totalValue: r.total_value,
  }));
}
