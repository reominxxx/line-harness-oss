-- ============================================================================
-- Migration 062: クーポン機能 (公式 LINE 相当)
--
-- 機能:
--   - クーポンの作成・編集・削除 (アカウント別)
--   - 配信時に Flex Message としてクーポンカード送信 (画像 + 割引情報 + 使用ボタン)
--   - 顧客は LIFF / 公開ページで「クーポンを使う」ボタン押下 → coupon_redemptions に記録
--   - 1回限定クーポンは redemptions の存在で再使用ブロック
-- ============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  -- 基本設定
  name                     TEXT NOT NULL,                      -- クーポン名 (60字)
  acquisition_condition    TEXT NOT NULL DEFAULT 'none',       -- 獲得条件 'none' | 'friend_add' | 'tag_added' 等
  -- 有効期間
  valid_from               TEXT NOT NULL,                      -- ISO8601 (JST)
  valid_to                 TEXT NOT NULL,                      -- ISO8601 (JST)
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  -- 画像 / 説明
  image_url                TEXT,
  usage_guide              TEXT,                                -- 利用ガイド (500字)
  -- 使用回数
  max_uses_per_friend      INTEGER NOT NULL DEFAULT 1,         -- 1=1回のみ, 0=無制限
  -- クーポンコード
  show_code                INTEGER NOT NULL DEFAULT 0,         -- 0=非表示, 1=表示
  code_value               TEXT,
  -- クーポンタイプ (現状 'discount' のみ、将来 'gift' 等を追加可能)
  coupon_type              TEXT NOT NULL DEFAULT 'discount',
  discount_mode            TEXT,                                -- 'yen' | 'percent' | 'strikethrough' | 'none'
  discount_yen             INTEGER,                             -- 'yen' のとき
  discount_percent         INTEGER,                             -- 'percent' のとき
  strikethrough_before     INTEGER,                             -- 'strikethrough' のとき (割引前金額)
  strikethrough_after      INTEGER,                             -- 'strikethrough' のとき (割引後金額)
  condition_text           TEXT,                                -- 利用条件 (30字 例: 1000円以上)
  -- 状態
  status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_coupons_account ON coupons (line_account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_valid ON coupons (line_account_id, valid_from, valid_to);

-- 顧客がクーポンを使用した記録
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id          TEXT PRIMARY KEY,
  coupon_id   TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  used_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  -- メタ: スタッフ提示時の確認 (任意)
  staff_id    TEXT REFERENCES staff_members(id) ON DELETE SET NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON coupon_redemptions (coupon_id, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemptions_friend ON coupon_redemptions (friend_id, coupon_id);
