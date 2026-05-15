/**
 * 事業者向け LINE プッシュ通知
 *
 * tenant_automation_policy.notification_target に LINE user_id が
 * 設定されていれば、そこに push する。設定なし or push 失敗時は
 * 静かに何もしない（メイン処理を止めない）。
 */

import { LineClient } from '@line-crm/line-sdk';

export interface NotifyOptions {
  db: D1Database;
  lineAccountId: string;
  text: string;
}

export async function notifyOperator(opts: NotifyOptions): Promise<{ ok: boolean; reason?: string }> {
  const { db, lineAccountId, text } = opts;

  try {
    const policy = await db
      .prepare(
        `SELECT notification_channel, notification_target FROM tenant_automation_policy WHERE line_account_id = ? LIMIT 1`,
      )
      .bind(lineAccountId)
      .first<{ notification_channel: string | null; notification_target: string | null }>();

    if (!policy?.notification_target) {
      return { ok: false, reason: 'no notification target' };
    }
    if (policy.notification_channel && policy.notification_channel !== 'line') {
      return { ok: false, reason: `channel ${policy.notification_channel} not supported yet` };
    }

    const account = await db
      .prepare(`SELECT channel_access_token FROM line_accounts WHERE id = ? LIMIT 1`)
      .bind(lineAccountId)
      .first<{ channel_access_token: string }>();
    if (!account?.channel_access_token) {
      return { ok: false, reason: 'line_account access token missing' };
    }

    const client = new LineClient(account.channel_access_token);
    await client.pushMessage(policy.notification_target, [
      { type: 'text', text: text.slice(0, 4500) },
    ]);
    return { ok: true };
  } catch (e) {
    console.error('[line-notify] push failed:', e);
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
