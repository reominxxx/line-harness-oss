-- ============================================================================
-- Migration 057: 友だちごとの AI 接客チャット停止フラグ
--
-- 経緯:
--   スタッフがチャット画面から手動でお客様に返信したら、AI 接客がその顧客に
--   勝手に応答してしまうと「人とAIで二重返信」になってしまう。
--   スタッフが手動返信 → 自動で AI 停止、再開はスタッフが UI トグルで明示 ON する。
--
-- 仕様:
--   - friends.ai_chat_paused = 1 の時、webhook で incoming メッセージを受けても AI は応答しない
--   - スタッフが個別チャットから outgoing 送信 → 自動で 1 にセット
--   - スタッフが UI 上で「AI 応答を再開」ボタン → 0 に戻す
--   - 5 分等の自動再開はしない (ユーザー要望: 明示的な ON のみ再開)
-- ============================================================================

ALTER TABLE friends ADD COLUMN ai_chat_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friends ADD COLUMN ai_chat_paused_at TEXT;

CREATE INDEX IF NOT EXISTS idx_friends_ai_chat_paused ON friends (ai_chat_paused);
