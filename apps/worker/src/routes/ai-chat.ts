/**
 * AI チャット API routes
 *
 * POST /api/ai-chat/respond  - ユーザーメッセージに AI が応答（テスト用）
 * POST /api/ai-chat/preview  - 設定確認用のプレビュー応答
 * GET  /api/ai-chat/recent   - 直近の AI 応答ログ
 */

import { Hono } from 'hono';
import { respondToChat } from '../services/ai-chat.js';
import type { Env } from '../index.js';

export const aiChat = new Hono<Env & { Bindings: { ANTHROPIC_API_KEY?: string } }>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

aiChat.post('/api/ai-chat/respond', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured. Set via wrangler secret put ANTHROPIC_API_KEY.' }, 503);
  }

  const body = await c.req.json<{
    friend_id: string;
    message: string;
    image_url?: string;
  }>();

  if (!body.friend_id || !body.message) {
    return c.json({ success: false, error: 'friend_id and message required' }, 400);
  }
  if (body.message.length > 4000) {
    return c.json({ success: false, error: 'message too long (4000 chars max)' }, 400);
  }

  try {
    const result = await respondToChat(c.env.DB, apiKey, {
      lineAccountId,
      friendId: body.friend_id,
      message: body.message,
      imageUrl: body.image_url,
    });
    return c.json({ success: true, ...result });
  } catch (e) {
    console.error('[ai-chat] error:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : 'AI chat failed' }, 500);
  }
});

aiChat.post('/api/ai-chat/preview', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<{ message: string }>();
  if (!body.message) {
    return c.json({ success: false, error: 'message required' }, 400);
  }

  try {
    const result = await respondToChat(c.env.DB, apiKey, {
      lineAccountId,
      friendId: 'preview-friend',
      message: body.message,
    });
    return c.json({ success: true, ...result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'preview failed' }, 500);
  }
});

aiChat.get('/api/ai-chat/recent', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const ratingFilter = c.req.query('rating'); // '-1' | '0' | '1' | undefined

  let sql = `SELECT id, friend_id, message_text, intent, model_used, input_tokens, output_tokens,
                    cost_yen_x100, cached_response, escalated, vision_used,
                    quality_rating, quality_note, rated_at, created_at
             FROM ai_chat_metadata
             WHERE line_account_id = ?`;
  const params: (string | number)[] = [lineAccountId];
  if (ratingFilter === '-1' || ratingFilter === '0' || ratingFilter === '1') {
    sql += ' AND quality_rating = ?';
    params.push(parseInt(ratingFilter, 10));
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const result = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ success: true, items: result.results });
});

/**
 * POST /api/ai-chat/:id/rate
 *
 * AI 応答に対する品質評価を保存する。
 * body: { rating: -1 | 1, note?: string }
 */
aiChat.post('/api/ai-chat/:id/rate', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const body = await c.req.json<{ rating: -1 | 1; note?: string }>();

  if (body.rating !== -1 && body.rating !== 1) {
    return c.json({ success: false, error: 'rating must be -1 or 1' }, 400);
  }
  if (body.note && body.note.length > 1000) {
    return c.json({ success: false, error: 'note too long (1000 chars max)' }, 400);
  }

  const exists = await c.env.DB
    .prepare(`SELECT id FROM ai_chat_metadata WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId)
    .first();
  if (!exists) {
    return c.json({ success: false, error: 'not found' }, 404);
  }

  await c.env.DB
    .prepare(
      `UPDATE ai_chat_metadata
       SET quality_rating = ?, quality_note = ?, rated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
       WHERE id = ? AND line_account_id = ?`,
    )
    .bind(body.rating, body.note ?? null, id, lineAccountId)
    .run();

  return c.json({ success: true });
});

/**
 * GET /api/ai-chat/quality-summary
 *
 * 品質評価の集計（直近 30 日）
 */
aiChat.get('/api/ai-chat/quality-summary', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const result = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN quality_rating = 1 THEN 1 ELSE 0 END) AS positive,
         SUM(CASE WHEN quality_rating = -1 THEN 1 ELSE 0 END) AS negative,
         SUM(CASE WHEN quality_rating = 0 THEN 1 ELSE 0 END) AS unrated
       FROM ai_chat_metadata
       WHERE line_account_id = ?
         AND created_at >= datetime('now', '-30 days', '+9 hours')`,
    )
    .bind(lineAccountId)
    .first<{ total: number; positive: number; negative: number; unrated: number }>();

  return c.json({ success: true, summary: result ?? { total: 0, positive: 0, negative: 0, unrated: 0 } });
});
