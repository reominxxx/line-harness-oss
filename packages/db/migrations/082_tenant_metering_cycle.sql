-- ============================================================================
-- Migration 082: 計量サイクルの開始日時ベースリセット
--
-- これまで tenant_metering の使用量 (used_*) と超過課金 (overage_charge_yen) は
-- 「暦月 (current_month = 'YYYY-MM')」基準で月初にリセットしていた。
-- 契約日が月初でないテナント向けに、「開始日時から 1 ヶ月ごと」のリセットを可能にする。
--
--   cycle_started_at = 計量サイクルの起点 (JST ISO, 例 '2026-06-20T00:00:00.000+09:00')
--                      NULL = 未設定 → 従来どおり暦月リセット (後方互換)
--   cycle_resets_at  = 次回リセット日時 (JST ISO)。この時刻を過ぎたアクセスで
--                      used_* / overage_charge_yen を 0 に戻し、+1 ヶ月進める。
-- ============================================================================

ALTER TABLE tenant_metering
  ADD COLUMN cycle_started_at TEXT;

ALTER TABLE tenant_metering
  ADD COLUMN cycle_resets_at TEXT;
