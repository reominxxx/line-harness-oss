-- ヒアリング → 運用設計書 生成機能
-- サービス事業者の MTG 文字起こし + ヒアリングシート CSV を入力に、
-- Claude で構造化された運用設計書を生成し保存する。
-- blueprint_json は schema (apps/worker/src/services/hearings/blueprint-schema.ts) 準拠。

CREATE TABLE hearings (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  -- 入力ソース
  transcript_text TEXT,                -- MTG 録音の文字起こし (別ツールで作成済み)
  csv_text TEXT,                       -- ヒアリングシート CSV
  csv_filename TEXT,
  -- AI 生成結果
  blueprint_json TEXT,                 -- 設計書 (JSON 文字列)
  ai_cost_yen_x100 INTEGER DEFAULT 0,  -- 生成時の AI コスト (1/100 円単位)
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_hearings_account_created
  ON hearings(line_account_id, created_at DESC);
