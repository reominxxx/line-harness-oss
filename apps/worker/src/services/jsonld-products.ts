/**
 * ページ HTML に埋め込まれた schema.org JSON-LD から商品/サービス/メニューを
 * LLM なしで抽出する (取込ラダー ②「埋め込み構造化」)。
 *
 * 対応 @type: Product / Service / MedicalProcedure / MenuItem / Course。
 * offers (Offer / AggregateOffer) から価格・幅を取り、@graph / ItemList / 配列を再帰的に辿る。
 * 素の抽出結果 (RawOffer) を返すだけ。共通モデルへの落とし込みは normalizeToOffer が行う。
 */

import type { RawOffer } from './product-normalize.js';

const KIND_BY_TYPE: Record<string, string> = {
  product: 'physical',
  service: 'service_plan',
  medicalprocedure: 'service_plan',
  medicaltherapy: 'service_plan',
  course: 'service_plan',
  menuitem: 'menu_item',
};

function typeList(t: unknown): string[] {
  if (typeof t === 'string') return [t.toLowerCase()];
  if (Array.isArray(t)) return t.filter((x) => typeof x === 'string').map((x) => (x as string).toLowerCase());
  return [];
}

function firstImage(img: unknown): string | null {
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    for (const x of img) {
      const r = firstImage(x);
      if (r) return r;
    }
    return null;
  }
  if (img && typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') {
    return (img as { url: string }).url;
  }
  return null;
}

function parsePrice(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

/** offers オブジェクト (Offer / AggregateOffer / 配列) から min/max を取り出す。 */
function extractOfferPrice(offers: unknown): { min: number | null; max: number | null } {
  if (!offers) return { min: null, max: null };
  if (Array.isArray(offers)) {
    let min: number | null = null;
    let max: number | null = null;
    for (const o of offers) {
      const r = extractOfferPrice(o);
      if (r.min != null) min = min == null ? r.min : Math.min(min, r.min);
      if (r.max != null) max = max == null ? r.max : Math.max(max, r.max);
    }
    return { min, max };
  }
  if (typeof offers === 'object') {
    const o = offers as Record<string, unknown>;
    const low = parsePrice(o.lowPrice);
    const high = parsePrice(o.highPrice);
    const price = parsePrice(o.price);
    if (low != null || high != null) return { min: low ?? price, max: high };
    if (price != null) return { min: price, max: null };
  }
  return { min: null, max: null };
}

function nodeToOffer(node: Record<string, unknown>, kind: string): RawOffer | null {
  const name = typeof node.name === 'string' ? node.name.trim() : '';
  if (!name) return null;
  const { min, max } = extractOfferPrice(node.offers);
  const desc = typeof node.description === 'string' ? node.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  const sku = typeof node.sku === 'string' ? node.sku : typeof node.mpn === 'string' ? node.mpn : null;
  const category =
    typeof node.category === 'string'
      ? node.category
      : (node.category as { name?: string } | undefined)?.name ?? null;
  const url = typeof node.url === 'string' ? node.url : (node.offers as { url?: string } | undefined)?.url ?? null;
  return {
    name,
    description: desc,
    price_yen: min,
    price_min: min,
    price_max: max && max !== min ? max : null,
    sku,
    category,
    image_url: firstImage(node.image),
    product_url: url,
    product_kind: kind,
  };
}

/** 任意の JSON-LD ノードを再帰的に辿り、対象 @type を RawOffer 化して集める。 */
function walk(node: unknown, out: RawOffer[], seen: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, out, seen);
    return;
  }
  const obj = node as Record<string, unknown>;
  // @graph / itemListElement / mainEntity などのコンテナを辿る
  if (Array.isArray(obj['@graph'])) walk(obj['@graph'], out, seen);
  if (Array.isArray(obj.itemListElement)) walk(obj.itemListElement, out, seen);
  if (obj.item && typeof obj.item === 'object') walk(obj.item, out, seen);
  if (Array.isArray(obj.hasMenuSection)) walk(obj.hasMenuSection, out, seen);
  if (Array.isArray(obj.hasMenuItem)) walk(obj.hasMenuItem, out, seen);
  if (Array.isArray(obj.menu)) walk(obj.menu, out, seen);

  const types = typeList(obj['@type']);
  for (const t of types) {
    const kind = KIND_BY_TYPE[t];
    if (kind) {
      const offer = nodeToOffer(obj, kind);
      if (offer) {
        const key = `${offer.name}|${offer.price_min ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(offer);
        }
      }
      break;
    }
  }
}

/**
 * HTML 内の全 JSON-LD <script> を舐めて商品/サービス/メニューを抽出する。
 * 1 件も取れなければ空配列 (呼び出し側は LLM 抽出へフォールバックする)。
 */
export function extractJsonLdProducts(html: string): RawOffer[] {
  const out: RawOffer[] = [];
  const seen = new Set<string>();
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    let raw = m[1].trim();
    // 稀に末尾セミコロンや HTML コメントが混じる
    raw = raw.replace(/^\s*\/\/<!\[CDATA\[/, '').replace(/\/\/\]\]>\s*$/, '').trim();
    try {
      const data = JSON.parse(raw);
      walk(data, out, seen);
    } catch {
      /* パース不能な JSON-LD はスキップ */
    }
  }
  return out;
}
