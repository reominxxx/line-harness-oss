-- ============================================================
-- 081: 無料診断「LINE運用度診断」の seed
--   - ナーチャシナリオ + 3ステップ
--   - 診断フォーム (form_kind='diagnosis', 業種 + Q1..Q9, options[].score)
-- 設計の正は docs/sales/free-diagnosis-design.md。
-- 固定 UUID + INSERT OR IGNORE で再適用しても二重登録されない。
-- フォーム ID は LP/LIFF の URL から参照する: 11111111-1111-4111-8111-111111111111
-- ============================================================

-- ナーチャシナリオ (trigger_type='manual': フォーム on_submit から enroll)
INSERT OR IGNORE INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, delivery_mode)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '無料診断ナーチャ',
  'LINE運用度診断の結果配信後に流すフォロー。結果解説→事例→ヒアリング予約催促。',
  'manual',
  NULL,
  1,
  'relative'
);

-- Step1: 結果の補足解説 (約1日後)
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
VALUES (
  '2a000001-0000-4000-8000-000000000001',
  '22222222-2222-4222-8222-222222222222',
  1,
  1440,
  'text',
  '昨日の診断結果はいかがでしたか？「で、何から手をつければいいか」は人によって違います。あなたの最大のボトルネックに合わせた具体的な改善ステップを、無料ヒアリング(30分)でご提案します。'
);

-- Step2: 業種別の事例 (約3日後)
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
VALUES (
  '2a000002-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  2,
  2880,
  'text',
  '同じ業種の店舗でも、LINEの使い方を整えるだけで予約・再来の数字は変わります。L-portは専属チーム＋AIで運用を丸ごと代行。気になる事例は無料ヒアリングでお話しします。'
);

-- Step3: ヒアリング予約の最終催促 (約2日後)
INSERT OR IGNORE INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
VALUES (
  '2a000003-0000-4000-8000-000000000003',
  '22222222-2222-4222-8222-222222222222',
  3,
  2880,
  'text',
  'まずは話を聞いてみたい、という方へ。無料ヒアリング(30分)では、あなたの店に合う改善プランと概算をその場でお出しします。ご希望の日時をこのトークに送ってください。'
);

-- 診断フォーム本体
INSERT OR IGNORE INTO forms
  (id, name, description, fields, on_submit_scenario_id, save_to_metadata, is_active, form_kind)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'LINE運用度診断',
  'リードマグネット用の無料診断。業種 + 9問(各4択/0-3点)で運用度スコアとボトルネックを判定する。',
  '[{"name":"industry","label":"業種","type":"select","required":true,"options":[{"value":"salon","label":"美容室"},{"value":"seitai","label":"整体・治療院"},{"value":"ec","label":"EC・D2C"},{"value":"school","label":"スクール・教室"},{"value":"shigyo","label":"士業"},{"value":"restaurant","label":"飲食店"},{"value":"other","label":"その他"}]},{"name":"q1","label":"友だち獲得導線","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"店頭・Web・広告など複数の導線があり、毎月安定して増えている"},{"value":"2","score":2,"label":"店頭QRなど1つの導線で、少しずつ増えている"},{"value":"1","score":1,"label":"友だち追加をお願いしているが、ほぼ増えていない"},{"value":"0","score":0,"label":"特に何もしていない / 友だちがほとんどいない"}]},{"name":"q2","label":"初動フォロー","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"あいさつ＋特典を自動で送り、初回来店/購入まで設計している"},{"value":"2","score":2,"label":"あいさつメッセージは自動で送っている"},{"value":"1","score":1,"label":"たまに手動で送ることがある"},{"value":"0","score":0,"label":"何も送っていない"}]},{"name":"q3","label":"リッチメニュー","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"目的別に整理し、対象によって出し分けている"},{"value":"2","score":2,"label":"設置していて、予約や問い合わせに使えている"},{"value":"1","score":1,"label":"設置しているが、ほぼ使われていない"},{"value":"0","score":0,"label":"設置していない"}]},{"name":"q4","label":"セグメント/パーソナライズ配信","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"タグ/セグメントで出し分け、一人ひとりに合った内容を送れている"},{"value":"2","score":2,"label":"一部のお客様を分けて送ることがある"},{"value":"1","score":1,"label":"全員に同じ内容を一斉配信している"},{"value":"0","score":0,"label":"そもそも配信していない"}]},{"name":"q5","label":"リピート施策","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"複数の仕組みがあり、リピート/再来が回っている"},{"value":"2","score":2,"label":"1つはある（例: クーポンや予約）"},{"value":"1","score":1,"label":"用意したいが手をつけられていない"},{"value":"0","score":0,"label":"何もない"}]},{"name":"q6","label":"効果測定","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"CV や流入を計測し、数字を見て改善している"},{"value":"2","score":2,"label":"開封やクリックは見ている"},{"value":"1","score":1,"label":"送りっぱなしで結果は見ていない"},{"value":"0","score":0,"label":"計測の仕方がわからない"}]},{"name":"q7","label":"配信コスト・通数管理","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"LINE公式アカウント側の配信数や追加費用を把握し、費用対効果を見ながら必要な配信ができている"},{"value":"2","score":2,"label":"配信数や費用はある程度把握しているが、配信頻度には少し不安がある"},{"value":"1","score":1,"label":"追加メッセージ費用や通数超過が気になり、配信を控えてしまうことがある"},{"value":"0","score":0,"label":"配信数や費用の仕組みがよく分からず、ほとんど運用できていない"}]},{"name":"q8","label":"配信内容の質","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"ユーザーの悩み・興味・状況に合わせた内容を配信できている"},{"value":"2","score":2,"label":"キャンペーンやお知らせ中心だが、一定の反応はある"},{"value":"1","score":1,"label":"何を送ればいいか分からず、配信が不定期になっている"},{"value":"0","score":0,"label":"ほとんど配信していない / 内容を考えられていない"}]},{"name":"q9","label":"運用体制・継続性","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"担当者・配信頻度・改善フローが決まっており、継続的に運用できている"},{"value":"2","score":2,"label":"担当者はいるが、運用が属人的になっている"},{"value":"1","score":1,"label":"やりたいが、時間や知識が足りず後回しになっている"},{"value":"0","score":0,"label":"誰も運用できていない / 放置している"}]}]',
  '22222222-2222-4222-8222-222222222222',
  1,
  1,
  'diagnosis'
);

-- 既に seed 済みの行は INSERT OR IGNORE では更新されないため、fields/説明を明示的に上書きする (9問化対応・冪等)。
UPDATE forms SET
  description = 'リードマグネット用の無料診断。業種 + 9問(各4択/0-3点)で運用度スコアとボトルネックを判定する。',
  fields = '[{"name":"industry","label":"業種","type":"select","required":true,"options":[{"value":"salon","label":"美容室"},{"value":"seitai","label":"整体・治療院"},{"value":"ec","label":"EC・D2C"},{"value":"school","label":"スクール・教室"},{"value":"shigyo","label":"士業"},{"value":"restaurant","label":"飲食店"},{"value":"other","label":"その他"}]},{"name":"q1","label":"友だち獲得導線","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"店頭・Web・広告など複数の導線があり、毎月安定して増えている"},{"value":"2","score":2,"label":"店頭QRなど1つの導線で、少しずつ増えている"},{"value":"1","score":1,"label":"友だち追加をお願いしているが、ほぼ増えていない"},{"value":"0","score":0,"label":"特に何もしていない / 友だちがほとんどいない"}]},{"name":"q2","label":"初動フォロー","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"あいさつ＋特典を自動で送り、初回来店/購入まで設計している"},{"value":"2","score":2,"label":"あいさつメッセージは自動で送っている"},{"value":"1","score":1,"label":"たまに手動で送ることがある"},{"value":"0","score":0,"label":"何も送っていない"}]},{"name":"q3","label":"リッチメニュー","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"目的別に整理し、対象によって出し分けている"},{"value":"2","score":2,"label":"設置していて、予約や問い合わせに使えている"},{"value":"1","score":1,"label":"設置しているが、ほぼ使われていない"},{"value":"0","score":0,"label":"設置していない"}]},{"name":"q4","label":"セグメント/パーソナライズ配信","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"タグ/セグメントで出し分け、一人ひとりに合った内容を送れている"},{"value":"2","score":2,"label":"一部のお客様を分けて送ることがある"},{"value":"1","score":1,"label":"全員に同じ内容を一斉配信している"},{"value":"0","score":0,"label":"そもそも配信していない"}]},{"name":"q5","label":"リピート施策","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"複数の仕組みがあり、リピート/再来が回っている"},{"value":"2","score":2,"label":"1つはある（例: クーポンや予約）"},{"value":"1","score":1,"label":"用意したいが手をつけられていない"},{"value":"0","score":0,"label":"何もない"}]},{"name":"q6","label":"効果測定","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"CV や流入を計測し、数字を見て改善している"},{"value":"2","score":2,"label":"開封やクリックは見ている"},{"value":"1","score":1,"label":"送りっぱなしで結果は見ていない"},{"value":"0","score":0,"label":"計測の仕方がわからない"}]},{"name":"q7","label":"配信コスト・通数管理","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"LINE公式アカウント側の配信数や追加費用を把握し、費用対効果を見ながら必要な配信ができている"},{"value":"2","score":2,"label":"配信数や費用はある程度把握しているが、配信頻度には少し不安がある"},{"value":"1","score":1,"label":"追加メッセージ費用や通数超過が気になり、配信を控えてしまうことがある"},{"value":"0","score":0,"label":"配信数や費用の仕組みがよく分からず、ほとんど運用できていない"}]},{"name":"q8","label":"配信内容の質","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"ユーザーの悩み・興味・状況に合わせた内容を配信できている"},{"value":"2","score":2,"label":"キャンペーンやお知らせ中心だが、一定の反応はある"},{"value":"1","score":1,"label":"何を送ればいいか分からず、配信が不定期になっている"},{"value":"0","score":0,"label":"ほとんど配信していない / 内容を考えられていない"}]},{"name":"q9","label":"運用体制・継続性","type":"radio","required":true,"options":[{"value":"3","score":3,"label":"担当者・配信頻度・改善フローが決まっており、継続的に運用できている"},{"value":"2","score":2,"label":"担当者はいるが、運用が属人的になっている"},{"value":"1","score":1,"label":"やりたいが、時間や知識が足りず後回しになっている"},{"value":"0","score":0,"label":"誰も運用できていない / 放置している"}]}]'
WHERE id = '11111111-1111-4111-8111-111111111111';
