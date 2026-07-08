/**
 * カード型メッセージ (公式 LINE 風 Flex Carousel)
 *
 * UI 側で 1〜12 枚のカードを GUI 編集 → cards_json に保存。
 * 配信時は flex_json (= Flex Message JSON) を生成して messageType='flex' で送信する。
 */

import { jstNow } from './utils.js';

export type CardType = 'product' | 'location' | 'person' | 'image';
export type ActionType = 'uri' | 'message';

export interface CardAction {
  /** ボタンに表示するラベル (15字まで) */
  label: string;
  /** URL リンク (uri) または送信メッセージ (message)。公式の "クーポン/ショップカード/リサーチ" も URL タイプとして扱う */
  type: ActionType;
  /** URI の場合: URL。message の場合: 送信するテキスト */
  data: string;
}

export interface CardItem {
  /** 表示用タグ (12字まで)。空なら表示しない */
  tagLabel?: string;
  /** タグ色 (6色): default/white/red/brown/green/blue */
  tagColor?: string;
  /** カード本体の画像 URL */
  imageUrl?: string;
  /** タイトル (20字まで) */
  title?: string;
  /** 説明文 (60字まで) */
  description?: string;
  /** 価格表示 (15字まで)。¥1,200 や $50 など */
  price?: string;
  /** 住所 (location 用、60字まで) */
  address?: string;
  /** 追加情報 (location 用、種別 + 30字まで)。例: 時間 / 営業時間 */
  extraInfoType?: string;
  extraInfo?: string;
  /** パーソン用: 名前 (20字まで) */
  personName?: string;
  /** タグ 2〜3 (person 用、計 3 個まで) */
  tagLabel2?: string;
  tagColor2?: string;
  tagLabel3?: string;
  tagColor3?: string;
  /** クリック時アクション 1〜2 */
  actions: CardAction[];
}

export interface CardMessageRow {
  id: string;
  line_account_id: string;
  name: string;
  card_type: CardType;
  cards_json: string;
  flex_json: string | null;
  alt_text: string | null;
  more_card_json?: string | null;
  created_at: string;
  updated_at: string;
}

/** もっと見るカード設定。アクション 1 つだけ持つシンプルカード。 */
export interface MoreCardConfig {
  /** ボタンに表示するラベル(例: もっと見る) */
  label: string;
  /** アクションタイプ */
  actionType: 'uri' | 'message' | 'coupon' | 'research';
  /** タップ時のデータ (URL / メッセージテキスト / クーポン URL / リサーチ URL) */
  data: string;
}

export interface CardMessageWithCards extends Omit<CardMessageRow, 'cards_json' | 'more_card_json'> {
  cards: CardItem[];
  moreCard?: MoreCardConfig | null;
}

function parseCards(row: CardMessageRow): CardMessageWithCards {
  let cards: CardItem[] = [];
  try { cards = JSON.parse(row.cards_json); } catch { /* invalid */ }
  let moreCard: MoreCardConfig | null = null;
  if (row.more_card_json) {
    try { moreCard = JSON.parse(row.more_card_json) as MoreCardConfig; } catch { /* invalid */ }
  }
  return {
    id: row.id,
    line_account_id: row.line_account_id,
    name: row.name,
    card_type: row.card_type,
    flex_json: row.flex_json,
    alt_text: row.alt_text,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cards,
    moreCard,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listCardMessages(
  db: D1Database,
  lineAccountId: string,
): Promise<CardMessageWithCards[]> {
  const result = await db
    .prepare(`SELECT * FROM card_messages WHERE line_account_id = ? ORDER BY updated_at DESC`)
    .bind(lineAccountId)
    .all<CardMessageRow>();
  return result.results.map(parseCards);
}

export async function getCardMessage(
  db: D1Database,
  id: string,
): Promise<CardMessageWithCards | null> {
  const row = await db
    .prepare(`SELECT * FROM card_messages WHERE id = ?`)
    .bind(id)
    .first<CardMessageRow>();
  return row ? parseCards(row) : null;
}

export interface CreateCardMessageInput {
  lineAccountId: string;
  name: string;
  cardType: CardType;
  cards: CardItem[];
  altText?: string;
  moreCard?: MoreCardConfig | null;
}

export async function createCardMessage(
  db: D1Database,
  input: CreateCardMessageInput,
): Promise<CardMessageWithCards> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const cardsJson = JSON.stringify(input.cards);
  const moreCardJson = input.moreCard ? JSON.stringify(input.moreCard) : null;
  const flexJson = JSON.stringify(
    buildFlexCarousel(input.cardType, input.cards, input.altText ?? input.name, input.moreCard ?? null),
  );
  await db
    .prepare(
      `INSERT INTO card_messages (id, line_account_id, name, card_type, cards_json, flex_json, alt_text, more_card_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.cardType,
      cardsJson,
      flexJson,
      input.altText ?? null,
      moreCardJson,
      now,
      now,
    )
    .run();
  return (await getCardMessage(db, id))!;
}

export interface UpdateCardMessageInput {
  name?: string;
  cardType?: CardType;
  cards?: CardItem[];
  altText?: string | null;
  moreCard?: MoreCardConfig | null;
}

export async function updateCardMessage(
  db: D1Database,
  id: string,
  input: UpdateCardMessageInput,
): Promise<CardMessageWithCards | null> {
  const existing = await getCardMessage(db, id);
  if (!existing) return null;
  const cardType = input.cardType ?? existing.card_type;
  const cards = input.cards ?? existing.cards;
  const name = input.name ?? existing.name;
  const altText = input.altText === undefined ? existing.alt_text : input.altText;
  const moreCard = input.moreCard === undefined ? (existing.moreCard ?? null) : input.moreCard;
  const moreCardJson = moreCard ? JSON.stringify(moreCard) : null;
  const flexJson = JSON.stringify(buildFlexCarousel(cardType, cards, altText ?? name, moreCard));
  await db
    .prepare(
      `UPDATE card_messages
       SET name = ?, card_type = ?, cards_json = ?, flex_json = ?, alt_text = ?, more_card_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(name, cardType, JSON.stringify(cards), flexJson, altText, moreCardJson, jstNow(), id)
    .run();
  return await getCardMessage(db, id);
}

export async function deleteCardMessage(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM card_messages WHERE id = ?`).bind(id).run();
}

// ---------------------------------------------------------------------------
// Flex Carousel 生成
// ---------------------------------------------------------------------------

const TAG_COLOR_BG: Record<string, string> = {
  default: '#6B7280',  // gray
  white: '#FFFFFF',
  red: '#EF4444',
  brown: '#A16207',
  green: '#10B981',
  blue: '#3B82F6',
};
const TAG_COLOR_FG: Record<string, string> = {
  default: '#FFFFFF',
  white: '#111827',
  red: '#FFFFFF',
  brown: '#FFFFFF',
  green: '#FFFFFF',
  blue: '#FFFFFF',
};

function actionToFlex(a: CardAction) {
  if (a.type === 'message') {
    return { type: 'message', label: a.label.slice(0, 20), text: a.data };
  }
  return { type: 'uri', label: a.label.slice(0, 20), uri: a.data };
}

function buildTagBox(label: string, color: string) {
  return {
    type: 'box',
    layout: 'baseline',
    position: 'absolute',
    offsetTop: '12px',
    offsetStart: '12px',
    backgroundColor: TAG_COLOR_BG[color] ?? TAG_COLOR_BG.default,
    cornerRadius: '4px',
    paddingAll: '4px',
    paddingStart: '8px',
    paddingEnd: '8px',
    contents: [
      {
        type: 'text',
        text: label.slice(0, 12),
        size: 'xs',
        color: TAG_COLOR_FG[color] ?? '#FFFFFF',
        weight: 'bold',
      },
    ],
  };
}

function buildProductBubble(card: CardItem) {
  const heroContents: unknown[] = [];
  if (card.tagLabel) heroContents.push(buildTagBox(card.tagLabel, card.tagColor ?? 'default'));

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    ...(card.imageUrl
      ? {
          hero: {
            type: 'image',
            url: card.imageUrl,
            size: 'full',
            aspectRatio: '1:1',
            aspectMode: 'cover',
            ...(heroContents.length > 0 ? {} : {}),
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(card.title
          ? [{ type: 'text', text: card.title.slice(0, 20), weight: 'bold', size: 'md', wrap: true }]
          : []),
        ...(card.description
          ? [{ type: 'text', text: card.description.slice(0, 60), size: 'xs', color: '#6B7280', wrap: true }]
          : []),
        ...(card.price
          ? [{ type: 'text', text: card.price.slice(0, 15), size: 'lg', weight: 'bold', align: 'end', margin: 'md' }]
          : []),
      ],
    },
    ...(card.actions && card.actions.length > 0
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: card.actions.slice(0, 2).map((a) => ({
              type: 'button',
              style: 'link',
              height: 'sm',
              action: actionToFlex(a),
            })),
          },
        }
      : {}),
  };
  return bubble;
}

function buildLocationBubble(card: CardItem) {
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    ...(card.imageUrl
      ? { hero: { type: 'image', url: card.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' } }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(card.title
          ? [{ type: 'text', text: card.title.slice(0, 20), weight: 'bold', size: 'md', wrap: true }]
          : []),
        ...(card.address
          ? [{
              type: 'box',
              layout: 'baseline',
              spacing: 'xs',
              contents: [
                { type: 'icon', url: 'https://api.line-port.com/_blank.png', size: 'xs' },
                { type: 'text', text: '📍 ' + card.address.slice(0, 60), size: 'xs', color: '#6B7280', wrap: true, flex: 0 },
              ],
            }]
          : []),
        ...(card.extraInfo
          ? [{ type: 'text', text: '🕐 ' + card.extraInfo.slice(0, 30), size: 'xs', color: '#6B7280' }]
          : []),
      ],
    },
    ...(card.actions && card.actions.length > 0
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: card.actions.slice(0, 2).map((a) => ({
              type: 'button',
              style: 'link',
              height: 'sm',
              action: actionToFlex(a),
            })),
          },
        }
      : {}),
  };
  return bubble;
}

function buildPersonBubble(card: CardItem) {
  const tags = [
    card.tagLabel && { label: card.tagLabel, color: card.tagColor ?? 'default' },
    card.tagLabel2 && { label: card.tagLabel2, color: card.tagColor2 ?? 'default' },
    card.tagLabel3 && { label: card.tagLabel3, color: card.tagColor3 ?? 'default' },
  ].filter(Boolean) as Array<{ label: string; color: string }>;

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...(card.imageUrl
          ? [{
              type: 'image',
              url: card.imageUrl,
              size: '120px',
              aspectMode: 'cover',
              aspectRatio: '1:1',
              align: 'center',
              gravity: 'center',
            }]
          : []),
        ...(card.personName
          ? [{ type: 'text', text: card.personName.slice(0, 20), weight: 'bold', size: 'md', align: 'center', wrap: true }]
          : []),
        ...(tags.length > 0
          ? [{
              type: 'box',
              layout: 'horizontal',
              spacing: 'xs',
              justifyContent: 'center',
              contents: tags.map((t) => ({
                type: 'text',
                text: t.label.slice(0, 12),
                size: 'xxs',
                color: TAG_COLOR_FG[t.color] ?? '#FFFFFF',
                weight: 'bold',
                align: 'center',
                backgroundColor: TAG_COLOR_BG[t.color] ?? TAG_COLOR_BG.default,
                flex: 0,
              })),
            }]
          : []),
        ...(card.description
          ? [{ type: 'text', text: card.description.slice(0, 60), size: 'xs', color: '#6B7280', wrap: true, align: 'center' }]
          : []),
      ],
    },
    ...(card.actions && card.actions.length > 0
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: card.actions.slice(0, 2).map((a) => ({
              type: 'button',
              style: 'link',
              height: 'sm',
              action: actionToFlex(a),
            })),
          },
        }
      : {}),
  };
  return bubble;
}

function buildImageBubble(card: CardItem) {
  // image タイプは画像 + アクションのみ
  if (!card.imageUrl) {
    return {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: '(画像未設定)', size: 'sm', color: '#9CA3AF', align: 'center' }],
      },
    };
  }
  const action = card.actions && card.actions[0] ? actionToFlex(card.actions[0]) : undefined;
  const heroContents: unknown[] = [];
  if (card.tagLabel) heroContents.push(buildTagBox(card.tagLabel, card.tagColor ?? 'default'));

  return {
    type: 'bubble',
    size: 'kilo',
    hero: {
      type: 'image',
      url: card.imageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'cover',
      ...(action ? { action } : {}),
    },
    ...(card.actions && card.actions.length > 0
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: card.actions.slice(0, 2).map((a) => ({
              type: 'button',
              style: 'link',
              height: 'sm',
              action: actionToFlex(a),
            })),
          },
        }
      : {}),
  };
}

/**
 * 4種類のカードタイプから Flex Carousel JSON を生成。
 * 配信時はこれを LINE Messaging API の flex タイプとして送信する。
 */
export function buildFlexCarousel(
  cardType: CardType,
  cards: CardItem[],
  altText: string,
  moreCard?: MoreCardConfig | null,
): unknown {
  const builder = {
    product: buildProductBubble,
    location: buildLocationBubble,
    person: buildPersonBubble,
    image: buildImageBubble,
  }[cardType];
  // LINE のカルーセルは bubble 最大 12 枚。もっと見るカードを使う場合は 11 + 1。
  const max = moreCard ? 11 : 12;
  const bubbles: unknown[] = cards.slice(0, max).map(builder);
  if (moreCard) {
    bubbles.push(buildMoreCardBubble(moreCard));
  }
  return {
    type: 'flex',
    altText: altText.slice(0, 400) || 'カード型メッセージ',
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  };
}

/** もっと見るカード(末尾の追加カード)を Flex bubble に変換 */
function buildMoreCardBubble(more: MoreCardConfig): unknown {
  // LINE Flex の action オブジェクトに変換
  const action = (() => {
    switch (more.actionType) {
      case 'message':
        return { type: 'message', label: more.label || 'もっと見る', text: more.data || more.label };
      case 'uri':
      case 'coupon':
      case 'research':
      default:
        return { type: 'uri', label: more.label || 'もっと見る', uri: more.data || 'https://line.me' };
    }
  })();
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      justifyContent: 'center',
      alignItems: 'center',
      contents: [
        {
          type: 'text',
          text: more.label || 'もっと見る',
          weight: 'bold',
          size: 'md',
          color: '#06C755',
          align: 'center',
          gravity: 'center',
          action,
        },
      ],
      action,
    },
  };
}
