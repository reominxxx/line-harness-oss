/**
 * account_settings KV ストレージ
 *
 * テーブル構造: (line_account_id, key, value) UNIQUE(line_account_id, key)
 *
 * L ステップ Bridge プラン用の設定値もここに保存する:
 *   - lstep_api_token: L ステップ API トークン (Bridge プラン顧客のみ)
 *   - lstep_enabled:   "1" なら Bridge モード有効
 *   - lstep_synced_at: 最終同期日時
 *
 * 既存の他のキー (例: business_hours / closed_days) と共存する。
 */

import { jstNow } from './utils.js';

export async function getAccountSetting(
  db: D1Database,
  lineAccountId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ? LIMIT 1`)
    .bind(lineAccountId, key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setAccountSetting(
  db: D1Database,
  lineAccountId: string,
  key: string,
  value: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO account_settings (line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(lineAccountId, key, value, now, now)
    .run();
}

export async function deleteAccountSetting(
  db: D1Database,
  lineAccountId: string,
  key: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(lineAccountId, key)
    .run();
}

/** 複数キーを一気に取得 (例: ['lstep_api_token', 'lstep_enabled']) */
export async function getAccountSettings(
  db: D1Database,
  lineAccountId: string,
  keys: string[],
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN (${placeholders})`)
    .bind(lineAccountId, ...keys)
    .all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of result.results) out[r.key] = r.value;
  return out;
}

// ---------------------------------------------------------------------------
// L ステップ Bridge 専用ヘルパー
// ---------------------------------------------------------------------------

export interface LstepBridgeSettings {
  enabled: boolean;
  apiToken: string | null;
  lastSyncedAt: string | null;
}

export async function getLstepBridgeSettings(
  db: D1Database,
  lineAccountId: string,
): Promise<LstepBridgeSettings> {
  const s = await getAccountSettings(db, lineAccountId, [
    'lstep_enabled',
    'lstep_api_token',
    'lstep_synced_at',
  ]);
  return {
    enabled: s['lstep_enabled'] === '1',
    apiToken: s['lstep_api_token'] ?? null,
    lastSyncedAt: s['lstep_synced_at'] ?? null,
  };
}

export async function setLstepBridgeSettings(
  db: D1Database,
  lineAccountId: string,
  input: { enabled: boolean; apiToken?: string },
): Promise<void> {
  await setAccountSetting(db, lineAccountId, 'lstep_enabled', input.enabled ? '1' : '0');
  if (input.apiToken !== undefined) {
    if (input.apiToken === '') {
      await deleteAccountSetting(db, lineAccountId, 'lstep_api_token');
    } else {
      await setAccountSetting(db, lineAccountId, 'lstep_api_token', input.apiToken);
    }
  }
}

export async function markLstepSynced(db: D1Database, lineAccountId: string): Promise<void> {
  await setAccountSetting(db, lineAccountId, 'lstep_synced_at', jstNow());
}
