/**
 * 商品取込の「正規化層」。
 *
 * ソース (Shopify公開JSON / JSON-LD / CSV / PDF・画像AI / 対話ヒアリング) が何であれ、
 * 各アダプタが吐いた素の抽出結果 (RawOffer) を、この 1 本の関数で ai_products の
 * 共通オファーモデルへ落とす。業種テンプレート (packages/shared) の既定値で
 * product_kind / pricing_type / cta_type を補完し、価格ヒューリスティクスで
 * pricing_type と price_min/max を決定し、業種別フィールドを attributes に畳む。
 *
 * 構造化コネクタが明示指定したフィールド (raw.product_kind 等) は推論より優先する。
 */

import { getIndustryTemplate } from '@line-crm/shared';

/** 各アダプタが吐く素の抽出結果。offer 系フィールドは構造化コネクタのみ埋める。 */
export interface RawOffer {
  name: string;
  price_yen?: number | null;
  price_min?: number | null;
  price_max?: number | null;
  price_note?: string | null;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  image_url?: string | null;
  product_url?: string | null;
  stock?: number | null;
  tags?: string[];
  // 構造化コネクタが明示的に持つ場合のみ (推論より優先)
  product_kind?: string | null;
  pricing_type?: string | null;
  cta_type?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  attributes?: Record<string, unknown> | null;
  external_id?: string | null;
  // 業種別フィールドがトップレベルに来ることがある (テンプレート key と照合して attributes へ畳む)
  [k: string]: unknown;
}

export interface NormalizeOpts {
  /** IndustryTemplate の id (UI で選ばせる)。既定値の供給源。 */
  industry?: string | null;
  /** 取得元アダプタ識別子 (shopify_public / json_ld / csv / manual 等) */
  source?: string | null;
  sourceUrl?: string | null;
  /** 取込後の状態。構造化=published、AI抽出=draft を推奨。既定 published。 */
  status?: string;
}

/** createAiProduct にそのまま渡せる正規化済みレコード (lineAccountId を除く)。 */
export interface NormalizedProductInput {
  name: string;
  sku?: string;
  description?: string;
  priceYen?: number;
  stock?: number;
  imageUrl?: string;
  productUrl?: string;
  category?: string;
  tags?: string[];
  productKind: string;
  pricingType: string;
  priceMin: number | null;
  priceMax: number | null;
  priceNote: string | null;
  ctaType: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  attributes: Record<string, unknown> | null;
  source: string | null;
  sourceUrl: string | null;
  externalId: string | null;
  status: string;
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^\d.]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function nonEmptyStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * 1 件の素の抽出結果を共通オファーモデルへ正規化する。純粋関数 (時刻・DB に依存しない)。
 */
export function normalizeToOffer(raw: RawOffer, opts: NormalizeOpts = {}): NormalizedProductInput {
  const template = getIndustryTemplate(opts.industry);

  const productKind = nonEmptyStr(raw.product_kind) ?? template?.defaultKind ?? 'physical';

  // 価格 3 値を確定
  const pMin = toInt(raw.price_min) ?? toInt(raw.price_yen);
  const pMax = toInt(raw.price_max);
  const hasPrice = pMin != null && pMin > 0;

  // pricing_type: 明示 > 幅あり=range > 価格あり=業種既定(fixed/from/subscription) > 価格不明=quote
  let pricingType = nonEmptyStr(raw.pricing_type);
  if (!pricingType) {
    if (pMin != null && pMax != null && pMax > pMin) {
      pricingType = 'range';
    } else if (hasPrice) {
      pricingType =
        template?.defaultPricing === 'subscription'
          ? 'subscription'
          : template?.defaultPricing === 'from'
            ? 'from'
            : 'fixed';
    } else {
      // 価格が取れない = 要相談扱い (美容整形の「要カウンセリング」など)
      pricingType = 'quote';
    }
  }

  const ctaType = nonEmptyStr(raw.cta_type) ?? template?.defaultCta ?? 'buy';

  // attributes: raw.attributes を土台に、テンプレート key と一致するトップレベル値を畳み込む
  const attributes: Record<string, unknown> = { ...(raw.attributes ?? {}) };
  if (template) {
    for (const f of template.fields) {
      if (attributes[f.key] === undefined && raw[f.key] !== undefined && raw[f.key] !== null && raw[f.key] !== '') {
        attributes[f.key] = raw[f.key];
      }
    }
  }
  const attrOut = Object.keys(attributes).length > 0 ? attributes : null;

  const priceYen = toInt(raw.price_yen) ?? pMin ?? undefined;

  return {
    name: String(raw.name).slice(0, 200),
    sku: nonEmptyStr(raw.sku) ?? undefined,
    description: nonEmptyStr(raw.description)?.slice(0, 1000) ?? undefined,
    priceYen: priceYen ?? undefined,
    stock: typeof raw.stock === 'number' ? raw.stock : undefined,
    imageUrl: nonEmptyStr(raw.image_url) ?? undefined,
    productUrl: nonEmptyStr(raw.product_url) ?? undefined,
    category: nonEmptyStr(raw.category)?.slice(0, 100) ?? undefined,
    tags: Array.isArray(raw.tags) && raw.tags.length > 0 ? raw.tags : undefined,
    productKind,
    pricingType,
    priceMin: pMin,
    priceMax: pMax,
    priceNote: nonEmptyStr(raw.price_note),
    ctaType,
    ctaLabel: nonEmptyStr(raw.cta_label),
    ctaUrl: nonEmptyStr(raw.cta_url),
    attributes: attrOut,
    source: nonEmptyStr(opts.source),
    sourceUrl: nonEmptyStr(opts.sourceUrl),
    externalId: nonEmptyStr(raw.external_id),
    status: opts.status ?? 'published',
  };
}
