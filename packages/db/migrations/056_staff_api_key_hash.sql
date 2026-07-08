-- ============================================================================
-- Migration 056: スタッフ API key をハッシュ化
--
-- 経緯:
--   staff_members.api_key を平文保存していたため、D1 漏洩時に全 key が即悪用可能。
--   SHA-256 + 共有 secret salt (env API_KEY_HASH_SECRET) でハッシュ化した値を
--   api_key_hash に保存し、認証時はハッシュ比較に切り替える。
--
--   既存 api_key 列は猶予期間で残置 (lazy migration)。
--   getStaffByApiKey が呼ばれるたびに hash 列が NULL なら計算して埋める。
--   全 row に hash が入った段階で次のマイグレーションで api_key 列を削除する。
-- ============================================================================

ALTER TABLE staff_members ADD COLUMN api_key_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_members_api_key_hash ON staff_members (api_key_hash);
