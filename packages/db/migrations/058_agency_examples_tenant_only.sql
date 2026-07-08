-- ============================================================================
-- Migration 058: agency_examples にテナント限定列 + 過去配信自動アーカイブ用カラム
--
-- 経緯:
--   開封率 35% 以上の自社配信を agency_examples に自動投入したいが、これは
--   他テナントに見せたくない (= 自社内限定の "うちのお店で過去に効いた配信例"
--   として AI 生成に活かしたい)。
--
--   `tenant_only_account_id` が NULL なら従来通り全テナント参照可。値が入ると、
--   その line_account_id のテナントだけが参照できる。
--
--   `archived_from_broadcast_id` で重複投入防止 (同じ broadcast を 2 回入れない)。
-- ============================================================================

ALTER TABLE agency_examples ADD COLUMN tenant_only_account_id TEXT;
ALTER TABLE agency_examples ADD COLUMN archived_from_broadcast_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agency_examples_tenant
  ON agency_examples (tenant_only_account_id, is_public);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_examples_broadcast_unique
  ON agency_examples (archived_from_broadcast_id)
  WHERE archived_from_broadcast_id IS NOT NULL;
