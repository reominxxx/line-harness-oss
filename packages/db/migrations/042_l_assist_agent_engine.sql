-- ============================================================================
-- 042_l_assist_agent_engine.sql
--
-- L-アシスト KPI 駆動 AI 自動化エンジン
--
-- 目的:
--   事業者が KPI を設定 → AI がタスク分解 → ジョブキュー投入 → cron で順次実行
--   → レビューキュー振り分け、までの完全自律エンジン。
--
-- 設計方針:
--   - 既存テーブルへの ALTER は行わない（041 と同方針）
--   - 全テーブル line_account_id でテナント分離
--   - id は TEXT (UUID), 日時は TEXT ISO 8601 JST
--
-- 含むもの:
--   1. kpi_goals       事業者の月次 KPI 目標
--   2. agent_jobs      AI 実行ジョブのキュー
--   3. tenant_automation_policy  テナント別自動化レベル設定
-- ============================================================================


-- ============================================================================
-- 1. KPI 目標
-- ============================================================================

CREATE TABLE IF NOT EXISTS kpi_goals (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  year_month        TEXT NOT NULL,
  metric            TEXT NOT NULL CHECK (metric IN (
                       'broadcast_count',       -- 月配信本数
                       'friend_growth',         -- 友だち純増
                       'cv_count',              -- コンバージョン件数
                       'reactivation_count',    -- 休眠掘り起こし件数
                       'open_rate',             -- 平均開封率
                       'click_rate',            -- 平均 CTR
                       'nps',                   -- NPS スコア
                       'reservation_count',     -- 予約件数
                       'review_count'           -- レビュー獲得件数
                     )),
  target_value      INTEGER NOT NULL,
  current_value     INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, year_month, metric)
);

CREATE INDEX IF NOT EXISTS idx_kpi_goals_account_month ON kpi_goals (line_account_id, year_month);


-- ============================================================================
-- 2. AI ジョブキュー
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_jobs (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  job_type          TEXT NOT NULL,
  input_json        TEXT NOT NULL DEFAULT '{}',
  origin            TEXT NOT NULL CHECK (origin IN (
                       'kpi_planner', 'manual', 'automation', 'cron', 'webhook'
                     )),
  related_kpi_id    TEXT REFERENCES kpi_goals (id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN (
                       'pending', 'running', 'review', 'approved',
                       'rejected', 'completed', 'failed', 'cancelled'
                     )),
  scheduled_at      TEXT NOT NULL,
  started_at        TEXT,
  completed_at      TEXT,
  output_json       TEXT,
  cost_yen_x100     INTEGER NOT NULL DEFAULT 0,
  retries           INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL DEFAULT 3,
  error             TEXT,
  reviewer_id       TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  reviewed_at       TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_account_status ON agent_jobs (line_account_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_pending_due  ON agent_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_kpi          ON agent_jobs (related_kpi_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_review       ON agent_jobs (line_account_id, status) WHERE status = 'review';


-- ============================================================================
-- 3. テナント別自動化ポリシー
--    どのジョブ種別を自動公開し、どれを人間レビューに回すかを設定
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_automation_policy (
  line_account_id   TEXT PRIMARY KEY REFERENCES line_accounts (id) ON DELETE CASCADE,
  automation_level  TEXT NOT NULL DEFAULT 'careful'
                     CHECK (automation_level IN ('careful', 'standard', 'aggressive')),
  job_overrides_json TEXT,  -- {"generate_broadcast": "auto", "wake_dormant": "review"} 等
  notification_channel TEXT DEFAULT 'line',  -- 承認待ち通知の宛先
  notification_target TEXT,                  -- LINE 通知先 user_id 等
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
