-- ============================================================================
-- Migration 079: CSV 一括取り込みで生成する「統合 system prompt」の保存先
--
-- AI 配信設定の CSV モードでは、①〜⑬ の個別モジュールに分割せず、取り込んだ
-- 事業情報から最適な system prompt を 1 本だけ生成する。これを保存する列。
--
--   NULL / 空文字 = 未設定 → 従来どおり prompt_modules を合成して使う
--   非空           = この統合プロンプトを brand system prompt として最優先で使う
-- ============================================================================

ALTER TABLE tenant_metering
  ADD COLUMN ai_custom_system_prompt TEXT;
