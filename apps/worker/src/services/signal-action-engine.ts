/**
 * シグナル→自動アクション評価エンジン (Big Move 4)
 *
 * 1 friend のシグナル / プロファイル更新後に呼ばれ、テナントの
 * friend_signal_actions ルールを評価して該当アクションを実行する。
 *
 * 呼び出し元:
 *   - calculate-intent-scores ハンドラの各 friend 更新後
 *   - summarize-friend-profile ハンドラの各 friend 更新後
 *   - 手動 trigger 用エンドポイント (/api/signal-actions/:id/evaluate)
 */

import {
  listFriendSignalActions,
  isWithinCooldown,
  recordActionLog,
  bumpActionTrigger,
  addTagToFriend,
  removeTagFromFriend,
  enrollFriendInScenario,
  getFriendProfileSummary,
  type FriendSignalActionRow,
  type AiFriendSignalRow,
  type SignalActionTriggerType,
} from '@line-crm/db';

export interface EvaluateContext {
  db: D1Database;
  lineAccountId: string;
  friendId: string;
  signals?: AiFriendSignalRow | null;
  /** スタッフ通知用 LINE push (テナント主担当者の line_user_id) */
  notifyChannel?: {
    sendPush: (toLineUserId: string, message: string) => Promise<void>;
  };
}

export interface EvaluationResult {
  evaluated: number;
  fired: number;
  skipped: number;
  failed: number;
  details: Array<{
    actionId: string;
    name: string;
    result: 'fired' | 'cooldown' | 'no_match' | 'failed';
    error?: string;
  }>;
}

/**
 * 1 friend に対して全アクションルールを評価して、発火するべきものを実行する。
 */
export async function evaluateSignalActions(ctx: EvaluateContext): Promise<EvaluationResult> {
  const { db, lineAccountId, friendId } = ctx;
  const actions = await listFriendSignalActions(db, lineAccountId, { activeOnly: true });
  const result: EvaluationResult = { evaluated: 0, fired: 0, skipped: 0, failed: 0, details: [] };

  if (actions.length === 0) return result;

  const signals = ctx.signals ?? null;
  const profile = await getFriendProfileSummary(db, friendId).catch(() => null);

  for (const action of actions) {
    result.evaluated++;
    const matched = matchesTrigger(action.trigger_type, action.trigger_value, signals, profile);
    if (!matched) {
      result.details.push({ actionId: action.id, name: action.name, result: 'no_match' });
      continue;
    }

    // クールダウンチェック
    const inCooldown = await isWithinCooldown(db, action.id, friendId, action.cooldown_days);
    if (inCooldown) {
      await recordActionLog(db, {
        actionId: action.id,
        friendId,
        lineAccountId,
        result: 'skipped_cooldown',
      });
      result.skipped++;
      result.details.push({ actionId: action.id, name: action.name, result: 'cooldown' });
      continue;
    }

    // アクション実行
    try {
      await executeAction(db, action, friendId, ctx);
      await recordActionLog(db, {
        actionId: action.id,
        friendId,
        lineAccountId,
        result: 'success',
        details: `${action.action_type}=${action.action_value}`,
      });
      await bumpActionTrigger(db, action.id);
      result.fired++;
      result.details.push({ actionId: action.id, name: action.name, result: 'fired' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      await recordActionLog(db, {
        actionId: action.id,
        friendId,
        lineAccountId,
        result: 'failed',
        details: msg,
      });
      result.failed++;
      result.details.push({
        actionId: action.id,
        name: action.name,
        result: 'failed',
        error: msg,
      });
    }
  }

  return result;
}

function matchesTrigger(
  triggerType: SignalActionTriggerType,
  triggerValue: string,
  signals: AiFriendSignalRow | null,
  profile: Awaited<ReturnType<typeof getFriendProfileSummary>>,
): boolean {
  switch (triggerType) {
    case 'purchase_intent_gte': {
      if (!signals) return false;
      const threshold = parseInt(triggerValue, 10);
      return Number.isFinite(threshold) && (signals.purchase_intent ?? 0) >= threshold;
    }
    case 'churn_risk_gte': {
      if (!signals) return false;
      const threshold = parseInt(triggerValue, 10);
      return Number.isFinite(threshold) && (signals.churn_risk ?? 0) >= threshold;
    }
    case 'vip_rank_eq': {
      if (!signals) return false;
      return signals.vip_rank === triggerValue;
    }
    case 'sentiment_eq': {
      if (!signals) return false;
      return signals.sentiment === triggerValue;
    }
    case 'days_since_last_purchase_gte': {
      if (!profile || profile.days_since_last_purchase == null) return false;
      const threshold = parseInt(triggerValue, 10);
      return Number.isFinite(threshold) && profile.days_since_last_purchase >= threshold;
    }
    case 'total_purchases_gte': {
      if (!profile) return false;
      const threshold = parseInt(triggerValue, 10);
      return Number.isFinite(threshold) && profile.total_purchases >= threshold;
    }
    case 'total_spent_yen_gte': {
      if (!profile) return false;
      const threshold = parseInt(triggerValue, 10);
      return Number.isFinite(threshold) && profile.total_spent_yen >= threshold;
    }
    default:
      return false;
  }
}

async function executeAction(
  db: D1Database,
  action: FriendSignalActionRow,
  friendId: string,
  ctx: EvaluateContext,
): Promise<void> {
  switch (action.action_type) {
    case 'add_tag':
      await addTagToFriend(db, friendId, action.action_value);
      return;
    case 'remove_tag':
      await removeTagFromFriend(db, friendId, action.action_value);
      return;
    case 'enroll_scenario':
      await enrollFriendInScenario(db, friendId, action.action_value);
      return;
    case 'send_message':
      // template_id 経由のメッセージ送信は将来実装。今は発火ログのみ
      throw new Error('send_message: not implemented yet');
    case 'notify_staff':
      if (!ctx.notifyChannel) {
        throw new Error('notify_staff: notifyChannel not configured');
      }
      await ctx.notifyChannel.sendPush(
        action.action_value,
        `[L-port] ${action.name} が発火: friend=${friendId}`,
      );
      return;
    default:
      throw new Error(`unknown action_type: ${action.action_type as string}`);
  }
}
