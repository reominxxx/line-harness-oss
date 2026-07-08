-- ============================================================================
-- Migration 054: vip_rank の hot を warm に統合 (6 セグメント → 5 セグメント)
--
-- 経緯:
--   ホット / ウォーム の区別がユーザーにとって冗長で運用も難しい。
--   両方をまとめて「ウォーム (反応してくれそうな見込み客)」に統一。
--
--   さらに今後、ai_friend_signals.vip_rank を見て friend_tags に
--   ★VIP / ★ウォーム / ★コールド / ★休眠 / ★NEW を自動付与する流れに
--   切り替えるための前提整理。
--
-- SQLite には CHECK 制約を ALTER で変える機能がないので、テーブル再作成。
-- ============================================================================

-- Step 1: 既存 'hot' データを 'warm' に統合
UPDATE ai_friend_signals SET vip_rank = 'warm' WHERE vip_rank = 'hot';

-- Step 2: 新しい CHECK 制約のテーブルを作成
CREATE TABLE IF NOT EXISTS ai_friend_signals_new (
  friend_id           TEXT PRIMARY KEY REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  purchase_intent     INTEGER NOT NULL DEFAULT 0,
  churn_risk          INTEGER NOT NULL DEFAULT 0,
  ltv_estimate_yen    INTEGER,
  vip_rank            TEXT CHECK (vip_rank IN ('vip', 'warm', 'cold', 'dormant', 'new')),
  sentiment           TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'angry')),
  signal_summary      TEXT,
  last_chat_at        TEXT,
  last_calculated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO ai_friend_signals_new (
  friend_id, line_account_id, purchase_intent, churn_risk, ltv_estimate_yen,
  vip_rank, sentiment, signal_summary, last_chat_at, last_calculated_at
)
SELECT friend_id, line_account_id, purchase_intent, churn_risk, ltv_estimate_yen,
       vip_rank, sentiment, signal_summary, last_chat_at, last_calculated_at
FROM ai_friend_signals;

DROP TABLE ai_friend_signals;
ALTER TABLE ai_friend_signals_new RENAME TO ai_friend_signals;

CREATE INDEX IF NOT EXISTS idx_ai_friend_signals_account
  ON ai_friend_signals (line_account_id);
CREATE INDEX IF NOT EXISTS idx_ai_friend_signals_rank
  ON ai_friend_signals (line_account_id, vip_rank);
