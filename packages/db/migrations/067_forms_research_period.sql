-- ============================================================
-- migration 067: extend forms for LINE official Research parity
--
-- LINE 公式リサーチに UX を寄せるため、リサーチ本体に
--   - 配信メッセージのメイン画像 (main_image_url)
--   - 紹介ページの細部 (icon_url)
--   - 実施期間 (start_at / end_at)
-- を保持できるようにする。既存フォームは NULL のままで挙動変わらず。
-- ============================================================

ALTER TABLE forms ADD COLUMN main_image_url TEXT;
ALTER TABLE forms ADD COLUMN icon_url TEXT;
ALTER TABLE forms ADD COLUMN start_at TEXT;  -- ISO 8601、開始日時(任意)
ALTER TABLE forms ADD COLUMN end_at   TEXT;  -- ISO 8601、終了日時(任意)
