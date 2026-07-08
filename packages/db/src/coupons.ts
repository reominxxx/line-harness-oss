/**
 * クーポン管理 + Flex Message 生成
 *
 * 公式 LINE 相当のクーポン仕様を内製。
 * 配信時は coupon → Flex Message に変換して送信、顧客は LIFF / 公開ページで
 * 「クーポンを使う」ボタン押下 → coupon_redemptions に記録。
 */

import { jstNow, ensureJstOffset } from './utils.js';

export type AcquisitionCondition = 'none' | 'lottery' | 'friend_add' | 'tag_added' | 'event_book';
export type DiscountMode = 'yen' | 'percent' | 'strikethrough' | 'none';
export type CouponStatus = 'draft' | 'published' | 'archived';

export interface CouponRow {
  id: string;
  line_account_id: string;
  name: string;
  acquisition_condition: AcquisitionCondition;
  valid_from: string;
  valid_to: string;
  timezone: string;
  image_url: string | null;
  usage_guide: string | null;
  max_uses_per_friend: number;
  show_code: number;
  code_value: string | null;
  coupon_type: string;
  discount_mode: DiscountMode | null;
  discount_yen: number | null;
  discount_percent: number | null;
  strikethrough_before: number | null;
  strikethrough_after: number | null;
  condition_text: string | null;
  status: CouponStatus;
  // migration 068 で追加(抽選条件用)
  lottery_probability?: number | null;   // 1〜100 (%)
  lottery_max_winners?: number | null;   // 当選者数上限 (NULL=無制限)
  created_at: string;
  updated_at: string;
}

export interface CreateCouponInput {
  lineAccountId: string;
  name: string;
  acquisitionCondition?: AcquisitionCondition;
  validFrom: string;
  validTo: string;
  timezone?: string;
  imageUrl?: string | null;
  usageGuide?: string | null;
  maxUsesPerFriend?: number;
  showCode?: boolean;
  codeValue?: string | null;
  discountMode?: DiscountMode;
  discountYen?: number | null;
  discountPercent?: number | null;
  strikethroughBefore?: number | null;
  strikethroughAfter?: number | null;
  conditionText?: string | null;
  status?: CouponStatus;
  // 抽選条件
  couponType?: string;
  lotteryProbability?: number | null;
  lotteryMaxWinners?: number | null;
  // デザイン拡張 (migration 071)
  subtitle?: string | null;
  templateId?: string | null;
  brandColor?: string | null;
  accentColor?: string | null;
  buttonLabel?: string | null;
  storeInfoJson?: string | null;
  showRemainingDays?: boolean;
  showLotteryRemaining?: boolean;
  backgroundPattern?: string | null;
  imagePosition?: string | null;
}

export async function listCoupons(
  db: D1Database,
  lineAccountId: string,
  opts: { status?: CouponStatus } = {},
): Promise<CouponRow[]> {
  let sql = `SELECT * FROM coupons WHERE line_account_id = ?`;
  const binds: unknown[] = [lineAccountId];
  if (opts.status) {
    sql += ` AND status = ?`;
    binds.push(opts.status);
  }
  sql += ` ORDER BY updated_at DESC`;
  const result = await db.prepare(sql).bind(...binds).all<CouponRow>();
  return result.results;
}

export async function getCoupon(db: D1Database, id: string): Promise<CouponRow | null> {
  return db.prepare(`SELECT * FROM coupons WHERE id = ?`).bind(id).first<CouponRow>();
}

export async function createCoupon(db: D1Database, input: CreateCouponInput): Promise<CouponRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO coupons (
        id, line_account_id, name, acquisition_condition,
        valid_from, valid_to, timezone, image_url, usage_guide,
        max_uses_per_friend, show_code, code_value,
        coupon_type, discount_mode, discount_yen, discount_percent,
        strikethrough_before, strikethrough_after, condition_text,
        status, lottery_probability, lottery_max_winners,
        subtitle, template_id, brand_color, accent_color, button_label, store_info_json,
        show_remaining_days, show_lottery_remaining, background_pattern, image_position,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.acquisitionCondition ?? 'none',
      // 有効期間はユーザー入力。offset 無しだと Date.now() 比較で 9h ズレるため JST 明示。
      ensureJstOffset(input.validFrom),
      ensureJstOffset(input.validTo),
      input.timezone ?? 'Asia/Tokyo',
      input.imageUrl ?? null,
      input.usageGuide ?? null,
      input.maxUsesPerFriend ?? 1,
      input.showCode ? 1 : 0,
      input.codeValue ?? null,
      input.couponType ?? 'discount',
      input.discountMode ?? 'none',
      input.discountYen ?? null,
      input.discountPercent ?? null,
      input.strikethroughBefore ?? null,
      input.strikethroughAfter ?? null,
      input.conditionText ?? null,
      input.status ?? 'draft',
      input.lotteryProbability ?? null,
      input.lotteryMaxWinners ?? null,
      input.subtitle ?? null,
      input.templateId ?? 'simple',
      input.brandColor ?? '#06C755',
      input.accentColor ?? null,
      input.buttonLabel ?? 'クーポンを見る',
      input.storeInfoJson ?? null,
      input.showRemainingDays === false ? 0 : 1,
      input.showLotteryRemaining ? 1 : 0,
      input.backgroundPattern ?? 'none',
      input.imagePosition ?? 'hero',
      now,
      now,
    )
    .run();
  return (await getCoupon(db, id))!;
}

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, 'lineAccountId'>>;

export async function updateCoupon(
  db: D1Database,
  id: string,
  input: UpdateCouponInput,
): Promise<CouponRow | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, v: unknown) => {
    fields.push(`${col} = ?`);
    values.push(v as string | number | null);
  };
  if (input.name !== undefined) set('name', input.name);
  if (input.acquisitionCondition !== undefined) set('acquisition_condition', input.acquisitionCondition);
  if (input.validFrom !== undefined) set('valid_from', ensureJstOffset(input.validFrom));
  if (input.validTo !== undefined) set('valid_to', ensureJstOffset(input.validTo));
  if (input.timezone !== undefined) set('timezone', input.timezone);
  if (input.imageUrl !== undefined) set('image_url', input.imageUrl);
  if (input.usageGuide !== undefined) set('usage_guide', input.usageGuide);
  if (input.maxUsesPerFriend !== undefined) set('max_uses_per_friend', input.maxUsesPerFriend);
  if (input.showCode !== undefined) set('show_code', input.showCode ? 1 : 0);
  if (input.codeValue !== undefined) set('code_value', input.codeValue);
  if (input.discountMode !== undefined) set('discount_mode', input.discountMode);
  if (input.discountYen !== undefined) set('discount_yen', input.discountYen);
  if (input.discountPercent !== undefined) set('discount_percent', input.discountPercent);
  if (input.strikethroughBefore !== undefined) set('strikethrough_before', input.strikethroughBefore);
  if (input.strikethroughAfter !== undefined) set('strikethrough_after', input.strikethroughAfter);
  if (input.conditionText !== undefined) set('condition_text', input.conditionText);
  if (input.status !== undefined) set('status', input.status);
  if (input.couponType !== undefined) set('coupon_type', input.couponType);
  if (input.lotteryProbability !== undefined) set('lottery_probability', input.lotteryProbability);
  if (input.lotteryMaxWinners !== undefined) set('lottery_max_winners', input.lotteryMaxWinners);
  // デザイン拡張カラム
  if (input.subtitle !== undefined) set('subtitle', input.subtitle);
  if (input.templateId !== undefined) set('template_id', input.templateId);
  if (input.brandColor !== undefined) set('brand_color', input.brandColor);
  if (input.accentColor !== undefined) set('accent_color', input.accentColor);
  if (input.buttonLabel !== undefined) set('button_label', input.buttonLabel);
  if (input.storeInfoJson !== undefined) set('store_info_json', input.storeInfoJson);
  if (input.showRemainingDays !== undefined) set('show_remaining_days', input.showRemainingDays ? 1 : 0);
  if (input.showLotteryRemaining !== undefined) set('show_lottery_remaining', input.showLotteryRemaining ? 1 : 0);
  if (input.backgroundPattern !== undefined) set('background_pattern', input.backgroundPattern);
  if (input.imagePosition !== undefined) set('image_position', input.imagePosition);
  if (fields.length === 0) return await getCoupon(db, id);
  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db
    .prepare(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return await getCoupon(db, id);
}

export async function deleteCoupon(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM coupons WHERE id = ?`).bind(id).run();
}

// ---------------------------------------------------------------------------
// 使用記録
// ---------------------------------------------------------------------------

export async function countRedemptions(
  db: D1Database,
  couponId: string,
  friendId?: string,
): Promise<number> {
  if (friendId) {
    const row = await db
      .prepare(`SELECT COUNT(*) as c FROM coupon_redemptions WHERE coupon_id = ? AND friend_id = ?`)
      .bind(couponId, friendId)
      .first<{ c: number }>();
    return row?.c ?? 0;
  }
  const row = await db
    .prepare(`SELECT COUNT(*) as c FROM coupon_redemptions WHERE coupon_id = ?`)
    .bind(couponId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export interface RedemptionRow {
  id: string;
  coupon_id: string;
  friend_id: string;
  used_at: string;
  staff_id: string | null;
  note: string | null;
}

export async function recordRedemption(
  db: D1Database,
  input: { couponId: string; friendId: string; staffId?: string | null; note?: string | null },
): Promise<RedemptionRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO coupon_redemptions (id, coupon_id, friend_id, used_at, staff_id, note) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.couponId, input.friendId, now, input.staffId ?? null, input.note ?? null)
    .run();
  return {
    id,
    coupon_id: input.couponId,
    friend_id: input.friendId,
    used_at: now,
    staff_id: input.staffId ?? null,
    note: input.note ?? null,
  };
}

// ---------------------------------------------------------------------------
// クーポンの状態判定 (有効か / 使用済みか)
// ---------------------------------------------------------------------------

export interface CouponPublicState {
  active: boolean;       // 期間内 + published
  expired: boolean;
  notStarted: boolean;
  usedUp: boolean;       // 1 回限定で既に使用済み
  redemptionsByFriend: number;
}

export async function getCouponPublicState(
  db: D1Database,
  coupon: CouponRow,
  friendId?: string,
): Promise<CouponPublicState> {
  const now = new Date();
  const from = new Date(coupon.valid_from);
  const to = new Date(coupon.valid_to);
  const notStarted = now < from;
  const expired = now > to;
  const active = coupon.status === 'published' && !notStarted && !expired;
  let redemptionsByFriend = 0;
  let usedUp = false;
  if (friendId) {
    redemptionsByFriend = await countRedemptions(db, coupon.id, friendId);
    usedUp = coupon.max_uses_per_friend > 0 && redemptionsByFriend >= coupon.max_uses_per_friend;
  }
  return { active, expired, notStarted, usedUp, redemptionsByFriend };
}

// ---------------------------------------------------------------------------
// Flex Message 生成
// ---------------------------------------------------------------------------

/** クーポンの "オファー表示文字列" (Flex の本文用) */
export function buildOfferText(c: CouponRow): string {
  switch (c.discount_mode) {
    case 'yen':
      return c.discount_yen != null ? `¥${c.discount_yen.toLocaleString('ja-JP')} OFF` : 'お得なクーポン';
    case 'percent':
      return c.discount_percent != null ? `${c.discount_percent}% OFF` : 'お得なクーポン';
    case 'strikethrough':
      if (c.strikethrough_before != null && c.strikethrough_after != null) {
        return `¥${c.strikethrough_before.toLocaleString('ja-JP')} → ¥${c.strikethrough_after.toLocaleString('ja-JP')}`;
      }
      return 'お得なクーポン';
    default:
      return 'お得なクーポン';
  }
}

/**
 * クーポンを LINE 配信用 Flex Message に変換。
 * 顧客側 LIFF / 公開ページの URL: `${publicBaseUrl}/c/${coupon.id}`
 */
export function buildCouponFlex(c: CouponRow, _publicBaseUrl: string): unknown {
  const offerText = buildOfferText(c);
  const validUntil = new Date(c.valid_to).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const couponUrl = `https://liff.line.me/{{liff_id}}?liffId={{liff_id}}&page=coupon&id=${encodeURIComponent(c.id)}`;

  // 新規追加カラムを読む (古い行で NULL でも default 値にフォールバック)
  const raw = c as unknown as Record<string, unknown>;
  const brandColor = (raw.brand_color as string | undefined) || '#06C755';
  const accentColor = (raw.accent_color as string | undefined) || brandColor;
  const subtitle = raw.subtitle as string | undefined;
  const buttonLabel = (raw.button_label as string | undefined) || 'クーポンを見る';
  const template = (raw.template_id as string | undefined) || 'simple';

  // テンプレ別のスタイル指定。bold は割引額を巨大に。premium は黒背景。urgent は赤強調。
  const isBold = template === 'bold';
  const isPremium = template === 'premium';
  const isUrgent = template === 'urgent';
  const bgColor = isPremium ? '#0f172a' : undefined;
  const titleColor = isPremium ? '#f8fafc' : '#0f172a';
  const subtleColor = isPremium ? '#94a3b8' : '#9CA3AF';
  const offerColor = isUrgent ? '#dc2626' : accentColor;

  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: '🎟️ クーポン',
      size: 'xs',
      color: brandColor,
      weight: 'bold',
    },
    {
      type: 'text',
      text: c.name.slice(0, 60),
      weight: 'bold',
      size: 'lg',
      color: titleColor,
      wrap: true,
    },
  ];

  if (subtitle) {
    bodyContents.push({
      type: 'text',
      text: subtitle.slice(0, 40),
      size: 'xs',
      color: subtleColor,
      margin: 'xs',
      wrap: true,
    });
  }

  bodyContents.push({
    type: 'text',
    text: offerText,
    weight: 'bold',
    size: isBold ? '3xl' : 'xl',
    color: offerColor,
    margin: 'md',
  });

  if (c.condition_text) {
    bodyContents.push({
      type: 'text',
      text: c.condition_text.slice(0, 30),
      size: 'xs',
      color: subtleColor,
      wrap: true,
      margin: 'sm',
    });
  }

  bodyContents.push({
    type: 'text',
    text: `有効期限 〜 ${validUntil}`,
    size: 'xs',
    color: subtleColor,
    margin: 'md',
  });

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'mega',
    ...(c.image_url
      ? {
          hero: {
            type: 'image',
            url: c.image_url,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
            // LIFF へ直接 uri で飛ばす (1 タップで開ける)。LIFF SDK が friend を
            // 自動識別するので friend_id をクエリに乗せる必要がない。
            // ({{liff_id}} は配信時に renderMessageContent で実 LIFF ID へ置換)
            action: {
              type: 'uri',
              label: buttonLabel,
              uri: couponUrl,
            },
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      ...(bgColor ? { backgroundColor: bgColor } : {}),
      contents: bodyContents,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      ...(bgColor ? { backgroundColor: bgColor } : {}),
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: brandColor,
          height: 'sm',
          // LIFF へ直接 uri で飛ばす (1 タップ)。LIFF SDK が friend を自動識別するため
          // friend_id をクエリに乗せる必要がない。uri→postback 変換 (flex-postback-transform)
          // は liff.line.me を除外するので、このボタンは postback 化されず 1 タップを保つ。
          action: {
            type: 'uri',
            label: buttonLabel,
            uri: couponUrl,
          },
        },
      ],
    },
  };

  return {
    type: 'flex',
    altText: `🎟️ ${c.name.slice(0, 50)} (${offerText})`,
    contents: bubble,
  };
}
