/**
 * 個別文面（休眠 / ウォームリード）→ 個別 push 配信
 *
 * wake_dormant / wake_warm_leads の output_json:
 *   {
 *     messages: [
 *       { friend_id, display_name, message, ... }
 *     ]
 *   }
 *
 * 各 friend に対して draft broadcasts を friend 単位で個別作成し、
 * scheduled として LINE Harness の既存配信エンジンに乗せる。
 *
 * 注意: 既存 broadcasts は target_type='all'/'tag'/'segment' のみで、
 *      friend 個別指定は無い。今は一時的なタグを付けて 1 broadcast = 1 friend
 *      で運用する（簡易実装）。
 */

import { jstNow } from '@line-crm/db';
import type { PostActionContext, PostActionResult } from './index.js';

export async function handleWakeMessagesPost(ctx: PostActionContext): Promise<PostActionResult> {
  const { job, db } = ctx;

  if (!job.output_json) return { ok: false, error: 'no output_json' };

  let parsed: {
    messages?: Array<{ friend_id?: string; display_name?: string | null; message?: string }>;
  };
  try {
    parsed = JSON.parse(job.output_json);
  } catch {
    return { ok: false, error: 'output_json parse failed' };
  }

  const messages = parsed.messages ?? [];
  if (messages.length === 0) {
    return { ok: false, error: 'no messages in output' };
  }

  // 一時タグ作成（後でバッチ削除可能なネーミング）
  const tagName = `_auto:${job.job_type}:${job.id.slice(0, 8)}`;
  const tagId = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(`INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, '#9333ea', ?)`)
      .bind(tagId, tagName, now)
      .run();
  } catch (e) {
    return { ok: false, error: `tag create failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 各 friend にタグ付け + broadcast 作成（1 broadcast = 1 friend）
  let createdCount = 0;
  let failedCount = 0;
  const broadcastIds: string[] = [];

  for (const m of messages) {
    if (!m.friend_id || !m.message) {
      failedCount++;
      continue;
    }

    try {
      // タグ付与
      await db
        .prepare(
          `INSERT OR IGNORE INTO friend_tags (id, friend_id, tag_id, created_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), m.friend_id, tagId, now)
        .run();

      // broadcast 作成
      const broadcastId = crypto.randomUUID();
      const scheduled = new Date();
      scheduled.setUTCMinutes(scheduled.getUTCMinutes() + 30); // 30 分後に配信
      await db
        .prepare(
          `INSERT INTO broadcasts (
             id, title, message_type, message_content, target_type, target_tag_id,
             status, scheduled_at, created_at
           ) VALUES (?, ?, 'text', ?, 'tag', ?, 'scheduled', ?, ?)`,
        )
        .bind(
          broadcastId,
          `${job.job_type === 'wake_dormant' ? '休眠' : 'ウォーム'}: ${m.display_name ?? m.friend_id.slice(0, 8)}`,
          m.message,
          tagId,
          scheduled.toISOString(),
          now,
        )
        .run();
      broadcastIds.push(broadcastId);
      createdCount++;
    } catch (e) {
      console.error(`[wake-messages-post] failed for friend ${m.friend_id}:`, e);
      failedCount++;
    }
  }

  if (createdCount === 0) {
    return { ok: false, error: `all ${messages.length} messages failed to schedule` };
  }

  return {
    ok: true,
    createdResource: broadcastIds.join(','),
    createdResourceType: 'broadcast_batch',
    notes: `${createdCount} 件の個別配信を予約（タグ ${tagName}、30 分後配信予定）${failedCount > 0 ? ` ／ ${failedCount} 件失敗` : ''}`,
  };
}
