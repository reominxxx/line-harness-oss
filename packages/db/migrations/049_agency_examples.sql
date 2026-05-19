-- ============================================================================
-- Migration 049: 業界横断・全テナント共有の配信実例ライブラリ
--
-- 目的:
--   ネット上の運用代行ノウハウ・YouTube 解説の要約・他社の実配信スクショや
--   テキストを「全テナント共通の参考データ」として蓄積する。
--   AI 配信生成 (generate-broadcast) 時に業界・テーマで検索して context に注入。
--
--   kb_documents は line_account_id NOT NULL なのでテナント横断には使えない。
--   ここで新規テーブルを作る。
-- ============================================================================

CREATE TABLE IF NOT EXISTS agency_examples (
  id              TEXT PRIMARY KEY,
  -- 分類タグ (検索フィルタとして使う)
  industry        TEXT,                 -- 'beauty' | 'chiropractic' | 'ecommerce' | 'school' | 'legal' | 'other' | NULL
  broadcast_type  TEXT,                 -- 'campaign' | 'reminder' | 'newsletter' | 'event' | 'limited_offer' | 'aftercare' | 'welcome' | NULL
  time_of_day     TEXT,                 -- 'morning' (6-10) | 'noon' (11-13) | 'afternoon' (14-17) | 'evening' (18-21) | 'night' (22-) | NULL
  weekday         TEXT,                 -- 'mon' | 'tue' | ... | 'sun' | NULL
  season          TEXT,                 -- 'spring' | 'summer' | 'autumn' | 'winter' | 'newyear' | 'xmas' | NULL
  -- 本体
  title           TEXT,                 -- 例: "美容室・5月の集客配信"
  content         TEXT NOT NULL,        -- 配信文の本文
  image_url       TEXT,                 -- 画像 URL (R2 or 外部)
  source_url      TEXT,                 -- 取り込み元 URL (Web 記事や元アカウントへのリンク)
  notes           TEXT,                 -- 自分のメモ・効果メモ ("開封 35%" 等)
  tags_json       TEXT,                 -- JSON array、自由タグ
  -- 公開範囲
  is_public       INTEGER NOT NULL DEFAULT 1,  -- 1=全テナント参照可、0=非公開 (アーカイブ用途)
  added_by        TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_agency_examples_industry  ON agency_examples (industry, is_public);
CREATE INDEX IF NOT EXISTS idx_agency_examples_type      ON agency_examples (broadcast_type, is_public);
CREATE INDEX IF NOT EXISTS idx_agency_examples_time      ON agency_examples (time_of_day, is_public);
CREATE INDEX IF NOT EXISTS idx_agency_examples_created   ON agency_examples (created_at DESC);
