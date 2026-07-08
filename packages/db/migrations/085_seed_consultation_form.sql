-- ============================================================
-- 085: 無料相談フォームの seed
--   LP「無料相談」ボタン → /consultation で表示する問い合わせフォーム。
--   form_kind='consultation'（診断ではないので採点しない）。
--   会社名/店舗名/担当者名/メール/電話/業種/WebサイトURL/
--   LINE公式アカウント有無/現在の課題/希望相談日時 を収集。
--   固定 UUID + INSERT OR IGNORE で再適用しても二重登録されない。
--   フォーム ID は LP の /consultation から参照する:
--     33333333-3333-4333-8333-333333333333
-- ============================================================

INSERT OR IGNORE INTO forms
  (id, name, description, fields, save_to_metadata, is_active, form_kind)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '無料相談',
  'LP「無料相談」ボタンから遷移する問い合わせフォーム。テレアポ/商談アポ獲得用。',
  '[{"name":"company","label":"会社名","type":"text","required":true},{"name":"store_name","label":"店舗名","type":"text","required":false},{"name":"contact_name","label":"ご担当者名","type":"text","required":true},{"name":"email","label":"メールアドレス","type":"email","required":true},{"name":"phone","label":"電話番号","type":"tel","required":true},{"name":"industry","label":"業種","type":"select","required":true,"options":[{"value":"salon","label":"美容室・ネイル"},{"value":"seitai","label":"整体・治療院・パーソナルジム"},{"value":"ec","label":"EC・D2C"},{"value":"school","label":"スクール・教室"},{"value":"shigyo","label":"士業"},{"value":"restaurant","label":"飲食店"},{"value":"other","label":"その他"}]},{"name":"website","label":"WebサイトURL","type":"text","required":false},{"name":"has_line_oa","label":"LINE公式アカウントの有無","type":"radio","required":true,"options":[{"value":"yes","label":"あり"},{"value":"no","label":"なし"},{"value":"unknown","label":"わからない"}]},{"name":"challenge","label":"現在の課題・ご相談内容","type":"textarea","required":false},{"name":"preferred_datetime","label":"希望相談日時","type":"text","required":false}]',
  0,
  1,
  'consultation'
);

-- 既に seed 済みの行は INSERT OR IGNORE では更新されないため、fields/説明を明示的に上書きする (冪等)。
UPDATE forms
SET
  name = '無料相談',
  description = 'LP「無料相談」ボタンから遷移する問い合わせフォーム。テレアポ/商談アポ獲得用。',
  fields = '[{"name":"company","label":"会社名","type":"text","required":true},{"name":"store_name","label":"店舗名","type":"text","required":false},{"name":"contact_name","label":"ご担当者名","type":"text","required":true},{"name":"email","label":"メールアドレス","type":"email","required":true},{"name":"phone","label":"電話番号","type":"tel","required":true},{"name":"industry","label":"業種","type":"select","required":true,"options":[{"value":"salon","label":"美容室・ネイル"},{"value":"seitai","label":"整体・治療院・パーソナルジム"},{"value":"ec","label":"EC・D2C"},{"value":"school","label":"スクール・教室"},{"value":"shigyo","label":"士業"},{"value":"restaurant","label":"飲食店"},{"value":"other","label":"その他"}]},{"name":"website","label":"WebサイトURL","type":"text","required":false},{"name":"has_line_oa","label":"LINE公式アカウントの有無","type":"radio","required":true,"options":[{"value":"yes","label":"あり"},{"value":"no","label":"なし"},{"value":"unknown","label":"わからない"}]},{"name":"challenge","label":"現在の課題・ご相談内容","type":"textarea","required":false},{"name":"preferred_datetime","label":"希望相談日時","type":"text","required":false}]',
  form_kind = 'consultation',
  is_active = 1
WHERE id = '33333333-3333-4333-8333-333333333333';
