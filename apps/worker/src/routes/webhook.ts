import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  jstNow,
  computeNextDeliveryAt,
  resolveStepContent,
  addTagToFriend,
  getEntryRouteByRefCode,
  getMessageTemplateById,
} from '@line-crm/db';
import type { EntryRoute, Friend as DbFriend } from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { enqueueOnFriendAdd } from '../services/agents/event-triggers.js';
import { buildMessage, expandVariables } from '../services/step-delivery.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

// LINE webhook bodies are small (events array). Cap defends against unauthenticated
// large-payload DoS before signature verification (#104). 1 MiB leaves room for
// bursty batched deliveries (~100 events × ~5 KB) while still well below the
// 128 MB Cloudflare Workers memory ceiling.
const MAX_WEBHOOK_BODY_SIZE = 1024 * 1024; // 1 MiB

webhook.post('/webhook', async (c) => {
  // Pre-read size guard: reject before reading the body if Content-Length is oversized.
  const contentLengthHeader = c.req.header('Content-Length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_SIZE) {
      return c.json({ status: 'too_large' }, 413);
    }
  }

  const rawBody = await c.req.text();

  // Post-read size guard for the case where Content-Length was absent or untrustworthy.
  // Use UTF-8 byte count: `rawBody.length` counts UTF-16 code units, so multibyte
  // payloads (Japanese/emoji) would otherwise bypass the cap.
  const rawBodyByteLength = new TextEncoder().encode(rawBody).byteLength;
  if (rawBodyByteLength > MAX_WEBHOOK_BODY_SIZE) {
    return c.json({ status: 'too_large' }, 413);
  }

  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  // Cheap pre-reject for unsigned / malformed-signature requests. LINE signatures
  // are HMAC-SHA256 + base64 = 44 chars. This avoids D1 lookups and HMAC compute
  // for junk traffic on a public endpoint.
  const LINE_SIGNATURE_LENGTH = 44;
  if (signature.length !== LINE_SIGNATURE_LENGTH) {
    console.error('Missing or malformed LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  // Verify signature BEFORE JSON.parse so attacker-controlled bodies never reach the parser.
  // Fast path: try env default secret first so malformed/unauthenticated traffic
  //   fails fast without a D1 lookup. The main account is typically also registered
  //   in line_accounts; on env match we still look it up so matchedAccountId binds
  //   correctly for downstream account-scoped filters.
  // Slow path: iterate DB-registered accounts for genuinely multi-account installs.
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;
  let valid = false;

  const envSecret = c.env.LINE_CHANNEL_SECRET;
  if (envSecret) {
    valid = await verifySignature(envSecret, rawBody, signature);
    if (valid) {
      const accounts = await getLineAccounts(db);
      const main = accounts.find(
        (a) => a.is_active && a.channel_secret === envSecret,
      );
      if (main) {
        channelAccessToken = main.channel_access_token;
        matchedAccountId = main.id;
      }
    }
  }

  if (!valid) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      if (envSecret && account.channel_secret === envSecret) continue; // already tried via fast path
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        valid = true;
        break;
      }
    }
  }

  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        // 冪等性ガード: LINE 再送 (isRedelivery) による二重処理を防ぐ。
        // webhookEventId を INSERT OR IGNORE し、既存 (changes=0) なら処理済みとしてスキップ。
        // 初回配信は毎回新しい id なので必ず処理される (正当イベントを落とさない)。
        const eventId = (event as { webhookEventId?: string }).webhookEventId;
        if (eventId) {
          const dedup = await db
            .prepare('INSERT OR IGNORE INTO webhook_events (webhook_event_id, line_account_id, received_at) VALUES (?, ?, ?)')
            .bind(eventId, matchedAccountId, new Date().toISOString())
            .run();
          if (dedup.meta.changes === 0) {
            console.log('[webhook] duplicate event skipped', eventId);
            continue;
          }
        }
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL, (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY, (c.env as { JINA_API_KEY?: string }).JINA_API_KEY);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

/**
 * 友だち未登録の userId が webhook イベントで来た場合に「その場で」登録する。
 *
 * 公式 LINE と同じ挙動を実現するため: ユーザーがリッチメニュー / Flex / カード /
 * クーポン / スタンプ / テキスト等で「何らかの user action」をとった瞬間、
 * follow webhook を逃していた友だちでも friends 表に自動 backfill する。
 *
 * 注意: getProfile はネットワーク呼び出しなので失敗時は displayName=null で登録継続。
 *       これにより auto-reply / scenario の処理が前進できる。
 */
async function ensureFriendForUserId(
  db: D1Database,
  lineClient: LineClient,
  userId: string,
  lineAccountId: string | null,
): Promise<DbFriend | null> {
  const existing = await getFriendByLineUserId(db, userId);
  if (existing) {
    // is_following=0 のまま postback 等が来た場合 (re-follow / block 解除前) は
    // followers 同期で 1 に戻る挙動と整合性を取るため、ここでは触らない。
    return existing;
  }
  // プロフィール取得 (ベストエフォート)
  let profile: { displayName?: string; pictureUrl?: string; statusMessage?: string } | null = null;
  try {
    profile = await lineClient.getProfile(userId);
  } catch (err) {
    console.warn('[ensureFriendForUserId] getProfile failed', userId, err);
  }
  const friend = await upsertFriend(db, {
    lineUserId: userId,
    displayName: profile?.displayName ?? null,
    pictureUrl: profile?.pictureUrl ?? null,
    statusMessage: profile?.statusMessage ?? null,
  });
  if (lineAccountId) {
    await db
      .prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
      .bind(lineAccountId, jstNow(), friend.id)
      .run();
  }
  console.log('[ensureFriendForUserId] backfilled friend', { id: friend.id, lineAccountId });
  return friend;
}

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
  anthropicApiKey?: string,
  jinaApiKey?: string,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    console.log(`[follow] userId=${userId} lineAccountId=${lineAccountId}`);

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    console.log(`[follow] profile=${profile?.displayName ?? 'null'}`);

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    console.log(`[follow] friend.id=${friend.id} friend.line_account_id=${(friend as any).line_account_id}`);

    // Set line_account_id for multi-account tracking (always update on follow)
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
        .bind(lineAccountId, jstNow(), friend.id).run();
      console.log(`[follow] line_account_id set to ${lineAccountId} for friend ${friend.id}`);
    }

    // 旧: 友だち追加直後に ★NEW タグを付与していたが、5 段階セグメント (VIP/
    // ウォーム/コールド/休眠/NEW) は業種横断的すぎて本質的でないため廃止。
    // 現在はアカウント別カスタムセグメント (/broadcasts/segments) でユーザーが
    // ヒアリングに基づいて定義し、AI が個別判定で付与する方式に移行している。

    // Resolve referral link (entry_route) for this friend.
    // /auth/callback (OAuth path) writes friends.ref_code in parallel with
    // this follow webhook, so the field can briefly be NULL when LINE
    // delivers the event. Retry a few times (~1s total) before giving up,
    // otherwise override mode and intro pushes silently fall back to the
    // account default whenever the webhook wins the race.
    const { getFriendById } = await import('@line-crm/db');
    let friendRefCode = (friend as { ref_code?: string | null }).ref_code ?? null;
    if (!friendRefCode) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const refreshed = await getFriendById(db, friend.id);
        const refreshedRef = (refreshed as { ref_code?: string | null } | null)?.ref_code ?? null;
        if (refreshedRef) {
          friendRefCode = refreshedRef;
          break;
        }
      }
    }
    const referralRoute: EntryRoute | null = friendRefCode
      ? await getEntryRouteByRefCode(db, friendRefCode)
      : null;
    const runAccountScenarios =
      !referralRoute || referralRoute.run_account_friend_add_scenarios !== 0;

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    // Skip entirely when a referral link explicitly overrides (run_account_friend_add_scenarios=0).
    const scenarios = runAccountScenarios ? await getScenarios(db) : [];
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          // INSERT OR IGNORE handles dedup via UNIQUE(friend_id, scenario_id)
          const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (!friendScenario) continue; // already enrolled

            // Immediate delivery: scenario.delivery_mode を踏まえて step1 が「now 以前」に
            // スケジュールされる場合のみ replyMessage で即時送信する。
            // - relative + delay_minutes=0 → 即時
            // - elapsed + offset_days=0 + offset_minutes=0 → 即時
            // - absolute_time で過去時刻 → computeNextDeliveryAt が now に clamp するので即時
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            const deliveryMode = scenario.delivery_mode ?? 'relative';
            const enrolledAtJst = new Date(Date.now() + 9 * 60 * 60_000);
            const firstScheduledAt = firstStep
              ? computeNextDeliveryAt(
                  { delivery_mode: deliveryMode },
                  firstStep,
                  { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
                )
              : null;
            const shouldSendImmediately =
              firstStep &&
              firstScheduledAt !== null &&
              firstScheduledAt.getTime() <= enrolledAtJst.getTime() &&
              friendScenario.status === 'active';
            if (firstStep && shouldSendImmediately) {
              try {
                // Resolve template_id → templates table (参照型)
                const resolved = await resolveStepContent(db, firstStep);
                const { resolveMetadata } = await import('../services/step-delivery.js');
                const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
                const expandedContent = expandVariables(resolved.messageContent, { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1]);
                const message = buildMessage(resolved.messageType, expandedContent);
                await lineClient.replyMessage(event.replyToken, [message]);
                console.log(`Immediate delivery: sent step ${firstStep.id} to ${userId}`);

                // Log what was actually delivered (post buildMessage normalization)
                // so the dashboard chat view mirrors LINE 1:1.
                const logId = crypto.randomUUID();
                const { messageToLogPayload: logPayload1 } = await import('../services/step-delivery.js');
                const wbScenarioPayload = logPayload1(message);
                await db
                  .prepare(
                    `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, template_id_at_send, created_at)
                     VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', 'scenario', ?, ?)`,
                  )
                  .bind(logId, friend.id, wbScenarioPayload.messageType, wbScenarioPayload.content, firstStep.id, resolved.templateIdAtSend, jstNow())
                  .run();

                // Advance or complete the friend_scenario — step 2 のスケジュールも
                // computeNextDeliveryAt で計算する（elapsed/absolute_time で正しく動かすため）
                const secondStep = steps[1] ?? null;
                if (secondStep) {
                  const nextDeliveryDate = computeNextDeliveryAt(
                    { delivery_mode: deliveryMode },
                    secondStep,
                    { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
                  );
                  await advanceFriendScenario(db, friendScenario.id, firstStep.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }

                // 到達タグ付与 (advance / complete の後)
                if (firstStep.on_reach_tag_id) {
                  try {
                    await addTagToFriend(db, friend.id, firstStep.on_reach_tag_id);
                  } catch (err) {
                    console.error(`[scenario] tag attach failed step=${firstStep.id}:`, err);
                  }
                }
              } catch (err) {
                console.error('Failed immediate delivery for scenario', scenario.id, err);
              }
            }
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // Referral link side-effects (intro push + dedicated scenario)
    if (referralRoute) {
      // Intro push from referral link
      if (referralRoute.intro_template_id) {
        try {
          const template = await getMessageTemplateById(db, referralRoute.intro_template_id);
          if (template) {
            const message = buildMessage(template.message_type, template.message_content);
            await lineClient.pushMessage(userId, [message]);
            console.log(`[follow] referral intro push sent route=${referralRoute.id}`);
          }
        } catch (err) {
          console.error('[follow] referral intro push failed', err);
        }
      }

      // Dedicated scenario enrollment from referral link
      if (referralRoute.scenario_id) {
        try {
          await enrollFriendInScenario(db, friend.id, referralRoute.scenario_id);
          console.log(`[follow] referral scenario enrolled scenario=${referralRoute.scenario_id}`);
        } catch (err) {
          console.error('[follow] referral scenario enrollment failed', err);
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);

    // AI 自動化（automation_level に応じてジョブを enqueue）
    if (lineAccountId) {
      try {
        await enqueueOnFriendAdd(db, {
          lineAccountId,
          friendId: friend.id,
          displayName: friend.display_name,
        });
      } catch (e) {
        console.error('[follow] AI enqueue failed (non-fatal):', e);
      }
    }
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false);
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    // 公式 LINE と同じ挙動: postback (リッチメニュー / Flex ボタン等) でも未登録なら登録。
    const friend = await ensureFriendForUserId(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const postbackData = (event as unknown as { postback: { data: string } }).postback.data;

    // Match postback data against auto_replies (exact match on keyword)
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        template_id: string | null;
      }>();

    // postback の incoming 自体を messages_log に記録する。Rich Menu のタップで
     // 利用者が "コスト比較" などのアクションを起こした事実を chat 履歴で可視化する。
     // delivery_type='push' は厳密には push ではないが、incoming/non-test として
     // 既存 chat list / 詳細 SQL のフィルタを通すための妥当な値 (auto_reply text 同様)。
    try {
      await db
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'postback', ?, ?)`,
        )
        .bind(crypto.randomUUID(), friend.id, postbackData, lineAccountId ?? null, jstNow())
        .run();
    } catch (err) {
      console.error('Failed to log incoming postback', err);
    }

    // --- 組み込み postback ハンドラ: open-link ---
    // 全配信パイプラインの transformFlexContentForPostback で uri アクションを
    // postback+displayText に変換した際、`data = open-link:<base64url>` で来る。
    // base64 復元 → 1 タップで開ける uri ボタン Flex を reply。
    if (postbackData.startsWith('open-link:')) {
      try {
        const { b64UrlDecode } = await import('../services/flex-postback-transform.js');
        const encoded = postbackData.slice('open-link:'.length);
        const targetUrl = b64UrlDecode(encoded);
        if (/^https?:\/\//i.test(targetUrl)) {
          const replyFlex = {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                { type: 'text', text: '↓ ここから開いてください ↓', size: 'xs', color: '#666666' },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: '#06C755',
                  height: 'sm',
                  action: { type: 'uri', label: '開く', uri: targetUrl },
                },
              ],
            },
          };
          await lineClient.replyMessage(event.replyToken, [
            { type: 'flex', altText: '開く', contents: replyFlex } as never,
          ]);
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', 'flex', ?, NULL, NULL, 'reply', 'open_link_postback', ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              friend.id,
              JSON.stringify(replyFlex),
              lineAccountId ?? null,
              jstNow(),
            )
            .run();
        }
      } catch (err) {
        console.error('[open-link-postback] failed', err);
      }
      return;
    }

    // --- 組み込み postback ハンドラ ---
    // クーポン Flex のフッターボタンが `open-coupon:<id>` で来る (coupons.ts buildCouponFlex)。
    // この場合は (1) 友だちは既に ensureFriendForUserId で登録済み (2) LIFF URL を返信して
    // 1 タップで LIFF を開ける状態にする。auto_reply ループより前で処理して reply_token を使い切る。
    if (postbackData.startsWith('open-coupon:')) {
      const couponId = postbackData.slice('open-coupon:'.length);
      try {
        const couponRow = await db
          .prepare(`SELECT id, name, line_account_id FROM coupons WHERE id = ?`)
          .bind(couponId)
          .first<{ id: string; name: string; line_account_id: string }>();
        if (couponRow && workerUrl) {
          const couponUrl = `${workerUrl}/c?id=${couponId}`;
          const replyFlex = {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              spacing: 'md',
              contents: [
                { type: 'text', text: `🎟️ ${couponRow.name}`, weight: 'bold', size: 'md', wrap: true },
                { type: 'text', text: '↓ ここから開いてください ↓', size: 'xs', color: '#666666' },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: '#06C755',
                  height: 'sm',
                  action: { type: 'uri', label: 'クーポンを開く', uri: couponUrl },
                },
              ],
            },
          };
          await lineClient.replyMessage(event.replyToken, [
            { type: 'flex', altText: `🎟️ ${couponRow.name}`, contents: replyFlex } as never,
          ]);
          // 返信ログ
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', 'flex', ?, NULL, NULL, 'reply', 'coupon_postback', ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              friend.id,
              JSON.stringify(replyFlex),
              lineAccountId ?? null,
              jstNow(),
            )
            .run();
        }
      } catch (err) {
        console.error('[coupon-postback] failed to reply', err);
      }
      return;
    }

    for (const rule of autoReplies.results) {
      const isMatch = rule.match_type === 'exact'
        ? postbackData === rule.keyword
        : postbackData.includes(rule.keyword);

      if (isMatch) {
        try {
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const resolved = await resolveAutoReplyContent(db, {
            template_id: rule.template_id,
            response_type: rule.response_type,
            response_content: rule.response_content,
          });
          const expandedContent = expandVariables(resolved.content, { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(resolved.messageType, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);

          // 送信ログ — Rich Menu 経由の Flex 応答もチャット詳細に残るようにする。
          // テキスト auto_reply (line ~390) と同じパターン。
          const { messageToLogPayload: logPayload } = await import('../services/step-delivery.js');
          const replyPayload = logPayload(replyMsg);
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', 'auto_reply', ?, ?)`,
            )
            .bind(crypto.randomUUID(), friend.id, replyPayload.messageType, replyPayload.content, lineAccountId ?? null, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send postback reply', err);
        }
        break;
      }
    }
    return;
  }

  // 非テキストの受信メッセージ（スタンプ/画像/音声/動画/ファイル/位置情報等）もログに残す。
  // ここで早期 return することで、テキスト用の auto_reply / scenario 判定には進まない
  // （スタンプ単体に対するキーワードマッチは意味を持たないため）。inbox 抜けだけ防ぐ。
  if (event.type === 'message' && event.message.type !== 'text') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;
    // 非テキスト (スタンプ / 画像 等) でも未登録なら自動登録
    const friend = await ensureFriendForUserId(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const msg = event.message as { type: string; fileName?: string; title?: string };
    const labels: Record<string, string> = {
      sticker: '[スタンプ]',
      image: '[画像]',
      audio: '[音声]',
      video: '[動画]',
      file: msg.fileName ? `[ファイル: ${msg.fileName}]` : '[ファイル]',
      location: msg.title ? `[位置情報: ${msg.title}]` : '[位置情報]',
    };
    const content = labels[msg.type] ?? `[${msg.type}]`;

    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, 'user', ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, msg.type, content, jstNow())
      .run();
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    // テキスト発言でも未登録なら自動登録 (公式 LINE 同等の挙動)
    const friend = await ensureFriendForUserId(db, lineClient, userId, lineAccountId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, 'user', ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } = await import('../services/step-delivery.js');
            await otherClient.pushMessage(other.line_user_id, [bm('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  ...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        console.error('Cross-account trigger error:', err);
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        template_id: string | null;
        is_active: number;
        created_at: string;
      }>();

    let matched = false;
    let replyTokenConsumed = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === 'exact'
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        // silent タイプ: 返信しないが matched=true にして unread / push を抑止する
        if (rule.response_type === 'silent') {
          matched = true;
          break;
        }

        try {
          const { resolveMetadata: resolveMeta2 } = await import('../services/step-delivery.js');
          const resolvedMeta2 = await resolveMeta2(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const resolved = await resolveAutoReplyContent(db, {
            template_id: rule.template_id,
            response_type: rule.response_type,
            response_content: rule.response_content,
          });
          const expandedContent = expandVariables(resolved.content, { ...friend, metadata: resolvedMeta2 } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(resolved.messageType, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
          replyTokenConsumed = true;

          // 送信ログ（replyMessage = 無料）— derive content from the built
          // reply message so any cleanEmptyNodes / parse-failure fallback is
          // reflected in the dashboard.
          const outLogId = crypto.randomUUID();
          const { messageToLogPayload: logPayload2 } = await import('../services/step-delivery.js');
          const wbAutoReplyPayload = logPayload2(replyMsg);
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', 'auto_reply', ?)`,
            )
            .bind(outLogId, friend.id, wbAutoReplyPayload.messageType, wbAutoReplyPayload.content, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send auto-reply', err);
        }

        matched = true;
        break;
      }
    }

    // L-port: auto_replies に未マッチ → AI 接客応答を試みる
    // 条件: ANTHROPIC_API_KEY 設定 + tenant_metering 設定済（プラン契約）
    //       + ai_chat_processing 同意（未記録なら opt-in 扱い、明示的 revoke 時のみ拒否）
    let aiResponded = false;
    if (!matched && lineAccountId && anthropicApiKey && !replyTokenConsumed) {
      try {
        const tenant = await db
          .prepare(`SELECT plan, ai_auto_reply_enabled FROM tenant_metering WHERE line_account_id = ? LIMIT 1`)
          .bind(lineAccountId)
          .first<{ plan: string; ai_auto_reply_enabled: number }>();

        // アカウント単位で AI 自動返信を OFF にしている場合は発火しない (全手動運用)
        if (tenant && tenant.ai_auto_reply_enabled !== 0) {
          const consentRow = await db
            .prepare(
              `SELECT granted FROM consent_records WHERE friend_id = ? AND consent_type = 'ai_chat_processing' LIMIT 1`,
            )
            .bind(friend.id)
            .first<{ granted: number }>();
          const consentDenied = consentRow !== null && consentRow.granted === 0;

          // 対人引き継ぎ中チェック: スタッフが手動返信した友だちは AI を停止
          // スタッフが UI で「AI 応答を再開」を押すまで再開しない (ユーザー要望: 明示的ONのみ再開)
          const pausedRow = await db
            .prepare(`SELECT ai_chat_paused FROM friends WHERE id = ? LIMIT 1`)
            .bind(friend.id)
            .first<{ ai_chat_paused: number }>();
          const aiPaused = pausedRow?.ai_chat_paused === 1;

          if (!consentDenied && !aiPaused) {
            const { respondToChat } = await import('../services/ai-chat.js');
            const aiResult = await respondToChat(db, anthropicApiKey, {
              lineAccountId,
              friendId: friend.id,
              message: incomingText,
            }, { jinaApiKey });

            if (aiResult.reply && aiResult.reply.trim().length > 0) {
              // respondToChat はエスカレ時 (クレーム検知 / 予算超過 / 生成失敗・タイムアウト)
              // でも「担当者よりご連絡します」等のホールディング文を必ず返す。
              // ここで escalated を理由に送信をスキップすると顧客は完全に無言応答になり
              // 「AI ON なのに返事が来ない」状態になるため、エスカレ時も必ず返信を送る。
              // 商品スライダーはエスカレ時には付けない (人に引き継ぐ局面で訴求しない)。
              const hasProducts = !aiResult.escalated && aiResult.productSuggestions.length > 0;
              const replyText = aiResult.reply;

              const messages: Parameters<typeof lineClient.replyMessage>[1] = [];
              if (replyText.trim().length > 0) {
                messages.push(buildMessage('text', replyText));
              }

              let carousel: { contents: Record<string, unknown>; altText: string } | null = null;
              if (hasProducts) {
                const { buildProductCarousel } = await import('../services/ai-chat-product-flex.js');
                carousel = buildProductCarousel(aiResult.productSuggestions);
                if (carousel) {
                  messages.push(
                    buildMessage('flex', JSON.stringify(carousel.contents), carousel.altText),
                  );
                }
              }

              if (messages.length > 0) {
                await lineClient.replyMessage(event.replyToken, messages);
                replyTokenConsumed = true;
                aiResponded = true;
                matched = true;

                if (replyText.trim().length > 0) {
                  await db
                    .prepare(
                      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, created_at)
                       VALUES (?, ?, 'outgoing', 'text', ?, NULL, NULL, 'reply', 'ai_chat', ?)`,
                    )
                    .bind(crypto.randomUUID(), friend.id, replyText, jstNow())
                    .run();
                }

                if (carousel) {
                  await db
                    .prepare(
                      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, created_at)
                       VALUES (?, ?, 'outgoing', 'flex', ?, NULL, NULL, 'reply', 'ai_chat', ?)`,
                    )
                    .bind(crypto.randomUUID(), friend.id, JSON.stringify(carousel.contents), jstNow())
                    .run();
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[webhook] AI auto-reply failed:', err);
        // 失敗時は unread のままスタッフに引き継ぐ
      }
    }
    void aiResponded;

    // auto_replies / AI 応答どちらにもマッチしなかった = 未対応 → unread にする
    if (!matched) {
      await upsertChatOnMessage(db, friend.id);
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

/**
 * auto_reply 行の content/type を resolve する。template_id が set なら templates
 * から取得、参照切れや NULL のときは inline response_content/response_type を使う。
 */
async function resolveAutoReplyContent(
  db: D1Database,
  rule: { template_id: string | null; response_type: string; response_content: string },
): Promise<{ messageType: string; content: string }> {
  if (rule.template_id) {
    const { getTemplateById } = await import('@line-crm/db');
    const tpl = await getTemplateById(db, rule.template_id);
    if (tpl) {
      return { messageType: tpl.message_type, content: tpl.message_content };
    }
  }
  return { messageType: rule.response_type, content: rule.response_content };
}

export { webhook };
