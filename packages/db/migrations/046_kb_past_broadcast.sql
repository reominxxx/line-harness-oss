-- ============================================================================
-- Migration 046: kb_documents に past_broadcast / past_scenario / past_chat 追加
--
-- 目的:
--   Lステップ等の他ツールからの移行時に、過去配信 / シナリオ / チャット履歴を
--   ナレッジベースとして取り込み、AI が新規配信生成時に RAG で参照できるよう
--   にする。
--
-- 方法:
--   SQLite では CHECK 制約を ALTER で変更できないため、テーブルを再構築する。
--   1. 新テーブル kb_documents_new を作成（拡張された CHECK 制約）
--   2. 既存データをコピー
--   3. 旧テーブルを drop
--   4. リネーム
--   5. インデックスを再作成
-- ============================================================================

CREATE TABLE kb_documents_new (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL CHECK (source_type IN
                     ('faq', 'product', 'brand_guide', 'manual', 'policy', 'external_url',
                      'past_broadcast', 'past_scenario', 'past_chat')),
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  source_url       TEXT,
  metadata_json    TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  vector_indexed   INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO kb_documents_new
SELECT id, line_account_id, source_type, title, content, source_url, metadata_json,
       active, vector_indexed, created_by, created_at, updated_at
FROM kb_documents;

DROP TABLE kb_documents;
ALTER TABLE kb_documents_new RENAME TO kb_documents;

CREATE INDEX IF NOT EXISTS idx_kb_documents_account ON kb_documents (line_account_id, source_type, active);
CREATE INDEX IF NOT EXISTS idx_kb_documents_active ON kb_documents (line_account_id, active);
