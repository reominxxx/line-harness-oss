/**
 * エンゲージメント計測 API
 *
 * 友だちの「反応」を計測種類ごとに「誰が・いつ・何を」で一覧取得する。
 * エンゲージメント軸 (hot/warm/dormant) の集計対象になっている各ソースを、
 * 個別の操作ログとして掘り下げて見るための画面用エンドポイント。
 *
 * GET /api/engagement/events?type=&page=&pageSize=   種類別の操作ログ一覧
 *
 * type:
 *   tap            リッチメニュー / Flex ボタンのタップ (messages_log postback 系)
 *   chat           チャット返信 / スタンプ・画像 (messages_log incoming 非 postback)
 *   link           トラッキングリンク (/t/) クリック
 *   form           フォーム / リサーチ回答
 *   coupon_use     クーポン利用
 *   coupon_lottery クーポン抽選への参加
 *   cv             コンバージョン
 *
 * アカウント分離は friends.line_account_id で行う (conversion_points / tracked_links /
 * forms 等は line_account_id を持たないが、friend は 1 アカウントに属するため friend 経由で
 * 正しく絞れる)。occurred_at は表示用に 'YYYY-MM-DD HH:MM' (JST) へ整形して返す。
 * タイムスタンプ書式が table 間で異なる: UTC 列 (link_clicks.clicked_at /
 * form_submissions.created_at) は +9 hours で JST 化、JST ISO 列はそのまま整形する。
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const engagement = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

const EVENT_TYPES = [
  'tap',
  'chat',
  'link',
  'form',
  'coupon_use',
  'coupon_lottery',
  'cv',
] as const;
type EngagementEventType = (typeof EVENT_TYPES)[number];

// type ごとの一覧 SQL。バインドは [accountId, limit, offset] で共通。
function buildEventQuery(type: EngagementEventType): string {
  switch (type) {
    case 'tap':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                ml.content AS label, ml.source AS sub, ml.message_type AS messageType,
                strftime('%Y-%m-%d %H:%M', ml.created_at) AS occurredAt
              FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
              WHERE f.line_account_id = ? AND ml.direction = 'incoming'
                AND ml.source IN ('postback','open_link_postback','coupon_postback')
              ORDER BY ml.created_at DESC LIMIT ? OFFSET ?`;
    case 'chat':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                ml.content AS label, ml.source AS sub, ml.message_type AS messageType,
                strftime('%Y-%m-%d %H:%M', ml.created_at) AS occurredAt
              FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
              WHERE f.line_account_id = ? AND ml.direction = 'incoming'
                AND COALESCE(ml.source,'user') NOT IN ('postback','open_link_postback','coupon_postback')
              ORDER BY ml.created_at DESC LIMIT ? OFFSET ?`;
    case 'link':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                tl.name AS label, NULL AS sub, NULL AS messageType,
                strftime('%Y-%m-%d %H:%M', lc.clicked_at, '+9 hours') AS occurredAt
              FROM link_clicks lc JOIN friends f ON f.id = lc.friend_id
                JOIN tracked_links tl ON tl.id = lc.tracked_link_id
              WHERE f.line_account_id = ?
              ORDER BY lc.clicked_at DESC LIMIT ? OFFSET ?`;
    case 'form':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                fm.name AS label, NULL AS sub, NULL AS messageType,
                strftime('%Y-%m-%d %H:%M', fs.created_at, '+9 hours') AS occurredAt
              FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
                JOIN forms fm ON fm.id = fs.form_id
              WHERE f.line_account_id = ?
              ORDER BY fs.created_at DESC LIMIT ? OFFSET ?`;
    case 'coupon_use':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                c.name AS label, NULL AS sub, NULL AS messageType,
                strftime('%Y-%m-%d %H:%M', cr.used_at) AS occurredAt
              FROM coupon_redemptions cr JOIN friends f ON f.id = cr.friend_id
                JOIN coupons c ON c.id = cr.coupon_id
              WHERE f.line_account_id = ?
              ORDER BY cr.used_at DESC LIMIT ? OFFSET ?`;
    case 'coupon_lottery':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                c.name AS label, cla.result AS sub, NULL AS messageType,
                strftime('%Y-%m-%d %H:%M', cla.attempted_at) AS occurredAt
              FROM coupon_lottery_attempts cla JOIN friends f ON f.id = cla.friend_id
                JOIN coupons c ON c.id = cla.coupon_id
              WHERE f.line_account_id = ?
              ORDER BY cla.attempted_at DESC LIMIT ? OFFSET ?`;
    case 'cv':
      return `SELECT f.id AS friendId, f.display_name AS displayName, f.picture_url AS pictureUrl,
                cp.name AS label, cp.event_type AS sub, NULL AS messageType,
                strftime('%Y-%m-%d %H:%M', ce.created_at) AS occurredAt
              FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
                JOIN conversion_points cp ON cp.id = ce.conversion_point_id
              WHERE f.line_account_id = ?
              ORDER BY ce.created_at DESC LIMIT ? OFFSET ?`;
  }
}

engagement.get('/api/engagement/events', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);

  const type = (c.req.query('type') ?? 'tap') as EngagementEventType;
  if (!EVENT_TYPES.includes(type)) return c.json({ success: false, error: 'invalid type' }, 400);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '50', 10) || 50));
  const offset = (page - 1) * pageSize;

  // hasMore 判定のため 1 件多く取得する。
  const { results } = await c.env.DB.prepare(buildEventQuery(type))
    .bind(accountId, pageSize + 1, offset)
    .all();
  const rows = (results ?? []) as Array<Record<string, unknown>>;
  const hasMore = rows.length > pageSize;
  return c.json({ success: true, items: rows.slice(0, pageSize), hasMore });
});
