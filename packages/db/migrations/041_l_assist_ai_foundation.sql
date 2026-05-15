-- ============================================================================
-- 041_l_assist_ai_foundation.sql
--
-- L-アシスト AI 機能基盤
--
-- 設計方針:
--  - 既存テーブルへの ALTER は行わない（既存運用に影響を与えない）
--  - 全テーブルは line_account_id で完全テナント分離（既存マルチアカウント基盤に準拠）
--  - id は TEXT (UUID), 日時は TEXT ISO 8601 JST (既存規約に合わせる)
--  - インデックス命名は idx_<table>_<columns> 規約
--  - 既存の friends / chats / staff_members / line_accounts を尊重
--
-- 含むもの:
--  1. ナレッジベース（kb_documents, kb_chunks）
--  2. AI 商品マスタ（ai_products）
--  3. プロンプトモジュール（prompt_modules, prompt_module_versions）
--  4. AI チャット拡張メタデータ（ai_chat_metadata）
--  5. AI 応答キャッシュ（ai_response_cache）
--  6. 顧客 AI シグナル（ai_friend_signals）
--  7. AI 使用ログ（ai_usage_log）
--  8. テナント計量（tenant_metering）
--  9. 監査ログ（audit_log）
-- 10. PII 削除リクエスト（pii_deletion_requests）
-- 11. 同意管理（consent_records）
-- ============================================================================


-- ============================================================================
-- 1. ナレッジベース（FAQ, ブランドガイド, マニュアル等）
-- ============================================================================

CREATE TABLE IF NOT EXISTS kb_documents (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL CHECK (source_type IN
                     ('faq', 'product', 'brand_guide', 'manual', 'policy', 'external_url')),
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

CREATE INDEX IF NOT EXISTS idx_kb_documents_account ON kb_documents (line_account_id, source_type, active);
CREATE INDEX IF NOT EXISTS idx_kb_documents_active ON kb_documents (line_account_id, active);


-- KB チャンク（Vectorize に投入する単位）
CREATE TABLE IF NOT EXISTS kb_chunks (
  id               TEXT PRIMARY KEY,
  document_id      TEXT NOT NULL REFERENCES kb_documents (id) ON DELETE CASCADE,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  content          TEXT NOT NULL,
  vector_id        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_account ON kb_chunks (line_account_id);


-- ============================================================================
-- 2. AI 商品マスタ（EC / 物販向け）
--    既存に products テーブルがないため新規。affiliates や conversion_points
--    とは別軸の「AI が回答時に参照する商品データ」。
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_products (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  sku              TEXT,
  name             TEXT NOT NULL,
  description      TEXT,
  price_yen        INTEGER,
  stock            INTEGER,
  image_url        TEXT,
  category         TEXT,
  tags_json        TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  vector_indexed   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ai_products_account ON ai_products (line_account_id, active);
CREATE INDEX IF NOT EXISTS idx_ai_products_category ON ai_products (line_account_id, category);


-- ============================================================================
-- 3. プロンプトモジュール（8 種類、バージョン履歴付き）
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_modules (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  module_type         TEXT NOT NULL CHECK (module_type IN (
                        'personality', 'voice_tone', 'business_kb', 'faq',
                        'restrictions', 'scenario', 'escalation', 'industry_preset'
                      )),
  current_version_id  TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, module_type)
);

CREATE INDEX IF NOT EXISTS idx_prompt_modules_account ON prompt_modules (line_account_id, active);


CREATE TABLE IF NOT EXISTS prompt_module_versions (
  id          TEXT PRIMARY KEY,
  module_id   TEXT NOT NULL REFERENCES prompt_modules (id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  author_id   TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_module ON prompt_module_versions (module_id, version DESC);


-- ============================================================================
-- 4. AI チャット拡張メタデータ
--    既存 chats テーブルは「会話セッション」レベル。
--    個別メッセージへの AI 関連メタは別テーブルで持つ（既存に影響を与えない）。
--    messages_log との関連は今後の実装フェーズで詰める。
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_chat_metadata (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  friend_id         TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  chat_id           TEXT REFERENCES chats (id) ON DELETE SET NULL,
  message_text      TEXT,
  intent            TEXT,
  model_used        TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cost_yen_x100     INTEGER,
  kb_chunks_used    TEXT,
  cached_response   INTEGER NOT NULL DEFAULT 0,
  escalated         INTEGER NOT NULL DEFAULT 0,
  vision_used       INTEGER NOT NULL DEFAULT 0,
  pii_masked        INTEGER NOT NULL DEFAULT 0,
  response_time_ms  INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_metadata_account ON ai_chat_metadata (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_metadata_friend ON ai_chat_metadata (friend_id, created_at DESC);


-- ============================================================================
-- 5. AI 応答キャッシュ（コスト削減）
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_response_cache (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  question_hash    TEXT NOT NULL,
  question         TEXT NOT NULL,
  response         TEXT NOT NULL,
  model_used       TEXT,
  hit_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (line_account_id, question_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_account_hash ON ai_response_cache (line_account_id, question_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_response_cache (expires_at);


-- ============================================================================
-- 6. 顧客 AI シグナル（intent score, churn risk, LTV, VIP rank）
--    既存 friend_scores や scoring_rules とは別軸で AI 推定値を保持。
--    既存スコア（行動ベース）と AI スコアを統合判断するロジックは UI 層。
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_friend_signals (
  friend_id           TEXT PRIMARY KEY REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  purchase_intent     INTEGER NOT NULL DEFAULT 0,
  churn_risk          INTEGER NOT NULL DEFAULT 0,
  ltv_estimate_yen    INTEGER,
  vip_rank            TEXT CHECK (vip_rank IN ('vip', 'hot', 'warm', 'cold', 'dormant', 'new')),
  sentiment           TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'angry')),
  signal_summary      TEXT,
  last_chat_at        TEXT,
  last_calculated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ai_signals_account_rank ON ai_friend_signals (line_account_id, vip_rank);
CREATE INDEX IF NOT EXISTS idx_ai_signals_account_intent ON ai_friend_signals (line_account_id, purchase_intent DESC);
CREATE INDEX IF NOT EXISTS idx_ai_signals_churn ON ai_friend_signals (line_account_id, churn_risk DESC);


-- ============================================================================
-- 7. AI 使用ログ（コスト追跡、テナント計量の根拠データ）
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  friend_id        TEXT REFERENCES friends (id) ON DELETE SET NULL,
  feature          TEXT NOT NULL CHECK (feature IN (
                     'chat', 'report', 'copy_gen', 'vision', 'intent',
                     'image_gen', 'batch_analysis', 'embedding', 'moderation'
                   )),
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_yen_x100    INTEGER NOT NULL DEFAULT 0,
  cached           INTEGER NOT NULL DEFAULT 0,
  request_id       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_account_date ON ai_usage_log (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage_log (line_account_id, feature, created_at DESC);


-- ============================================================================
-- 8. テナント計量（含有枠 + 当月使用 + 超過課金）
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_metering (
  line_account_id            TEXT PRIMARY KEY REFERENCES line_accounts (id) ON DELETE CASCADE,
  plan                       TEXT NOT NULL DEFAULT 'lite'
                              CHECK (plan IN ('lite', 'standard', 'pro', 'enterprise')),

  monthly_broadcast_quota    INTEGER NOT NULL DEFAULT 0,
  monthly_chat_quota         INTEGER NOT NULL DEFAULT 0,
  monthly_vision_quota       INTEGER NOT NULL DEFAULT 0,
  monthly_imagegen_quota     INTEGER NOT NULL DEFAULT 0,
  monthly_kb_doc_quota       INTEGER NOT NULL DEFAULT 0,

  current_month              TEXT NOT NULL DEFAULT '',
  used_broadcast             INTEGER NOT NULL DEFAULT 0,
  used_chat                  INTEGER NOT NULL DEFAULT 0,
  used_vision                INTEGER NOT NULL DEFAULT 0,
  used_imagegen              INTEGER NOT NULL DEFAULT 0,
  used_kb_doc                INTEGER NOT NULL DEFAULT 0,

  overage_charge_yen         INTEGER NOT NULL DEFAULT 0,

  monthly_budget_cap_yen     INTEGER,
  alert_threshold_yen        INTEGER,
  auto_fallback_at_limit     INTEGER NOT NULL DEFAULT 1,

  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);


-- ============================================================================
-- 9. 監査ログ（セキュリティ最重要：誰がいつ何をしたか）
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  staff_id         TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  action           TEXT NOT NULL,
  resource_type    TEXT,
  resource_id      TEXT,
  ip_address       TEXT,
  user_agent       TEXT,
  request_id       TEXT,
  details_json     TEXT,
  result           TEXT NOT NULL DEFAULT 'success'
                    CHECK (result IN ('success', 'failed', 'denied')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_account_date ON audit_log (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_staff ON audit_log (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, created_at DESC);


-- ============================================================================
-- 10. PII 削除リクエスト（個人情報保護法対応）
-- ============================================================================

CREATE TABLE IF NOT EXISTS pii_deletion_requests (
  id                  TEXT PRIMARY KEY,
  line_account_id     TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  friend_id           TEXT REFERENCES friends (id) ON DELETE SET NULL,
  requested_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  requested_by        TEXT NOT NULL,
  reason              TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'completed', 'denied', 'cancelled')),
  processed_at        TEXT,
  processed_by        TEXT REFERENCES staff_members (id) ON DELETE SET NULL,
  deletion_log_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pii_deletion_account_status ON pii_deletion_requests (line_account_id, status);
CREATE INDEX IF NOT EXISTS idx_pii_deletion_friend ON pii_deletion_requests (friend_id);


-- ============================================================================
-- 11. 同意管理（AI 利用同意、データ処理同意）
-- ============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
  id               TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  consent_type     TEXT NOT NULL CHECK (consent_type IN (
                     'ai_chat_processing', 'data_storage', 'marketing_delivery', 'profile_analysis'
                   )),
  granted          INTEGER NOT NULL DEFAULT 0,
  policy_version   TEXT,
  granted_at       TEXT,
  revoked_at       TEXT,
  ip_address       TEXT,
  user_agent       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_consent_account_friend ON consent_records (line_account_id, friend_id);
CREATE INDEX IF NOT EXISTS idx_consent_type_granted ON consent_records (consent_type, granted);
