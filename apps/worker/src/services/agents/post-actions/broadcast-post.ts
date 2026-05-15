/**
 * 配信案 → broadcasts への予約挿入
 *
 * generate_broadcast の output_json が以下の形であることを期待:
 *   {
 *     title: "..."          // 管理用件名
 *     content: "..."        // 配信本文
 *     recommendedSendTime?: ISO 8601
 *     suggestedTags?: string[]
 *   }
 */

import { jstNow } from '@line-crm/db';
import type { PostActionContext, PostActionResult } from './index.js';

export async function handleBroadcastPost(ctx: PostActionContext): Promise<PostActionResult> {
  const { job, db } = ctx;

  if (!job.output_json) {
    return { ok: false, error: 'no output_json' };
  }

  let parsed: {
    title?: string;
    content?: string;
    recommendedSendTime?: string;
    suggestedTags?: string[];
  };
  try {
    parsed = JSON.parse(job.output_json);
  } catch {
    return { ok: false, error: 'output_json parse failed' };
  }

  const content = parsed.content;
  const title = parsed.title || `自動生成配信 ${new Date().toLocaleString('ja-JP')}`;

  if (!content || typeof content !== 'string') {
    return { ok: false, error: 'output.content is missing' };
  }

  // 推奨時刻が未指定 or 過去なら、24 時間後に予約
  let scheduledAt = parsed.recommendedSendTime;
  if (!scheduledAt || new Date(scheduledAt).getTime() < Date.now()) {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() + 24);
    scheduledAt = d.toISOString();
  }

  // suggested タグがあれば最初の 1 つを target_tag_id に
  let targetTagId: string | null = null;
  let targetType: 'all' | 'tag' = 'all';
  if (parsed.suggestedTags && parsed.suggestedTags.length > 0) {
    const tagName = parsed.suggestedTags[0];
    try {
      const tag = await db
        .prepare(`SELECT id FROM tags WHERE name = ? LIMIT 1`)
        .bind(tagName)
        .first<{ id: string }>();
      if (tag) {
        targetTagId = tag.id;
        targetType = 'tag';
      }
    } catch {
      /* タグなくても全配信で OK */
    }
  }

  const broadcastId = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO broadcasts (
           id, title, message_type, message_content, target_type, target_tag_id,
           status, scheduled_at, created_at
         ) VALUES (?, ?, 'text', ?, ?, ?, 'scheduled', ?, ?)`,
      )
      .bind(
        broadcastId,
        title.slice(0, 200),
        content,
        targetType,
        targetTagId,
        scheduledAt,
        now,
      )
      .run();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'broadcast insert failed' };
  }

  return {
    ok: true,
    createdResource: broadcastId,
    createdResourceType: 'broadcast',
    notes: `予約配信を作成しました（${new Date(scheduledAt).toLocaleString('ja-JP')} 配信予定）`,
  };
}
