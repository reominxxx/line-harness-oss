import { Hono } from 'hono';
import {
  getBroadcasts,
  getBroadcastById,
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
} from '@line-crm/db';
import type { Broadcast as DbBroadcast, BroadcastMessageType, BroadcastTargetType } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { processBroadcastSend, buildMessage, processQueuedBroadcasts } from '../services/broadcast.js';
import { QuotaExceededError, assertWithinQuota } from '../services/quota-guard.js';
import { computeDedupBroadcastPreview } from '../services/dedup-broadcast.js';
import { processSegmentSend } from '../services/segment-send.js';
import type { SegmentCondition } from '../services/segment-query.js';
import { parseEngagementSegmentId, engagementCondition } from '../services/engagement.js';
import { getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';

const broadcasts = new Hono<Env>();

/**
 * セグメント配信の宛先解決クエリを組み立てる。
 *
 * segmentTagIds には 2 種類が混在しうる:
 *   - `engagement:hot|warm|dormant` … DB 非保存の仮想セグメント。
 *     直近30日の反応回数を SQL でその場算出して判定する (engagement.ts)。
 *   - それ以外 (UUID) … friend_segment_tags に保存された実セグメント。
 *
 * 両者を AND で掛け合わせる。実セグメントは「指定タグを全て持つ友だち」=
 * COUNT(DISTINCT segment_tag_id) = タグ数 の交差集合。エンゲージメントは
 * friends 行に対する真偽条件を AND で足す。
 *
 * 返り値の SQL は `FROM friends f WHERE ...` を前提に、SELECT 句だけ差し替えて
 * 件数取得 / 宛先取得の両方で使い回せるよう {whereSql, binds} を返す。
 */
function buildSegmentRecipientWhere(
  segmentTagIds: string[],
  accountId: string,
): { whereSql: string; binds: unknown[] } {
  const engagementLevels: Array<'hot' | 'warm' | 'light' | 'dormant'> = [];
  const realIds: string[] = [];
  for (const id of segmentTagIds) {
    const level = parseEngagementSegmentId(id);
    if (level) engagementLevels.push(level);
    else realIds.push(id);
  }

  const conditions: string[] = ['f.line_account_id = ?', 'f.is_following = 1'];
  const binds: unknown[] = [accountId];

  if (realIds.length > 0) {
    const placeholders = realIds.map(() => '?').join(',');
    conditions.push(
      `f.id IN (
         SELECT fst.friend_id FROM friend_segment_tags fst
          WHERE fst.segment_tag_id IN (${placeholders})
            AND fst.line_account_id = ?
          GROUP BY fst.friend_id
         HAVING COUNT(DISTINCT fst.segment_tag_id) = ?
       )`,
    );
    binds.push(...realIds, accountId, realIds.length);
  }

  for (const level of engagementLevels) {
    conditions.push(engagementCondition(level, 'f'));
  }

  return { whereSql: `WHERE ${conditions.join(' AND ')}`, binds };
}

/**
 * Parse a D1 JSON-array column. Returns:
 *   - null if the column is null/undefined/empty string or parse fails
 *   - the value as-is if already an array (some D1 drivers auto-parse JSON columns)
 *   - the parsed array if the JSON is a valid string-array
 *   - null if parsed JSON is not an array (e.g., object, scalar)
 */
function parseJsonArray(s: unknown): string[] | null {
  if (!s) return null;
  if (Array.isArray(s)) return s as string[];
  if (typeof s !== 'string') return null;
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function serializeBroadcast(row: DbBroadcast) {
  const r = row as unknown as Record<string, unknown>;
  return {
    id: row.id,
    title: row.title,
    messageType: row.message_type,
    messageContent: row.message_content,
    targetType: row.target_type,
    targetTagId: row.target_tag_id,
    targetSegmentTagId: (row as unknown as Record<string, unknown>).target_segment_tag_id as string | null ?? null,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    totalCount: row.total_count,
    successCount: row.success_count,
    lineRequestId: r.line_request_id || null,
    aggregationUnit: r.aggregation_unit || null,
    lineAccountId: r.line_account_id || null,
    accountIds: parseJsonArray(r.account_ids),
    dedupPriority: parseJsonArray(r.dedup_priority),
    failedAccountIds: parseJsonArray(r.failed_account_ids),
    segmentConditions: (r.segment_conditions as string | null) ?? null,
    createdAt: row.created_at,
  };
}

// =========================================================================
// POST /api/broadcasts/multi-segment-send
//   複数セグメント(タグ)を AND で結合し、共通する友だち全員に即時 multicast 配信する。
//   通常の broadcast は targetTagId が単一指定だが、こちらは
//   「50代 ∧ 東京 ∧ 顔の悩みあり」のような交差集合配信を想定している。
//   送信先は LINE Messaging API multicast(1 リクエスト最大 500 件)に
//   500 件ずつ chunk して送る。レスポンスでは送信成功 / 失敗数を返す。
// =========================================================================
broadcasts.post('/api/broadcasts/multi-segment-send', async (c) => {
  try {
    const body = await c.req.json<{
      accountId: string;
      segmentTagIds: string[];
      messageType: 'text' | 'flex' | 'image';
      messageContent: string; // text の場合はそのまま、flex/image は JSON 文字列
      title?: string;
    }>();

    if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);
    if (!Array.isArray(body.segmentTagIds) || body.segmentTagIds.length === 0) {
      return c.json({ success: false, error: 'segmentTagIds required' }, 400);
    }
    if (!body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'messageType / messageContent required' }, 400);
    }

    const db = c.env.DB;

    // ─── 1. AND で対象友だち抽出 ─────────────────────────────────
    // リサーチ回答セグメント (friend_segment_tags) と仮想エンゲージメント
    // セグメント (engagement:hot/warm/dormant) を AND で掛け合わせる。
    const { whereSql, binds } = buildSegmentRecipientWhere(body.segmentTagIds, body.accountId);
    const intersectRows = await db
      .prepare(`SELECT f.id AS friend_id, f.line_user_id FROM friends f ${whereSql}`)
      .bind(...binds)
      .all<{ friend_id: string; line_user_id: string }>();

    const targets = intersectRows.results.filter((r) => r.line_user_id);
    if (targets.length === 0) {
      return c.json({ success: true, sent: 0, failed: 0, total: 0 });
    }

    // ─── 2. アカウントのアクセストークン取得 ───────────────────
    const account = await getLineAccountById(db, body.accountId);
    if (!account) return c.json({ success: false, error: 'account not found' }, 404);
    const lineClient = new LineClient(account.channel_access_token);

    // ─── 3. メッセージを LINE Messaging API 仕様の Message[] に変換 ──
    const messages = (() => {
      try {
        return [buildMessage(body.messageType, body.messageContent)];
      } catch (err) {
        console.error('buildMessage failed', err);
        return null;
      }
    })();
    if (!messages) return c.json({ success: false, error: 'invalid messageContent' }, 400);

    // ─── 配信上限ガード: 送信予定数が残枠を超えるなら送信前に止める ──
    try {
      await assertWithinQuota(lineClient, targets.length);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return c.json({ success: false, error: err.message }, 429);
      }
      throw err;
    }

    // ─── 4. 500 件ずつ chunk して multicast ─────────────────────
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const CHUNK = 500;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const slice = targets.slice(i, i + CHUNK);
      const userIds = slice.map((r) => r.line_user_id);
      try {
        await lineClient.multicast(userIds, messages);
        sent += userIds.length;
      } catch (err) {
        failed += userIds.length;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        console.error('multicast chunk failed', i, msg);
      }
    }

    return c.json({
      success: true,
      sent,
      failed,
      total: targets.length,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    });
  } catch (err) {
    console.error('POST /api/broadcasts/multi-segment-send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/multi-segment-preview
// 対象人数のみを返す軽量エンドポイント(配信前のプレビュー用)
broadcasts.post('/api/broadcasts/multi-segment-preview', async (c) => {
  try {
    const body = await c.req.json<{ accountId: string; segmentTagIds: string[] }>();
    if (!body.accountId || !Array.isArray(body.segmentTagIds) || body.segmentTagIds.length === 0) {
      return c.json({ success: false, error: 'accountId / segmentTagIds required' }, 400);
    }
    const { whereSql, binds } = buildSegmentRecipientWhere(body.segmentTagIds, body.accountId);
    const row = await c.env.DB
      .prepare(`SELECT COUNT(*) AS count FROM friends f ${whereSql}`)
      .bind(...binds)
      .first<{ count: number }>();
    return c.json({ success: true, count: row?.count ?? 0 });
  } catch (err) {
    console.error('POST /api/broadcasts/multi-segment-preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts - list all
broadcasts.get('/api/broadcasts', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const items = await getBroadcasts(c.env.DB, lineAccountId || undefined);
    return c.json({ success: true, data: items.map(serializeBroadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id - get single
broadcasts.get('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);

    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/related-messages — 配信後 24h の応答チャット履歴
//
// 顧客画面の配信履歴で「この配信後にお客様がどう反応したか」を見るため、
// 該当配信を受け取った友だち群が 24h 以内に交わしたメッセージを時系列で返す。
// 配信本体 (broadcast_id 付き outgoing) は除外し、incoming と AI 応答 (broadcast_id NULL の outgoing)
// だけを集める。
broadcasts.get('/api/broadcasts/:id/related-messages', async (c) => {
  try {
    const id = c.req.param('id');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    // 配信時刻が無いと境界が決まらないので draft/scheduled は空で返す
    const sentAtRaw = broadcast.sent_at ?? broadcast.scheduled_at;
    if (!sentAtRaw) {
      return c.json({ success: true, data: { messages: [], baseAt: null } });
    }

    // 配信を実際に受け取った friend_id 群 (messages_log の broadcast_id 経由)
    // 関連メッセージはこの friend 群の sent_at 以降 24h 以内の incoming + 通常 outgoing
    const sql = `
      WITH targets AS (
        SELECT DISTINCT friend_id FROM messages_log
        WHERE broadcast_id = ? AND direction = 'outgoing'
      )
      SELECT ml.id, ml.friend_id, ml.direction, ml.message_type, ml.content,
             ml.broadcast_id, ml.source, ml.created_at,
             f.display_name, f.picture_url
      FROM messages_log ml
      LEFT JOIN friends f ON f.id = ml.friend_id
      WHERE ml.friend_id IN (SELECT friend_id FROM targets)
        AND ml.created_at >= ?
        AND ml.created_at < datetime(?, '+1 day')
        AND ml.broadcast_id IS NULL
      ORDER BY ml.created_at ASC
      LIMIT ?
    `;
    const result = await c.env.DB.prepare(sql)
      .bind(id, sentAtRaw, sentAtRaw, limit)
      .all<{
        id: string;
        friend_id: string;
        direction: 'incoming' | 'outgoing';
        message_type: string;
        content: string;
        broadcast_id: string | null;
        source: string | null;
        created_at: string;
        display_name: string | null;
        picture_url: string | null;
      }>();

    return c.json({
      success: true,
      data: {
        baseAt: sentAtRaw,
        messages: result.results.map((m) => ({
          id: m.id,
          friendId: m.friend_id,
          friendName: m.display_name,
          friendPictureUrl: m.picture_url,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          source: m.source,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/related-messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/preview-count — 送信前の対象人数を計算する。
// draft 状態の broadcast に対し、send 確認モーダルで「対象 X人」を表示するために使う。
// target_type ごとに使う SQL を切り替える。total_count は send 後にしか入らないので、
// このエンドポイントが「送ったらこの人数」を返す唯一の手段。
broadcasts.get('/api/broadcasts/:id/preview-count', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    const raw = broadcast as unknown as Record<string, unknown>;
    let count = 0;
    let perAccount: Array<{ accountId: string; sendCount: number }> | undefined;

    // segment_conditions が設定されていれば、target_type を上書きして条件ベースで集計する。
    // multi-account-dedup は dedup ロジックを通す必要があるため除外。
    const segConds = raw.segment_conditions as string | null;
    if (segConds && broadcast.target_type !== 'multi-account-dedup') {
      try {
        const { buildSegmentQuery } = await import('../services/segment-query.js');
        const { sql, bindings } = buildSegmentQuery(JSON.parse(segConds) as SegmentCondition);
        const accountId = (raw.line_account_id as string | null) || null;
        let accountSql = sql;
        const accountBindings = [...bindings];
        if (accountId) {
          accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
          accountBindings.unshift(accountId);
        }
        const countSql = accountSql.replace(/^SELECT .+ FROM/, 'SELECT COUNT(*) as cnt FROM');
        const row = await c.env.DB.prepare(countSql).bind(...accountBindings).first<{ cnt: number }>();
        count = row?.cnt ?? 0;
      } catch (err) {
        console.warn('preview-count: segment_conditions parse failed, falling back to target_type', err);
      }
      return c.json({ success: true, data: { count, perAccount } });
    }

    if (broadcast.target_type === 'multi-account-dedup') {
      const accountIds = parseJsonArray(raw.account_ids) ?? [];
      const dedupPriority = parseJsonArray(raw.dedup_priority) ?? [];
      const preview = await computeDedupBroadcastPreview(
        c.env.DB,
        accountIds,
        dedupPriority,
        broadcast.target_tag_id ?? null,
      );
      // /send パスと同じく inactive/missing アカウントを除外して、実送信数の見積りを返す。
      // 同時に per-account breakdown も返して confirm modal に表示できるようにする。
      const { getLineAccountById } = await import('@line-crm/db');
      let active = 0;
      const breakdown: Array<{ accountId: string; sendCount: number }> = [];
      for (const a of preview.perAccount) {
        const account = await getLineAccountById(c.env.DB, a.accountId);
        if (account && account.is_active) {
          active += a.recipients.length;
          breakdown.push({ accountId: a.accountId, sendCount: a.recipients.length });
        }
      }
      count = active;
      perAccount = breakdown;
    } else if (broadcast.target_type === 'tag' && broadcast.target_tag_id) {
      // 注: ここは inline send パス (broadcast.ts:61 getFriendsByTag) が
      // line_account_id でフィルタしないので、preview もアカウント横断で数える。
      // 実際の送信先と modal 表示を一致させるための整合性。
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM friends f
           INNER JOIN friend_tags ft ON ft.friend_id = f.id
           WHERE ft.tag_id = ? AND f.is_following = 1`,
      ).bind(broadcast.target_tag_id).first<{ cnt: number }>();
      count = row?.cnt ?? 0;
    } else if (broadcast.target_type === 'segment' && broadcast.target_segment_tag_id) {
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM friends f
           INNER JOIN friend_segment_tags fst ON fst.friend_id = f.id
           WHERE fst.segment_tag_id = ? AND f.is_following = 1`,
      ).bind(broadcast.target_segment_tag_id).first<{ cnt: number }>();
      count = row?.cnt ?? 0;
    } else if (broadcast.target_type === 'all') {
      const accountId = (raw.line_account_id as string | null) || null;
      const sql = accountId
        ? `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1 AND line_account_id = ?`
        : `SELECT COUNT(*) AS cnt FROM friends WHERE is_following = 1`;
      const binds: unknown[] = accountId ? [accountId] : [];
      const row = await c.env.DB.prepare(sql).bind(...binds).first<{ cnt: number }>();
      count = row?.cnt ?? 0;
    }

    return c.json({ success: true, data: { count, perAccount } });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/preview-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/per-account-stats — multi-account-dedup などで
// アカウント別の配信数 + insight 内訳を返す。
//
// 返り値:
//   data: [{
//     accountId, accountName,
//     sent: number,                    // messages_log での実送信数
//     uniqueImpression: number | null, // LINE Insight (アカ token で個別 fetch)
//     uniqueClick: number | null,
//   }]
//
// insight は live で各アカウントの token を使って LINE API を叩く (sent and aggregation_unit 必須)。
// キャッシュしない (broadcast_insights は集計値しか持たない設計のため)。
broadcasts.get('/api/broadcasts/:id/per-account-stats', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    const raw = broadcast as unknown as Record<string, unknown>;
    const aggregationUnit = (raw.aggregation_unit as string | null) || null;

    // 対象アカウントリスト: dedup なら account_ids JSON、それ以外なら line_account_id 単独
    let accountIds: string[];
    if (broadcast.target_type === 'multi-account-dedup') {
      accountIds = parseJsonArray(raw.account_ids) ?? [];
    } else {
      const single = (raw.line_account_id as string | null) || null;
      accountIds = single ? [single] : [];
    }

    if (accountIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    // sent 数: messages_log の line_account_id (送信時固定) で GROUP BY する。
    // 旧データ (032 migration 前) は ml.line_account_id=NULL なので、その場合だけ
    // friends.line_account_id にフォールバックする (best-effort、現在のアカウント帰属で集計)。
    const placeholders = accountIds.map(() => '?').join(',');
    const sentRes = await c.env.DB.prepare(
      `SELECT COALESCE(ml.line_account_id, f.line_account_id) AS account_id, COUNT(*) AS sent
       FROM messages_log ml
       INNER JOIN friends f ON f.id = ml.friend_id
       WHERE ml.broadcast_id = ? AND ml.direction = 'outgoing'
         AND COALESCE(ml.line_account_id, f.line_account_id) IN (${placeholders})
       GROUP BY COALESCE(ml.line_account_id, f.line_account_id)`,
    ).bind(id, ...accountIds).all<{ account_id: string; sent: number }>();
    const sentMap = new Map<string, number>();
    for (const r of sentRes.results ?? []) sentMap.set(r.account_id, r.sent);

    // アカウント名
    const metaRes = await c.env.DB.prepare(
      `SELECT id, name FROM line_accounts WHERE id IN (${placeholders})`,
    ).bind(...accountIds).all<{ id: string; name: string }>();
    const nameMap = new Map<string, string>();
    for (const r of metaRes.results ?? []) nameMap.set(r.id, r.name);

    // insight: status='sent' かつ aggregation_unit がある場合だけ live fetch する。
    // 各アカウントの LINE API call は 3-5 秒かかるので、Promise.all で並列化して
    // 4 アカ夢中なら ~5 秒、シリアルだと ~20 秒の差。Worker / browser timeout 回避用。
    const insightMap = new Map<string, { uniqueImpression: number | null; uniqueClick: number | null }>();
    if (broadcast.status === 'sent' && aggregationUnit && broadcast.sent_at) {
      const sentDate = broadcast.sent_at.slice(0, 10).replace(/-/g, '');
      const { getLineAccountById } = await import('@line-crm/db');
      await Promise.all(
        accountIds.map(async (aid) => {
          const account = await getLineAccountById(c.env.DB, aid);
          if (!account) return;
          try {
            const client = new LineClient(account.channel_access_token);
            const response = await client.getUnitInsight(aggregationUnit, sentDate, sentDate) as Record<string, unknown>;
            const messages = response.messages as Array<Record<string, unknown>> | undefined;
            const overview = messages?.[0] || {};
            insightMap.set(aid, {
              uniqueImpression: (overview.uniqueImpression as number) ?? null,
              uniqueClick: (overview.uniqueClick as number) ?? null,
            });
          } catch (err) {
            console.error(`[per-account-stats] account ${aid} insight failed:`, err);
          }
        }),
      );
    }

    const result = accountIds.map((aid) => ({
      accountId: aid,
      accountName: nameMap.get(aid) ?? aid,
      sent: sentMap.get(aid) ?? 0,
      uniqueImpression: insightMap.get(aid)?.uniqueImpression ?? null,
      uniqueClick: insightMap.get(aid)?.uniqueClick ?? null,
    }));

    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/per-account-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts - create
broadcasts.post('/api/broadcasts', async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      messageType: BroadcastMessageType;
      messageContent: string;
      targetType: BroadcastTargetType;
      targetTagId?: string | null;
      targetSegmentTagId?: string | null;
      scheduledAt?: string | null;
      lineAccountId?: string | null;
      altText?: string | null;
      accountIds?: string[];
      dedupPriority?: string[];
      segmentConditions?: string | null;
    }>();

    if (!body.title || !body.messageType || !body.messageContent || !body.targetType) {
      return c.json(
        { success: false, error: 'title, messageType, messageContent, and targetType are required' },
        400,
      );
    }

    // targetType='tag' でも segmentConditions が与えられていれば、tag dropdown 単体ではなく
    // 条件ベース絞り込みとして扱う (フォーム側でセグメントビルダーに切り替えた場合)。
    if (body.targetType === 'tag' && !body.targetTagId && !body.segmentConditions) {
      return c.json(
        { success: false, error: 'targetTagId or segmentConditions is required when targetType is "tag"' },
        400,
      );
    }

    if (body.targetType === 'segment' && !body.targetSegmentTagId) {
      return c.json(
        { success: false, error: 'targetSegmentTagId is required when targetType is "segment"' },
        400,
      );
    }

    if (body.targetType === 'multi-account-dedup') {
      if (!Array.isArray(body.accountIds) || body.accountIds.length < 1) {
        return c.json({ success: false, error: 'accountIds (length >= 1) required for multi-account-dedup' }, 400);
      }
      if (!Array.isArray(body.dedupPriority)) {
        return c.json({ success: false, error: 'dedupPriority (array, may be empty) required for multi-account-dedup' }, 400);
      }
      // Defense in depth: drop priority entries not in accountIds before persisting.
      body.dedupPriority = body.dedupPriority.filter((id: unknown) =>
        typeof id === 'string' && body.accountIds!.includes(id));
    }

    const broadcast = await createBroadcast(c.env.DB, {
      title: body.title,
      messageType: body.messageType,
      messageContent: body.messageContent,
      targetType: body.targetType,
      targetTagId: body.targetTagId ?? null,
      targetSegmentTagId: body.targetSegmentTagId ?? null,
      scheduledAt: body.scheduledAt ?? null,
      accountIds: body.accountIds,
      dedupPriority: body.dedupPriority,
    });

    // Save line_account_id, alt_text, segment_conditions if provided
    const updates: string[] = [];
    const binds: unknown[] = [];
    if (body.lineAccountId) { updates.push('line_account_id = ?'); binds.push(body.lineAccountId); }
    if (body.altText) { updates.push('alt_text = ?'); binds.push(body.altText); }
    if (body.segmentConditions) { updates.push('segment_conditions = ?'); binds.push(body.segmentConditions); }
    if (updates.length > 0) {
      binds.push(broadcast.id);
      await c.env.DB.prepare(`UPDATE broadcasts SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...binds).run();
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) }, 201);
  } catch (err) {
    console.error('POST /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/broadcasts/:id - update draft
broadcasts.put('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return c.json({ success: false, error: 'Only draft or scheduled broadcasts can be updated' }, 400);
    }

    const body = await c.req.json<{
      title?: string;
      messageType?: BroadcastMessageType;
      messageContent?: string;
      targetType?: BroadcastTargetType;
      targetTagId?: string | null;
      scheduledAt?: string | null;
      segmentConditions?: string | null;
    }>();

    // Keep status in sync with scheduledAt changes
    let statusUpdate: 'draft' | 'scheduled' | undefined;
    if (body.scheduledAt !== undefined) {
      statusUpdate = body.scheduledAt ? 'scheduled' : 'draft';
    }

    const updated = await updateBroadcast(c.env.DB, id, {
      title: body.title,
      message_type: body.messageType,
      message_content: body.messageContent,
      target_type: body.targetType,
      target_tag_id: body.targetTagId,
      scheduled_at: body.scheduledAt,
      segment_conditions: body.segmentConditions,
      ...(statusUpdate !== undefined ? { status: statusUpdate } : {}),
    });

    // 失敗 partial dedup broadcast を draft に戻して編集 → 再送するケースで、
    // 残っていた resume 用 state を全部クリアして fresh campaign として送り直せる
    // ようにする。
    // - dedup_progress: 残すと過去 partial を skip して mixed delivery 事故
    // - success_count: 残すと recover 経路の `success_count > 0 + dedup_progress=NULL`
    //   排除条件にひっかかって永久に stuck になる (再 lock 後 crash で復旧不可)
    // - failed_account_ids: 過去 attempt の失敗 mark を継承するのは misleading
    // - batch_lock_at: stale lock 跡を残さない
    // - sent_at: 念のため NULL に戻す。getQueuedBroadcasts / recoverStalledBroadcasts は
    //   `sent_at IS NULL` を要求するので、過去 sent 値が残ると永久 stuck の元
    // - aggregation_unit / line_request_id: 過去送信の insight 集計参照を残さない
    await c.env.DB.prepare(
      `UPDATE broadcasts SET
         dedup_progress = NULL,
         batch_lock_at = NULL,
         success_count = 0,
         failed_account_ids = NULL,
         sent_at = NULL,
         aggregation_unit = NULL,
         line_request_id = NULL
       WHERE id = ?`,
    ).bind(id).run();

    // 過去 send の insight 行を削除する。createBroadcastInsight は idempotent で
    // 既存行があれば skip する設計のため、削除しないと再送時に新しい pending
    // insight が作られず getPendingInsights / GET /insight が古い metrics を返し続ける。
    await c.env.DB.prepare(
      `DELETE FROM broadcast_insights WHERE broadcast_id = ?`,
    ).bind(id).run();

    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('PUT /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/broadcasts/:id - delete
broadcasts.delete('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteBroadcast(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send - send now (tag配信で500人超はキュー方式)
//
// Atomic UPDATE-WHERE で多重起動を防ぐ。check-then-act の TOCTOU race だと、
// 並列リクエストが同時に status='draft' を読んで両方が processBroadcastSend に
// 進入しうる (2026-04-10 19:50 の重複配信事故 broadcast 0069eb9f / 57c9667d)。
// 既存の lock 修正 (a27ad9f / bffcdf8 / 3ac2fec) は cron / scheduled 経路を
// 守ったが、API direct 経路は未対応のままだった。
broadcasts.post('/api/broadcasts/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    // segment_conditions が設定されている場合は target_type に関わらず必ずキュー方式。
    // 直接 send 経路 (target='all') を通すと LINE の broadcast() が全フォロワー宛に
    // 送ってしまい、UI でセグメント指定した意味が無くなる。queue 経路は
    // processQueuedBroadcastBatches で segment_conditions を使った絞り込み multicast を行う。
    const rawExistingForSegment = existing as unknown as Record<string, unknown>;
    const segmentConditionsRaw = rawExistingForSegment.segment_conditions as string | null;
    if (segmentConditionsRaw && existing.target_type !== 'multi-account-dedup') {
      const lockResult = await c.env.DB.prepare(
        `UPDATE broadcasts SET status = 'sending', batch_offset = 0 WHERE id = ? AND status IN ('draft','scheduled')`
      ).bind(id).run();
      if (!lockResult.meta.changes) {
        return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 409);
      }

      // cron を待たず即時にバックグラウンド処理を起動
      try {
        const ctx = c.executionCtx as ExecutionContext;
        let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
        const segAccountId = rawExistingForSegment.line_account_id as string | null;
        if (segAccountId) {
          const { getLineAccountById } = await import('@line-crm/db');
          const account = await getLineAccountById(c.env.DB, segAccountId);
          if (account) accessToken = account.channel_access_token;
        }
        const client = new LineClient(accessToken);
        ctx.waitUntil(
          processQueuedBroadcasts(c.env.DB, client, c.env.WORKER_URL).catch((err) => {
            console.error('[segment-send] background queue processing failed:', err);
          }),
        );
      } catch (kickErr) {
        console.warn('[segment-send] waitUntil unavailable, falling back to cron:', kickErr);
      }

      const result = await getBroadcastById(c.env.DB, id);
      return c.json({
        success: true,
        data: result ? serializeBroadcast(result) : null,
        queued: true,
        message: 'Broadcast queued for segment-filtered processing',
      }, 202);
    }

    // multi-account-dedup は常にキュー方式 — Worker の30秒制限を超えるため
    if (existing.target_type === 'multi-account-dedup') {
      // Always queue — never run inline. The executor walks per-account multicast
      // loops which can exceed the Worker's 30 s wall-clock if invoked synchronously.
      // Use status='sending' + batch_offset=0 to signal queued; processed by cron
      // via processQueuedBroadcasts (schema CHECK allows only draft/scheduled/sending/sent).
      //
      // total_count を同期計算して書く: progress polling が 0/0 のまま固まらないように。
      // computeDedupBroadcastPreview は単一SQL (ROW_NUMBER OVER) なので軽量。
      const rawExisting = existing as unknown as Record<string, unknown>;
      const accountIds = parseJsonArray(rawExisting.account_ids) ?? [];
      const dedupPriority = parseJsonArray(rawExisting.dedup_priority) ?? [];
      const preview = await computeDedupBroadcastPreview(
        c.env.DB,
        accountIds,
        dedupPriority,
        existing.target_tag_id ?? null,
      );

      // executor (processMultiAccountDedupBroadcast) は inactive/missing
      // アカウントを skip するので、total_count もそれに揃える。preview は
      // inactive 分も含めた全件を返すため、ここでアカウント状態を引き直して
      // active 分だけ集計する。これで confirm/progress UI と実送信数が一致する。
      let projectedTotal = 0;
      const { getLineAccountById } = await import('@line-crm/db');
      for (const a of preview.perAccount) {
        const account = await getLineAccountById(c.env.DB, a.accountId);
        if (account && account.is_active) projectedTotal += a.recipients.length;
      }

      const lockResult = await c.env.DB.prepare(
        `UPDATE broadcasts SET status = 'sending', batch_offset = 0, total_count = ? WHERE id = ? AND status IN ('draft','scheduled')`
      ).bind(projectedTotal, id).run();
      if (!lockResult.meta.changes) {
        return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 409);
      }

      // cron (5min) を待たず即時にバックグラウンド処理を起動する。waitUntil なら
      // レスポンス返却後も Worker が処理を続行できる。失敗しても cron が拾うので
      // 二重で安全。processQueuedBroadcasts 内の楽観ロック (batch_offset=-1) が
      // 並走を防ぐ。
      try {
        const ctx = c.executionCtx as ExecutionContext;
        const defaultClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
        ctx.waitUntil(
          processQueuedBroadcasts(c.env.DB, defaultClient, c.env.WORKER_URL).catch((err) => {
            console.error('[multi-account-dedup] background queue processing failed:', err);
          }),
        );
      } catch (kickErr) {
        // ExecutionContext 未利用環境 (test 等) — cron 経由にフォールバック
        console.warn('[multi-account-dedup] waitUntil unavailable, falling back to cron:', kickErr);
      }

      return c.json({
        success: true,
        data: { id, status: 'sending', totalCount: projectedTotal },
        queued: true,
        message: 'Broadcast queued for immediate background processing',
      }, 202);
    }

    // target_type='tag' で対象が多い場合はキュー方式
    if (existing.target_type === 'tag' && existing.target_tag_id) {
      const { getFriendsByTag } = await import('@line-crm/db');
      const friends = await getFriendsByTag(c.env.DB, existing.target_tag_id, (existing as unknown as Record<string, unknown>).line_account_id as string | null);
      const followingCount = friends.filter(f => f.is_following).length;

      if (followingCount > 500) {
        // Atomic lock: status='draft'|'scheduled' のときだけ status='sending' に遷移
        const tagMarker = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: existing.target_tag_id }] });
        const lockResult = await c.env.DB.prepare(
          `UPDATE broadcasts SET status = 'sending', batch_offset = 0, segment_conditions = ? WHERE id = ? AND status IN ('draft','scheduled')`
        ).bind(tagMarker, id).run();
        if (!lockResult.meta.changes) {
          return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 409);
        }
        const result = await getBroadcastById(c.env.DB, id);
        return c.json({ success: true, data: result ? serializeBroadcast(result) : null, queued: true, message: 'Broadcast queued for batch processing by Cron' }, 202);
      }
    }

    // 500人以下またはtarget_type='all'は即時送信
    // accessToken 解決は lock 前に行う (setup 失敗時に status='sending' で stuck しないため、
    // 即時送信パスには recoverStalledBroadcasts がない)
    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const broadcastAccountId = (existing as unknown as Record<string, unknown>).line_account_id;
    if (broadcastAccountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(c.env.DB, broadcastAccountId as string);
      if (account) accessToken = account.channel_access_token;
    }
    const lineClient = new LineClient(accessToken);

    // atomic lock — 'draft' と 'scheduled' を分けて単一 UPDATE で claim する。
    // 各 UPDATE は単一 write statement なので read-then-write transaction の
    // SQLITE_BUSY_SNAPSHOT を引き起こさず、claim 成功時の status も WHERE 句から
    // 一意に確定する (rollback 時の status 復元に使用)。
    let claimedStatus: 'draft' | 'scheduled' | null = null;
    const draftClaim = await c.env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'draft'`
    ).bind(id).run();
    if (draftClaim.meta.changes) {
      claimedStatus = 'draft';
    } else {
      const schedClaim = await c.env.DB.prepare(
        `UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`
      ).bind(id).run();
      if (schedClaim.meta.changes) {
        claimedStatus = 'scheduled';
      }
    }
    if (!claimedStatus) {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 409);
    }

    // processBroadcastSend は内部の try/catch で multicast 失敗を 'draft' に戻すが、
    // 冒頭 (updateBroadcastStatus / getBroadcastById / autoTrackContent / buildMessage) で
    // 失敗した場合は内部 catch の対象外。lock を外側で必ず rollback する。
    try {
      await processBroadcastSend(c.env.DB, lineClient, id, c.env.WORKER_URL);
    } catch (err) {
      await c.env.DB.prepare(
        `UPDATE broadcasts SET status = ? WHERE id = ? AND status = 'sending'`
      ).bind(claimedStatus, id).run();
      throw err;
    }

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return c.json({ success: false, error: err.message }, 429);
    }
    console.error('POST /api/broadcasts/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send-segment - send to a filtered segment (常にキュー方式)
broadcasts.post('/api/broadcasts/:id/send-segment', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    const body = await c.req.json<{ conditions: SegmentCondition }>();

    if (!body.conditions || !body.conditions.operator || !Array.isArray(body.conditions.rules)) {
      return c.json(
        { success: false, error: 'conditions with operator and rules array is required' },
        400,
      );
    }

    // Atomic lock: status='draft'|'scheduled' のときだけ status='sending' に遷移
    const lockResult = await c.env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending', batch_offset = 0, segment_conditions = ? WHERE id = ? AND status IN ('draft','scheduled')`
    ).bind(JSON.stringify(body.conditions), id).run();
    if (!lockResult.meta.changes) {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 409);
    }

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null, queued: true, message: 'Broadcast queued for batch processing by Cron' }, 202);
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send-segment error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/insight — インサイト（開封率・クリック率）取得
broadcasts.get('/api/broadcasts/:id/insight', async (c) => {
  try {
    const id = c.req.param('id');
    const insight = await c.env.DB.prepare(
      'SELECT * FROM broadcast_insights WHERE broadcast_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(id).first<Record<string, unknown>>();

    if (!insight) {
      return c.json({ success: true, data: null, message: 'Insight not yet available' });
    }

    return c.json({
      success: true,
      data: {
        broadcastId: insight.broadcast_id,
        delivered: insight.delivered,
        uniqueImpression: insight.unique_impression,
        uniqueClick: insight.unique_click,
        uniqueMediaPlayed: insight.unique_media_played,
        openRate: insight.open_rate,
        clickRate: insight.click_rate,
        status: insight.status,
        fetchedAt: insight.fetched_at,
      },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/insight error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/fetch-insight — LINE APIからインサイトを即時取得
broadcasts.post('/api/broadcasts/:id/fetch-insight', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    if (broadcast.status !== 'sent') {
      return c.json({ success: false, error: 'Broadcast has not been sent yet' }, 400);
    }

    // DBから直接取得してline_request_id/aggregation_unit/account_ids/failed_account_idsを確実に読む
    const rawBroadcast = await c.env.DB.prepare(
      'SELECT line_request_id, aggregation_unit, line_account_id, target_type, account_ids, failed_account_ids FROM broadcasts WHERE id = ?',
    ).bind(id).first<Record<string, string | null>>();
    const lineRequestId = rawBroadcast?.line_request_id || null;
    const aggregationUnit = rawBroadcast?.aggregation_unit || null;
    const targetType = rawBroadcast?.target_type || null;

    if (!lineRequestId && !aggregationUnit) {
      return c.json({ success: false, error: 'No line_request_id or aggregation_unit available for this broadcast' }, 400);
    }

    let delivered: number | null = null;
    let uniqueImpression: number | null = null;
    let uniqueClick: number | null = null;
    let uniqueMediaPlayed: number | null = null;
    let rawResponse: string = '{}';

    const sentDate = broadcast.sent_at!.slice(0, 10).replace(/-/g, '');

    if (lineRequestId) {
      // broadcast API ('all') 経由の insight: 単一 lineRequestId で取れる
      const accountId = rawBroadcast?.line_account_id || null;
      let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(c.env.DB, accountId);
        if (account) accessToken = account.channel_access_token;
      }
      const lineClient = new LineClient(accessToken);
      const response = await lineClient.getMessageEventInsight(lineRequestId) as Record<string, unknown>;
      const overview = response.overview as Record<string, unknown> | undefined;
      delivered = (overview?.delivered as number) ?? null;
      uniqueImpression = (overview?.uniqueImpression as number) ?? null;
      uniqueClick = (overview?.uniqueClick as number) ?? null;
      uniqueMediaPlayed = (overview?.uniqueMediaPlayed as number) ?? null;
      rawResponse = JSON.stringify(response);
    } else if (aggregationUnit && targetType === 'multi-account-dedup') {
      // 多アカ dedup: 同じ unit 名を全アカウントの multicast で共有しているが、
      // LINE 側のカウントはチャネルごとに独立しているため、各アカウントの
      // channel_access_token で getUnitInsight を呼んで合算する。
      // failed_account_ids は除外しない: アカウントは途中バッチで例外を出しても
      // それ以前のバッチは送信成功している可能性があるため、部分配信の insight も
      // 拾うべき。
      const accountIds = parseJsonArray(rawBroadcast?.account_ids) ?? [];

      const { getLineAccountById } = await import('@line-crm/db');
      const responses: Array<{ accountId: string; data: Record<string, unknown> }> = [];

      let aggImpression = 0;
      let aggClick = 0;
      let aggMedia = 0;
      let hasAnyData = false;
      let allCallsFailed = true;

      for (const aid of accountIds) {
        // is_active は意図的にチェックしない: 送信時にアクティブだったアカウントが
        // insight 取得時に deactivate されてる可能性がある。token があれば LINE
        // API は叩けるので、過去配信の集計を欠損させない。
        const account = await getLineAccountById(c.env.DB, aid);
        if (!account) continue;
        const client = new LineClient(account.channel_access_token);
        try {
          const response = await client.getUnitInsight(aggregationUnit, sentDate, sentDate) as Record<string, unknown>;
          responses.push({ accountId: aid, data: response });
          allCallsFailed = false;
          const messages = response.messages as Array<Record<string, unknown>> | undefined;
          const overview = messages?.[0] || {};
          aggImpression += (overview.uniqueImpression as number) ?? 0;
          aggClick += (overview.uniqueClick as number) ?? 0;
          aggMedia += (overview.uniqueMediaPlayed as number) ?? 0;
          if (messages && messages.length > 0) hasAnyData = true;
        } catch (err) {
          console.error(`[fetch-insight] dedup account ${aid} failed:`, err);
          responses.push({ accountId: aid, data: { error: String(err) } });
        }
      }

      if (allCallsFailed && accountIds.length > 0) {
        // 全アカウントの API 呼び出しが失敗した場合、blank insight を保存して
        // retry ボタンを潰さないように 502 を返す (ユーザーが再試行できる状態)。
        return c.json({
          success: false,
          error: 'All account insight fetches failed; please retry later',
        }, 502);
      }

      if (hasAnyData) {
        uniqueImpression = aggImpression;
        uniqueClick = aggClick;
        uniqueMediaPlayed = aggMedia;
      }
      // delivered は unit insight には含まれない (LINE 仕様)。dedup の場合は
      // broadcasts.success_count を delivered として採用する (送達数の近似値)。
      delivered = (broadcast as unknown as Record<string, number | null>).success_count ?? null;
      rawResponse = JSON.stringify({ perAccount: responses });
    } else if (aggregationUnit) {
      // tag broadcast (単一アカ): 既存パス
      const accountId = rawBroadcast?.line_account_id || null;
      let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(c.env.DB, accountId);
        if (account) accessToken = account.channel_access_token;
      }
      const lineClient = new LineClient(accessToken);
      const response = await lineClient.getUnitInsight(aggregationUnit, sentDate, sentDate) as Record<string, unknown>;
      const messages = response.messages as Array<Record<string, unknown>> | undefined;
      const overview = messages?.[0] || {};
      uniqueImpression = (overview.uniqueImpression as number) ?? null;
      uniqueClick = (overview.uniqueClick as number) ?? null;
      uniqueMediaPlayed = (overview.uniqueMediaPlayed as number) ?? null;
      rawResponse = JSON.stringify(response);
    }

    const openRate = (delivered && uniqueImpression) ? uniqueImpression / delivered : null;
    const clickRate = (delivered && uniqueClick) ? uniqueClick / delivered : null;

    // 旧コードの `ON CONFLICT(broadcast_id)` は broadcast_insights.broadcast_id に
    // UNIQUE 制約がないため D1 が `SQLITE_ERROR: ON CONFLICT clause does not match
    // any PRIMARY KEY or UNIQUE constraint` を返して 500 化していた。
    // SELECT で既存の pending 行を探して UPDATE、なければ INSERT する明示的 upsert に置き換え。
    const { jstNow } = await import('@line-crm/db');
    const now = jstNow();
    const existing = await c.env.DB.prepare(
      'SELECT id FROM broadcast_insights WHERE broadcast_id = ? ORDER BY created_at DESC LIMIT 1',
    ).bind(id).first<{ id: string }>();

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE broadcast_insights SET
           delivered = ?, unique_impression = ?, unique_click = ?, unique_media_played = ?,
           open_rate = ?, click_rate = ?, raw_response = ?, status = 'ready', fetched_at = ?
         WHERE id = ?`,
      ).bind(delivered, uniqueImpression, uniqueClick, uniqueMediaPlayed, openRate, clickRate, rawResponse, now, existing.id).run();
    } else {
      const insightId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO broadcast_insights (id, broadcast_id, delivered, unique_impression, unique_click, unique_media_played, open_rate, click_rate, raw_response, status, fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
      ).bind(insightId, id, delivered, uniqueImpression, uniqueClick, uniqueMediaPlayed, openRate, clickRate, rawResponse, now, now).run();
    }

    return c.json({
      success: true,
      data: { delivered, uniqueImpression, uniqueClick, uniqueMediaPlayed, openRate, clickRate },
    });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/fetch-insight error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/test-send — send to test recipients with 【テスト配信】 label
broadcasts.post('/api/broadcasts/:id/test-send', async (c) => {
  const id = c.req.param('id');
  try {
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (broadcast.status !== 'draft') {
      return c.json({ success: false, error: 'Only draft broadcasts can be test-sent' }, 400);
    }

    const raw = broadcast as unknown as Record<string, unknown>;
    const accountId = raw.line_account_id as string | null;
    if (!accountId) return c.json({ success: false, error: 'Broadcast has no line_account_id' }, 400);

    // Get test recipients
    const setting = await c.env.DB.prepare(
      `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`
    ).bind(accountId).first<{ value: string }>();
    if (!setting) return c.json({ success: false, error: 'No test recipients configured' }, 400);

    const friendIds: string[] = JSON.parse(setting.value);
    if (friendIds.length === 0) return c.json({ success: false, error: 'No test recipients configured' }, 400);

    const placeholders = friendIds.map(() => '?').join(',');
    const friends = await c.env.DB.prepare(
      `SELECT id, line_user_id FROM friends WHERE id IN (${placeholders})`
    ).bind(...friendIds).all<{ id: string; line_user_id: string }>();

    const account = await getLineAccountById(c.env.DB, accountId);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 400);
    const lineClient = new LineClient(account.channel_access_token);

    // Build message with test label
    let messageContent = broadcast.message_content;
    if (broadcast.message_type === 'text') {
      messageContent = `【テスト配信】\n${messageContent}`;
    }

    // Auto-track URLs
    const { autoTrackContent } = await import('../services/auto-track.js');
    const tracked = await autoTrackContent(c.env.DB, broadcast.message_type, messageContent, c.env.WORKER_URL, accountId);

    const { extractFlexAltText } = await import('../utils/flex-alt-text.js');
    const altText = raw.alt_text as string || (tracked.messageType === 'flex' ? extractFlexAltText(tracked.content) : undefined);
    const message = buildMessage(tracked.messageType, tracked.content, altText);

    let sent = 0;
    let failed = 0;
    const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

    for (const friend of friends.results) {
      try {
        await lineClient.pushMessage(friend.line_user_id, [message]);
        sent++;
        await c.env.DB.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, delivery_type, source, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, NULL, 'test', 'broadcast', ?)`
        ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, messageContent, now).run();
      } catch (err) {
        console.error(`Test send to ${friend.id} failed:`, err);
        failed++;
      }
    }

    return c.json({ success: true, sent, failed });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/test-send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/progress — batch send progress
broadcasts.get('/api/broadcasts/:id/progress', async (c) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast) return c.json({ success: false, error: 'Not found' }, 404);

  const raw = broadcast as unknown as Record<string, unknown>;
  return c.json({
    success: true,
    data: {
      status: broadcast.status,
      totalCount: broadcast.total_count,
      successCount: broadcast.success_count,
      batchOffset: raw.batch_offset as number,
    },
  });
});

// POST /api/segments/count — count friends matching segment conditions
broadcasts.post('/api/segments/count', async (c) => {
  const body = await c.req.json<{ conditions: unknown; accountId?: string }>();
  try {
    const { buildSegmentQuery } = await import('../services/segment-query.js');
    const { sql, bindings } = buildSegmentQuery(body.conditions as SegmentCondition);

    let accountSql = sql;
    const accountBindings = [...bindings];
    if (body.accountId) {
      accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
      accountBindings.unshift(body.accountId);
    }

    const countSql = accountSql.replace(/^SELECT .+ FROM/, 'SELECT COUNT(*) as count FROM');
    const result = await c.env.DB.prepare(countSql).bind(...accountBindings).first<{ count: number }>();

    return c.json({ success: true, count: result?.count ?? 0 });
  } catch (err) {
    console.error('POST /api/segments/count error:', err);
    return c.json({ success: false, error: 'Invalid segment conditions' }, 400);
  }
});

export { broadcasts };
