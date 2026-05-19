/**
 * シグナル→自動アクション ルール API (Big Move 4)
 *
 * GET    /api/signal-actions               一覧
 * POST   /api/signal-actions               作成
 * PUT    /api/signal-actions/:id           更新
 * DELETE /api/signal-actions/:id           削除
 * GET    /api/signal-actions/logs          発火ログ
 */

import { Hono } from 'hono';
import {
  listFriendSignalActions,
  createFriendSignalAction,
  updateFriendSignalAction,
  deleteFriendSignalAction,
  listFriendSignalActionLogs,
  type SignalActionTriggerType,
  type SignalActionType,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const signalActions = new Hono<Env>();

const VALID_TRIGGER_TYPES: SignalActionTriggerType[] = [
  'purchase_intent_gte',
  'churn_risk_gte',
  'vip_rank_eq',
  'sentiment_eq',
  'days_since_last_purchase_gte',
  'total_purchases_gte',
  'total_spent_yen_gte',
];
const VALID_ACTION_TYPES: SignalActionType[] = [
  'add_tag',
  'remove_tag',
  'enroll_scenario',
  'send_message',
  'notify_staff',
];

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

signalActions.get('/api/signal-actions', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);
  const includeInactive = new URL(c.req.url).searchParams.get('include_inactive') === '1';
  const rows = await listFriendSignalActions(c.env.DB, lineAccountId, {
    activeOnly: !includeInactive,
  });
  return c.json({ success: true, actions: rows });
});

signalActions.post('/api/signal-actions', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);
  type Body = {
    name?: string;
    trigger_type?: string;
    trigger_value?: string;
    cooldown_days?: number;
    action_type?: string;
    action_value?: string;
    is_active?: boolean;
  };
  const body = (await c.req.json<Body>().catch(() => ({}))) as Body;
  if (!body.name || !body.trigger_type || !body.trigger_value || !body.action_type || !body.action_value) {
    return c.json({ success: false, error: 'missing required fields' }, 400);
  }
  if (!(VALID_TRIGGER_TYPES as readonly string[]).includes(body.trigger_type)) {
    return c.json({ success: false, error: 'invalid trigger_type' }, 400);
  }
  if (!(VALID_ACTION_TYPES as readonly string[]).includes(body.action_type)) {
    return c.json({ success: false, error: 'invalid action_type' }, 400);
  }
  const row = await createFriendSignalAction(c.env.DB, {
    lineAccountId,
    name: body.name,
    triggerType: body.trigger_type as SignalActionTriggerType,
    triggerValue: body.trigger_value,
    cooldownDays: body.cooldown_days,
    actionType: body.action_type as SignalActionType,
    actionValue: body.action_value,
    isActive: body.is_active !== false,
  });
  return c.json({ success: true, action: row });
});

signalActions.put('/api/signal-actions/:id', async (c) => {
  type Body = Partial<{
    name: string;
    trigger_type: string;
    trigger_value: string;
    cooldown_days: number;
    action_type: string;
    action_value: string;
    is_active: boolean;
  }>;
  const body = (await c.req.json<Body>().catch(() => ({}))) as Body;
  const row = await updateFriendSignalAction(c.env.DB, c.req.param('id'), {
    name: body.name,
    triggerType: body.trigger_type as SignalActionTriggerType | undefined,
    triggerValue: body.trigger_value,
    cooldownDays: body.cooldown_days,
    actionType: body.action_type as SignalActionType | undefined,
    actionValue: body.action_value,
    isActive: body.is_active,
  });
  if (!row) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, action: row });
});

signalActions.delete('/api/signal-actions/:id', async (c) => {
  await deleteFriendSignalAction(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

signalActions.get('/api/signal-actions/logs', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);
  const limit = Math.min(parseInt(new URL(c.req.url).searchParams.get('limit') ?? '100', 10), 500);
  const logs = await listFriendSignalActionLogs(c.env.DB, lineAccountId, limit);
  return c.json({ success: true, logs });
});
