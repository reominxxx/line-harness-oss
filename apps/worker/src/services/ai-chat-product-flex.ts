/**
 * AI 接客チャット 商品スライダー (LINE Flex Message carousel) ビルダー
 *
 * 商品の訴求は「テキスト中のリンク」では絶対に行わず、必ず画像付きの
 * 横スクロールカルーセル (スライダー) で行う。各バブルは
 *   - hero: 商品画像 (https, R2 再ホスト済を想定)
 *   - body: 商品名 / 価格 (商品説明は出さない)
 *   - footer: 商品ページへ飛ぶ「詳しく見る」ボタン (product_url がある時のみ)
 * で構成する。
 */

export interface ProductForFlex {
  id: string;
  name: string;
  price_yen: number | null;
  image_url: string | null;
  product_url: string | null;
  description: string | null;
  // --- migration 087: 汎用オファースキーマ (任意。無ければ従来表示にフォールバック) ---
  pricing_type?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  price_note?: string | null;
  cta_type?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

/**
 * 価格モデルに応じた価格表示文字列を組み立てる。
 * pricing_type が無い / fixed の場合は従来どおり price_yen を単純表示する。
 * quote(要相談) は額を出さず、free は「無料」を返す。
 */
function formatPrice(p: ProductForFlex): string | null {
  const yen = (n: number) => `¥${n.toLocaleString()}`;
  const note = p.price_note ? ` ${p.price_note}` : '';
  switch (p.pricing_type) {
    case 'quote':
      return `要相談${note}`;
    case 'free':
      return `無料${note}`;
    case 'from': {
      const base = p.price_min ?? p.price_yen;
      return typeof base === 'number' && base > 0 ? `${yen(base)}〜${note}` : null;
    }
    case 'range': {
      if (typeof p.price_min === 'number' && typeof p.price_max === 'number') {
        return `${yen(p.price_min)}〜${yen(p.price_max)}${note}`;
      }
      const base = p.price_min ?? p.price_yen;
      return typeof base === 'number' && base > 0 ? `${yen(base)}〜${note}` : null;
    }
    case 'subscription': {
      const base = p.price_min ?? p.price_yen;
      return typeof base === 'number' && base > 0 ? `${yen(base)}/月${note}` : null;
    }
    default: {
      // fixed / 未指定
      return typeof p.price_yen === 'number' && p.price_yen > 0 ? `${yen(p.price_yen)}${note}` : null;
    }
  }
}

/** cta_type ごとの既定ボタン文言 (cta_label 未指定時)。 */
const DEFAULT_CTA_LABEL: Record<string, string> = {
  buy: '購入する',
  book: '予約する',
  consult: '無料カウンセリング予約',
  inquire: 'お問い合わせ',
  none: '詳しく見る',
};

const ACCENT = '#E8643C';
/** LINE carousel は最大 12 バブルだが、接客では絞った方が選びやすい */
const MAX_BUBBLES = 8;

function isHttps(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https:\/\//i.test(url.trim());
}

function buildBubble(p: ProductForFlex): Record<string, unknown> {
  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: p.name,
      weight: 'bold',
      size: 'md',
      wrap: true,
      maxLines: 2,
    },
  ];

  const priceText = formatPrice(p);
  if (priceText) {
    bodyContents.push({
      type: 'text',
      text: priceText,
      size: 'sm',
      weight: 'bold',
      color: ACCENT,
      margin: 'sm',
      wrap: true,
    });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'none',
      contents: bodyContents,
    },
  };

  if (isHttps(p.image_url)) {
    bubble.hero = {
      type: 'image',
      url: p.image_url.trim(),
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
    };
  }

  // CTA の遷移先は cta_url を優先し、無ければ従来どおり product_url にフォールバック。
  const ctaUrl = isHttps(p.cta_url) ? p.cta_url.trim() : isHttps(p.product_url) ? p.product_url.trim() : null;
  if (ctaUrl && p.cta_type !== 'none') {
    const label = p.cta_label?.trim() || DEFAULT_CTA_LABEL[p.cta_type ?? 'buy'] || '詳しく見る';
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          color: ACCENT,
          action: {
            type: 'uri',
            label,
            uri: ctaUrl,
          },
        },
      ],
    };
  }

  return bubble;
}

/**
 * 商品配列から LINE Flex carousel の contents オブジェクトを構築する。
 * 商品が 1 件でも carousel で返す (bubble 単体と見た目はほぼ同じで、UI 上の一貫性を優先)。
 * 表示すべき商品が無い場合は null。
 */
export function buildProductCarousel(
  products: ProductForFlex[],
): { contents: Record<string, unknown>; altText: string } | null {
  const usable = products.slice(0, MAX_BUBBLES);
  if (usable.length === 0) return null;

  const bubbles = usable.map(buildBubble);
  const contents = { type: 'carousel', contents: bubbles };

  const first = usable[0]?.name ?? '商品';
  const altText =
    usable.length === 1 ? `${first}` : `${first} など ${usable.length}件のおすすめ商品`;

  return { contents, altText };
}
