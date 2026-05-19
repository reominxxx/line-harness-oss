-- ============================================================================
-- Migration 050: 友だち個別の長期プロファイル要約
--
-- 目的:
--   AI 接客チャットや配信生成で「この顧客は半年前から乾燥に悩んでいて、
--   先月化粧水A を買った」のような長期記憶を AI に渡せるようにする。
--
--   directly に messages_log を全部 AI に投げるとコスト爆発するので、
--   日次バッチで Haiku を使って 200 字くらいに要約 + 購入履歴を集計する。
--
-- 更新タイミング:
--   - 日次 cron で過去 30 日に新規メッセージがあった friend について再生成
--   - 新規 conversion_events / link_clicks があったタイミングでも再生成可能
-- ============================================================================

CREATE TABLE IF NOT EXISTS friend_profile_summary (
  friend_id                  TEXT PRIMARY KEY REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  -- 購入履歴 (直近 12 件、JSON 配列: [{name, price_yen, occurred_at}, ...])
  purchase_history_json      TEXT,
  total_purchases            INTEGER NOT NULL DEFAULT 0,
  total_spent_yen            INTEGER NOT NULL DEFAULT 0,
  days_since_last_purchase   INTEGER,
  -- 過去 6 ヶ月の会話テーマ要約 (200〜400 字、Haiku 生成)
  chat_topic_summary         TEXT,
  -- 興味分野タグ (JSON 配列: ["乾燥対策", "メンズ", "頭皮ケア"] 等)
  interest_tags_json         TEXT,
  -- 最後の重要イベント (購入 / フォーム / 来店 / 高 CV クリック)
  last_significant_event     TEXT,
  last_significant_at        TEXT,
  -- 累積行動メトリクス
  total_messages             INTEGER NOT NULL DEFAULT 0,
  total_link_clicks          INTEGER NOT NULL DEFAULT 0,
  total_form_submissions     INTEGER NOT NULL DEFAULT 0,
  -- メタ
  summarized_at              TEXT NOT NULL,
  summary_model              TEXT,
  summary_cost_yen_x100      INTEGER NOT NULL DEFAULT 0,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_profile_summary_account
  ON friend_profile_summary (line_account_id, summarized_at DESC);
