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
  deleteAllAiProducts,
  searchAiProductsByKeyword,
} from '@line-crm/db';
import { normalizeToOffer, type RawOffer } from '../services/product-normalize.js';
import { extractJsonLdProducts } from '../services/jsonld-products.js';
import { fetchShopifyPublicProducts } from '../services/shopify-public.js';
import { getIndustryTemplate, PRODUCT_KINDS, PRICING_TYPES, CTA_TYPES } from '@line-crm/shared';
import type { Env } from '../index.js';

/**
 * 既知 CDN の画像 URL を高解像度バリアントに書き換える。
 * 該当しない URL はそのまま返す。
 * 副作用ナシ、必ず string を返す。
 */
function upgradeCdnUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const host = u.hostname;

    // Shopify CDN (cdn.shopify.com): _100x150 / _small / _medium 等 → _2048x2048 相当
    if (host.includes('cdn.shopify.com') || host.endsWith('myshopify.com')) {
      // ファイル名末尾の _<W>x<H> を除去 (オリジナル取得)
      const cleaned = path.replace(/_(\d+x\d+|small|medium|large|grande|master|compact|pico|icon|crop_center)(?=\.[a-z]{3,4}($|\?))/i, '_2048x2048');
      u.pathname = cleaned;
      // width クエリパラメタもアップグレード
      if (u.searchParams.has('width')) u.searchParams.set('width', '2048');
      return u.toString();
    }

    // Cloudinary: w_100,h_100 等の transform → w_2000
    if (host.endsWith('cloudinary.com')) {
      u.pathname = path.replace(/\/(w|h|c)_\d+,?/g, '/w_2000,');
      return u.toString();
    }

    // Cloudflare Images: /cdn-cgi/image/width=100,quality=80/...  → width=2000
    if (path.includes('/cdn-cgi/image/')) {
      u.pathname = path.replace(/width=\d+/g, 'width=2000').replace(/height=\d+/g, '');
      return u.toString();
    }

    // imgix / Sanity: ?w=100&h=100 → w=2000
    if (u.searchParams.has('w') || u.searchParams.has('width')) {
      if (u.searchParams.has('w')) u.searchParams.set('w', '2000');
      if (u.searchParams.has('width')) u.searchParams.set('width', '2000');
      u.searchParams.delete('h');
      u.searchParams.delete('height');
      return u.toString();
    }

    // 楽天 (rakuten.co.jp): _ex=128x128 → _ex=800x800
    if (host.includes('rakuten')) {
      u.pathname = path.replace(/_ex=\d+x\d+/g, '_ex=800x800');
      u.search = u.search.replace(/_ex=\d+x\d+/g, '_ex=800x800');
      return u.toString();
    }

    // Amazon (images-na.ssl-images-amazon.com / m.media-amazon.com):
    //   abc._SL75_.jpg / abc._AC_SX300_.jpg → abc.jpg (オリジナル)
    if (host.includes('amazon.com') || host.includes('media-amazon.com') || host.includes('ssl-images-amazon')) {
      u.pathname = path.replace(/\._[A-Z0-9_,]+(?=\.[a-z]{3,4}($|\?))/g, '');
      return u.toString();
    }

    // BASE (base-ec): /_/scaled.thumb_300_300_xxx.jpg → /_/original/xxx.jpg
    if (host.includes('baseec.app') || host.includes('thebase.in')) {
      u.pathname = path.replace(/scaled\.thumb_\d+_\d+_/, 'original/');
      return u.toString();
    }

    // STORES (sj-stores / stores.jp): w_300 等
    if (host.includes('stores.jp') || host.includes('stores-js')) {
      u.pathname = path.replace(/\/w_\d+\//g, '/w_2000/');
      return u.toString();
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Google ドライブの共有リンクを直接ダウンロード URL に変換する。
 * 該当しなければそのまま返す。
 */
function normalizeDriveUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('drive.google.com')) return url;
    // https://drive.google.com/file/d/<ID>/view?... → uc?export=download&id=<ID>
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    const id = m?.[1] ?? u.searchParams.get('id');
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    return url;
  } catch {
    return url;
  }
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_REHOST_BYTES = 10 * 1024 * 1024; // 10MB

// 取り込み画像の自動圧縮設定。長辺 1280px に収め (we=拡大しない)、quality 80 で
// JPEG 再エンコードする。Worker には canvas が無いため、Cloudflare 配下の無料画像
// 最適化プロキシ images.weserv.nl 経由で取得し圧縮済みバイト列を受け取る。
// 出力を JPEG 固定にするのは LINE Flex の hero 画像が JPEG/PNG のみ対応のため。
const REHOST_MAX_EDGE = 1280;
const REHOST_QUALITY = 80;

// 画像最適化プロキシ URL を組み立てる。weserv は scheme 無しの host/path を受け取り
// https で取得するため、先頭の http(s):// を除いて渡す。
function buildCompressUrl(srcUrl: string): string | null {
  const stripped = srcUrl.replace(/^https?:\/\//i, '').trim();
  if (!stripped) return null;
  const params = [
    `url=${encodeURIComponent(stripped)}`,
    `w=${REHOST_MAX_EDGE}`,
    `h=${REHOST_MAX_EDGE}`,
    'fit=inside',
    'we', // without enlargement: 元より大きくしない
    `q=${REHOST_QUALITY}`,
    'output=jpg',
  ];
  return `https://images.weserv.nl/?${params.join('&')}`;
}

function fetchSourceImage(url: string, signal: AbortSignal) {
  return fetch(url, {
    headers: { 'User-Agent': 'L-port Product Importer/1.0', Accept: 'image/*' },
    redirect: 'follow',
    signal,
  });
}

// URL 取込でサイトが返した HTTP ステータスを、利用者向けの分かりやすい
// 日本語メッセージに変換する。大手 EC は bot 対策で 403/401/429 を返すため、
// 取込に対応していない旨を伝えて CSV など正規ルートへ誘導する。
function urlFetchErrorMessage(status: number): string {
  const fallback = 'CSV取込・画像/PDF・Shopify連携をお試しください。';
  if (status === 403 || status === 401 || status === 429 || status === 451) {
    return `このサイトは外部からの自動読み込みをブロックしているため取り込めません（大手ECサイトに多い仕様です）。${fallback}`;
  }
  if (status === 404 || status === 410) {
    return `指定したページが見つかりませんでした（${status}）。URL をご確認ください。`;
  }
  if (status >= 500) {
    return `取得先サイトでエラーが発生しています（${status}）。時間をおいて再度お試しいただくか、${fallback}`;
  }
  return `このサイトの読み込みに失敗しました（${status}）。取り込みに対応していないサイトの可能性があります。${fallback}`;
}

/**
 * AI の返した商品配列 JSON をパースする。maxTokens 到達で末尾が途中欠損した
 * (truncated) 場合でも、最後の完全な `}` までで打ち切って `]` で閉じ直し、
 * 完成している商品だけを救済する。復元不能なら null。
 */
function parseProductArrayLoose(text: string): unknown[] | null {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  try {
    const v = JSON.parse(trimmed);
    if (Array.isArray(v)) return v;
  } catch {
    /* 途中欠損の可能性 → 下で救済 */
  }
  const start = trimmed.indexOf('[');
  const lastBrace = trimmed.lastIndexOf('}');
  if (start === -1 || lastBrace <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, lastBrace + 1) + ']');
    if (Array.isArray(v)) return v;
  } catch {
    /* 救済失敗 */
  }
  return null;
}

/**
 * 外部画像 URL を取得して R2 (IMAGES) に再ホストし、当サービス配信の永続 URL を返す。
 * 取得時に画像最適化プロキシで自動的にリサイズ・圧縮する。プロキシが失敗した場合は
 * 原本を直接取得してフォールバック (圧縮は効かないがリンク切れ対策は維持)。
 * 失敗時は null（呼び出し側で元 URL にフォールバック）。
 */
async function rehostImageToR2(
  env: Env['Bindings'],
  srcUrl: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);
    // まず圧縮プロキシ経由で取得。失敗したら原本を直接取得する。
    const compressUrl = buildCompressUrl(srcUrl);
    let res = compressUrl ? await fetchSourceImage(compressUrl, controller.signal) : null;
    if (!res || !res.ok) {
      res = await fetchSourceImage(srcUrl, controller.signal);
    }
    clearTimeout(t);
    if (!res.ok) return null;
    let mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(mime)) {
      // content-type が当てにならない CDN 向けに拡張子から推定
      const ext = srcUrl.split('?')[0].split('.').pop()?.toLowerCase();
      const guess: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
      if (ext && guess[ext]) mime = guess[ext];
      else return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_REHOST_BYTES) return null;

    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const key = `${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(key, buf, {
      httpMetadata: { contentType: mime },
      customMetadata: { source: 'bulk-import' },
    });
    const base = env.WORKER_URL || 'https://api.line-port.com';
    return `${base}/images/${key}`;
  } catch {
    return null;
  }
}

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
  const status = c.req.query('status') || undefined;
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 1000);

  if (search) {
    const results = await searchAiProductsByKeyword(c.env.DB, lineAccountId, search, limit);
    return c.json({ success: true, products: results });
  }
  const products = await listAiProducts(c.env.DB, lineAccountId, { category, activeOnly, status, limit });
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
    product_kind?: string;
    pricing_type?: string;
    price_min?: number | null;
    price_max?: number | null;
    price_note?: string | null;
    cta_type?: string;
    cta_label?: string | null;
    cta_url?: string | null;
    attributes?: Record<string, unknown> | null;
    status?: string;
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
    productKind: body.product_kind,
    pricingType: body.pricing_type,
    priceMin: body.price_min ?? null,
    priceMax: body.price_max ?? null,
    priceNote: body.price_note ?? null,
    ctaType: body.cta_type,
    ctaLabel: body.cta_label ?? null,
    ctaUrl: body.cta_url ?? null,
    attributes: body.attributes ?? null,
    status: body.status,
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
    source: 'text' | 'image' | 'url' | 'csv' | 'pdf';
    text?: string;
    image_url?: string;
    url?: string;
    csv?: string;
    /** 画像/PDF をローカルアップロードした場合の base64 (data: プレフィックスなし) */
    file_data?: string;
    /** file_data の MIME (image/png, image/jpeg, application/pdf 等) */
    media_type?: string;
    /** 業種テンプレ id。指定すると product_kind と業種別属性の抽出を促す。 */
    industry?: string;
  }>();

  let inputText = '';
  let inputImageUrl: string | null = null;
  // ローカルアップロード (base64) の画像/PDF。Anthropic の image/document ブロックに載せる。
  let inputFileBlock: { type: 'image' | 'document'; media_type: string; data: string } | null = null;

  const ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
  // 4.5MB (base64 で ~6MB) 上限。Anthropic の document/image 制約に収める。
  const MAX_FILE_BASE64 = 6_000_000;

  if (body.source === 'text') {
    if (!body.text || body.text.length < 5) {
      return c.json({ success: false, error: 'text required (min 5 chars)' }, 400);
    }
    if (body.text.length > 20000) {
      return c.json({ success: false, error: 'text too long (max 20000 chars)' }, 400);
    }
    inputText = body.text;
  } else if (body.source === 'pdf') {
    // PDF は base64 アップロードのみ (Anthropic document ブロック)。
    if (!body.file_data || body.media_type !== 'application/pdf') {
      return c.json({ success: false, error: 'PDF の file_data (base64) と media_type=application/pdf が必要です' }, 400);
    }
    if (body.file_data.length > MAX_FILE_BASE64) {
      return c.json({ success: false, error: 'PDF が大きすぎます (約 4.5MB まで)' }, 400);
    }
    inputFileBlock = { type: 'document', media_type: 'application/pdf', data: body.file_data };
  } else if (body.source === 'image') {
    // 公開 URL でも、ローカルアップロード (base64) でも受ける。
    if (body.file_data) {
      const mt = body.media_type ?? 'image/png';
      if (!ALLOWED_UPLOAD_TYPES.includes(mt) || mt === 'application/pdf') {
        return c.json({ success: false, error: '対応していない画像形式です (png/jpeg/gif/webp)' }, 400);
      }
      if (body.file_data.length > MAX_FILE_BASE64) {
        return c.json({ success: false, error: '画像が大きすぎます (約 4.5MB まで)' }, 400);
      }
      inputFileBlock = { type: 'image', media_type: mt, data: body.file_data };
    } else if (body.image_url) {
      inputImageUrl = body.image_url;
    } else {
      return c.json({ success: false, error: 'image_url または file_data が必要です' }, 400);
    }
  } else if (body.source === 'url') {
    if (!body.url || !/^https?:\/\//.test(body.url)) {
      return c.json({ success: false, error: 'valid url required' }, 400);
    }
    // URL fetch して HTML をテキスト化 + 画像 URL も抽出して context に含める。
    // AI が text と並んで画像 URL リストを見て、各商品に最も合う画像を選んでくれる。
    try {
      const res = await fetch(body.url, {
        headers: { 'User-Agent': 'L-Assist Product Importer/1.0' },
      });
      if (!res.ok) {
        return c.json({ success: false, error: urlFetchErrorMessage(res.status) }, 400);
      }
      const html = await res.text();
      const pageBase = new URL(body.url);

      // 取込ラダー ②: まず JSON-LD (schema.org Product/Service/MenuItem 等) を LLM なしで抽出。
      // 1 件でも取れれば AI を呼ばず、構造化データをそのまま返す (無料・正確)。
      const jsonLd = extractJsonLdProducts(html);
      if (jsonLd.length > 0) {
        const cleaned = jsonLd
          .filter((p) => typeof p.name === 'string' && p.name.length > 0)
          .slice(0, 200)
          .map((p) => {
            const rawImg = typeof p.image_url === 'string' ? p.image_url.trim() : '';
            const image_url = /^https?:\/\//.test(rawImg) ? upgradeCdnUrl(rawImg).slice(0, 1000) : null;
            const rawPu = typeof p.product_url === 'string' ? p.product_url.trim() : '';
            let product_url: string | null = null;
            try {
              product_url = rawPu ? new URL(rawPu, pageBase).toString().slice(0, 1000) : null;
            } catch { product_url = null; }
            return {
              name: String(p.name).slice(0, 200),
              price_yen: typeof p.price_min === 'number' && p.price_min > 0 ? p.price_min : null,
              price_min: typeof p.price_min === 'number' ? p.price_min : null,
              price_max: typeof p.price_max === 'number' ? p.price_max : null,
              description: String(p.description ?? '').slice(0, 1000),
              category: String(p.category ?? '').slice(0, 100),
              sku: String(p.sku ?? '').slice(0, 100),
              image_url,
              product_url,
              product_kind: p.product_kind ?? null,
            };
          });
        if (cleaned.length > 0) {
          return c.json({
            success: true,
            products: cleaned,
            meta: { model: 'json-ld', costYen: 0, inputTokens: 0, outputTokens: 0, truncated: false, structured: true },
          });
        }
      }

      // 取込ラダー ①: JSON-LD が空でも Shopify ストアなら公開 products.json から直接取得。
      // collections/ranking のような一覧ページは JSON-LD を持たず、
      // 従来は HTML を丸ごと LLM に投げて 60s タイムアウトしていた。
      // Shopify マーカーを検出したら LLM を回避し、無料・正確な公開 API に切替える。
      if (/cdn\.shopify\.com|\/cdn\/shop\/|Shopify\.|myshopify/i.test(html)) {
        const shopify = await fetchShopifyPublicProducts(body.url);
        if (shopify.ok && shopify.products.length > 0) {
          const products = shopify.products.slice(0, 250).map((raw) => {
            const n = normalizeToOffer(raw, { industry: null, source: 'shopify_public', sourceUrl: shopify.origin });
            return {
              name: n.name,
              price_yen: n.priceYen ?? null,
              price_min: n.priceMin,
              price_max: n.priceMax,
              description: n.description ?? '',
              category: n.category ?? '',
              sku: n.sku ?? '',
              image_url: n.imageUrl ?? null,
              product_url: n.productUrl ?? null,
              stock: n.stock,
              tags: n.tags,
              product_kind: n.productKind,
              pricing_type: n.pricingType,
              cta_type: n.ctaType,
              external_id: n.externalId,
              source: 'shopify_public',
            };
          });
          if (products.length > 0) {
            return c.json({
              success: true,
              products,
              meta: { model: 'shopify-public', costYen: 0, inputTokens: 0, outputTokens: 0, truncated: false, structured: true },
            });
          }
        }
      }

      // 画像 URL を抽出 (優先度順、品質スコア付き)。
      // スコア:
      //  +100 og:image / twitter:image (canonical hi-res 想定)
      //  +80  JSON-LD Product.image (構造化データ、最も信頼度高い)
      //  +50  srcset の最大解像度バリアント
      //  +0   <img src>
      //  -50  低品質ヒント (thumb / small / icon / 100x100 等) を含む URL
      //  +30  高品質ヒント (large / main / original / 1200x / 2000x 等) を含む URL
      type Cand = { url: string; score: number };
      const candidates: Cand[] = [];
      const seen = new Set<string>();

      const lowQualityPatterns = /(thumb|thumbnail|_small|_xs|_sm|-small|-xs|-sm|_50x|_100x|_150x|_200x|_50\.|_100\.|icon[-_/]|sprite|placeholder|loading\.)/i;
      const highQualityPatterns = /(large|main|original|hires|hi-res|_lg|_xl|_xxl|-large|-main|2000x|1600x|1200x|1500x|_2000\.|_1600\.|_1200\.)/i;
      const skipPatterns = /(\.svg($|\?)|^data:|spacer|pixel|tracking|1x1\.|blank\.|favicon|logo[-_./])/i;

      function scoreUrl(u: string, base: number): number {
        let s = base;
        if (lowQualityPatterns.test(u)) s -= 50;
        if (highQualityPatterns.test(u)) s += 30;
        return s;
      }

      function tryAdd(u: string, base: number) {
        if (!u || u.length < 8) return;
        if (skipPatterns.test(u)) return;
        let abs: string;
        try { abs = new URL(u, pageBase).toString(); } catch { return; }
        if (!/^https?:\/\//.test(abs)) return;
        // 既知 CDN の画像サイズ指定を高解像度に書き換え (見つかれば +20)
        const upgraded = upgradeCdnUrl(abs);
        const score = scoreUrl(upgraded, base) + (upgraded !== abs ? 20 : 0);
        if (!seen.has(upgraded)) {
          seen.add(upgraded);
          candidates.push({ url: upgraded, score });
        }
      }

      // 1. JSON-LD Product schema の image (最も信頼度高い)
      const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const m of jsonLdMatches) {
        try {
          const data = JSON.parse(m[1]);
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const img = item.image;
            if (typeof img === 'string') tryAdd(img, 80);
            else if (Array.isArray(img)) img.forEach((u: unknown) => typeof u === 'string' && tryAdd(u, 80));
            else if (img && typeof img === 'object' && typeof img.url === 'string') tryAdd(img.url, 80);
            // ネストされた offers.image なども拾う
            if (item.offers?.image) tryAdd(item.offers.image, 70);
          }
        } catch { /* JSON-LD parse fail はスキップ */ }
      }

      // 2. og:image / twitter:image (high-res canonical)
      for (const m of html.matchAll(/<meta[^>]+property=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["']/gi)) {
        tryAdd(m[1], 100);
      }
      for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|twitter:image|og:image:secure_url)["']/gi)) {
        tryAdd(m[1], 100);
      }
      // og:image:width が大きいやつには加点 (未実装、複雑になるのでスキップ)

      // 3. <img> の srcset から最大解像度を抽出
      for (const m of html.matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)) {
        const srcset = m[1];
        // srcset: "url1 100w, url2 800w, url3 1600w" → 最大 w のものを採用
        const variants = srcset.split(',').map((v) => {
          const parts = v.trim().split(/\s+/);
          const w = parseInt(parts[1] ?? '0', 10);
          return { url: parts[0], w: isNaN(w) ? 0 : w };
        });
        variants.sort((a, b) => b.w - a.w);
        if (variants[0]) tryAdd(variants[0].url, 50);
      }

      // 4. <img src> (low priority)
      for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
        tryAdd(m[1], 0);
      }
      // 5. og:image など失敗時用に <link rel="image_src">
      for (const m of html.matchAll(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/gi)) {
        tryAdd(m[1], 60);
      }

      // スコア順に並べ、低スコア (skip patterns) は捨てる
      candidates.sort((a, b) => b.score - a.score);
      const uniqueImages = candidates
        .filter((c) => c.score > -30) // 低品質確定は除外
        .map((c) => c.url)
        .slice(0, 30);

      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 28000);

      const imagesBlock = uniqueImages.length > 0
        ? `\n\n[ページ内の画像 URL 一覧 (各商品に最も適切なものを選んで image_url に入れてください)]\n${uniqueImages.join('\n')}`
        : '';
      inputText = `[ソース: ${body.url}]\n\n${stripped}${imagesBlock}`;
    } catch {
      return c.json(
        {
          success: false,
          error:
            'このサイトの読み込みに失敗しました。応答がない、または取り込みに対応していないサイトの可能性があります。CSV取込・画像/PDF・Shopify連携をお試しください。',
        },
        400,
      );
    }
  } else if (body.source === 'csv') {
    if (!body.csv) {
      return c.json({ success: false, error: 'csv required' }, 400);
    }
    inputText = `以下は CSV データです。1 行目がヘッダーです。\n\n${body.csv.slice(0, 20000)}`;
  } else {
    return c.json({ success: false, error: 'invalid source' }, 400);
  }

  // 業種テンプレが指定されていれば、種別の既定と業種別属性の抽出を促す追記を作る。
  const tmpl = getIndustryTemplate(body.industry);
  const industryBlock = tmpl
    ? `

【この事業の業種: ${tmpl.label}】
- product_kind は原則 "${tmpl.defaultKind}"（明らかに異なる場合のみ変更）。
- 各商品で、下記の業種別属性を読み取れた範囲で "attributes"（オブジェクト）に入れてください。読み取れないキーは省略可。
${tmpl.fields.map((f) => `  - "${f.key}"（${f.label}${f.unit ? ` / 単位:${f.unit}` : ''}${f.hint ? ` / ${f.hint}` : ''}）`).join('\n')}`
    : '';

  const systemPrompt = `あなたは商品マスタ抽出の専門家です。
入力されたテキスト・画像・PDF から、商品（または提供サービス・メニュー）を抽出し、
以下の JSON 形式で配列として返してください。

[
  {
    "name": "商品名（必須）",
    "price_yen": 数値（円・税抜想定、不明なら null）,
    "description": "簡潔な説明（不明なら空文字）",
    "category": "カテゴリ（不明なら空文字）",
    "sku": "型番・商品コード（不明なら空文字）",
    "product_kind": "種別（${PRODUCT_KINDS.join(' / ')} のいずれか。物販=physical / 施術・コース=service_plan / サブスク=subscription / 予約枠=booking / デジタル=digital / 飲食メニュー=menu_item。不明なら空文字）",
    "attributes": {},
    "image_url": "商品画像 URL（入力に「ページ内の画像 URL 一覧」または CSV の image_url / 画像 列があれば、その中から商品名と最も合うものを選んで入れる。なければ空文字）",
    "product_url": "商品ページの URL（CSV の product_url / 商品ページURL 列や、ソース URL から該当商品の詳細ページが分かる場合に入れる。なければ空文字）"
  }
]${industryBlock}

【厳守ルール】
- レスポンスは JSON 配列のみ。前後の文章・コードブロック禁止
- 価格の幅がある場合（例: ¥8,000〜¥10,000）→ price_yen は最安値、description に「最大 ¥10,000」と記載
- 商品が見つからない場合は [] を返す
- 各商品の name は最大 100 文字、description は最大 500 文字
- 重複は除外する
- 価格が「お問い合わせ」「要相談」の場合は price_yen: null
- image_url は、与えられた候補リストの URL を**そのまま**返す（新規生成・推測 NG）。リストに無ければ空文字
- 1 URL を複数商品に割り当てない（最も近い 1 商品にだけ割り当てる）`;

  type UserBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };
  const userContent: UserBlock[] = [];
  if (inputFileBlock) {
    if (inputFileBlock.type === 'document') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: inputFileBlock.media_type, data: inputFileBlock.data } });
      userContent.push({ type: 'text', text: 'この PDF（料金表・メニュー等）から商品/メニューを抽出してください。' });
    } else {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: inputFileBlock.media_type, data: inputFileBlock.data } });
      userContent.push({ type: 'text', text: 'この画像から商品/メニューを抽出してください。' });
    }
  } else if (inputImageUrl) {
    userContent.push({ type: 'image', source: { type: 'url', url: inputImageUrl } });
    userContent.push({ type: 'text', text: 'この画像から商品/メニューを抽出してください。' });
  } else {
    userContent.push({ type: 'text', text: inputText });
  }

  const { callClaude } = await import('../lib/claude-client.js');
  // 画像・PDF・URL は Sonnet、テキスト/CSV は Haiku で十分
  const heavy = body.source === 'image' || body.source === 'url' || body.source === 'pdf';
  const model = heavy ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  try {
    const result = await callClaude({
      apiKey,
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      // URL/画像/PDF は商品数が多く出力が長くなりがち。4000 だと途中で切れて JSON が壊れるため広げる。
      maxTokens: heavy ? 12000 : 4000,
      temperature: 0.2,
    });

    // JSON parse（maxTokens 到達で末尾が切れていても完成分だけ救済する）
    const parsed = parseProductArrayLoose(result.text);
    if (!parsed) {
      return c.json({
        success: false,
        error: 'AI レスポンスの JSON 解析に失敗しました',
        raw: result.text.slice(0, 500),
        parseError: result.stopReason === 'max_tokens' ? '出力が長すぎて途中で打ち切られました' : 'unknown',
      }, 500);
    }
    const products = parsed as Array<{ name: string; price_yen: number | null; description: string; category: string; sku: string; image_url?: string; product_url?: string; product_kind?: string; attributes?: Record<string, unknown> }>;
    const truncated = result.stopReason === 'max_tokens';
    const KIND_SET = new Set<string>(PRODUCT_KINDS);

    // バリデーション + サニタイズ
    const cleaned = products
      .filter((p) => p && typeof p.name === 'string' && p.name.length > 0)
      .slice(0, 200)
      .map((p) => {
        const rawImg = typeof p.image_url === 'string' ? p.image_url.trim() : '';
        // 妥当な https URL のみ通す。AI が prompt の指示を破って空文字や無効値を返したら null。
        const image_url = /^https?:\/\//.test(rawImg) ? rawImg.slice(0, 1000) : null;
        const rawProductUrl = typeof p.product_url === 'string' ? p.product_url.trim() : '';
        const product_url = /^https?:\/\//.test(rawProductUrl) ? rawProductUrl.slice(0, 1000) : null;
        // product_kind は enum のみ通す。業種テンプレ指定時は既定値でフォールバック。
        const kind = typeof p.product_kind === 'string' && KIND_SET.has(p.product_kind)
          ? p.product_kind
          : (tmpl?.defaultKind ?? null);
        const attributes = p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes)
          ? (p.attributes as Record<string, unknown>)
          : null;
        return {
          name: String(p.name).slice(0, 200),
          price_yen: typeof p.price_yen === 'number' && p.price_yen > 0 ? Math.round(p.price_yen) : null,
          description: String(p.description ?? '').slice(0, 1000),
          category: String(p.category ?? '').slice(0, 100),
          sku: String(p.sku ?? '').slice(0, 100),
          image_url,
          product_url,
          product_kind: kind,
          attributes,
        };
      });

    return c.json({
      success: true,
      products: cleaned,
      meta: {
        model: result.model,
        costYen: result.costYenX100 / 100,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        // 出力が上限に達し、末尾商品を取りこぼした可能性がある（UI で注意喚起する）
        truncated,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'AI 抽出失敗' }, 500);
  }
});

/**
 * ヒアリング応答 (JSON オブジェクト) をゆるくパース。
 * maxTokens 到達で末尾が欠けても、最初の { 〜 最後の } を救済して JSON.parse を試みる。
 */
function parseHearingResponse(
  text: string,
): { done?: unknown; reply?: unknown; products?: unknown } | null {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* 救済へ */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, end + 1));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* 救済失敗 */
  }
  return null;
}

/**
 * 対話ヒアリングコネクタ（取込ラダー④）。
 * 自由対話で業種別属性を埋めていく。ITに不慣れなオーナーが自然文で商品/サービスを説明し、
 * AI が業種テンプレに沿って足りない情報を1問ずつ質問。十分集まったら下書きオファーを生成する。
 * 生成物は parse と同形の drafts になり、既存のレビュー/一括登録UIにそのまま流れる。
 */
aiProducts.post('/api/ai-products/hearing', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const body = await c.req.json<{
    industry?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>();

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return c.json({ success: false, error: 'messages は user 発話で終わる必要があります' }, 400);
  }

  const tmpl = getIndustryTemplate(body.industry);
  const industryBlock = tmpl
    ? `

【業種: ${tmpl.label}】
- 生成する各オファーの product_kind は原則 "${tmpl.defaultKind}"。
- 各オファーで下記の業種別属性を、聞き取れた範囲で "attributes" に入れてください。
${tmpl.fields.map((f) => `  - "${f.key}"（${f.label}${f.unit ? ` / 単位:${f.unit}` : ''}${f.hint ? ` / ${f.hint}` : ''}）`).join('\n')}
- 上記属性で未確認のものがあれば、それを埋める質問を優先してください。`
    : '';

  const systemPrompt = `あなたは L-port の商品ヒアリング担当です。店舗オーナー（多くはITに不慣れ）と会話しながら、AI接客が薦めるための「商品/サービス（オファー）カタログ」を作ります。${industryBlock}

【進め方】
- 1 回の発話につき質問は1つだけ。専門用語を避け、やさしく短く。
- 商品名 → 価格（税込/税抜・「〜から」「要相談」も可）→ 含まれる内容 → 対象や特徴（業種別属性）の順に埋める。
- オーナーが「以上」「終わり」「これで」等の打ち切りを示したら、その時点までの情報でカタログを確定する。
- 情報が薄くても、聞き取れた分で最低1件はオファーを作れる。

【毎回、次の JSON オブジェクトだけを返す（前後の文章・コードブロック禁止）】
{
  "reply": "オーナーへの返答（次の質問、または確定時のお礼と要約）",
  "done": false,
  "products": [
    {
      "name": "商品/サービス名",
      "price_yen": 数値 or null,
      "price_min": 数値 or null,
      "price_max": 数値 or null,
      "pricing_type": "${PRICING_TYPES.join(' / ')} のいずれか or 空文字",
      "description": "簡潔な説明",
      "category": "カテゴリ or 空文字",
      "product_kind": "${PRODUCT_KINDS.join(' / ')} のいずれか or 空文字",
      "cta_type": "${CTA_TYPES.join(' / ')} のいずれか or 空文字",
      "attributes": {}
    }
  ]
}
【厳守】done が false の間は products は [] のままでよい。done を true にするのはカタログ確定時のみ。`;

  const { callClaude } = await import('../lib/claude-client.js');
  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
      maxTokens: 3000,
      temperature: 0.4,
    });

    const parsed = parseHearingResponse(result.text);
    if (!parsed) {
      return c.json(
        { success: false, error: 'AI レスポンスの解析に失敗しました', raw: result.text.slice(0, 500) },
        500,
      );
    }

    const done = parsed.done === true;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.slice(0, 2000) : '';
    const KIND_SET = new Set<string>(PRODUCT_KINDS);
    const PRICING_SET = new Set<string>(PRICING_TYPES);
    const CTA_SET = new Set<string>(CTA_TYPES);
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null);

    let products: Array<Record<string, unknown>> = [];
    if (done && Array.isArray(parsed.products)) {
      products = (parsed.products as Array<Record<string, unknown>>)
        .filter((p) => p && typeof p.name === 'string' && (p.name as string).length > 0)
        .slice(0, 100)
        .map((p) => {
          const kind =
            typeof p.product_kind === 'string' && KIND_SET.has(p.product_kind)
              ? p.product_kind
              : (tmpl?.defaultKind ?? null);
          const pricing_type =
            typeof p.pricing_type === 'string' && PRICING_SET.has(p.pricing_type) ? p.pricing_type : null;
          const cta_type = typeof p.cta_type === 'string' && CTA_SET.has(p.cta_type) ? p.cta_type : null;
          const attributes =
            p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes)
              ? (p.attributes as Record<string, unknown>)
              : null;
          return {
            name: String(p.name).slice(0, 200),
            price_yen: num(p.price_yen),
            price_min: num(p.price_min),
            price_max: num(p.price_max),
            pricing_type,
            description: String(p.description ?? '').slice(0, 1000),
            category: String(p.category ?? '').slice(0, 100),
            product_kind: kind,
            cta_type,
            attributes,
            source: 'hearing',
          };
        });
    }

    return c.json({
      success: true,
      done,
      reply,
      products,
      meta: {
        model: result.model,
        costYen: result.costYenX100 / 100,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'ヒアリング処理失敗' }, 500);
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
      price_min?: number | null;
      price_max?: number | null;
      price_note?: string | null;
      stock?: number;
      image_url?: string;
      product_url?: string;
      category?: string;
      tags?: string[];
      product_kind?: string | null;
      pricing_type?: string | null;
      cta_type?: string | null;
      cta_label?: string | null;
      cta_url?: string | null;
      attributes?: Record<string, unknown> | null;
      external_id?: string | null;
      source?: string | null;
    }>;
    skipDuplicates?: boolean;
    /** 業種テンプレート id。offer フィールド未指定時の既定値の供給源。 */
    industry?: string | null;
    /** 取込後の状態。'draft'（人間レビュー待ち）/ 'published'（即公開）。既定 published。 */
    status?: string;
  }>();

  if (!Array.isArray(body.products) || body.products.length === 0) {
    return c.json({ success: false, error: 'products required (non-empty array)' }, 400);
  }
  if (body.products.length > 500) {
    return c.json({ success: false, error: '一度に登録できるのは 500 件までです' }, 400);
  }

  // 画像 URL を R2 へ再ホスト（外部リンク切れ・縮小サムネ対策）。取得時に
  // 画像最適化プロキシで長辺 1280px / quality 80 の JPEG へ自動圧縮する。
  // 並列上限を設けて Worker の制限内に収める。最大 200 枚まで再ホスト。
  const REHOST_LIMIT = 200;
  let rehostBudget = REHOST_LIMIT;
  let imagesRehosted = 0;
  const resolvedImageUrls = new Array<string | undefined>(body.products.length);

  async function resolveImage(idx: number): Promise<void> {
    const raw = (body.products[idx]?.image_url ?? '').trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) return; // 無効な値は無視
    // 既に当サービス R2 に置かれている画像はそのまま使う
    if (raw.includes('/images/')) {
      resolvedImageUrls[idx] = raw;
      return;
    }
    const normalized = normalizeDriveUrl(raw);
    const upgraded = upgradeCdnUrl(normalized);
    if (rehostBudget > 0) {
      rehostBudget--;
      const hosted = await rehostImageToR2(c.env, upgraded);
      if (hosted) {
        resolvedImageUrls[idx] = hosted;
        imagesRehosted++;
        return;
      }
    }
    // 再ホスト失敗 or 予算切れ → 高解像度化した元 URL を保存
    resolvedImageUrls[idx] = upgraded;
  }

  // 並列度 6 で画像を解決
  const CONCURRENCY = 6;
  for (let start = 0; start < body.products.length; start += CONCURRENCY) {
    const batch: Promise<void>[] = [];
    for (let j = start; j < Math.min(start + CONCURRENCY, body.products.length); j++) {
      batch.push(resolveImage(j));
    }
    await Promise.all(batch);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ index: number; reason: string }> = [];
  const nowIso = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '');

  // 既存商品を 2 クエリで先読みし、per-item SELECT (最大 2N 回) を排除。
  // 名前重複は大小/前後空白を無視して判定。同一取込内の重複もここで捕捉する。
  const normName = (s: string) => s.trim().toLowerCase();
  const seenNames = new Set<string>();
  const bySourceExt = new Map<string, string>(); // `${source} ${external_id}` -> id
  {
    const existingNames = await c.env.DB
      .prepare(`SELECT name FROM ai_products WHERE line_account_id = ?`)
      .bind(lineAccountId)
      .all<{ name: string }>();
    for (const row of existingNames.results) seenNames.add(normName(row.name ?? ''));
    const existingExt = await c.env.DB
      .prepare(`SELECT id, source, external_id FROM ai_products WHERE line_account_id = ? AND external_id IS NOT NULL`)
      .bind(lineAccountId)
      .all<{ id: string; source: string | null; external_id: string | null }>();
    for (const row of existingExt.results) {
      if (row.source && row.external_id) bySourceExt.set(`${row.source} ${row.external_id}`, row.id);
    }
  }

  for (let i = 0; i < body.products.length; i++) {
    const p = body.products[i];
    if (!p?.name || p.name.trim().length === 0) {
      skipped++;
      continue;
    }
    try {
      // 正規化: UI 指定の offer フィールドを尊重しつつ、未指定分は業種テンプレの既定値で補完。
      const raw: RawOffer = {
        name: p.name,
        price_yen: p.price_yen ?? null,
        price_min: p.price_min ?? null,
        price_max: p.price_max ?? null,
        price_note: p.price_note ?? null,
        description: p.description ?? null,
        category: p.category ?? null,
        sku: p.sku ?? null,
        image_url: resolvedImageUrls[i] ?? p.image_url ?? null,
        product_url: p.product_url ?? null,
        stock: p.stock ?? null,
        tags: p.tags,
        product_kind: p.product_kind ?? null,
        pricing_type: p.pricing_type ?? null,
        cta_type: p.cta_type ?? null,
        cta_label: p.cta_label ?? null,
        cta_url: p.cta_url ?? null,
        attributes: p.attributes ?? null,
        external_id: p.external_id ?? null,
      };
      const n = normalizeToOffer(raw, {
        industry: body.industry ?? null,
        source: p.source ?? null,
        status: body.status ?? 'published',
      });
      const offerFields = {
        productKind: n.productKind,
        pricingType: n.pricingType,
        priceMin: n.priceMin,
        priceMax: n.priceMax,
        priceNote: n.priceNote,
        ctaType: n.ctaType,
        ctaLabel: n.ctaLabel,
        ctaUrl: n.ctaUrl,
        attributes: n.attributes,
        source: n.source,
        sourceUrl: n.sourceUrl,
        externalId: n.externalId,
        status: n.status,
        syncedAt: n.source ? nowIso : null,
      };

      // 再同期 upsert: source + external_id が既存にあれば更新 (構造化コネクタの再取込)。
      if (n.source && n.externalId) {
        const existingId = bySourceExt.get(`${n.source} ${n.externalId}`);
        if (existingId === 'new') {
          // 同一取込内に同じ external_id が二重に含まれていた → 既に登録済みとしてスキップ
          skipped++;
          continue;
        }
        if (existingId) {
          await updateAiProduct(c.env.DB, existingId, lineAccountId, {
            name: n.name.slice(0, 200),
            description: n.description ?? null,
            priceYen: typeof n.priceYen === 'number' ? n.priceYen : null,
            stock: n.stock ?? null,
            imageUrl: resolvedImageUrls[i] ?? n.imageUrl ?? null,
            productUrl: n.productUrl ?? null,
            category: n.category ?? null,
            tags: n.tags ?? null,
            vectorIndexed: false,
            ...offerFields,
          });
          updated++;
          continue;
        }
      }

      // 名前重複スキップ (external_id 無しのソース向け)。大小/空白を無視、同一取込内の重複も捕捉。
      if (body.skipDuplicates !== false && !(n.source && n.externalId)) {
        if (seenNames.has(normName(n.name))) {
          skipped++;
          continue;
        }
      }

      await createAiProduct(c.env.DB, {
        lineAccountId,
        sku: n.sku,
        name: n.name,
        description: n.description,
        priceYen: typeof n.priceYen === 'number' ? n.priceYen : undefined,
        stock: n.stock,
        imageUrl: resolvedImageUrls[i] ?? n.imageUrl,
        productUrl: n.productUrl,
        category: n.category,
        tags: n.tags,
        ...offerFields,
      });
      created++;
      seenNames.add(normName(n.name));
      if (n.source && n.externalId) bySourceExt.set(`${n.source} ${n.externalId}`, 'new');
    } catch (e) {
      errors.push({ index: i, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return c.json({
    success: true,
    summary: { created, updated, skipped, errors: errors.length, imagesRehosted },
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
        // 再同期 upsert キー: 公開 JSON 取込と同じ体系で external_id / source を付与し、
        // 再取込時に二重登録せず更新できるようにする。
        product_kind: 'physical',
        external_id: `shopify:${p.id}`,
        source: 'shopify_admin',
      };
    });

    return c.json({ success: true, products, meta: { source: 'shopify', count: products.length } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'Shopify fetch 失敗' }, 500);
  }
});

/**
 * Shopify 公開 products.json 取込 (トークン不要)。
 * body: { url: "https://store.example.com" or "store.myshopify.com", max_pages?: number }
 * 戻り値: 正規化済みの商品候補リスト (bulk-import に流す前のプレビュー用)。
 */
aiProducts.post('/api/ai-products/shopify-public-fetch', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{ url?: string; max_pages?: number }>();
  if (!body.url || body.url.trim().length === 0) {
    return c.json({ success: false, error: 'url が必要です（例: https://yourstore.com）' }, 400);
  }
  const maxPages = Math.min(Math.max(body.max_pages ?? 20, 1), 40);
  const result = await fetchShopifyPublicProducts(body.url, maxPages);
  if (!result.ok) {
    return c.json({ success: false, error: result.error ?? 'Shopify 公開データを取得できませんでした' }, 400);
  }
  // 正規化して DraftProduct 相当 (snake) に落とす。source/external_id を保持して再同期可能にする。
  const products = result.products.map((raw) => {
    const n = normalizeToOffer(raw, { industry: null, source: 'shopify_public', sourceUrl: result.origin });
    return {
      name: n.name,
      price_yen: n.priceYen ?? null,
      price_min: n.priceMin,
      price_max: n.priceMax,
      description: n.description ?? '',
      category: n.category ?? '',
      sku: n.sku ?? '',
      image_url: n.imageUrl ?? null,
      product_url: n.productUrl ?? null,
      stock: n.stock,
      tags: n.tags,
      product_kind: n.productKind,
      pricing_type: n.pricingType,
      cta_type: n.ctaType,
      external_id: n.externalId,
      source: 'shopify_public',
    };
  });
  return c.json({
    success: true,
    products,
    meta: { source: 'shopify_public', count: products.length, origin: result.origin },
  });
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
    price_yen?: number | null;
    stock?: number;
    image_url?: string;
    product_url?: string;
    category?: string;
    tags?: string[];
    active?: boolean;
    product_kind?: string;
    pricing_type?: string;
    price_min?: number | null;
    price_max?: number | null;
    price_note?: string | null;
    cta_type?: string;
    cta_label?: string | null;
    cta_url?: string | null;
    attributes?: Record<string, unknown> | null;
    status?: string;
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
    productKind: body.product_kind,
    pricingType: body.pricing_type,
    priceMin: body.price_min,
    priceMax: body.price_max,
    priceNote: body.price_note,
    ctaType: body.cta_type,
    ctaLabel: body.cta_label,
    ctaUrl: body.cta_url,
    attributes: body.attributes,
    status: body.status,
  });
  const updated = await getAiProductById(c.env.DB, id, lineAccountId);
  return c.json({ success: true, product: updated });
});

// アカウント配下の全商品をまとめて削除。
aiProducts.delete('/api/ai-products', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const deleted = await deleteAllAiProducts(c.env.DB, lineAccountId);
  return c.json({ success: true, deleted });
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
