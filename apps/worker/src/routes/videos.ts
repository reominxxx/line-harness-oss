/**
 * 動画アップロード API
 *
 * POST /api/videos?filename=foo.mp4
 *   Headers: Content-Type: video/mp4 (or video/quicktime etc.)
 *   Body:    raw binary (大きい動画は streaming で受信)
 *   Resp:    { success: true, data: { url, key, contentType, size? } }
 *
 * R2 に直接書き込み、broadcast-images の公開ルート (/api/broadcast-images/:key)
 * を流用して配信。LINE Messaging API の video.originalContentUrl にそのまま使える。
 *
 * Note: Cloudflare Workers の request body 上限は Free 100MB / Paid 500MB。
 * LINE の動画は 200MB まで対応なので、Paid 想定。
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const videos = new Hono<Env>();

const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
]);
const MAX_BYTES = 200 * 1024 * 1024; // 200MB (LINE 上限)

videos.post('/api/videos', async (c) => {
  const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
  // LINE 推奨は MP4 だが、それ以外も R2 には保存可。配信時に検証は LINE 側で行われる。
  const mime = ALLOWED_MIMES.has(contentType) ? contentType : 'video/mp4';

  const filename = c.req.query('filename') ?? 'video.mp4';
  const safeExt = filename.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase() || 'mp4';
  const key = `broadcast-images/videos/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${safeExt}`;

  // Content-Length が分かれば事前に上限チェック
  const lenHeader = c.req.header('Content-Length');
  if (lenHeader) {
    const n = Number(lenHeader);
    if (Number.isFinite(n) && n > MAX_BYTES) {
      return c.json({ success: false, error: `ファイルサイズが大きすぎます (上限 200MB、受信 ${Math.floor(n / 1024 / 1024)}MB)` }, 413);
    }
  }

  const body = c.req.raw.body;
  if (!body) return c.json({ success: false, error: 'リクエストボディが空です' }, 400);

  try {
    await c.env.IMAGES.put(key, body, {
      httpMetadata: { contentType: mime },
    });
  } catch (e) {
    console.error('[videos] R2 put failed:', e);
    return c.json({ success: false, error: 'R2 への保存に失敗しました' }, 500);
  }

  const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
  const url = `${origin}/api/broadcast-images/${encodeURIComponent(key)}`;
  return c.json({
    success: true,
    data: { url, key, contentType: mime },
  });
});
