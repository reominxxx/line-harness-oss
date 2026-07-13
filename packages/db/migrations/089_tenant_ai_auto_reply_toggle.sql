-- ============================================================================
-- Migration 089: アカウント単位の AI 自動返信 ON/OFF トグル
--
-- 経緯:
--   「AI には一切自動返信させず全部手動で対応したい」というアカウントがある。
--   既存の停止機構は友だち単位 (friends.ai_chat_paused) と同意単位
--   (consent_records) のみで、アカウント全体を一括で止める手段が無かった。
--
-- 仕様:
--   - tenant_metering.ai_auto_reply_enabled = 0 の時、そのアカウントの全友だちで
--     webhook の AI 接客自動返信を発火させない。
--   - DEFAULT 1 (有効) なので既存アカウントの挙動は不変。
--   - OFF にしても auto_replies / ステップ配信 / 手動 push / ブロードキャストは
--     従来どおり動作する。止まるのは「AI による自動接客応答」だけ。
-- ============================================================================

ALTER TABLE tenant_metering ADD COLUMN ai_auto_reply_enabled INTEGER NOT NULL DEFAULT 1;
