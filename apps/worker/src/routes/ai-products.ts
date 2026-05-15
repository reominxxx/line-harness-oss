/**
 * AI 商品マスタ API routes
 */

import { Hono } from 'hono';
import {
  listAiProducts,
  getAiProductById,
  createAiProduct,
  updateAiProduct,
  deleteAiProduct,
  searchAiProductsByKeyword,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const aiProducts = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

aiProducts.get('/api/ai-products', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const category = c.req.query('category');
  const activeOnly = c.req.query('active_only') !== 'false';
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);

  if (search) {
    const results = await searchAiProductsByKeyword(c.env.DB, lineAccountId, search, limit);
    return c.json({ success: true, products: results });
  }
  const products = await listAiProducts(c.env.DB, lineAccountId, { category, activeOnly, limit });
  return c.json({ success: true, products });
});

aiProducts.get('/api/ai-products/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const product = await getAiProductById(c.env.DB, c.req.param('id'), lineAccountId);
  if (!product) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.json({ success: true, product });
});

aiProducts.post('/api/ai-products', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{
    sku?: string;
    name: string;
    description?: string;
    price_yen?: number;
    stock?: number;
    image_url?: string;
    category?: string;
    tags?: string[];
  }>();
  if (!body.name) {
    return c.json({ success: false, error: 'name required' }, 400);
  }
  if (body.name.length > 200) {
    return c.json({ success: false, error: 'name too long' }, 400);
  }
  const product = await createAiProduct(c.env.DB, {
    lineAccountId,
    sku: body.sku,
    name: body.name,
    description: body.description,
    priceYen: body.price_yen,
    stock: body.stock,
    imageUrl: body.image_url,
    category: body.category,
    tags: body.tags,
  });
  return c.json({ success: true, product }, 201);
});

aiProducts.put('/api/ai-products/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const existing = await getAiProductById(c.env.DB, id, lineAccountId);
  if (!existing) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const body = await c.req.json<{
    sku?: string;
    name?: string;
    description?: string;
    price_yen?: number;
    stock?: number;
    image_url?: string;
    category?: string;
    tags?: string[];
    active?: boolean;
  }>();
  await updateAiProduct(c.env.DB, id, lineAccountId, {
    sku: body.sku,
    name: body.name,
    description: body.description,
    priceYen: body.price_yen,
    stock: body.stock,
    imageUrl: body.image_url,
    category: body.category,
    tags: body.tags,
    active: body.active,
    vectorIndexed: false,
  });
  const updated = await getAiProductById(c.env.DB, id, lineAccountId);
  return c.json({ success: true, product: updated });
});

aiProducts.delete('/api/ai-products/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const existing = await getAiProductById(c.env.DB, id, lineAccountId);
  if (!existing) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await deleteAiProduct(c.env.DB, id, lineAccountId);
  return c.json({ success: true });
});
