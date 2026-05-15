/**
 * AI 顧客シグナル API routes
 *
 * GET  /api/ai-signals/:friend_id            個別顧客の AI シグナル
 * POST /api/ai-signals/:friend_id            シグナル更新（バッチからの呼び出し or 手動）
 * GET  /api/ai-signals/hot                   ホットリード一覧
 * GET  /api/ai-signals/rank/:rank            ランク別一覧
 */

import { Hono } from 'hono';
import {
  getAiFriendSignal,
  upsertAiFriendSignal,
  listHotLeads,
  listByVipRank,
  type VipRank,
  type Sentiment,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const aiSignals = new Hono<Env>();

const VALID_RANKS: VipRank[] = ['vip', 'hot', 'warm', 'cold', 'dormant', 'new'];

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

aiSignals.get('/api/ai-signals/friend/:friend_id', async (c) => {
  const friendId = c.req.param('friend_id');
  const signal = await getAiFriendSignal(c.env.DB, friendId);
  return c.json({ success: true, signal });
});

aiSignals.post('/api/ai-signals/friend/:friend_id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const friendId = c.req.param('friend_id');
  const body = await c.req.json<{
    purchase_intent?: number;
    churn_risk?: number;
    ltv_estimate_yen?: number;
    vip_rank?: VipRank;
    sentiment?: Sentiment;
    signal_summary?: string;
    last_chat_at?: string;
  }>();

  if (body.purchase_intent !== undefined && (body.purchase_intent < 0 || body.purchase_intent > 100)) {
    return c.json({ success: false, error: 'purchase_intent must be 0-100' }, 400);
  }
  if (body.churn_risk !== undefined && (body.churn_risk < 0 || body.churn_risk > 100)) {
    return c.json({ success: false, error: 'churn_risk must be 0-100' }, 400);
  }
  if (body.vip_rank && !VALID_RANKS.includes(body.vip_rank)) {
    return c.json({ success: false, error: 'Invalid vip_rank' }, 400);
  }

  await upsertAiFriendSignal(c.env.DB, {
    friendId,
    lineAccountId,
    purchaseIntent: body.purchase_intent,
    churnRisk: body.churn_risk,
    ltvEstimateYen: body.ltv_estimate_yen,
    vipRank: body.vip_rank,
    sentiment: body.sentiment,
    signalSummary: body.signal_summary,
    lastChatAt: body.last_chat_at,
  });
  const updated = await getAiFriendSignal(c.env.DB, friendId);
  return c.json({ success: true, signal: updated });
});

aiSignals.get('/api/ai-signals/hot', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const minIntent = parseInt(c.req.query('min_intent') ?? '60', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const items = await listHotLeads(c.env.DB, lineAccountId, minIntent, limit);
  return c.json({ success: true, items });
});

aiSignals.get('/api/ai-signals/rank/:rank', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const rank = c.req.param('rank');
  if (!VALID_RANKS.includes(rank as VipRank)) {
    return c.json({ success: false, error: 'Invalid rank' }, 400);
  }
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const items = await listByVipRank(c.env.DB, lineAccountId, rank as VipRank, limit);
  return c.json({ success: true, items });
});

aiSignals.get('/api/ai-signals/summary', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  // ランク別カウント
  const result = await c.env.DB
    .prepare(
      `SELECT vip_rank, COUNT(*) as count
       FROM ai_friend_signals
       WHERE line_account_id = ?
       GROUP BY vip_rank`,
    )
    .bind(lineAccountId)
    .all<{ vip_rank: string | null; count: number }>();

  const counts: Record<string, number> = {};
  for (const r of result.results) {
    counts[r.vip_rank ?? 'unranked'] = r.count;
  }

  // 平均スコア
  const avg = await c.env.DB
    .prepare(
      `SELECT AVG(purchase_intent) as avg_intent, AVG(churn_risk) as avg_churn, AVG(ltv_estimate_yen) as avg_ltv
       FROM ai_friend_signals
       WHERE line_account_id = ?`,
    )
    .bind(lineAccountId)
    .first<{ avg_intent: number; avg_churn: number; avg_ltv: number }>();

  return c.json({
    success: true,
    rank_counts: counts,
    avg_purchase_intent: avg?.avg_intent ?? 0,
    avg_churn_risk: avg?.avg_churn ?? 0,
    avg_ltv_estimate_yen: avg?.avg_ltv ?? 0,
  });
});
