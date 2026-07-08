-- ============================================================================
-- Migration 060: L ステップ Bridge 統合
--
-- 経緯:
--   L ステップを使い続ける顧客向けに、L アシスト の AI 機能を追加できる
--   "Bridge プラン" を提供する。
--
--   テナントごとに L ステップ API トークン (Bearer) を保存し、AI セグメント
--   判定や配信生成の出力を L ステップへ流す。
--
-- 仕様:
--   - account_settings に lstep_* 系キーを追加 (既存テーブルを活用)
--   - segment_tags に L ステップ側で対応するタグ ID を保持して双方向同期
--   - friends に L ステップ側 friend_id を保持して名寄せ
-- ============================================================================

-- segment_tags: L ステップ側で対応するタグ ID を保持
ALTER TABLE segment_tags ADD COLUMN lstep_tag_id TEXT;
CREATE INDEX IF NOT EXISTS idx_segment_tags_lstep ON segment_tags (lstep_tag_id);

-- friends: L ステップ側 friend_id (名寄せキー)
ALTER TABLE friends ADD COLUMN lstep_friend_id TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_lstep_friend_id ON friends (lstep_friend_id);
