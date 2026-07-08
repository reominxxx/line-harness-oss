-- CSP 違反レポート収集テーブル
-- Cloudflare Pages に設定した Content-Security-Policy-Report-Only の
-- report-uri から POST されるレポートを保存する。
-- ここに溜めた違反を見て、CSP を強制モードに切替える判断材料にする。

CREATE TABLE IF NOT EXISTS csp_reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  document_uri TEXT,
  violated_directive TEXT,
  effective_directive TEXT,
  blocked_uri TEXT,
  source_file TEXT,
  line_number INTEGER,
  column_number INTEGER,
  status_code INTEGER,
  disposition TEXT,
  user_agent TEXT,
  raw TEXT
);

CREATE INDEX IF NOT EXISTS idx_csp_reports_created_at ON csp_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_csp_reports_directive ON csp_reports(violated_directive);
CREATE INDEX IF NOT EXISTS idx_csp_reports_blocked ON csp_reports(blocked_uri);
