/**
 * Knowledge Base (KB) API routes
 *
 * GET    /api/kb/documents              一覧取得
 * GET    /api/kb/documents/:id          詳細取得
 * POST   /api/kb/documents              新規作成
 * PUT    /api/kb/documents/:id          更新
 * DELETE /api/kb/documents/:id          削除
 * GET    /api/kb/documents/:id/chunks   チャンク一覧
 *
 * すべて line_account_id によるテナント分離。
 * X-Line-Account-Id ヘッダで指定 (既存マルチアカウント運用と整合)。
 */

import { Hono } from 'hono';
import { staffIdForFk } from '../lib/staff-fk.js';
import {
  listKbDocuments,
  getKbDocumentById,
  createKbDocument,
  updateKbDocument,
  deleteKbDocument,
  listKbChunks,
  type KbSourceType,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const kb = new Hono<Env>();

const VALID_SOURCE_TYPES: KbSourceType[] = [
  'faq', 'product', 'brand_guide', 'manual', 'policy', 'external_url',
  'past_broadcast', 'past_scenario', 'past_chat',
];

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

// 一覧取得
kb.get('/api/kb/documents', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const sourceType = c.req.query('source_type') as KbSourceType | undefined;
  if (sourceType && !VALID_SOURCE_TYPES.includes(sourceType)) {
    return c.json({ success: false, error: 'Invalid source_type' }, 400);
  }
  const activeOnly = c.req.query('active_only') !== 'false';

  const documents = await listKbDocuments(c.env.DB, lineAccountId, { sourceType, activeOnly });
  return c.json({ success: true, documents });
});

// 詳細取得
kb.get('/api/kb/documents/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const document = await getKbDocumentById(c.env.DB, id, lineAccountId);
  if (!document) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.json({ success: true, document });
});

// 新規作成
kb.post('/api/kb/documents', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  const body = await c.req.json<{
    source_type: KbSourceType;
    title: string;
    content: string;
    source_url?: string;
    metadata?: Record<string, unknown>;
  }>();

  if (!body.title || !body.content || !body.source_type) {
    return c.json({ success: false, error: 'title, content, source_type are required' }, 400);
  }
  if (!VALID_SOURCE_TYPES.includes(body.source_type)) {
    return c.json({ success: false, error: 'Invalid source_type' }, 400);
  }
  if (body.title.length > 200) {
    return c.json({ success: false, error: 'title too long' }, 400);
  }
  if (body.content.length > 100_000) {
    return c.json({ success: false, error: 'content too long (100,000 chars max)' }, 400);
  }

  const document = await createKbDocument(c.env.DB, {
    lineAccountId,
    sourceType: body.source_type,
    title: body.title,
    content: body.content,
    sourceUrl: body.source_url,
    metadata: body.metadata,
    createdBy: staffIdForFk(staff) ?? undefined,
  });
  return c.json({ success: true, document }, 201);
});

// 更新
kb.put('/api/kb/documents/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const existing = await getKbDocumentById(c.env.DB, id, lineAccountId);
  if (!existing) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const body = await c.req.json<{
    title?: string;
    content?: string;
    source_type?: KbSourceType;
    source_url?: string | null;
    metadata?: Record<string, unknown> | null;
    active?: boolean;
  }>();

  if (body.source_type && !VALID_SOURCE_TYPES.includes(body.source_type)) {
    return c.json({ success: false, error: 'Invalid source_type' }, 400);
  }
  if (body.title && body.title.length > 200) {
    return c.json({ success: false, error: 'title too long' }, 400);
  }
  if (body.content && body.content.length > 100_000) {
    return c.json({ success: false, error: 'content too long (100,000 chars max)' }, 400);
  }

  await updateKbDocument(c.env.DB, id, lineAccountId, {
    title: body.title,
    content: body.content,
    sourceType: body.source_type,
    sourceUrl: body.source_url,
    metadata: body.metadata,
    active: body.active,
    vectorIndexed: false, // 内容変更時はベクトル化やり直し
  });

  const updated = await getKbDocumentById(c.env.DB, id, lineAccountId);
  return c.json({ success: true, document: updated });
});

// 削除
kb.delete('/api/kb/documents/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const existing = await getKbDocumentById(c.env.DB, id, lineAccountId);
  if (!existing) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await deleteKbDocument(c.env.DB, id, lineAccountId);
  return c.json({ success: true });
});

// チャンク一覧
kb.get('/api/kb/documents/:id/chunks', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const document = await getKbDocumentById(c.env.DB, id, lineAccountId);
  if (!document) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const chunks = await listKbChunks(c.env.DB, id);
  return c.json({ success: true, chunks });
});
