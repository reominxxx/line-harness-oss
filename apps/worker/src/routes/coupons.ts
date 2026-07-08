/**
 * クーポン API
 *
 * 管理画面用:
 *   GET    /api/coupons             一覧 (X-Line-Account-Id)
 *   POST   /api/coupons             新規作成
 *   GET    /api/coupons/:id         詳細
 *   PATCH  /api/coupons/:id         更新
 *   DELETE /api/coupons/:id         削除
 *   POST   /api/coupons/:id/flex    Flex Message プレビュー生成
 *   GET    /api/coupons/:id/redemptions  使用履歴
 *
 * 公開エンドポイント (LIFF / 公開ページから):
 *   GET    /api/coupons/public/:id                       クーポン公開情報
 *   POST   /api/coupons/public/:id/redeem                使用記録 (friendId 必須)
 *   POST   /api/coupons/public/:id/lottery-challenge     抽選に挑戦 (friendId 必須)
 *   GET    /api/coupons/public/:id/lottery-status        抽選状態取得 (friendId 必須)
 */

import { Hono } from 'hono';
import {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  countRedemptions,
  recordRedemption,
  getCouponPublicState,
  buildCouponFlex,
  buildOfferText,
  getLineAccountById,
  type CouponStatus,
  type DiscountMode,
  type AcquisitionCondition,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';

const coupons = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? c.req.header('X-Line-Account-Id') ?? null;
}

// LIFF から渡される friendId は LINE userId ("U" + 32 文字) の場合と
// 管理画面から渡される UUID の場合がある。両方受けて friend.id (UUID) を返す。
async function resolveFriendId(db: D1Database, given: string): Promise<string | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(given)) {
    return given;
  }
  if (/^U[a-f0-9]{32}$/.test(given)) {
    const row = await db
      .prepare(`SELECT id FROM friends WHERE line_user_id = ?`)
      .bind(given)
      .first<{ id: string }>();
    return row?.id ?? null;
  }
  return null;
}

// GET /api/coupons - list
coupons.get('/api/coupons', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const status = c.req.query('status') as CouponStatus | undefined;
  const items = await listCoupons(c.env.DB, accountId, status ? { status } : undefined);
  return c.json({ success: true, items });
});

// GET /api/coupons/:id - detail
coupons.get('/api/coupons/:id', async (c) => {
  const id = c.req.param('id');
  const item = await getCoupon(c.env.DB, id);
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  const totalRedemptions = await countRedemptions(c.env.DB, id);
  return c.json({ success: true, item, totalRedemptions });
});

// POST /api/coupons - create
coupons.post('/api/coupons', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = await c.req.json<{
    name?: string;
    acquisitionCondition?: AcquisitionCondition;
    validFrom?: string;
    validTo?: string;
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
    couponType?: string;
    lotteryProbability?: number | null;
    lotteryMaxWinners?: number | null;
    // デザイン拡張
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
  }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name required' }, 400);
  if (!body.validFrom || !body.validTo) {
    return c.json({ success: false, error: 'validFrom and validTo required' }, 400);
  }
  if (new Date(body.validFrom) >= new Date(body.validTo)) {
    return c.json({ success: false, error: 'validFrom must be earlier than validTo' }, 400);
  }
  const item = await createCoupon(c.env.DB, {
    lineAccountId: accountId,
    name: body.name.trim().slice(0, 60),
    acquisitionCondition: body.acquisitionCondition,
    validFrom: body.validFrom,
    validTo: body.validTo,
    timezone: body.timezone,
    imageUrl: body.imageUrl,
    usageGuide: body.usageGuide?.slice(0, 500),
    maxUsesPerFriend: body.maxUsesPerFriend,
    showCode: body.showCode,
    codeValue: body.codeValue,
    discountMode: body.discountMode,
    discountYen: body.discountYen,
    discountPercent: body.discountPercent,
    strikethroughBefore: body.strikethroughBefore,
    strikethroughAfter: body.strikethroughAfter,
    conditionText: body.conditionText?.slice(0, 30),
    status: body.status,
    couponType: body.couponType,
    lotteryProbability: body.lotteryProbability,
    lotteryMaxWinners: body.lotteryMaxWinners,
    // デザイン拡張
    subtitle: body.subtitle?.slice(0, 40),
    templateId: body.templateId,
    brandColor: body.brandColor,
    accentColor: body.accentColor,
    buttonLabel: body.buttonLabel?.slice(0, 30),
    storeInfoJson: body.storeInfoJson,
    showRemainingDays: body.showRemainingDays,
    showLotteryRemaining: body.showLotteryRemaining,
    backgroundPattern: body.backgroundPattern,
    imagePosition: body.imagePosition,
  });
  return c.json({ success: true, item });
});

// PATCH /api/coupons/:id - update
coupons.patch('/api/coupons/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const item = await updateCoupon(c.env.DB, id, {
    name: body.name as string | undefined,
    acquisitionCondition: body.acquisitionCondition as AcquisitionCondition | undefined,
    validFrom: body.validFrom as string | undefined,
    validTo: body.validTo as string | undefined,
    timezone: body.timezone as string | undefined,
    imageUrl: body.imageUrl as string | null | undefined,
    usageGuide: body.usageGuide as string | null | undefined,
    maxUsesPerFriend: body.maxUsesPerFriend as number | undefined,
    showCode: body.showCode as boolean | undefined,
    codeValue: body.codeValue as string | null | undefined,
    discountMode: body.discountMode as DiscountMode | undefined,
    discountYen: body.discountYen as number | null | undefined,
    discountPercent: body.discountPercent as number | null | undefined,
    strikethroughBefore: body.strikethroughBefore as number | null | undefined,
    strikethroughAfter: body.strikethroughAfter as number | null | undefined,
    conditionText: body.conditionText as string | null | undefined,
    status: body.status as CouponStatus | undefined,
    couponType: body.couponType as string | undefined,
    lotteryProbability: body.lotteryProbability as number | null | undefined,
    lotteryMaxWinners: body.lotteryMaxWinners as number | null | undefined,
    // デザイン拡張
    subtitle: body.subtitle as string | null | undefined,
    templateId: body.templateId as string | null | undefined,
    brandColor: body.brandColor as string | null | undefined,
    accentColor: body.accentColor as string | null | undefined,
    buttonLabel: body.buttonLabel as string | null | undefined,
    storeInfoJson: body.storeInfoJson as string | null | undefined,
    showRemainingDays: body.showRemainingDays as boolean | undefined,
    showLotteryRemaining: body.showLotteryRemaining as boolean | undefined,
    backgroundPattern: body.backgroundPattern as string | null | undefined,
    imagePosition: body.imagePosition as string | null | undefined,
  });
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, item });
});

// DELETE /api/coupons/:id
coupons.delete('/api/coupons/:id', async (c) => {
  await deleteCoupon(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// POST /api/coupons/:id/flex - Flex Message プレビュー
coupons.post('/api/coupons/:id/flex', async (c) => {
  const id = c.req.param('id');
  const coupon = await getCoupon(c.env.DB, id);
  if (!coupon) return c.json({ success: false, error: 'not found' }, 404);
  // publicBaseUrl は顧客向けクーポン公開ページ (/c?id=...) の base URL。
  // 顧客向けページは Pages 側にあるので ADMIN_URL を使う。未設定なら worker
  // 自身を fallback (古い動作との互換) — worker /c は ADMIN_URL に 302 する。
  const url = new URL(c.req.url);
  const publicBaseUrl = c.env.ADMIN_URL || `${url.protocol}//${url.host}`;
  const flex = buildCouponFlex(coupon, publicBaseUrl);
  return c.json({ success: true, flex, offerText: buildOfferText(coupon) });
});

// GET /api/coupons/:id/redemptions - 使用履歴
coupons.get('/api/coupons/:id/redemptions', async (c) => {
  const id = c.req.param('id');
  const limit = Number(c.req.query('limit') ?? '50');
  const result = await c.env.DB
    .prepare(
      `SELECT r.id, r.coupon_id, r.friend_id, r.used_at, r.staff_id, r.note,
              f.display_name AS friend_name, f.picture_url AS friend_picture
         FROM coupon_redemptions r
         LEFT JOIN friends f ON f.id = r.friend_id
        WHERE r.coupon_id = ?
        ORDER BY r.used_at DESC
        LIMIT ?`,
    )
    .bind(id, limit)
    .all();
  return c.json({ success: true, items: result.results });
});

// GET /api/coupons/public/:id - 公開クーポン情報
coupons.get('/api/coupons/public/:id', async (c) => {
  const id = c.req.param('id');
  const rawFriendId = c.req.query('friendId');
  const coupon = await getCoupon(c.env.DB, id);
  if (!coupon) return c.json({ success: false, error: 'not found' }, 404);
  // redeem は friend.id(UUID) で使用記録を残すため、使用済み判定もUUIDで集計する。
  // LIFF からは LINE userId(U...) が来るので必ず解決してから state を出す。
  // (未解決のまま生 userId で数えると常に 0 件 → usedUp が永遠に false になり、
  //  使用後も「クーポンを使用する」ボタンが出続けるバグになる)
  const friendId = rawFriendId ? ((await resolveFriendId(c.env.DB, rawFriendId)) ?? undefined) : undefined;
  const state = await getCouponPublicState(c.env.DB, coupon, friendId);

  // 公式アカウント情報 (LINE 公式クーポン画面のヘッダー用)
  const raw = coupon as unknown as Record<string, unknown>;
  const accountId = raw.line_account_id as string | null;
  let account: { name: string; handle: string; picture_url: string | null } | null = null;
  if (accountId) {
    const acct = await c.env.DB
      .prepare(`SELECT name, display_name, basic_id, picture_url FROM line_accounts WHERE id = ?`)
      .bind(accountId)
      .first<{ name: string; display_name: string | null; basic_id: string | null; picture_url: string | null }>();
    if (acct) {
      account = {
        name: acct.display_name ?? acct.name,
        handle: acct.basic_id ? `@${acct.basic_id.replace(/^@/, '')}` : '',
        picture_url: acct.picture_url,
      };
    }
  }

  // 抽選残枠 (showLotteryRemaining=1 のときのフロント側計算用)
  let lottery_remaining: number | null = null;
  if (raw.lottery_max_winners) {
    const row = await c.env.DB
      .prepare(`SELECT COUNT(*) AS c FROM coupon_lottery_attempts WHERE coupon_id = ? AND result = 'won'`)
      .bind(coupon.id)
      .first<{ c: number }>();
    const winners = (raw.lottery_max_winners as number) - (row?.c ?? 0);
    lottery_remaining = winners > 0 ? winners : 0;
  }

  return c.json({
    success: true,
    coupon: {
      id: coupon.id,
      name: coupon.name,
      acquisition_condition: coupon.acquisition_condition,
      valid_from: coupon.valid_from,
      valid_to: coupon.valid_to,
      image_url: coupon.image_url,
      usage_guide: coupon.usage_guide,
      coupon_type: coupon.coupon_type,
      discount_mode: coupon.discount_mode,
      discount_yen: coupon.discount_yen,
      discount_percent: coupon.discount_percent,
      strikethrough_before: coupon.strikethrough_before,
      strikethrough_after: coupon.strikethrough_after,
      condition_text: coupon.condition_text,
      show_code: coupon.show_code,
      code_value: coupon.code_value,
      max_uses_per_friend: coupon.max_uses_per_friend,
      lottery_probability: coupon.lottery_probability,
      lottery_max_winners: coupon.lottery_max_winners,
      offerText: buildOfferText(coupon),
      // 新規 UI/UX フィールド
      subtitle: (raw.subtitle as string | null) ?? null,
      template_id: (raw.template_id as string | null) ?? 'simple',
      brand_color: (raw.brand_color as string | null) ?? '#06C755',
      accent_color: (raw.accent_color as string | null) ?? null,
      button_label: (raw.button_label as string | null) ?? 'クーポンを見る',
      store_info: raw.store_info_json ? safeJson(raw.store_info_json as string) : null,
      show_remaining_days: ((raw.show_remaining_days as number | null) ?? 1) === 1,
      show_lottery_remaining: ((raw.show_lottery_remaining as number | null) ?? 0) === 1,
      background_pattern: (raw.background_pattern as string | null) ?? 'none',
      image_position: (raw.image_position as string | null) ?? 'hero',
      lottery_remaining,
    },
    account,
    state,
  });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// POST /api/coupons/public/:id/redeem - 使用記録 (使用済みにする)
coupons.post('/api/coupons/public/:id/redeem', async (c) => {
  const couponId = c.req.param('id');
  const body = (await c.req.json<{ friendId?: string; note?: string }>().catch(() => ({}))) as {
    friendId?: string;
    note?: string;
  };
  if (!body.friendId) return c.json({ success: false, error: 'friendId required' }, 400);
  const resolvedFriendId = await resolveFriendId(c.env.DB, body.friendId);
  if (!resolvedFriendId) return c.json({ success: false, error: 'friend not found' }, 404);
  body.friendId = resolvedFriendId;
  const coupon = await getCoupon(c.env.DB, couponId);
  if (!coupon) return c.json({ success: false, error: 'not found' }, 404);
  const state = await getCouponPublicState(c.env.DB, coupon, body.friendId);
  if (!state.active) {
    return c.json(
      { success: false, error: 'coupon not active (expired / not started / not published)' },
      400,
    );
  }
  if (state.usedUp) return c.json({ success: false, error: 'already used up' }, 400);
  const rec = await recordRedemption(c.env.DB, {
    couponId,
    friendId: body.friendId,
    note: body.note?.slice(0, 200),
  });
  return c.json({ success: true, redemption: rec });
});

// ─────────────────────────────────────────────────────────────────────────
// 抽選クーポン挑戦エンドポイント
//   POST /api/coupons/public/:id/lottery-challenge
//
//   1 友だち = 1 抽選 (UNIQUE 制約)。再挑戦は不可。
//   結果は coupon_lottery_attempts に保存し、当選なら won、落選なら lost を返す。
// ─────────────────────────────────────────────────────────────────────────
coupons.post('/api/coupons/public/:id/lottery-challenge', async (c) => {
  const couponId = c.req.param('id');
  const body = (await c.req.json<{ friendId?: string }>().catch(() => ({}))) as {
    friendId?: string;
  };
  if (!body.friendId) return c.json({ success: false, error: 'friendId required' }, 400);
  const resolvedFriendId = await resolveFriendId(c.env.DB, body.friendId);
  if (!resolvedFriendId) return c.json({ success: false, error: 'friend not found' }, 404);
  const friendId = resolvedFriendId;

  const coupon = await getCoupon(c.env.DB, couponId);
  if (!coupon) return c.json({ success: false, error: 'not found' }, 404);
  if (coupon.acquisition_condition !== 'lottery') {
    return c.json({ success: false, error: 'not a lottery coupon' }, 400);
  }
  const now = Date.now();
  if (new Date(coupon.valid_from).getTime() > now) {
    return c.json({ success: false, error: 'coupon not started yet' }, 400);
  }
  if (new Date(coupon.valid_to).getTime() < now) {
    return c.json({ success: false, error: 'coupon expired' }, 400);
  }

  const db = c.env.DB;

  // 既存挑戦履歴チェック
  const existing = await db
    .prepare(
      `SELECT result, attempted_at FROM coupon_lottery_attempts WHERE coupon_id = ? AND friend_id = ?`,
    )
    .bind(couponId, friendId)
    .first<{ result: 'won' | 'lost'; attempted_at: string }>();
  if (existing) {
    return c.json({
      success: true,
      alreadyAttempted: true,
      result: existing.result,
      attemptedAt: existing.attempted_at,
    });
  }

  const probability = coupon.lottery_probability ?? 100;
  const maxWinners = coupon.lottery_max_winners ?? null;

  // 当選者数上限チェック
  if (maxWinners != null) {
    const winnerRow = await db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM coupon_lottery_attempts WHERE coupon_id = ? AND result = 'won'`,
      )
      .bind(couponId)
      .first<{ cnt: number }>();
    if ((winnerRow?.cnt ?? 0) >= maxWinners) {
      const roll = Math.floor(Math.random() * 100);
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO coupon_lottery_attempts (id, coupon_id, friend_id, result, probability, random_roll)
           VALUES (?, ?, ?, 'lost', ?, ?)`,
        )
        .bind(id, couponId, friendId, probability, roll)
        .run();
      return c.json({
        success: true,
        alreadyAttempted: false,
        result: 'lost',
        reason: 'max_winners_reached',
      });
    }
  }

  // 抽選: 0〜99 の整数 < probability で当選
  const roll = Math.floor(Math.random() * 100);
  const won = roll < probability;
  const result: 'won' | 'lost' = won ? 'won' : 'lost';

  const attemptId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO coupon_lottery_attempts (id, coupon_id, friend_id, result, probability, random_roll)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(attemptId, couponId, friendId, result, probability, roll)
    .run();

  // 当選時: 公式アカウントから「おめでとうございます」push 通知を送る
  if (won) {
    c.executionCtx.waitUntil(
      sendLotteryWinNotification(db, coupon.line_account_id, friendId, coupon).catch((err) => {
        console.error('[lottery] failed to send win notification', err);
      }),
    );
  }

  return c.json({
    success: true,
    alreadyAttempted: false,
    result,
    couponId,
  });
});

// 抽選当選者に push でお祝いメッセージ + クーポン LIFF へのリンクを送る
async function sendLotteryWinNotification(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  coupon: { id: string; name: string; image_url: string | null },
): Promise<void> {
  // friend.line_user_id と account.channel_access_token + liff_id を取得
  const friendRow = await db
    .prepare(`SELECT line_user_id FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ line_user_id: string }>();
  if (!friendRow?.line_user_id) return;

  const account = await getLineAccountById(db, lineAccountId);
  if (!account) return;

  const liffId = account.liff_id;
  const liffUrl = liffId
    ? `https://liff.line.me/${liffId}?liffId=${liffId}&page=coupon&id=${coupon.id}`
    : null;

  const flex: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    ...(coupon.image_url
      ? {
          hero: {
            type: 'image',
            url: coupon.image_url,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
            ...(liffUrl ? { action: { type: 'uri', uri: liffUrl } } : {}),
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: '🎉 抽選に当選しました!', weight: 'bold', size: 'lg', color: '#06C755' },
        { type: 'text', text: coupon.name, weight: 'bold', size: 'md', wrap: true },
        {
          type: 'text',
          text: '下のボタンから獲得したクーポンをチェックできます。',
          size: 'sm',
          color: '#666666',
          wrap: true,
        },
      ],
    },
    ...(liffUrl
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#06C755',
                action: { type: 'uri', label: '🎟️ クーポンを見る', uri: liffUrl },
              },
            ],
          },
        }
      : {}),
  };

  const client = new LineClient(account.channel_access_token);
  await client.pushMessage(friendRow.line_user_id, [
    {
      type: 'flex',
      altText: `🎉 抽選に当選しました!「${coupon.name}」を獲得しました`,
      contents: flex as unknown as Record<string, unknown>,
    } as unknown as Parameters<typeof client.pushMessage>[1][number],
  ]);
}

// GET /api/coupons/public/:id/lottery-status
//   特定 friend がそのクーポンを既に抽選済みかを返す(LIFF が初期表示時に呼ぶ)
coupons.get('/api/coupons/public/:id/lottery-status', async (c) => {
  const couponId = c.req.param('id');
  const friendIdRaw = c.req.query('friendId');
  if (!friendIdRaw) return c.json({ success: false, error: 'friendId required' }, 400);
  const resolvedFriendId = await resolveFriendId(c.env.DB, friendIdRaw);
  if (!resolvedFriendId) return c.json({ success: true, attempted: false });
  const row = await c.env.DB
    .prepare(
      `SELECT result, attempted_at FROM coupon_lottery_attempts WHERE coupon_id = ? AND friend_id = ?`,
    )
    .bind(couponId, resolvedFriendId)
    .first<{ result: 'won' | 'lost'; attempted_at: string }>();
  if (!row) return c.json({ success: true, attempted: false });
  return c.json({
    success: true,
    attempted: true,
    result: row.result,
    attemptedAt: row.attempted_at,
  });
});

export { coupons };
