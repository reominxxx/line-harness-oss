-- ============================================================
-- migration 066: extend forms for research/survey use case
--
-- 用途:
--   - 既存 forms テーブルを「フォーム」と「リサーチ(アンケート)」両方で
--     使えるよう拡張する (form_kind カラム)。
--   - リサーチを「友だち追加時のあいさつに同梱」「既存友だちへ配信」など
--     どこで配るかを保持 (delivery_targets JSON)。
--   - 質問の選択肢ごとに別々のタグを付与できるよう、fields JSON の
--     options 配列に tagId を含められる契約に変更 (スキーマ自体は変更不要、
--     アプリ側で読み書きする規約のみ更新)。
--
-- 後方互換:
--   - form_kind = 'form' をデフォルトにし、既存フォームは挙動変更なし。
--   - delivery_targets が NULL/空配列ならフォームのまま (リサーチではない)。
-- ============================================================

ALTER TABLE forms ADD COLUMN form_kind TEXT NOT NULL DEFAULT 'form';
-- 'form' | 'research'

ALTER TABLE forms ADD COLUMN delivery_targets TEXT NOT NULL DEFAULT '[]';
-- JSON 配列。例: '["friend_add"]', '["broadcast"]', '["friend_add","broadcast"]'

ALTER TABLE forms ADD COLUMN research_template TEXT;
-- 'age' | 'gender' | 'area' | 'custom' | NULL。テンプレ起源を残しておくと UI で再現しやすい。
