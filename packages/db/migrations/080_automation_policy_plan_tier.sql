-- ============================================================================
-- Migration 080: tenant_automation_policy に plan_tier / monthly_broadcast_count を追加
--
-- TS 型 (TenantAutomationPolicyRow) と upsertAutomationPolicy() は既に
-- plan_tier / monthly_broadcast_count を参照しているが、テーブル定義に列が無く、
-- 自動化ポリシー保存 API (routes/agent-jobs.ts) 実行時に
-- "no column named plan_tier" で失敗していた。これを是正する。
--
-- AIエージェント組織化（司令室ダッシュボード）の基盤整備の一環。
-- ============================================================================

ALTER TABLE tenant_automation_policy
  ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'starter';

ALTER TABLE tenant_automation_policy
  ADD COLUMN monthly_broadcast_count INTEGER NOT NULL DEFAULT 4;
