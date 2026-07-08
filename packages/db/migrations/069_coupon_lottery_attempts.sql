-- ============================================================
-- migration 069: lottery attempt log
--
-- 抽選クーポン (acquisition_condition='lottery') の挑戦結果を記録する。
-- 既存 coupon_redemptions は「使用済み (店舗で使われた)」を表す用途で残し、
-- 抽選結果は別テーブルに分離する。
-- 理由:
--   1. 1 友だち = 1 抽選 を担保しやすい (UNIQUE (coupon_id, friend_id))
--   2. 当選後の利用は coupon_redemptions に追加で記録 → 抽選→当選→使用 の 2 段
--   3. 落選も履歴に残せる (再挑戦防止)
-- ============================================================

CREATE TABLE IF NOT EXISTS coupon_lottery_attempts (
  id              TEXT PRIMARY KEY,
  coupon_id       TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  result          TEXT NOT NULL CHECK (result IN ('won', 'lost')),
  probability     INTEGER NOT NULL,      -- 挑戦時の当選確率 (1〜100)
  random_roll     INTEGER NOT NULL,      -- 出目 (0〜99) — 監査用
  attempted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (coupon_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_lottery_attempts_coupon ON coupon_lottery_attempts (coupon_id, result);
CREATE INDEX IF NOT EXISTS idx_lottery_attempts_friend ON coupon_lottery_attempts (friend_id);
