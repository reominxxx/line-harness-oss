# Claude Code 実装プロンプト — L-port 無料診断「LINE運用度診断」

> このファイルは、別の Claude Code セッションにそのまま渡す実装指示です。
> 設計の全文は同ディレクトリの `free-diagnosis-design.md` を正とします。
>
> **実装済みメモ（2026-06-17）**: 本機能は実装・両環境デプロイ完了。Web 入口は `apps/web` ではなく
> **l-port-lp の静的ページ `diagnosis.html`**、LIFF 引き継ぎは **worker `?page=diagnosis`**（`apps/worker/src/client/main.ts`）。
> 採点は `packages/db/src/diagnosis-scoring.ts`、submit 後処理は `apps/worker/src/services/diagnosis.ts`。

---

## あなたへの依頼（コピペして使う本文）

`/Users/reo/line-harness/`（ブランド名 L-port、DfY型 AI LINE運用代行）に、リードマグネットの「無料LINE運用度診断」機能を実装してください。設計の確定仕様は `docs/sales/free-diagnosis-design.md` にあります。**まず必ずこのファイルと、下記の既存基盤ファイルを読んでから着手**してください。

### ゴール（動線）
1. Web公開ページ（匿名OK）で業種選択＋6問（各4択）に回答
2. Webで即時に簡易結果＝運用度スコア(100点/レベルA-D)＋最大ボトルネック1つを表示
3. 「詳細レポートはLINEで」→ 友だち追加CTA。回答は URL パラメータ（例 `?ans=2,1,3,0,2,1&industry=salon`）で引き継ぐ
4. 友だち追加後、LIFFが回答を読み取り `POST /api/forms/:id/submit` で自動送信（ユーザーは再入力不要）
5. 送信時に: 結果Flex配信（スコア/ボトルネック/L-port解決策/「無料ヒアリングを予約」ボタン）＋ segment_tag付与（業種・レベル・ボトルネック種別）＋ metadata保存 ＋ on_submit_scenario_id でナーチャシナリオ登録

### 採点ロジック（設計書 §3 を厳守）
- 生スコア = Q1〜Q6 合計(0〜18) → 100点換算 = round(raw/18*100)
- レベル: A≥80 / B 60-79 / C 40-59 / D<40
- ボトルネック = 最低スコアの軸。同点は売上インパクト順 `Q6 > Q1 > Q5 > Q2 > Q4 > Q3` で決定
- 結果文言は「レベル総評(4文) × ボトルネック文(6文)」の組み合わせ（設計書 §4・§5 の確定文を使用）

### 流用する既存基盤（新規でフルスクラッチしない）
- フォーム定義/回答CRUD: `packages/db/src/forms.ts`、`packages/db/migrations/007_forms.sql`
  - `fields`(JSON) に設問、`options[].tagId`、`on_submit_scenario_id`、`on_submit_tag_id`、`save_to_metadata` がある。選択肢の配点は `options[].score` を追加して持たせる
- 送信フロー: `apps/worker/src/routes/forms.ts` の `POST /api/forms/:id/submit`（タグ付与→metadata保存→シナリオ登録→結果メッセージ配信が既に実装済み。ここに採点＋結果Flex生成を足す）
- LIFF: `apps/liff/`、認証は `apps/worker/src/routes/liff.ts` / `apps/liff/src/lib/liff-auth.ts`
- セグメント: `packages/db/migrations/055_segment_tags.sql`、`friend_segment_tags`（業種/レベル/ボトルネックを付与）
- シナリオ登録: `packages/db/src/scenarios.ts` の `enrollFriendInScenario`
- 既存の仮想セグメント/採点の書き方の参考: `apps/worker/src/services/engagement.ts`

### 実装範囲（推奨の分割）
1. **採点ユーティリティ**（純関数・テスト付き）: 回答配列→{score100, level, bottleneckAxis}。設計書 §3 の同点ルールまで実装。`*.test.ts` を併設
2. **Web診断ページ**: `apps/web` に公開ページ。匿名で回答→クライアントで採点→簡易結果→LINE友だち追加CTA（回答をURLパラメータに載せる）
3. **LIFF引き継ぎ送信**: `apps/liff` で URL パラメータの回答を読み `POST /api/forms/:id/submit`
4. **submit拡張**: `forms.ts` のsubmitに採点→結果Flex生成→segment_tag付与（業種/レベル/ボトルネック）を追加。結果Flexに「無料ヒアリングを予約」ボタン（予約 or LP のヒアリング動線へ）
5. **診断フォームのseed**: この診断用の form レコード（業種＋6問＋配点＋on_submit_scenario_id）を作る手段（管理UI or seedスクリプト or migration）
6. **ナーチャシナリオ**: 結果解説→業種別事例→ヒアリング予約催促 の数ステップ（最低限の雛形でよい）

### 注意・プロジェクトルール
- **薬機法**: 整体・治療院・美容系の文言で「治る」等の断定表現を使わない
- **既知バグ2類型に注意**（`docs/BUG_AUDIT.md`）: ①タイムゾーン変換漏れ（UTC datetime と JST ISO が混在）②セグメント条件の OR/AND 取り違え。SQLを書く時は同種を作り込まない
- **デプロイ**: 機能追加後は **staging + 本番の両方** に反映する。worker は `npx wrangler deploy` 単体だと dist が更新されないので **`pnpm run deploy`（vite build 込み）** を使う
- **AI接客の商品訴求**: もし結果で商品をすすめる場合、テキストリンクではなく画像/価格/ボタン付き Flex carousel スライダーで（このプロジェクトの方針）
- 実装前に変更計画を出し、段階的に進めること。型チェック（`npx tsc --noEmit`）とテストを通すこと

### 完了の確認
- 採点関数のユニットテストが通る（境界値: 全0点=D/ボトルネック、全3点=A、同点時の優先順位）
- Web診断→結果表示→友だち追加→LIFF送信→結果Flex→セグメント付与→シナリオ登録が一気通貫で動く
- staging で実機（スマホ）確認後、本番へ
