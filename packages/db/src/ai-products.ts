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
  product_url: string | null;
  category: string | null;
  tags_json: string | null;
  active: number;
  vector_indexed: number;
  created_at: string;
  updated_at: string;
  // --- migration 087: 汎用オファースキーマ ---
  product_kind: string;
  pricing_type: string;
  price_min: number | null;
  price_max: number | null;
  price_note: string | null;
  cta_type: string;
  cta_label: string | null;
  cta_url: string | null;
  attributes_json: string | null;
  source: string | null;
  source_url: string | null;
  external_id: string | null;
  synced_at: string | null;
  status: string;
  confidence_json: string | null;
}

/** createAiProduct / updateAiProduct が受け取る新スキーマ側の入力。 */
export interface AiProductOfferInput {
  productKind?: string;
  pricingType?: string;
  priceMin?: number | null;
  priceMax?: number | null;
  priceNote?: string | null;
  ctaType?: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  attributes?: Record<string, unknown> | null;
  source?: string | null;
  sourceUrl?: string | null;
  externalId?: string | null;
  syncedAt?: string | null;
  status?: string;
  confidence?: Record<string, unknown> | null;
}

export async function listAiProducts(
  db: D1Database,
  lineAccountId: string,
  filters: { category?: string; activeOnly?: boolean; status?: string; publishedOnly?: boolean; limit?: number } = {},
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
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  } else if (filters.publishedOnly) {
    // AI 接客が参照する条件: 公開済みのみ
    conditions.push("status = 'published'");
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
    productUrl?: string;
    category?: string;
    tags?: string[];
  } & AiProductOfferInput,
): Promise<AiProductRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO ai_products (
         id, line_account_id, sku, name, description, price_yen, stock, image_url, product_url, category, tags_json,
         active, vector_indexed, created_at, updated_at,
         product_kind, pricing_type, price_min, price_max, price_note,
         cta_type, cta_label, cta_url, attributes_json,
         source, source_url, external_id, synced_at, status, confidence_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.productUrl ?? null,
      input.category ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
      input.productKind ?? 'physical',
      input.pricingType ?? 'fixed',
      input.priceMin ?? null,
      input.priceMax ?? null,
      input.priceNote ?? null,
      input.ctaType ?? 'buy',
      input.ctaLabel ?? null,
      input.ctaUrl ?? null,
      input.attributes ? JSON.stringify(input.attributes) : null,
      input.source ?? null,
      input.sourceUrl ?? null,
      input.externalId ?? null,
      input.syncedAt ?? null,
      input.status ?? 'published',
      input.confidence ? JSON.stringify(input.confidence) : null,
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
    productUrl: string | null;
    category: string | null;
    tags: string[] | null;
    active: boolean;
    vectorIndexed: boolean;
  }> & AiProductOfferInput,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.sku !== undefined) { sets.push('sku = ?'); values.push(updates.sku); }
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.priceYen !== undefined) { sets.push('price_yen = ?'); values.push(updates.priceYen); }
  if (updates.stock !== undefined) { sets.push('stock = ?'); values.push(updates.stock); }
  if (updates.imageUrl !== undefined) { sets.push('image_url = ?'); values.push(updates.imageUrl); }
  if (updates.productUrl !== undefined) { sets.push('product_url = ?'); values.push(updates.productUrl); }
  if (updates.category !== undefined) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.tags !== undefined) { sets.push('tags_json = ?'); values.push(updates.tags ? JSON.stringify(updates.tags) : null); }
  if (updates.active !== undefined) { sets.push('active = ?'); values.push(updates.active ? 1 : 0); }
  if (updates.vectorIndexed !== undefined) { sets.push('vector_indexed = ?'); values.push(updates.vectorIndexed ? 1 : 0); }
  // --- migration 087 の新列 ---
  if (updates.productKind !== undefined) { sets.push('product_kind = ?'); values.push(updates.productKind); }
  if (updates.pricingType !== undefined) { sets.push('pricing_type = ?'); values.push(updates.pricingType); }
  if (updates.priceMin !== undefined) { sets.push('price_min = ?'); values.push(updates.priceMin); }
  if (updates.priceMax !== undefined) { sets.push('price_max = ?'); values.push(updates.priceMax); }
  if (updates.priceNote !== undefined) { sets.push('price_note = ?'); values.push(updates.priceNote); }
  if (updates.ctaType !== undefined) { sets.push('cta_type = ?'); values.push(updates.ctaType); }
  if (updates.ctaLabel !== undefined) { sets.push('cta_label = ?'); values.push(updates.ctaLabel); }
  if (updates.ctaUrl !== undefined) { sets.push('cta_url = ?'); values.push(updates.ctaUrl); }
  if (updates.attributes !== undefined) { sets.push('attributes_json = ?'); values.push(updates.attributes ? JSON.stringify(updates.attributes) : null); }
  if (updates.source !== undefined) { sets.push('source = ?'); values.push(updates.source); }
  if (updates.sourceUrl !== undefined) { sets.push('source_url = ?'); values.push(updates.sourceUrl); }
  if (updates.externalId !== undefined) { sets.push('external_id = ?'); values.push(updates.externalId); }
  if (updates.syncedAt !== undefined) { sets.push('synced_at = ?'); values.push(updates.syncedAt); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.confidence !== undefined) { sets.push('confidence_json = ?'); values.push(updates.confidence ? JSON.stringify(updates.confidence) : null); }
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

/**
 * 再同期用: 同一アカウント×ソース×external_id の既存レコードを引く。
 * external_id 付きの構造化取込 (Shopify公開JSON 等) で upsert 判定に使う。
 */
export async function findAiProductBySource(
  db: D1Database,
  lineAccountId: string,
  source: string,
  externalId: string,
): Promise<AiProductRow | null> {
  return db
    .prepare(
      `SELECT * FROM ai_products WHERE line_account_id = ? AND source = ? AND external_id = ? LIMIT 1`,
    )
    .bind(lineAccountId, source, externalId)
    .first<AiProductRow>();
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

/** アカウント配下の全商品を削除。削除件数を返す。 */
export async function deleteAllAiProducts(
  db: D1Database,
  lineAccountId: string,
): Promise<number> {
  const res = await db
    .prepare(`DELETE FROM ai_products WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .run();
  return res.meta.changes ?? 0;
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
       WHERE line_account_id = ? AND active = 1 AND status = 'published'
         AND (name LIKE ? OR description LIKE ? OR category LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, pattern, pattern, pattern, limit)
    .all<AiProductRow>();
  return result.results;
}
