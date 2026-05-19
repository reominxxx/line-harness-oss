/**
 * シグナル→自動アクション ルール (Big Move 4)
 *
 * 顧客のシグナル (purchase_intent / churn_risk / vip_rank / sentiment) や
 * 行動メトリクス (days_since_last_purchase 等) を見て、自動でタグ付与 /
 * シナリオ enroll / メッセージ送信 / スタッフ通知 を実行するルールエンジン。
 *
 * 評価タイミング:
 *   - calculate-intent-scores ジョブの最後 (シグナル更新後)
 *   - summarize-friend-profile ジョブの最後 (累計購入等の更新後)
 */

import { jstNow } from './utils.js';

export type SignalActionTriggerType =
  | 'purchase_intent_gte'
  | 'churn_risk_gte'
  | 'vip_rank_eq'
  | 'sentiment_eq'
  | 'days_since_last_purchase_gte'
  | 'total_purchases_gte'
  | 'total_spent_yen_gte';

export type SignalActionType =
  | 'add_tag'
  | 'remove_tag'
  | 'enroll_scenario'
  | 'send_message'
  | 'notify_staff';

export interface FriendSignalActionRow {
  id: string;
  line_account_id: string;
  name: string;
  trigger_type: SignalActionTriggerType;
  trigger_value: string;
  cooldown_days: number;
  action_type: SignalActionType;
  action_value: string;
  is_active: number;
  last_triggered_at: string | null;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

export interface FriendSignalActionLogRow {
  id: string;
  action_id: string;
  friend_id: string;
  line_account_id: string;
  result: 'success' | 'failed' | 'skipped_cooldown';
  details: string | null;
  fired_at: string;
}

export async function listFriendSignalActions(
  db: D1Database,
  lineAccountId: string,
  options: { activeOnly?: boolean } = {},
): Promise<FriendSignalActionRow[]> {
  const where = options.activeOnly === false
    ? 'WHERE line_account_id = ?'
    : 'WHERE line_account_id = ? AND is_active = 1';
  const result = await db
    .prepare(`SELECT * FROM friend_signal_actions ${where} ORDER BY created_at DESC`)
    .bind(lineAccountId)
    .all<FriendSignalActionRow>();
  return result.results;
}

export async function getFriendSignalAction(
  db: D1Database,
  id: string,
): Promise<FriendSignalActionRow | null> {
  return db
    .prepare(`SELECT * FROM friend_signal_actions WHERE id = ?`)
    .bind(id)
    .first<FriendSignalActionRow>();
}

export interface CreateFriendSignalActionInput {
  lineAccountId: string;
  name: string;
  triggerType: SignalActionTriggerType;
  triggerValue: string;
  cooldownDays?: number;
  actionType: SignalActionType;
  actionValue: string;
  isActive?: boolean;
}

export async function createFriendSignalAction(
  db: D1Database,
  input: CreateFriendSignalActionInput,
): Promise<FriendSignalActionRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_signal_actions (
         id, line_account_id, name, trigger_type, trigger_value, cooldown_days,
         action_type, action_value, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.triggerType,
      input.triggerValue,
      input.cooldownDays ?? 30,
      input.actionType,
      input.actionValue,
      input.isActive === false ? 0 : 1,
      now,
      now,
    )
    .run();
  const row = await getFriendSignalAction(db, id);
  if (!row) throw new Error('insert failed');
  return row;
}

export async function updateFriendSignalAction(
  db: D1Database,
  id: string,
  input: Partial<CreateFriendSignalActionInput>,
): Promise<FriendSignalActionRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(val);
  };
  if (input.name !== undefined) push('name', input.name);
  if (input.triggerType !== undefined) push('trigger_type', input.triggerType);
  if (input.triggerValue !== undefined) push('trigger_value', input.triggerValue);
  if (input.cooldownDays !== undefined) push('cooldown_days', input.cooldownDays);
  if (input.actionType !== undefined) push('action_type', input.actionType);
  if (input.actionValue !== undefined) push('action_value', input.actionValue);
  if (input.isActive !== undefined) push('is_active', input.isActive ? 1 : 0);
  if (sets.length === 0) return getFriendSignalAction(db, id);
  push('updated_at', jstNow());
  await db
    .prepare(`UPDATE friend_signal_actions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return getFriendSignalAction(db, id);
}

export async function deleteFriendSignalAction(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM friend_signal_actions WHERE id = ?`).bind(id).run();
}

/** 直近のアクション発火ログを取得 */
export async function listFriendSignalActionLogs(
  db: D1Database,
  lineAccountId: string,
  limit = 100,
): Promise<FriendSignalActionLogRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM friend_signal_action_logs
        WHERE line_account_id = ?
        ORDER BY fired_at DESC LIMIT ?`,
    )
    .bind(lineAccountId, limit)
    .all<FriendSignalActionLogRow>();
  return result.results;
}

export async function recordActionLog(
  db: D1Database,
  input: {
    actionId: string;
    friendId: string;
    lineAccountId: string;
    result: 'success' | 'failed' | 'skipped_cooldown';
    details?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO friend_signal_action_logs (
         id, action_id, friend_id, line_account_id, result, details, fired_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.actionId,
      input.friendId,
      input.lineAccountId,
      input.result,
      input.details ?? null,
      jstNow(),
    )
    .run();
}

/** 該当 friend がこのアクションを cooldown 期間内に発火していたか */
export async function isWithinCooldown(
  db: D1Database,
  actionId: string,
  friendId: string,
  cooldownDays: number,
): Promise<boolean> {
  if (cooldownDays <= 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 FROM friend_signal_action_logs
        WHERE action_id = ? AND friend_id = ? AND result = 'success'
          AND fired_at >= datetime('now', ?, '+9 hours')
        LIMIT 1`,
    )
    .bind(actionId, friendId, `-${cooldownDays} days`)
    .first<{ '1': number }>();
  return !!row;
}

/** action 発火後の last_triggered_at + trigger_count 更新 */
export async function bumpActionTrigger(db: D1Database, actionId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE friend_signal_actions
          SET last_triggered_at = ?, trigger_count = trigger_count + 1, updated_at = ?
        WHERE id = ?`,
    )
    .bind(jstNow(), jstNow(), actionId)
    .run();
}
