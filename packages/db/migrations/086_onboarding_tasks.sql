-- 顧客オンボーディング/運用タスク チェックリスト
-- 顧客 (line_account) ごとに「やること」をチェック形式で管理する。
-- テンプレート(初期タスク群)は worker 側 (routes/onboarding.ts) の定数で持ち、
-- apply-template API で顧客に流し込む。手動での項目追加も可能。

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general', -- 契約/ヒアリング/LINE連携/AI設定/制作/セグメント/運用/定例 等
  title TEXT NOT NULL,
  description TEXT,                          -- 補足・やり方メモ
  order_index INTEGER NOT NULL DEFAULT 0,    -- 表示順 (カテゴリ内)
  is_done INTEGER NOT NULL DEFAULT 0,        -- 0=未完了 1=完了
  done_at TEXT,                              -- 完了日時 (JST)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_account
  ON onboarding_tasks(line_account_id, order_index ASC);
