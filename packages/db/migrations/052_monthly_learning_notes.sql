-- ============================================================================
-- Migration 052: 月次学習ノート (PDCA フィードバックループ)
--
-- 目的:
--   analyze-broadcast-performance.ts が生成する月次レポートを
--   構造化して保持し、次月の generate-broadcast / plan-monthly-broadcasts
--   の system prompt に自動注入する。
--
--   これにより「先月失敗した時間帯や訴求は避ける」「先月好評だったフレーズを
--   再活用する」のような PDCA が自動的に効くようになる。
-- ============================================================================

CREATE TABLE IF NOT EXISTS monthly_learning_notes (
  id                          TEXT PRIMARY KEY,
  line_account_id             TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  year_month                  TEXT NOT NULL,        -- "2026-05"
  -- 開封率・CV 等の集計
  total_broadcasts            INTEGER NOT NULL DEFAULT 0,
  avg_open_rate               REAL,
  avg_click_rate              REAL,
  best_send_hour              INTEGER,              -- 開封率が一番高かった時刻 (JST)
  best_send_weekday           TEXT,                 -- 'fri' 等
  -- AI が生成した学びサマリ
  insights_summary            TEXT,                 -- 「金曜 19 時の配信が最も開封率高い」等 (200〜400 字)
  successful_patterns_json    TEXT,                 -- 成功配信の共通特徴 (JSON array)
  failed_patterns_json        TEXT,                 -- 失敗配信の共通特徴
  recommendations_json        TEXT,                 -- 次月への改善提案 (JSON array)
  ab_test_suggestions_json    TEXT,                 -- A/B テスト案
  -- メタ
  generated_by                TEXT,                 -- 'analyze-broadcast-performance' 等
  generation_model            TEXT,
  generation_cost_yen_x100    INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_learning_notes_account
  ON monthly_learning_notes (line_account_id, year_month DESC);
