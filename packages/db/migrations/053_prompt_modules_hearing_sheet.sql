-- ============================================================================
-- Migration 053: prompt_modules に hearing_sheet モジュールを追加
--
-- 経緯:
--   prompt_modules.module_type の CHECK 制約は 041 時点で 8 種類しか
--   許容しておらず、その後 TS 側で internal_manual / product_recommend を
--   足したが本番 D1 の制約は更新されていなかった。
--   さらに今回 hearing_sheet (運用代行初回 MTG のヒアリングシートを
--   そのまま AI のノウハウ源として注入する枠) を 11 種類目として追加。
--
-- SQLite には ALTER TABLE で CHECK 制約を変える機能がないため、
-- 一度 prompt_modules_new に作り直してデータをコピーする標準パターンを使う。
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_modules_new (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  module_type         TEXT NOT NULL CHECK (module_type IN (
                        'personality', 'voice_tone', 'business_kb', 'faq',
                        'restrictions', 'scenario', 'escalation', 'industry_preset',
                        'internal_manual', 'product_recommend', 'hearing_sheet'
                      )),
  current_version_id  TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, module_type)
);

INSERT INTO prompt_modules_new (
  id, line_account_id, module_type, current_version_id, active, created_at, updated_at
)
SELECT id, line_account_id, module_type, current_version_id, active, created_at, updated_at
FROM prompt_modules;

DROP TABLE prompt_modules;
ALTER TABLE prompt_modules_new RENAME TO prompt_modules;

CREATE INDEX IF NOT EXISTS idx_prompt_modules_account
  ON prompt_modules (line_account_id, active);
