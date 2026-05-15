/**
 * AI 商品マスタ（ai_products）のクエリヘルパー。
 * EC・物販事業者が AI チャットで商品紹介できるようにする。
 */

import { jstNow } from './utils.js';

export interface AiProductRow {
  id: string;
  line_account_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  price_yen: number | null;
  stock: number | null;
  image_url: string | null;
  category: string | null;
  tags_json: string | null;
  active: number;
  vector_indexed: number;
  created_at: string;
  updated_at: string;
}

export async function listAiProducts(
  db: D1Database,
  lineAccountId: string,
  filters: { category?: string; activeOnly?: boolean; limit?: number } = {},
): Promise<AiProductRow[]> {
  const conditions = ['line_account_id = ?'];
  const values: unknown[] = [lineAccountId];
  if (filters.category) {
    conditions.push('category = ?');
    values.push(filters.category);
  }
  if (filters.activeOnly !== false) {
    conditions.push('active = 1');
  }
  const limit = Math.min(filters.limit ?? 100, 1000);
  const result = await db
    .prepare(
      `SELECT * FROM ai_products WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(...values, limit)
    .all<AiProductRow>();
  return result.results;
}

export async function getAiProductById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<AiProductRow | null> {
  return db
    .prepare(`SELECT * FROM ai_products WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first<AiProductRow>();
}

export async function createAiProduct(
  db: D1Database,
  input: {
    lineAccountId: string;
    sku?: string;
    name: string;
    description?: string;
    priceYen?: number;
    stock?: number;
    imageUrl?: string;
    category?: string;
    tags?: string[];
  },
): Promise<AiProductRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO ai_products (id, line_account_id, sku, name, description, price_yen, stock, image_url, category, tags_json, active, vector_indexed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.sku ?? null,
      input.name,
      input.description ?? null,
      input.priceYen ?? null,
      input.stock ?? null,
      input.imageUrl ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
    )
    .run();
  return (await getAiProductById(db, id, input.lineAccountId))!;
}

export async function updateAiProduct(
  db: D1Database,
  id: string,
  lineAccountId: string,
  updates: Partial<{
    sku: string | null;
    name: string;
    description: string | null;
    priceYen: number | null;
    stock: number | null;
    imageUrl: string | null;
    category: string | null;
    tags: string[] | null;
    active: boolean;
    vectorIndexed: boolean;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.sku !== undefined) { sets.push('sku = ?'); values.push(updates.sku); }
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.priceYen !== undefined) { sets.push('price_yen = ?'); values.push(updates.priceYen); }
  if (updates.stock !== undefined) { sets.push('stock = ?'); values.push(updates.stock); }
  if (updates.imageUrl !== undefined) { sets.push('image_url = ?'); values.push(updates.imageUrl); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.tags !== undefined) { sets.push('tags_json = ?'); values.push(updates.tags ? JSON.stringify(updates.tags) : null); }
  if (updates.active !== undefined) { sets.push('active = ?'); values.push(updates.active ? 1 : 0); }
  if (updates.vectorIndexed !== undefined) { sets.push('vector_indexed = ?'); values.push(updates.vectorIndexed ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  values.push(lineAccountId);
  await db
    .prepare(`UPDATE ai_products SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`)
    .bind(...values)
    .run();
}

export async function deleteAiProduct(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM ai_products WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .run();
}

/** 簡易キーワード検索（Vectorize 未統合時のフォールバック） */
export async function searchAiProductsByKeyword(
  db: D1Database,
  lineAccountId: string,
  keyword: string,
  limit = 10,
): Promise<AiProductRow[]> {
  const pattern = `%${keyword}%`;
  const result = await db
    .prepare(
      `SELECT * FROM ai_products
       WHERE line_account_id = ? AND active = 1
         AND (name LIKE ? OR description LIKE ? OR category LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, pattern, pattern, pattern, limit)
    .all<AiProductRow>();
  return result.results;
}
