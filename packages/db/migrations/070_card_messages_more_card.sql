-- ============================================================
-- migration 070: card_messages にもっと見るカード設定を追加
--
-- LINE 公式カードタイプメッセージの「もっと見るカード」相当。
-- 通常カードの最後に表示される追加カードで、CTA を 1 つだけ持つ。
-- 形式:
--   { "label": "もっと見る", "actionType": "uri" | "coupon" | "research" | "message", "data": "..." }
-- ============================================================

ALTER TABLE card_messages ADD COLUMN more_card_json TEXT;
