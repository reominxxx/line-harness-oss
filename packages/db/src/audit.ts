/**
 * 監査ログ（audit_log）と PII 削除リクエスト（pii_deletion_requests）、
 * 同意管理（consent_records）のクエリヘルパー。
 *
 * これらはセキュリティ・コンプライアンスの基盤。
 */

import { jstNow } from './utils.js';

// ---------------------------------------------------------------------------
// audit_log
// ---------------------------------------------------------------------------

export type AuditResult = 'success' | 'failed' | 'denied';

export interface AuditLogRow {
  id: string;
  line_account_id: string | null;
  staff_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  details_json: string | null;
  result: AuditResult;
  created_at: string;
}

export async function writeAuditLog(
  db: D1Database,
  input: {
    lineAccountId?: string | null;
    staffId?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestId?: string | null;
    details?: Record<string, unknown> | null;
    result: AuditResult;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (id, line_account_id, staff_id, action, resource_type, resource_id, ip_address, user_agent, request_id, details_json, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineAccountId ?? null,
      input.staffId ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.requestId ?? null,
      input.details ? JSON.stringify(input.details) : null,
      input.result,
      jstNow(),
    )
    .run();
}

export async function listAuditLogs(
  db: D1Database,
  filters: {
    lineAccountId?: string;
    staffId?: string;
    resourceType?: string;
    resourceId?: string;
    result?: AuditResult;
    limit?: number;
  } = {},
): Promise<AuditLogRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.lineAccountId) { conditions.push('line_account_id = ?'); values.push(filters.lineAccountId); }
  if (filters.staffId) { conditions.push('staff_id = ?'); values.push(filters.staffId); }
  if (filters.resourceType) { conditions.push('resource_type = ?'); values.push(filters.resourceType); }
  if (filters.resourceId) { conditions.push('resource_id = ?'); values.push(filters.resourceId); }
  if (filters.result) { conditions.push('result = ?'); values.push(filters.result); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 100, 1000);

  const result = await db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, limit)
    .all<AuditLogRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// pii_deletion_requests
// ---------------------------------------------------------------------------

export type PiiDeletionStatus = 'pending' | 'processing' | 'completed' | 'denied' | 'cancelled';

export interface PiiDeletionRow {
  id: string;
  line_account_id: string;
  friend_id: string | null;
  requested_at: string;
  requested_by: string;
  reason: string | null;
  status: PiiDeletionStatus;
  processed_at: string | null;
  processed_by: string | null;
  deletion_log_json: string | null;
}

export async function createPiiDeletionRequest(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId?: string | null;
    requestedBy: string;
    reason?: string;
  },
): Promise<PiiDeletionRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO pii_deletion_requests (id, line_account_id, friend_id, requested_at, requested_by, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .bind(id, input.lineAccountId, input.friendId ?? null, now, input.requestedBy, input.reason ?? null)
    .run();
  return (await db
    .prepare(`SELECT * FROM pii_deletion_requests WHERE id = ?`)
    .bind(id)
    .first<PiiDeletionRow>())!;
}

export async function listPiiDeletionRequests(
  db: D1Database,
  lineAccountId: string,
  status?: PiiDeletionStatus,
): Promise<PiiDeletionRow[]> {
  const conditions = ['line_account_id = ?'];
  const values: unknown[] = [lineAccountId];
  if (status) {
    conditions.push('status = ?');
    values.push(status);
  }
  const result = await db
    .prepare(
      `SELECT * FROM pii_deletion_requests WHERE ${conditions.join(' AND ')} ORDER BY requested_at DESC`,
    )
    .bind(...values)
    .all<PiiDeletionRow>();
  return result.results;
}

export async function updatePiiDeletionStatus(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: {
    status: PiiDeletionStatus;
    processedBy?: string;
    deletionLog?: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE pii_deletion_requests
       SET status = ?, processed_at = ?, processed_by = ?, deletion_log_json = ?
       WHERE id = ? AND line_account_id = ?`,
    )
    .bind(
      updates.status,
      jstNow(),
      updates.processedBy ?? null,
      updates.deletionLog ? JSON.stringify(updates.deletionLog) : null,
      id,
      lineAccountId,
    )
    .run();
}

// ---------------------------------------------------------------------------
// consent_records
// ---------------------------------------------------------------------------

export type ConsentType = 'ai_chat_processing' | 'data_storage' | 'marketing_delivery' | 'profile_analysis';

export interface ConsentRecordRow {
  id: string;
  line_account_id: string;
  friend_id: string;
  consent_type: ConsentType;
  granted: number;
  policy_version: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export async function recordConsent(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    consentType: ConsentType;
    granted: boolean;
    policyVersion?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  const now = jstNow();
  // UNIQUE 制約により upsert で対応
  await db
    .prepare(
      `INSERT INTO consent_records (id, line_account_id, friend_id, consent_type, granted, policy_version, granted_at, revoked_at, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(friend_id, consent_type) DO UPDATE SET
         granted = excluded.granted,
         policy_version = excluded.policy_version,
         granted_at = CASE WHEN excluded.granted = 1 THEN excluded.granted_at ELSE consent_records.granted_at END,
         revoked_at = CASE WHEN excluded.granted = 0 THEN excluded.created_at ELSE NULL END,
         ip_address = excluded.ip_address,
         user_agent = excluded.user_agent`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineAccountId,
      input.friendId,
      input.consentType,
      input.granted ? 1 : 0,
      input.policyVersion ?? null,
      input.granted ? now : null,
      input.granted ? null : now,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      now,
    )
    .run();
}

export async function getConsent(
  db: D1Database,
  friendId: string,
  consentType: ConsentType,
): Promise<ConsentRecordRow | null> {
  return db
    .prepare(`SELECT * FROM consent_records WHERE friend_id = ? AND consent_type = ?`)
    .bind(friendId, consentType)
    .first<ConsentRecordRow>();
}

export async function listConsents(
  db: D1Database,
  friendId: string,
): Promise<ConsentRecordRow[]> {
  const result = await db
    .prepare(`SELECT * FROM consent_records WHERE friend_id = ?`)
    .bind(friendId)
    .all<ConsentRecordRow>();
  return result.results;
}

export async function hasConsent(
  db: D1Database,
  friendId: string,
  consentType: ConsentType,
): Promise<boolean> {
  const row = await getConsent(db, friendId, consentType);
  return row?.granted === 1;
}
