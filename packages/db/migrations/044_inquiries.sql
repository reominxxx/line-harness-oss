-- ============================================================================
-- Migration 044: 無料相談・問い合わせ受付
--
-- 目的:
--   LP（lassist.jp 等）からの無料相談・資料請求の問い合わせを受ける。
--   LINE 友だち追加前の見込み客が対象なので、line_account_id とは独立。
--   reo さん側で受信通知を受け、対応ステータスを管理する。
-- ============================================================================

CREATE TABLE IF NOT EXISTS inquiries (
  id                TEXT PRIMARY KEY,
  company_name      TEXT,
  contact_name      TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  industry          TEXT,
  plan_interest     TEXT,                -- 'lite' | 'standard' | 'pro' | 'unknown'
  message           TEXT NOT NULL,
  preferred_dates   TEXT,                -- 顧客記入の希望日時候補（自由記述）
  source            TEXT NOT NULL,       -- 'lp_free_consult' | 'lp_document_request' | 'lp_other'
  status            TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'contacted', 'meeting_scheduled', 'closed_won', 'closed_lost', 'spam')),
  staff_note        TEXT,
  assigned_to       TEXT REFERENCES staff_members (id),
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status_created ON inquiries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries (email);
