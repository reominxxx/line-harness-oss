-- ============================================================================
-- Migration 078: prompt_modules の CHECK 制約に chat_examples / other を追加
--
-- 経緯:
--   053 で hearing_sheet (11番目) を追加した際、TS 側に既に存在していた
--   chat_examples (⑫ 模範応答例 / Few-shot) を CHECK 制約に入れ忘れていた。
--   このため ⑫ の保存が module_type の CHECK 違反で 500 になっていた。
--   あわせて ⑬「その他」(other) を自由記入の補足枠として追加する。
--
-- SQLite には ALTER TABLE で CHECK 制約を変える機能がないため、
-- prompt_modules_new に作り直してデータをコピーする標準パターンを使う。
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_modules_new (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  module_type         TEXT NOT NULL CHECK (module_type IN (
                        'personality', 'voice_tone', 'business_kb', 'faq',
                        'restrictions', 'scenario', 'escalation', 'industry_preset',
                        'internal_manual', 'product_recommend', 'hearing_sheet',
                        'chat_examples', 'other'
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
