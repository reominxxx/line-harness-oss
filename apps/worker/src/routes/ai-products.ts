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
    product_url?: string;
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
    productUrl: body.product_url,
    category: body.category,
    tags: body.tags,
  });
  return c.json({ success: true, product }, 201);
});

/**
 * AI で商品データを抽出（一括登録の前段階）
 *
 * 入力ソース 4 種類に対応:
 *   - text:    自由テキスト（メモ、箇条書き）
 *   - image:   メニュー表の画像 URL
 *   - url:     EC サイト等の URL（HTML 取得して AI 解析）
 *   - csv:     CSV テキスト（カラム自動判定）
 *
 * 戻り値: 構造化された商品候補リスト（プレビュー用、まだ DB には登録しない）
 */
aiProducts.post('/api/ai-products/parse', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const body = await c.req.json<{
    source: 'text' | 'image' | 'url' | 'csv';
    text?: string;
    image_url?: string;
    url?: string;
    csv?: string;
  }>();

  let inputText = '';
  let inputImageUrl: string | null = null;

  if (body.source === 'text') {
    if (!body.text || body.text.length < 5) {
      return c.json({ success: false, error: 'text required (min 5 chars)' }, 400);
    }
    if (body.text.length > 20000) {
      return c.json({ success: false, error: 'text too long (max 20000 chars)' }, 400);
    }
    inputText = body.text;
  } else if (body.source === 'image') {
    if (!body.image_url) {
      return c.json({ success: false, error: 'image_url required' }, 400);
    }
    inputImageUrl = body.image_url;
  } else if (body.source === 'url') {
    if (!body.url || !/^https?:\/\//.test(body.url)) {
      return c.json({ success: false, error: 'valid url required' }, 400);
    }
    // URL fetch して HTML をテキスト化
    try {
      const res = await fetch(body.url, {
        headers: { 'User-Agent': 'L-Assist Product Importer/1.0' },
      });
      if (!res.ok) {
        return c.json({ success: false, error: `URL fetch failed: ${res.status}` }, 400);
      }
      const html = await res.text();
      // 雑だが効果的: タグを剥がす、script/style 除去、空白整理
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30000);
      inputText = `[ソース: ${body.url}]\n\n${stripped}`;
    } catch (e) {
      return c.json({ success: false, error: `URL fetch error: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
    }
  } else if (body.source === 'csv') {
    if (!body.csv) {
      return c.json({ success: false, error: 'csv required' }, 400);
    }
    inputText = `以下は CSV データです。1 行目がヘッダーです。\n\n${body.csv.slice(0, 20000)}`;
  } else {
    return c.json({ success: false, error: 'invalid source' }, 400);
  }

  const systemPrompt = `あなたは商品マスタ抽出の専門家です。
入力されたテキストや画像から、商品（または提供サービス・メニュー）を抽出し、
以下の JSON 形式で配列として返してください。

[
  {
    "name": "商品名（必須）",
    "price_yen": 数値（円・税抜想定、不明なら null）,
    "description": "簡潔な説明（不明なら空文字）",
    "category": "カテゴリ（不明なら空文字）",
    "sku": "型番・商品コード（不明なら空文字）"
  }
]

【厳守ルール】
- レスポンスは JSON 配列のみ。前後の文章・コードブロック禁止
- 価格の幅がある場合（例: ¥8,000〜¥10,000）→ price_yen は最安値、description に「最大 ¥10,000」と記載
- 商品が見つからない場合は [] を返す
- 各商品の name は最大 100 文字、description は最大 500 文字
- 重複は除外する
- 価格が「お問い合わせ」「要相談」の場合は price_yen: null`;

  const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }> = [];
  if (inputImageUrl) {
    userContent.push({ type: 'image', source: { type: 'url', url: inputImageUrl } });
    userContent.push({ type: 'text', text: 'この画像から商品/メニューを抽出してください。' });
  } else {
    userContent.push({ type: 'text', text: inputText });
  }

  const { callClaude } = await import('../lib/claude-client.js');
  // 画像や URL の場合は Sonnet、テキストは Haiku で十分
  const model = body.source === 'image' || body.source === 'url' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  try {
    const result = await callClaude({
      apiKey,
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4000,
      temperature: 0.2,
    });

    // JSON parse
    let products: Array<{ name: string; price_yen: number | null; description: string; category: string; sku: string }>;
    try {
      const trimmed = result.text.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '');
      products = JSON.parse(trimmed);
      if (!Array.isArray(products)) throw new Error('not an array');
    } catch (e) {
      return c.json({
        success: false,
        error: 'AI レスポンスの JSON 解析に失敗しました',
        raw: result.text.slice(0, 500),
        parseError: e instanceof Error ? e.message : 'unknown',
      }, 500);
    }

    // バリデーション + サニタイズ
    const cleaned = products
      .filter((p) => p && typeof p.name === 'string' && p.name.length > 0)
      .slice(0, 200)
      .map((p) => ({
        name: String(p.name).slice(0, 200),
        price_yen: typeof p.price_yen === 'number' && p.price_yen > 0 ? Math.round(p.price_yen) : null,
        description: String(p.description ?? '').slice(0, 1000),
        category: String(p.category ?? '').slice(0, 100),
        sku: String(p.sku ?? '').slice(0, 100),
      }));

    return c.json({
      success: true,
      products: cleaned,
      meta: {
        model: result.model,
        costYen: result.costYenX100 / 100,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'AI 抽出失敗' }, 500);
  }
});

/**
 * 一括登録（プレビュー後に呼ぶ）
 */
aiProducts.post('/api/ai-products/bulk-import', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{
    products: Array<{
      sku?: string;
      name: string;
      description?: string;
      price_yen?: number | null;
      stock?: number;
      image_url?: string;
      category?: string;
      tags?: string[];
    }>;
    skipDuplicates?: boolean;
  }>();

  if (!Array.isArray(body.products) || body.products.length === 0) {
    return c.json({ success: false, error: 'products required (non-empty array)' }, 400);
  }
  if (body.products.length > 500) {
    return c.json({ success: false, error: '一度に登録できるのは 500 件までです' }, 400);
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < body.products.length; i++) {
    const p = body.products[i];
    if (!p?.name || p.name.length === 0) {
      skipped++;
      continue;
    }
    try {
      // 重複チェック（同名 + 同価格 を既存と比較）
      if (body.skipDuplicates !== false) {
        const existing = await c.env.DB
          .prepare(`SELECT id FROM ai_products WHERE line_account_id = ? AND name = ? LIMIT 1`)
          .bind(lineAccountId, p.name)
          .first();
        if (existing) {
          skipped++;
          continue;
        }
      }
      await createAiProduct(c.env.DB, {
        lineAccountId,
        sku: p.sku,
        name: p.name.slice(0, 200),
        description: p.description?.slice(0, 1000),
        priceYen: typeof p.price_yen === 'number' ? p.price_yen : undefined,
        stock: p.stock,
        imageUrl: p.image_url,
        category: p.category,
        tags: p.tags,
      });
      created++;
    } catch (e) {
      errors.push({ index: i, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return c.json({
    success: true,
    summary: { created, skipped, errors: errors.length },
    errors: errors.slice(0, 30),
  });
});

/**
 * Shopify API 連携で商品を取得
 *
 * body: { shop_domain: "xxx.myshopify.com", access_token: "shpat_..." }
 * 戻り値: 商品候補リスト（bulk-import に流す前のプレビュー用）
 */
aiProducts.post('/api/ai-products/shopify-fetch', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{ shop_domain: string; access_token: string; limit?: number }>();
  if (!body.shop_domain || !body.access_token) {
    return c.json({ success: false, error: 'shop_domain と access_token が必要です' }, 400);
  }
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(body.shop_domain)) {
    return c.json({ success: false, error: 'shop_domain の形式が不正です（例: yourstore.myshopify.com）' }, 400);
  }

  const limit = Math.min(body.limit ?? 100, 250);
  try {
    const res = await fetch(
      `https://${body.shop_domain}/admin/api/2024-01/products.json?limit=${limit}`,
      { headers: { 'X-Shopify-Access-Token': body.access_token } },
    );
    if (!res.ok) {
      return c.json({ success: false, error: `Shopify API: ${res.status} ${res.statusText}` }, 400);
    }
    const data = await res.json() as {
      products: Array<{
        id: number;
        title: string;
        body_html?: string;
        product_type?: string;
        tags?: string;
        variants?: Array<{ sku?: string; price?: string; inventory_quantity?: number }>;
        image?: { src?: string };
      }>;
    };
    const products = (data.products ?? []).map((p) => {
      const v0 = p.variants?.[0];
      return {
        name: p.title,
        price_yen: v0?.price ? Math.round(parseFloat(v0.price)) : null,
        description: (p.body_html ?? '').replace(/<[^>]+>/g, '').slice(0, 500),
        category: p.product_type ?? '',
        sku: v0?.sku ?? '',
        image_url: p.image?.src ?? null,
        stock: v0?.inventory_quantity,
        tags: p.tags ? p.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      };
    });

    return c.json({ success: true, products, meta: { source: 'shopify', count: products.length } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'Shopify fetch 失敗' }, 500);
  }
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
    product_url?: string;
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
    productUrl: body.product_url,
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
