-- ============================================================================
-- Migration 045: プランベースの月配信本数管理
--
-- 目的:
--   KPI 駆動 (kpi_goals テーブル) から、プラン契約時に決まる固定の配信本数に
--   シンプル化。事業者が KPI を設定しなくても、プランに紐付いた月配信本数が
--   自動で AI 分解の元データになる。
--
-- 変更:
--   tenant_automation_policy.plan_tier         契約プラン (starter / pro / enterprise)
--   tenant_automation_policy.monthly_broadcast_count  プランに紐付く月配信本数
--
-- 注: kpi_goals テーブルは互換性のため残す（将来削除予定）
-- ============================================================================

ALTER TABLE tenant_automation_policy
  ADD COLUMN plan_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan_tier IN ('starter', 'pro', 'enterprise'));

ALTER TABLE tenant_automation_policy
  ADD COLUMN monthly_broadcast_count INTEGER NOT NULL DEFAULT 4;
