-- ============================================================================
-- Migration 061: カード型メッセージ + 動画配信
--
-- ① 公式 LINE 風のカード型メッセージ (Flex Carousel) を管理する独立テーブル。
--    テンプレートとして保存し、配信フォームから引用できる。
--    内部的には Flex Message に変換して送信するので、配信時は既存の
--    messageType='flex' で動く (broadcasts の CHECK 変更不要)。
--
-- ② broadcasts に video 関連カラムを追加 (ALTER のみ、CHECK 変更なし)。
--    送信時は messageType='image' を流用しつつ、video_original_url が
--    入っている時は LINE Messaging API の video タイプで送る。
--    フロントは「動画」タブを別途用意する。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ① card_messages テーブル
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS card_messages (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  card_type       TEXT NOT NULL CHECK (card_type IN ('product', 'location', 'person', 'image')),
  cards_json      TEXT NOT NULL,
  flex_json       TEXT,
  alt_text        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_card_messages_account ON card_messages (line_account_id, updated_at DESC);

-- ----------------------------------------------------------------------------
-- ② broadcasts に動画用カラム追加 (CHECK 変更を避けるため ALTER で対応)
-- ----------------------------------------------------------------------------
-- video_original_url が NULL でない時、その broadcast は動画として扱う。
-- 送信時に messageType='image' でも video_original_url があれば LINE video API で送る。
ALTER TABLE broadcasts ADD COLUMN video_original_url TEXT;
ALTER TABLE broadcasts ADD COLUMN video_preview_url TEXT;
ALTER TABLE broadcasts ADD COLUMN video_duration_ms INTEGER;
