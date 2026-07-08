/**
 * L ステップ Bridge API
 *
 * テナント設定 + 疎通確認 + 友だち取込 + タグ同期。
 * 既存 L アシスト 機能 (セグメント自動付与 / 顧客分析) の出力を L ステップ側に
 * 反映させる Bridge プラン用エンドポイント。
 *
 * GET   /api/lstep/settings              現在の Bridge 設定
 * POST  /api/lstep/settings              Bridge 設定の保存 (token / enabled)
 * POST  /api/lstep/ping                  API トークン疎通確認
 * POST  /api/lstep/import-friends        L ステップ友だちを L アシスト DB に取込み (名寄せ)
 * POST  /api/lstep/sync-segment/:id      セグメントタグを L ステップ側に push (タグ作成 + 友だち付与)
 * POST  /api/lstep/webhook/:accountId    L ステップ Webhook 転送の受信口 (Phase 2: パターン B 共存)
 */

import { Hono } from 'hono';
import {
  getLstepBridgeSettings,
  setLstepBridgeSettings,
  markLstepSynced,
  getSegmentTag,
  listFriendIdsBySegmentTag,
} from '@line-crm/db';
import { LstepClient, LstepApiError } from '../lib/lstep-client.js';
import type { Env } from '../index.js';

export const lstepBridge = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

// 現在の Bridge 設定 (apiToken は最後 4 文字だけマスクして返す)
lstepBridge.get('/api/lstep/settings', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const s = await getLstepBridgeSettings(c.env.DB, accountId);
  return c.json({
    success: true,
    data: {
      enabled: s.enabled,
      apiTokenMasked: s.apiToken
        ? `${'•'.repeat(Math.max(0, s.apiToken.length - 4))}${s.apiToken.slice(-4)}`
        : null,
      hasToken: !!s.apiToken,
      lastSyncedAt: s.lastSyncedAt,
    },
  });
});

// Bridge 設定保存
lstepBridge.post('/api/lstep/settings', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = await c.req.json<{ enabled?: boolean; apiToken?: string }>().catch(() => ({} as { enabled?: boolean; apiToken?: string }));
  if (typeof body.enabled !== 'boolean') {
    return c.json({ success: false, error: 'enabled (boolean) is required' }, 400);
  }
  await setLstepBridgeSettings(c.env.DB, accountId, {
    enabled: body.enabled,
    apiToken: body.apiToken,
  });
  return c.json({ success: true });
});

// 疎通確認: 入力された (or 保存済みの) token で L ステップ API に GET /tags を叩く
lstepBridge.post('/api/lstep/ping', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = await c.req.json<{ apiToken?: string }>().catch(() => ({} as { apiToken?: string }));
  let token = body.apiToken;
  if (!token) {
    const s = await getLstepBridgeSettings(c.env.DB, accountId);
    token = s.apiToken ?? '';
  }
  if (!token) return c.json({ success: false, error: 'apiToken not configured' }, 400);
  const client = new LstepClient({ apiToken: token });
  const r = await client.ping();
  return c.json({ success: true, data: r });
});

// L ステップ友だちを L アシスト DB に名寄せ取込
// 既存 friends.line_user_id と lstep_friend_id を結びつける (display_name で粗マッチング)
lstepBridge.post('/api/lstep/import-friends', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const s = await getLstepBridgeSettings(c.env.DB, accountId);
  if (!s.apiToken) return c.json({ success: false, error: 'lstep apiToken not configured' }, 400);
  const client = new LstepClient({ apiToken: s.apiToken });

  let cursor: string | undefined;
  let imported = 0;
  let matched = 0;
  try {
    for (let i = 0; i < 20; i++) {
      const page = await client.listFriends({ limit: 200, cursor });
      const items = page.data ?? [];
      for (const f of items) {
        const lstepFriendId = String(f.id);
        const displayName = f.display_name ?? null;
        // 既存 friends を display_name + line_account_id で粗マッチング
        // 完全な名寄せは LINE userId が必要だが、API 仕様未確定なので display_name ベース
        if (displayName) {
          const existing = await c.env.DB
            .prepare(
              `SELECT id FROM friends WHERE line_account_id = ? AND display_name = ? LIMIT 1`,
            )
            .bind(accountId, displayName)
            .first<{ id: string }>();
          if (existing) {
            await c.env.DB
              .prepare(`UPDATE friends SET lstep_friend_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ?`)
              .bind(lstepFriendId, existing.id)
              .run();
            matched++;
          }
        }
        imported++;
      }
      cursor = page.next_cursor ?? undefined;
      if (!cursor || items.length === 0) break;
    }
    await markLstepSynced(c.env.DB, accountId);
    return c.json({ success: true, data: { imported, matched } });
  } catch (e) {
    const msg = e instanceof LstepApiError ? e.message : (e instanceof Error ? e.message : 'import failed');
    return c.json({ success: false, error: msg }, 500);
  }
});

// セグメントタグを L ステップへ push (タグ作成 + 友だち付与)
//   - segment_tags.lstep_tag_id が空なら L ステップに作成して保存
//   - L アシスト 側で AI 判定済の friend たちに L ステップ側でもタグ付与
lstepBridge.post('/api/lstep/sync-segment/:id', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const tagId = c.req.param('id');
  const tag = await getSegmentTag(c.env.DB, tagId);
  if (!tag) return c.json({ success: false, error: 'segment tag not found' }, 404);
  if (tag.line_account_id !== accountId) return c.json({ success: false, error: 'tag belongs to other account' }, 403);

  const s = await getLstepBridgeSettings(c.env.DB, accountId);
  if (!s.apiToken) return c.json({ success: false, error: 'lstep apiToken not configured' }, 400);
  const client = new LstepClient({ apiToken: s.apiToken });

  try {
    // L ステップ側にタグが無ければ作成
    let lstepTagId: string | number | null = tag.lstep_tag_id ?? null;
    if (!lstepTagId) {
      const created = await client.createTag({ name: tag.name });
      lstepTagId = created.id;
      await c.env.DB
        .prepare(`UPDATE segment_tags SET lstep_tag_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ?`)
        .bind(String(lstepTagId), tagId)
        .run();
    }

    // 該当 friend たちの L ステップ friend_id を取得
    const friendIds = await listFriendIdsBySegmentTag(c.env.DB, tagId);
    if (friendIds.length === 0) {
      return c.json({ success: true, data: { lstepTagId, syncedCount: 0, note: 'no friends to sync' } });
    }
    const placeholders = friendIds.map(() => '?').join(',');
    const result = await c.env.DB
      .prepare(`SELECT lstep_friend_id FROM friends WHERE id IN (${placeholders}) AND lstep_friend_id IS NOT NULL`)
      .bind(...friendIds)
      .all<{ lstep_friend_id: string }>();
    const lstepFriendIds = result.results.map((r) => r.lstep_friend_id);

    if (lstepFriendIds.length === 0) {
      return c.json({
        success: true,
        data: {
          lstepTagId,
          syncedCount: 0,
          note: '名寄せ済みの友だちなし。先に /api/lstep/import-friends で取込んでください',
        },
      });
    }

    // 一括付与 (10 req/sec 制限内に収めるため 1 リクエストでまとめて送る)
    // L ステップ API は POST /tags/{id}/friends で複数 friend_id を受け付ける
    const BATCH = 200;
    let synced = 0;
    for (let i = 0; i < lstepFriendIds.length; i += BATCH) {
      const batch = lstepFriendIds.slice(i, i + BATCH);
      await client.addTagToFriends(lstepTagId, batch);
      synced += batch.length;
    }
    await markLstepSynced(c.env.DB, accountId);
    return c.json({ success: true, data: { lstepTagId, syncedCount: synced, totalFriends: friendIds.length } });
  } catch (e) {
    const msg = e instanceof LstepApiError ? e.message : (e instanceof Error ? e.message : 'sync failed');
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// Webhook 転送 受信口 (Phase 2: パターン B 共存モード)
//
//   L ステップ「Webhook 転送機能」(月額 5,500 円オプション) が発火した受信イベントを
//   ここで受ける。L ステップが受信を握ったまま、L-port は AI 応答だけ担当する構成。
//   reply token は無いので返信は client.sendMessage() = push (従量) になる。
//
//   管理画面に登録する転送先 URL: https://api.line-port.com/api/lstep/webhook/{accountId}
//   accountId でテナントを特定する。
//
//   ⚠ 骨組みのみ。以下は L ステップ公式仕様 (トークン取得後) 確定後に要実装:
//     - 署名/シークレット検証 (なりすまし防止)
//     - 転送 JSON の正確なフィールド (event type / friend id / message text)
//     - AI 応答生成フロー (services/ai-generators) との接続
// ---------------------------------------------------------------------------
lstepBridge.post('/api/lstep/webhook/:accountId', async (c) => {
  const accountId = c.req.param('accountId');

  // 転送 JSON の形は仕様未確定。複数の想定形を best-effort で吸収する。
  const payload = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!payload) {
    // Webhook は速い 200 を期待するので、パース不能でも 200 で受けて握りつぶす
    return c.json({ success: true, ignored: 'invalid json' });
  }

  // TODO: 署名検証 (c.req.header('x-lstep-signature') 等)。仕様確定後に実装。

  const s = await getLstepBridgeSettings(c.env.DB, accountId);
  if (!s.enabled || !s.apiToken) {
    return c.json({ success: true, ignored: 'bridge disabled or no token' });
  }

  // best-effort 抽出 (フィールド名は仕様確定後に固定する)
  const eventType =
    (payload.event_type as string) ??
    (payload.type as string) ??
    (payload.event as string) ??
    'unknown';
  const friendId =
    (payload.friend_id as string | number) ??
    (payload.friendId as string | number) ??
    ((payload.friend as { id?: string | number } | undefined)?.id) ??
    null;
  const messageText =
    (payload.text as string) ??
    ((payload.message as { text?: string } | undefined)?.text) ??
    null;

  // メッセージ受信イベントのみ AI 応答対象。それ以外 (友だち追加/タグ操作等) は今は素通り。
  const isMessage = eventType === 'message' || eventType.includes('message');
  if (!isMessage || friendId == null || !messageText) {
    return c.json({ success: true, handled: false, eventType });
  }

  // TODO: ここで AI 応答を生成し、push 返信する。
  //   const reply = await generateAiReply(c.env, accountId, String(friendId), messageText);
  //   const client = new LstepClient({ apiToken: s.apiToken });
  //   await client.sendMessage(friendId, [{ type: 'text', text: reply }]);

  return c.json({ success: true, handled: false, eventType, note: 'AI reply not wired yet (Phase 2)' });
});
