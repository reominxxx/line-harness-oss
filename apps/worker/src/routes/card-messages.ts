/**
 * カード型メッセージ API
 *
 * 公式 LINE 風のカード型メッセージ (Flex Carousel) を CRUD する。
 * 内部的に Flex JSON を生成し、配信時は messageType='flex' で送信する。
 *
 * GET    /api/card-messages           一覧 (アカウント別)
 * POST   /api/card-messages           新規作成
 * GET    /api/card-messages/:id       詳細
 * PATCH  /api/card-messages/:id       更新
 * DELETE /api/card-messages/:id       削除
 * POST   /api/card-messages/:id/preview-flex   生成済 Flex JSON を返す (プレビュー用)
 */

import { Hono } from 'hono';
import {
  listCardMessages,
  getCardMessage,
  createCardMessage,
  updateCardMessage,
  deleteCardMessage,
  type CardType,
  type CardItem,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const cardMessages = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

cardMessages.get('/api/card-messages', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const items = await listCardMessages(c.env.DB, accountId);
  return c.json({ success: true, items });
});

cardMessages.get('/api/card-messages/:id', async (c) => {
  const item = await getCardMessage(c.env.DB, c.req.param('id'));
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, item });
});

cardMessages.post('/api/card-messages', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = await c.req.json<{
    name?: string;
    cardType?: CardType;
    cards?: CardItem[];
    altText?: string;
    moreCard?: { label: string; actionType: 'uri' | 'message' | 'coupon' | 'research'; data: string } | null;
  }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name required' }, 400);
  if (!body.cardType || !['product', 'location', 'person', 'image'].includes(body.cardType)) {
    return c.json({ success: false, error: 'cardType must be product/location/person/image' }, 400);
  }
  if (!Array.isArray(body.cards) || body.cards.length === 0) {
    return c.json({ success: false, error: 'cards (array, min 1) required' }, 400);
  }
  if (body.cards.length > 12) {
    return c.json({ success: false, error: 'cards max 12' }, 400);
  }
  const item = await createCardMessage(c.env.DB, {
    lineAccountId: accountId,
    name: body.name.trim(),
    cardType: body.cardType,
    cards: body.cards,
    altText: body.altText,
    moreCard: body.moreCard ?? null,
  });
  return c.json({ success: true, item });
});

cardMessages.patch('/api/card-messages/:id', async (c) => {
  const body = await c.req.json<{
    name?: string;
    cardType?: CardType;
    cards?: CardItem[];
    altText?: string | null;
    moreCard?: { label: string; actionType: 'uri' | 'message' | 'coupon' | 'research'; data: string } | null;
  }>();
  const item = await updateCardMessage(c.env.DB, c.req.param('id'), body);
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, item });
});

cardMessages.delete('/api/card-messages/:id', async (c) => {
  await deleteCardMessage(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

cardMessages.post('/api/card-messages/:id/preview-flex', async (c) => {
  const item = await getCardMessage(c.env.DB, c.req.param('id'));
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  let flex: unknown = null;
  try { flex = item.flex_json ? JSON.parse(item.flex_json) : null; } catch { /* invalid */ }
  return c.json({ success: true, flex });
});
