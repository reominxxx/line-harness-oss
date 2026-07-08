// =============================================================================
// AI 商品 (= AI 接客が薦める「オファー」) の共通モデル定義
//
// 「商品」は物販 SKU に限定しない。物販 / 美容整形の施術プラン / 整体コース /
// 飲食メニュー / サブスク / 予約枠 を全部この 1 モデルで表現する。
// 業種ごとに異なるフィールドは attributes_json に逃がし、その「キー体系と
// 表示ラベル」を IndustryTemplate で定義する (universal escape hatch)。
//
// このファイルは web (レビュー UI / 商品編集) と worker (取込正規化 / Flex 生成)
// の両方から import される。DB のマイグレーションは 087_ai_products_offer_schema.sql。
// =============================================================================

// -----------------------------------------------------------------------------
// 種別・価格・CTA の enum (DB 列の TEXT と 1:1)
// -----------------------------------------------------------------------------

/** 種別ディスクリミネータ。DB 列 product_kind。 */
export const PRODUCT_KINDS = [
  'physical', // 物販 SKU (アパレル・雑貨・食品 等)
  'service_plan', // 施術/コース/サービスプラン (美容整形・整体・エステ 等)
  'subscription', // 継続課金 (月額会員・サブスク)
  'booking', // 予約枠 (来店予約・セッション枠)
  'digital', // デジタル商品 (オンライン講座・データ)
  'menu_item', // 飲食メニュー
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** 価格モデル。DB 列 pricing_type。 */
export const PRICING_TYPES = [
  'fixed', // 固定額
  'from', // 〜から (最低額のみ提示)
  'range', // ¥X〜¥Y の幅
  'quote', // 要相談・要カウンセリング (額を出さない)
  'subscription', // 月額
  'free', // 無料
] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

/** 次アクション種別。DB 列 cta_type。会話後に AI が促す一手。 */
export const CTA_TYPES = [
  'buy', // 購入
  'book', // 予約
  'consult', // 相談・カウンセリング
  'inquire', // 問い合わせ
  'none', // CTA なし (情報提示のみ)
] as const;
export type CtaType = (typeof CTA_TYPES)[number];

/** レビュー状態。DB 列 status。AI 接客に出すのは published のみ。 */
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** cta_type ごとのデフォルト表示文言 (cta_label 未指定時に使う)。 */
export const DEFAULT_CTA_LABELS: Record<CtaType, string> = {
  buy: '購入する',
  book: '予約する',
  consult: '無料カウンセリング予約',
  inquire: 'お問い合わせ',
  none: '詳しく見る',
};

// -----------------------------------------------------------------------------
// 業種別属性テンプレート
// -----------------------------------------------------------------------------

/** attributes_json 内の 1 フィールドの定義。 */
export interface AttributeField {
  /** attributes_json 内のキー (英小文字スネーク) */
  key: string;
  /** レビュー UI / 接客での表示ラベル */
  label: string;
  /** 入力・表示の型 */
  type: 'text' | 'number' | 'boolean' | 'duration' | 'list';
  /** 数値・時間の単位 ("分" "回" "円" 等) */
  unit?: string;
  /** AI 抽出プロンプトに渡すヒント (この業種でこの語をどう解釈するか) */
  hint?: string;
  /** AI 接客のスライダー本文にこのフィールドを出すか (絞らないと Flex が煩雑になる) */
  showInFlex?: boolean;
}

/** 1 業種のテンプレート。取込正規化・レビュー UI・接客表示の共通定義。 */
export interface IndustryTemplate {
  /** テンプレート識別子 (英小文字スネーク) */
  id: string;
  /** 表示名 */
  label: string;
  /** この業種の既定 product_kind */
  defaultKind: ProductKind;
  /** この業種の既定 pricing_type */
  defaultPricing: PricingType;
  /** この業種の既定 cta_type */
  defaultCta: CtaType;
  /** 業種別の属性フィールド群 */
  fields: AttributeField[];
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'beauty_clinic',
    label: '美容整形・美容皮膚科',
    defaultKind: 'service_plan',
    defaultPricing: 'from',
    defaultCta: 'consult',
    fields: [
      { key: 'body_area', label: '施術部位', type: 'text', hint: '鼻・目・輪郭など', showInFlex: true },
      { key: 'downtime', label: 'ダウンタイム', type: 'text', unit: '日', hint: '腫れ・内出血が引くまでの目安' },
      { key: 'anesthesia', label: '麻酔', type: 'text', hint: '局所・静脈・笑気など' },
      { key: 'sessions', label: '推奨回数', type: 'number', unit: '回' },
      { key: 'duration_min', label: '施術時間', type: 'number', unit: '分' },
      { key: 'risks', label: 'リスク・副作用', type: 'text', hint: '説明義務のある副作用' },
    ],
  },
  {
    id: 'beauty_salon',
    label: 'エステ・美容サロン',
    defaultKind: 'service_plan',
    defaultPricing: 'fixed',
    defaultCta: 'book',
    fields: [
      { key: 'menu_area', label: '施術部位・メニュー', type: 'text', showInFlex: true },
      { key: 'duration_min', label: '所要時間', type: 'number', unit: '分', showInFlex: true },
      { key: 'course_count', label: '回数券', type: 'number', unit: '回' },
      { key: 'first_time_price', label: '初回価格', type: 'number', unit: '円' },
    ],
  },
  {
    id: 'chiropractic',
    label: '整体・整骨・カイロ',
    defaultKind: 'service_plan',
    defaultPricing: 'fixed',
    defaultCta: 'book',
    fields: [
      { key: 'symptom', label: '対応症状', type: 'text', hint: '腰痛・肩こり・骨盤矯正など', showInFlex: true },
      { key: 'duration_min', label: '施術時間', type: 'number', unit: '分', showInFlex: true },
      { key: 'course_count', label: '回数券', type: 'number', unit: '回' },
    ],
  },
  {
    id: 'restaurant',
    label: '飲食店メニュー',
    defaultKind: 'menu_item',
    defaultPricing: 'fixed',
    defaultCta: 'book',
    fields: [
      { key: 'menu_category', label: 'カテゴリ', type: 'text', hint: '前菜・メイン・ドリンクなど', showInFlex: true },
      { key: 'allergens', label: 'アレルゲン', type: 'list' },
      { key: 'spicy', label: '辛さ', type: 'text' },
      { key: 'vegetarian', label: 'ベジ対応', type: 'boolean' },
    ],
  },
  {
    id: 'apparel',
    label: 'アパレル',
    defaultKind: 'physical',
    defaultPricing: 'fixed',
    defaultCta: 'buy',
    fields: [
      { key: 'sizes', label: 'サイズ展開', type: 'list', showInFlex: true },
      { key: 'colors', label: 'カラー', type: 'list' },
      { key: 'material', label: '素材', type: 'text' },
      { key: 'gender', label: '対象', type: 'text', hint: 'メンズ・レディース・ユニセックス' },
    ],
  },
  {
    id: 'retail',
    label: '物販・EC (汎用)',
    defaultKind: 'physical',
    defaultPricing: 'fixed',
    defaultCta: 'buy',
    fields: [
      { key: 'brand', label: 'ブランド', type: 'text' },
      { key: 'spec', label: '仕様・スペック', type: 'text' },
      { key: 'warranty', label: '保証', type: 'text' },
    ],
  },
  {
    id: 'subscription_course',
    label: 'サブスク・オンライン講座',
    defaultKind: 'subscription',
    defaultPricing: 'subscription',
    defaultCta: 'inquire',
    fields: [
      { key: 'billing_cycle', label: '課金周期', type: 'text', hint: '月額・年額', showInFlex: true },
      { key: 'trial', label: '無料トライアル', type: 'text' },
      { key: 'contents', label: '含まれる内容', type: 'text' },
    ],
  },
];

/** id から業種テンプレートを引く。 */
export function getIndustryTemplate(id: string | null | undefined): IndustryTemplate | undefined {
  if (!id) return undefined;
  return INDUSTRY_TEMPLATES.find((t) => t.id === id);
}
