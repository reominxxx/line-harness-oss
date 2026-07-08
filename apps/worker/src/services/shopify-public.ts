/**
 * Shopify 公開 products.json コネクタ (取込ラダー ①、最上位)。
 *
 * Shopify ストアは `{domain}/products.json?limit=250&page=N` を**トークン無し**で
 * 公開している (テーマが無効化していない限り)。URL / ドメインを貼るだけで全商品を
 * ページングして取得できる。Admin API + shpat_ トークン方式より圧倒的に低ハードル。
 *
 * 素の抽出結果 (RawOffer) を返すだけ。共通モデル化は normalizeToOffer が行う。
 */

import type { RawOffer } from './product-normalize.js';

interface ShopifyVariant {
  id?: number;
  sku?: string;
  price?: string;
  compare_at_price?: string;
  inventory_quantity?: number;
  available?: boolean;
}
interface ShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  product_type?: string;
  tags?: string | string[];
  variants?: ShopifyVariant[];
  images?: Array<{ src?: string }>;
  image?: { src?: string };
}

/** 入力 (URL でもドメインでも) から Shopify のオリジン `https://host` を取り出す。 */
export function toShopifyOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return `https://${u.hostname}`;
  } catch {
    return null;
  }
}

function mapProduct(origin: string, p: ShopifyProduct): RawOffer | null {
  const name = (p.title ?? '').trim();
  if (!name) return null;
  const variants = p.variants ?? [];
  const prices = variants
    .map((v) => (v.price ? parseFloat(v.price) : NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = prices.length ? Math.round(Math.min(...prices)) : null;
  const max = prices.length ? Math.round(Math.max(...prices)) : null;
  const v0 = variants[0];
  const img = p.images?.[0]?.src ?? p.image?.src ?? null;
  const tags = Array.isArray(p.tags)
    ? p.tags
    : typeof p.tags === 'string'
      ? p.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
  return {
    name,
    description: (p.body_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) || null,
    price_yen: min,
    price_min: min,
    price_max: max && max !== min ? max : null,
    category: p.product_type ?? null,
    sku: v0?.sku ?? null,
    image_url: img,
    product_url: p.handle ? `${origin}/products/${p.handle}` : null,
    stock: typeof v0?.inventory_quantity === 'number' ? v0.inventory_quantity : null,
    tags,
    product_kind: 'physical',
    external_id: p.id != null ? `shopify:${p.id}` : null,
  };
}

export interface ShopifyPublicResult {
  ok: boolean;
  origin: string | null;
  products: RawOffer[];
  error?: string;
}

/**
 * 公開 products.json を最大 maxPages ページまで辿って全商品を取得する。
 * 1 ページ 250 件。空ページか非 200 で停止。Shopify でないサイトは ok:false。
 */
export async function fetchShopifyPublicProducts(
  input: string,
  maxPages = 20,
): Promise<ShopifyPublicResult> {
  const origin = toShopifyOrigin(input);
  if (!origin) return { ok: false, origin: null, products: [], error: 'URL / ドメインの形式が不正です' };

  const all: RawOffer[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let res: Response;
    try {
      res = await fetch(`${origin}/products.json?limit=250&page=${page}`, {
        headers: { 'User-Agent': 'L-port Product Importer/1.0', Accept: 'application/json' },
        redirect: 'follow',
      });
    } catch {
      return { ok: false, origin, products: all, error: 'サイトに接続できませんでした' };
    }
    if (!res.ok) {
      if (page === 1) {
        return {
          ok: false,
          origin,
          products: [],
          error:
            'このサイトからは Shopify の公開商品データを取得できませんでした（Shopify ストアでないか、公開が無効な可能性があります）。',
        };
      }
      break; // 2 ページ目以降のエラーはそこまでの取得分で確定
    }
    let data: { products?: ShopifyProduct[] };
    try {
      data = (await res.json()) as { products?: ShopifyProduct[] };
    } catch {
      if (page === 1) {
        return { ok: false, origin, products: [], error: 'Shopify の商品データとして解釈できませんでした。' };
      }
      break;
    }
    const list = data.products ?? [];
    if (list.length === 0) break;
    for (const p of list) {
      const mapped = mapProduct(origin, p);
      if (mapped) all.push(mapped);
    }
    if (list.length < 250) break; // 最終ページ
  }

  if (all.length === 0) {
    return { ok: false, origin, products: [], error: '商品が見つかりませんでした。' };
  }
  return { ok: true, origin, products: all };
}
