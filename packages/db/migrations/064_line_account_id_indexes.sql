-- ============================================================
-- migration 064: add missing line_account_id indexes
-- 008_multi_account.sql で line_account_id を追加したが
-- 主要テーブルに INDEX が無く、アカウント別クエリが全件スキャンになっていた。
-- 1000 アカウント / 数百万行スケールで性能崩壊するため事前に対処。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_friends_line_account_id     ON friends     (line_account_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_line_account_id   ON scenarios   (line_account_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_line_account_id  ON broadcasts  (line_account_id);
CREATE INDEX IF NOT EXISTS idx_reminders_line_account_id   ON reminders   (line_account_id);
CREATE INDEX IF NOT EXISTS idx_automations_line_account_id ON automations (line_account_id);
CREATE INDEX IF NOT EXISTS idx_chats_line_account_id       ON chats       (line_account_id);
