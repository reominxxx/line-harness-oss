-- staff_members.role に 'customer' を追加。
-- 顧客アカウント (運用代行モデルで「自分の店の結果だけ見る」役割) を別 role で表現。
-- assigned_line_account_id を NOT NULL にして、customer は必ず特定の LINE アカウントに紐付ける。
-- SQLite は CHECK ALTER 不可なので table 再作成。

CREATE TABLE staff_members_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'customer')),
  api_key TEXT UNIQUE,
  api_key_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  assigned_line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  password_hash TEXT,
  password_salt TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO staff_members_new (id, name, email, role, api_key, api_key_hash, is_active, created_at, updated_at)
SELECT id, name, email, role, api_key, api_key_hash, is_active, created_at, updated_at
FROM staff_members;

DROP TABLE staff_members;
ALTER TABLE staff_members_new RENAME TO staff_members;

CREATE INDEX idx_staff_email ON staff_members(email);
CREATE INDEX idx_staff_role ON staff_members(role);
CREATE INDEX idx_staff_assigned ON staff_members(assigned_line_account_id);
