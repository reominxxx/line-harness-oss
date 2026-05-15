/**
 * 同意管理 + PII 削除リクエスト API routes
 */

import { Hono } from 'hono';
import { staffIdForFk } from '../lib/staff-fk.js';
import {
  recordConsent,
  getConsent,
  listConsents,
  createPiiDeletionRequest,
  listPiiDeletionRequests,
  updatePiiDeletionStatus,
  type ConsentType,
  type PiiDeletionStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const consents = new Hono<Env>();

const VALID_CONSENT_TYPES: ConsentType[] = [
  'ai_chat_processing',
  'data_storage',
  'marketing_delivery',
  'profile_analysis',
];

const VALID_DELETION_STATUS: PiiDeletionStatus[] = [
  'pending', 'processing', 'completed', 'denied', 'cancelled',
];

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// 同意一覧（友だち別）
consents.get('/api/consents/:friend_id', async (c) => {
  const friendId = c.req.param('friend_id');
  const records = await listConsents(c.env.DB, friendId);
  return c.json({ success: true, consents: records });
});

// 同意取得（特定タイプ）
consents.get('/api/consents/:friend_id/:type', async (c) => {
  const friendId = c.req.param('friend_id');
  const type = c.req.param('type');
  if (!VALID_CONSENT_TYPES.includes(type as ConsentType)) {
    return c.json({ success: false, error: 'Invalid consent type' }, 400);
  }
  const record = await getConsent(c.env.DB, friendId, type as ConsentType);
  return c.json({ success: true, consent: record });
});

// 同意記録（grant or revoke）
consents.post('/api/consents', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{
    friend_id: string;
    consent_type: ConsentType;
    granted: boolean;
    policy_version?: string;
  }>();
  if (!body.friend_id || !body.consent_type) {
    return c.json({ success: false, error: 'friend_id and consent_type required' }, 400);
  }
  if (!VALID_CONSENT_TYPES.includes(body.consent_type)) {
    return c.json({ success: false, error: 'Invalid consent type' }, 400);
  }
  if (typeof body.granted !== 'boolean') {
    return c.json({ success: false, error: 'granted must be boolean' }, 400);
  }

  await recordConsent(c.env.DB, {
    lineAccountId,
    friendId: body.friend_id,
    consentType: body.consent_type,
    granted: body.granted,
    policyVersion: body.policy_version,
    ipAddress: getClientIp(c),
    userAgent: c.req.header('user-agent'),
  });
  return c.json({ success: true });
});

// PII 削除リクエスト作成（顧客 or スタッフから）
consents.post('/api/pii-deletions', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  const body = await c.req.json<{
    friend_id?: string;
    reason?: string;
    requested_by?: 'friend' | 'staff';
  }>();
  const requestedBy = body.requested_by === 'friend' ? 'friend' : (staffIdForFk(staff) ?? 'env-owner');

  const record = await createPiiDeletionRequest(c.env.DB, {
    lineAccountId,
    friendId: body.friend_id,
    requestedBy,
    reason: body.reason,
  });
  return c.json({ success: true, request: record }, 201);
});

// PII 削除リクエスト一覧
consents.get('/api/pii-deletions', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const status = c.req.query('status') as PiiDeletionStatus | undefined;
  if (status && !VALID_DELETION_STATUS.includes(status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }
  const records = await listPiiDeletionRequests(c.env.DB, lineAccountId, status);
  return c.json({ success: true, requests: records });
});

// PII 削除リクエストのステータス更新
consents.patch('/api/pii-deletions/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const staff = c.get('staff');
  const body = await c.req.json<{
    status: PiiDeletionStatus;
    deletion_log?: Record<string, unknown>;
  }>();
  if (!VALID_DELETION_STATUS.includes(body.status)) {
    return c.json({ success: false, error: 'Invalid status' }, 400);
  }
  await updatePiiDeletionStatus(c.env.DB, id, lineAccountId, {
    status: body.status,
    processedBy: staffIdForFk(staff) ?? undefined,
    deletionLog: body.deletion_log,
  });
  return c.json({ success: true });
});
