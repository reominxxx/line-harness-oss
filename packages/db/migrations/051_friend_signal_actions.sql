-- ============================================================================
-- Migration 051: シグナル → 自動アクション ルール
--
-- 目的:
--   ai_friend_signals (purchase_intent / churn_risk / vip_rank / sentiment) や
--   friend の状態 (days_since_last_purchase 等) を見て、自動で:
--     - タグ付与 (例: VIP)
--     - シナリオ enroll (例: VIP 特別ケア配信)
--     - メッセージ送信 (例: お礼 DM)
--     - スタッフ通知 (例: クレーム検知時 LINE プッシュ)
--   を実行するルールエンジン。
--
--   今までシグナルは "計算するだけ" で何も自動アクションがなかった。
--   このテーブルでテナント別にルール CRUD できるようにする。
-- ============================================================================

CREATE TABLE IF NOT EXISTS friend_signal_actions (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,           -- "VIP 自動指定" 等
  -- トリガー条件
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN (
                    'purchase_intent_gte',     -- purchase_intent >= 値
                    'churn_risk_gte',          -- churn_risk >= 値
                    'vip_rank_eq',             -- vip_rank == 値
                    'sentiment_eq',            -- sentiment == 値
                    'days_since_last_purchase_gte',
                    'total_purchases_gte',
                    'total_spent_yen_gte'
                  )),
  trigger_value   TEXT NOT NULL,            -- "80" / "hot" / "negative" 等
  -- 重複実行防止 (一度発火したら N 日間は同じ friend に発火しない)
  cooldown_days   INTEGER NOT NULL DEFAULT 30,
  -- アクション
  action_type     TEXT NOT NULL CHECK (action_type IN (
                    'add_tag',                 -- tag_id を付与
                    'remove_tag',
                    'enroll_scenario',         -- scenario_id に enroll
                    'send_message',            -- template_id でメッセージ送信
                    'notify_staff'             -- staff_line_user_id にプッシュ
                  )),
  action_value    TEXT NOT NULL,            -- tag_id / scenario_id / template_id / line_user_id
  -- 状態
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT,
  trigger_count   INTEGER NOT NULL DEFAULT 0,
  -- メタ
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_signal_actions_account
  ON friend_signal_actions (line_account_id, is_active);

-- アクション発火ログ (重複実行防止 + 監査用)
CREATE TABLE IF NOT EXISTS friend_signal_action_logs (
  id              TEXT PRIMARY KEY,
  action_id       TEXT NOT NULL REFERENCES friend_signal_actions (id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('success', 'failed', 'skipped_cooldown')),
  details         TEXT,
  fired_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_signal_action_logs_account
  ON friend_signal_action_logs (line_account_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_friend_signal_action_logs_friend
  ON friend_signal_action_logs (friend_id, action_id, fired_at DESC);
