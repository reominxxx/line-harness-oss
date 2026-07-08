-- クーポン UI/UX 拡張: テンプレート / カラー / サブタイトル / 店舗情報など
-- LINE 公式アカウントクーポンの UI に寄せた表示に対応する。

ALTER TABLE coupons ADD COLUMN subtitle TEXT;
-- 「今月限定」「新規様限定」等のキャッチコピー (40 字推奨)

ALTER TABLE coupons ADD COLUMN template_id TEXT DEFAULT 'simple';
-- デザインテンプレ: simple / bold / elegant / pop / premium / urgent

ALTER TABLE coupons ADD COLUMN brand_color TEXT DEFAULT '#06C755';
-- テーマカラー (Flex のアクセント / ボタン / 装飾に使う)

ALTER TABLE coupons ADD COLUMN accent_color TEXT;
-- 強調色 (割引額の色など)。null なら brand_color と同じ扱い。

ALTER TABLE coupons ADD COLUMN button_label TEXT DEFAULT 'クーポンを見る';
-- Flex メッセージの主ボタン文言 (「予約する」「詳細を見る」等にカスタム可)

ALTER TABLE coupons ADD COLUMN store_info_json TEXT;
-- 店舗情報の JSON: { name, hours, phone, address, map_url, sub_buttons: [...] }

ALTER TABLE coupons ADD COLUMN show_remaining_days INTEGER DEFAULT 1;
-- 1 = 「あと N 日」を表示 (残り 3 日以下で赤強調)

ALTER TABLE coupons ADD COLUMN show_lottery_remaining INTEGER DEFAULT 0;
-- 1 = 抽選クーポンで「残り N 名様」を表示

ALTER TABLE coupons ADD COLUMN background_pattern TEXT DEFAULT 'none';
-- none / stripe / dot / gradient

ALTER TABLE coupons ADD COLUMN image_position TEXT DEFAULT 'hero';
-- hero (上部ヘッダー) / inline (本文中央)
