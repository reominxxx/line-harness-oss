-- ============================================================================
-- Migration 087: ai_products を「あらゆるオファー」を表現できる汎用スキーマへ拡張
--
-- 背景・目的:
--   AI 接客が薦める「商品」を、物販 SKU に限定しない。美容整形の施術プラン /
--   整体コース / 飲食メニュー / サブスク / 予約枠 なども同じ 1 テーブルで扱えるよう
--   にする。ソース (Shopify公開JSON / JSON-LD / CSV / PDF / 対話ヒアリング) が
--   何であれ、最終的にこの共通モデルへ正規化して落とす。
--
--   固定 EC 前提スキーマにはしない。共通コア列 + 業種別フィールドは attributes_json
--   (JSON) に逃がす「universal escape hatch」方式。業種ごとの表示・抽出は
--   packages/shared の IndustryTemplate で定義する。
--
-- 後方互換:
--   既存の price_yen / stock / image_url / product_url / category / tags_json は
--   そのまま残す。price_yen は「代表価格 (1件で示すならこの額)」として使い続ける。
--   新規レコードは pricing_type と price_min/price_max も併せて持つ。
-- ============================================================================

-- 種別ディスクリミネータ: physical / service_plan / subscription / booking / digital / menu_item
ALTER TABLE ai_products ADD COLUMN product_kind TEXT NOT NULL DEFAULT 'physical';

-- 価格モデル: fixed(固定) / from(〜から) / range(¥X〜¥Y) / quote(要相談・要カウンセリング) / subscription(月額) / free(無料)
ALTER TABLE ai_products ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'fixed';
-- 価格帯。fixed の時は price_min = price_max = price_yen を想定
ALTER TABLE ai_products ADD COLUMN price_min INTEGER;
ALTER TABLE ai_products ADD COLUMN price_max INTEGER;
-- 価格の補足表記 ("初回のみ" "税込" "1回あたり" "要カウンセリング" 等)
ALTER TABLE ai_products ADD COLUMN price_note TEXT;

-- 次アクション種別: buy(購入) / book(予約) / consult(相談・カウンセリング) / inquire(問い合わせ) / none
-- 業種で「AI が会話後に促す次の一手」が変わる肝。物販=購入、美容整形=カウンセリング予約 等。
ALTER TABLE ai_products ADD COLUMN cta_type TEXT NOT NULL DEFAULT 'buy';
-- CTA ボタンの表示文言 ("詳しく見る" を上書き。例: "無料カウンセリング予約")
ALTER TABLE ai_products ADD COLUMN cta_label TEXT;
-- CTA の遷移先。未指定なら従来どおり product_url にフォールバック
ALTER TABLE ai_products ADD COLUMN cta_url TEXT;

-- 業種別フィールドの JSON。美容整形=部位/ダウンタイム/麻酔/回数/リスク、整体=症状/施術時間/回数券 等。
-- キー体系は packages/shared の IndustryTemplate で定義する。
ALTER TABLE ai_products ADD COLUMN attributes_json TEXT;

-- 取得元アダプタ識別子: shopify_public / json_ld / google_feed / csv / pdf / image / manual / url_llm 等
ALTER TABLE ai_products ADD COLUMN source TEXT;
-- 取得元 URL / ファイル名 (再取得・トレーサビリティ用)
ALTER TABLE ai_products ADD COLUMN source_url TEXT;
-- ソース側の一意 ID (Shopify variant id 等)。再同期(upsert)のキー。
ALTER TABLE ai_products ADD COLUMN external_id TEXT;
-- 最後にソースから同期した時刻
ALTER TABLE ai_products ADD COLUMN synced_at TEXT;

-- レビュー状態: draft(下書き・AI生成直後で未確認) / published(公開・AI接客が参照可) / archived(取り下げ)
-- AI 接客に出す条件は status='published' AND active=1。
ALTER TABLE ai_products ADD COLUMN status TEXT NOT NULL DEFAULT 'published';

-- AI 抽出の確信度メタ (フィールド別 0-1 など)。人間レビュー UI で「怪しい所」を光らせる用。
ALTER TABLE ai_products ADD COLUMN confidence_json TEXT;

-- 再同期の upsert キー: 同一アカウント×ソース×external_id は 1 レコード。
-- external_id が NULL のレコード (手入力・対話ヒアリング) は制約対象外にするため部分インデックス。
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_products_source_ext
  ON ai_products (line_account_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- AI 接客の参照クエリ (status='published' AND active=1) 用
CREATE INDEX IF NOT EXISTS idx_ai_products_status
  ON ai_products (line_account_id, status, active);
