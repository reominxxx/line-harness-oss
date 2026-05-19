/**
 * 配信案 → broadcasts への予約挿入
 *
 * generate_broadcast の output_json が以下の形であることを期待:
 *   {
 *     title: "..."                  // 管理用件名
 *     content: "..."                // 配信本文 (LINE 表示用テキスト)
 *     recommendedSendTime?: ISO 8601
 *     suggestedTags?: string[]
 *     imageUrl?: string             // GPT-Image-2 で生成 or 手動指定の画像 URL
 *     flexContent?: string          // Flex Message の JSON 文字列 (指定があれば優先)
 *   }
 *
 * 優先順位:
 *   flexContent (JSON 妥当) > imageUrl > content (テキスト)
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
    imageUrl?: string | null;
    flexContent?: string | null;
  };
  try {
    parsed = JSON.parse(job.output_json);
  } catch {
    return { ok: false, error: 'output_json parse failed' };
  }

  const title = parsed.title || `自動生成配信 ${new Date().toLocaleString('ja-JP')}`;

  // メッセージ種別の判定
  let messageType: 'text' | 'image' | 'flex' = 'text';
  let messageContent: string;

  if (parsed.flexContent && parsed.flexContent.trim().length > 0) {
    // Flex を最優先 (JSON 妥当性チェック)
    try {
      JSON.parse(parsed.flexContent);
      messageType = 'flex';
      messageContent = parsed.flexContent;
    } catch {
      return { ok: false, error: 'flexContent is not valid JSON' };
    }
  } else if (parsed.imageUrl && parsed.imageUrl.trim().length > 0) {
    // 画像 + テキストの場合は LINE の image メッセージ
    messageType = 'image';
    const imageUrl = absolutizeImageUrl(parsed.imageUrl, ctx.workerUrl);
    messageContent = JSON.stringify({
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });
  } else {
    // テキストのみ
    if (!parsed.content || typeof parsed.content !== 'string') {
      return { ok: false, error: 'output.content is missing' };
    }
    messageType = 'text';
    messageContent = parsed.content;
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
         ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      )
      .bind(
        broadcastId,
        title.slice(0, 200),
        messageType,
        messageContent,
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
    notes: `予約配信を作成しました（${new Date(scheduledAt).toLocaleString('ja-JP')} 配信予定 / ${messageType}）`,
  };
}

/**
 * imageUrl が "/api/broadcast-images/..." のような相対パスなら、
 * worker URL を頭に付けて絶対 URL に。LINE は https:// 必須。
 */
function absolutizeImageUrl(url: string, workerUrl?: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (workerUrl) {
    const base = workerUrl.replace(/\/$/, '');
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  // フォールバック: 本番 worker URL
  return `https://line-harness-test.reoyakyu428z.workers.dev${url.startsWith('/') ? '' : '/'}${url}`;
}
