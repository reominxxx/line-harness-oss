-- ============================================================================
-- Migration 055: アカウント別カスタムセグメントタグ + AI 自動付与
--
-- 経緯:
--   既存の ai_friend_signals.vip_rank ベースの 5 段階 (vip/warm/cold/dormant/new)
--   は業界横断的すぎて、本質的な顧客像にならない。
--
--   美容クリニックなら「鼻悩み」「肌乾燥」「医療脱毛興味あり」、
--   整体なら「腰痛持続」「スポーツ系」「産後ケア」など、業種・店舗ごとに
--   ヒアリングして決めたカスタムセグメントで切るべき。
--
--   そのためのテーブル:
--     - segment_tags: アカウント別タグマスタ (criteria = AI 判定基準文)
--     - friend_segment_tags: 友だちへの付与 (assigned_by, confidence, reason)
--     - broadcasts.target_segment_tag_id: セグメント配信ターゲット
--
--   既存 tags / friend_tags はそのまま残し、segment_tags は独立扱い。
-- ============================================================================

CREATE TABLE IF NOT EXISTS segment_tags (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  criteria        TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#3B82F6',
  is_ai_managed   INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  assigned_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(line_account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_segment_tags_account ON segment_tags (line_account_id);

CREATE TABLE IF NOT EXISTS friend_segment_tags (
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  segment_tag_id   TEXT NOT NULL REFERENCES segment_tags(id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  assigned_by      TEXT NOT NULL DEFAULT 'ai' CHECK (assigned_by IN ('ai','manual')),
  confidence       INTEGER,
  reason           TEXT,
  assigned_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (friend_id, segment_tag_id)
);

CREATE INDEX IF NOT EXISTS idx_fst_segment ON friend_segment_tags (segment_tag_id);
CREATE INDEX IF NOT EXISTS idx_fst_account_friend ON friend_segment_tags (line_account_id, friend_id);

-- broadcasts にセグメント配信ターゲットを追加
ALTER TABLE broadcasts ADD COLUMN target_segment_tag_id TEXT REFERENCES segment_tags(id) ON DELETE SET NULL;
