-- ============================================================
-- migration 068: extend coupons for LINE 公式リサーチ-style lottery
--
-- LINE 公式アカウントマネージャーのクーポン作成画面で「抽選」を選んだ場合の
-- 当選確率(1% 等)と当選者数上限を保持する。
-- acquisition_condition は既に 'none' (条件なし) / 'lottery' (抽選) を許容している前提。
-- ============================================================

ALTER TABLE coupons ADD COLUMN lottery_probability INTEGER;
-- 当選確率(1〜100)。NULL ならデフォルト 100%(全員当選=条件なしと同じ)。
-- LINE 公式 UI は「1%, 5%, 10%, 25%, 50%, 75%」などプリセット選択方式が一般的。

ALTER TABLE coupons ADD COLUMN lottery_max_winners INTEGER;
-- 当選者数上限。NULL なら「上限なし」。
