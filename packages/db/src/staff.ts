import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff' | 'customer';
  api_key: string | null;
  api_key_hash: string | null;
  is_active: number;
  /** customer role の人は自分のアカウントのみ閲覧可。staff 以上は NULL。 */
  assigned_line_account_id: string | null;
  /** customer role 用のメール/パスワード認証 (staff は api_key を使う) */
  password_hash: string | null;
  password_salt: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * SHA-256 + worker secret salt で API key をハッシュ化。
 * - 入力は generateApiKey() が出す `lh_<32 hex>` の形式 (= 128bit ランダム) 想定
 * - secret は worker env API_KEY_HASH_SECRET (本番では wrangler secret put で設定)
 *   未設定でも動くようにフォールバック値あり (ただし強度低い = 必ず設定すること)
 * - 出力は 64 文字の hex 文字列
 */
export async function hashApiKey(apiKey: string, secret: string | undefined): Promise<string> {
  const saltedSecret = secret && secret.length >= 16 ? secret : 'line-harness-default-salt-please-rotate';
  const encoder = new TextEncoder();
  const data = encoder.encode(`${saltedSecret}:${apiKey}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff' | 'customer';
  /** customer role のとき、この LINE アカウントのみ閲覧可にスコープする */
  assigned_line_account_id?: string | null;
}

export interface UpdateStaffInput {
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  is_active?: number;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

/**
 * API key で staff を検索。
 *
 * 二段検索:
 *   1. ハッシュ値で検索 (本来の道) — secret が必要なので worker から呼ぶ
 *   2. 旧 api_key 平文列でフォールバック検索 (lazy migration)
 *      ヒットしたらこの行の api_key_hash を即時 upsert する
 *
 * 二段目フォールバックは、既存セッション (lh_xxx 平文) を切らずに hash 列を
 * 埋めていくため。全 row に hash が入った段階で次のマイグレーションで平文列を
 * NULL にし、最終的に DROP COLUMN する。
 */
export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
  hashSecret?: string,
): Promise<StaffMember | null> {
  // 1) ハッシュで検索
  if (hashSecret !== undefined) {
    const hash = await hashApiKey(apiKey, hashSecret);
    const hashed = await db
      .prepare('SELECT * FROM staff_members WHERE api_key_hash = ? AND is_active = 1')
      .bind(hash)
      .first<StaffMember>();
    if (hashed) return hashed;
  }

  // 2) 旧平文列で検索 (lazy migration フォールバック)
  const legacy = await db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
  if (legacy && hashSecret !== undefined && !legacy.api_key_hash) {
    // 次回からハッシュで引けるよう、この行に hash を upsert
    const hash = await hashApiKey(apiKey, hashSecret);
    try {
      await db
        .prepare('UPDATE staff_members SET api_key_hash = ?, updated_at = ? WHERE id = ?')
        .bind(hash, jstNow(), legacy.id)
        .run();
    } catch (e) {
      console.warn('[staff] api_key_hash lazy migration failed:', e);
    }
  }
  return legacy;
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
  hashSecret?: string,
): Promise<StaffMember & { plainApiKey?: string }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();
  const apiKeyHash = hashSecret !== undefined ? await hashApiKey(apiKey, hashSecret) : null;

  await db
    .prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, api_key_hash, assigned_line_account_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.email ?? null,
      input.role,
      apiKey,
      apiKeyHash,
      input.assigned_line_account_id ?? null,
      now,
      now,
    )
    .run();

  const row = (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
  // 平文 key は作成直後の 1 度だけ返す (呼び出し側が UI で見せる)
  return { ...row, plainApiKey: apiKey };
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(
  db: D1Database,
  id: string,
  hashSecret?: string,
): Promise<string> {
  const newKey = generateApiKey();
  const newHash = hashSecret !== undefined ? await hashApiKey(newKey, hashSecret) : null;
  const now = jstNow();
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, api_key_hash = ?, updated_at = ? WHERE id = ?')
    .bind(newKey, newHash, now, id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

/** 指定 LINE アカウントに紐づく customer role のキー一覧を返す (発行済みお客様ログイン) */
export async function getCustomerKeysByAccount(
  db: D1Database,
  lineAccountId: string,
): Promise<StaffMember[]> {
  const result = await db
    .prepare(
      `SELECT * FROM staff_members
       WHERE role = 'customer' AND assigned_line_account_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(lineAccountId)
    .all<StaffMember>();
  return result.results;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
