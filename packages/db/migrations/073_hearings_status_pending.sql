-- hearings.status の CHECK 制約に 'pending' を追加。
-- SQLite は CHECK 制約を ALTER できないので、テーブルを作り直して移行する。

CREATE TABLE hearings_new (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  transcript_text TEXT,
  csv_text TEXT,
  csv_filename TEXT,
  blueprint_json TEXT,
  ai_cost_yen_x100 INTEGER DEFAULT 0,
  monthly_broadcast_count INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id) ON DELETE CASCADE
);

INSERT INTO hearings_new (
  id, line_account_id, title, transcript_text, csv_text, csv_filename,
  blueprint_json, ai_cost_yen_x100, monthly_broadcast_count, status, error_message,
  created_at, updated_at
)
SELECT
  id, line_account_id, title, transcript_text, csv_text, csv_filename,
  blueprint_json, ai_cost_yen_x100, monthly_broadcast_count, status, error_message,
  created_at, updated_at
FROM hearings;

DROP TABLE hearings;
ALTER TABLE hearings_new RENAME TO hearings;

CREATE INDEX idx_hearings_account_created
  ON hearings(line_account_id, created_at DESC);
