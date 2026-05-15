/**
 * ナレッジベース（kb_documents, kb_chunks）のクエリヘルパー
 *
 * AI 接客チャットが回答時に参照する企業ナレッジを管理する。
 * FAQ / ブランドガイド / マニュアル / ポリシー / 外部 URL を蓄積。
 *
 * Cloudflare Vectorize 連携は別ファイル（埋め込み生成 + 検索）。
 * 本ファイルは D1 への CRUD のみ担当。
 */

import { jstNow } from './utils.js';

export type KbSourceType = 'faq' | 'product' | 'brand_guide' | 'manual' | 'policy' | 'external_url';

export interface KbDocumentRow {
  id: string;
  line_account_id: string;
  source_type: KbSourceType;
  title: string;
  content: string;
  source_url: string | null;
  metadata_json: string | null;
  active: number;
  vector_indexed: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbChunkRow {
  id: string;
  document_id: string;
  line_account_id: string;
  chunk_index: number;
  content: string;
  vector_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listKbDocuments(
  db: D1Database,
  lineAccountId: string,
  filters: { sourceType?: KbSourceType; activeOnly?: boolean } = {},
): Promise<KbDocumentRow[]> {
  const conditions = ['line_account_id = ?'];
  const values: unknown[] = [lineAccountId];

  if (filters.sourceType) {
    conditions.push('source_type = ?');
    values.push(filters.sourceType);
  }
  if (filters.activeOnly !== false) {
    conditions.push('active = 1');
  }

  const sql = `SELECT * FROM kb_documents WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`;
  const result = await db.prepare(sql).bind(...values).all<KbDocumentRow>();
  return result.results;
}

export async function getKbDocumentById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<KbDocumentRow | null> {
  return db
    .prepare(`SELECT * FROM kb_documents WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<KbDocumentRow>();
}

export async function createKbDocument(
  db: D1Database,
  input: {
    lineAccountId: string;
    sourceType: KbSourceType;
    title: string;
    content: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  },
): Promise<KbDocumentRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO kb_documents (id, line_account_id, source_type, title, content, source_url, metadata_json, active, vector_indexed, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.sourceType,
      input.title,
      input.content,
      input.sourceUrl ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdBy ?? null,
      now,
      now,
    )
    .run();
  return (await getKbDocumentById(db, id, input.lineAccountId))!;
}

export async function updateKbDocument(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{
    title: string;
    content: string;
    sourceType: KbSourceType;
    sourceUrl: string | null;
    metadata: Record<string, unknown> | null;
    active: boolean;
    vectorIndexed: boolean;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
  if (updates.sourceType !== undefined) { sets.push('source_type = ?'); values.push(updates.sourceType); }
  if (updates.sourceUrl !== undefined) { sets.push('source_url = ?'); values.push(updates.sourceUrl); }
  if (updates.metadata !== undefined) { sets.push('metadata_json = ?'); values.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
  if (updates.active !== undefined) { sets.push('active = ?'); values.push(updates.active ? 1 : 0); }
  if (updates.vectorIndexed !== undefined) { sets.push('vector_indexed = ?'); values.push(updates.vectorIndexed ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db
    .prepare(`UPDATE kb_documents SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteKbDocument(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  // chunks は ON DELETE CASCADE で連動削除される
  await db
    .prepare(`DELETE FROM kb_documents WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .run();
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export async function listKbChunks(db: D1Database, documentId: string): Promise<KbChunkRow[]> {
  const result = await db
    .prepare(`SELECT * FROM kb_chunks WHERE document_id = ? ORDER BY chunk_index ASC`)
    .bind(documentId)
    .all<KbChunkRow>();
  return result.results;
}

export async function createKbChunk(
  db: D1Database,
  input: { documentId: string; lineAccountId: string; chunkIndex: number; content: string; vectorId?: string },
): Promise<KbChunkRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO kb_chunks (id, document_id, line_account_id, chunk_index, content, vector_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.documentId,
      input.lineAccountId,
      input.chunkIndex,
      input.content,
      input.vectorId ?? null,
      now,
    )
    .run();
  return {
    id,
    document_id: input.documentId,
    line_account_id: input.lineAccountId,
    chunk_index: input.chunkIndex,
    content: input.content,
    vector_id: input.vectorId ?? null,
    created_at: now,
  };
}

export async function deleteKbChunksByDocument(db: D1Database, documentId: string): Promise<void> {
  await db.prepare(`DELETE FROM kb_chunks WHERE document_id = ?`).bind(documentId).run();
}

/**
 * 簡易な全文検索 (Vectorize 未統合時のフォールバック)。
 * content の LIKE 検索で上位 N 件を返す。
 */
export async function searchKbChunksByKeyword(
  db: D1Database,
  lineAccountId: string,
  keyword: string,
  limit = 5,
): Promise<KbChunkRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM kb_chunks WHERE line_account_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, `%${keyword}%`, limit)
    .all<KbChunkRow>();
  return result.results;
}
