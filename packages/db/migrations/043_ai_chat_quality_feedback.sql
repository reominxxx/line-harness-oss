-- ============================================================================
-- Migration 043: AI チャット品質フィードバックループ
--
-- 目的:
--   AI が応答した個別メッセージに対する評価（thumbs up / down）を蓄積し、
--   プロンプト改善のフィードバックループを回す基盤を作る。
--
-- 追加カラム:
--   quality_rating  -1=微妙, 0=未評価, 1=良かった
--   quality_note    補足コメント（任意）
--   rated_at        評価日時
--   rated_by        評価者の staff_id（NULL = エンドユーザー直接）
-- ============================================================================

ALTER TABLE ai_chat_metadata ADD COLUMN quality_rating INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_chat_metadata ADD COLUMN quality_note TEXT;
ALTER TABLE ai_chat_metadata ADD COLUMN rated_at TEXT;
ALTER TABLE ai_chat_metadata ADD COLUMN rated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_chat_metadata_rating
  ON ai_chat_metadata (line_account_id, quality_rating, created_at DESC);
