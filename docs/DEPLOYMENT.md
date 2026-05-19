# デプロイ環境とスナップショット

L-アシストの本番・ステージング・スナップショット運用ガイド。

---

## 本番環境

| リソース | URL / 名前 |
|---|---|
| 管理画面 (Pages) | https://line-harness-test-admin-fdb73abf.pages.dev |
| API (Worker) | https://line-harness-test.reoyakyu428z.workers.dev |
| D1 Database | `line-harness-test` (id: `890abaa1-cbf5-444e-8b95-c8f82c35763b`) |
| R2 Bucket | `line-harness-test-images` |
| Cloudflare Account | `64f3d8910fc87b527850d0545c15537f` |

最新タグ: `v1.0-mvp-phase3` (commit `967009b`)

---

## ステージング環境 (構築済)

| リソース | URL / 名前 |
|---|---|
| 管理画面 (Pages) | https://line-harness-staging-admin.pages.dev |
| API (Worker) | https://line-harness-staging.reoyakyu428z.workers.dev |
| D1 Database | `line-harness-staging` (id: `74349760-fcd4-4a1a-a99e-b483c37f4c81`) |
| R2 Bucket | `line-harness-staging-images` |
| 設定ファイル | `apps/worker/wrangler.staging.toml` (gitignore) |
| テスト用 line_account | `staging-acc-1` (name: "Staging Test Account") |

⚠️ **Secret 未登録**: ANTHROPIC_API_KEY / OPENAI_API_KEY / API_KEY をユーザー作業で登録する必要あり。下記「Staging Secret 登録」参照。

### Staging へのデプロイ手順

```bash
# Worker のデプロイ
cd apps/worker
npx wrangler deploy --config wrangler.staging.toml

# Web のデプロイ (staging API URL 向きにビルドし直す)
cd ../web
NEXT_PUBLIC_API_URL=https://line-harness-staging.reoyakyu428z.workers.dev pnpm build
npx wrangler pages deploy out --project-name=line-harness-staging-admin \
  --branch=staging \
  --commit-dirty=true --commit-message="staging update"
# ↑ --branch=staging を必ず付ける (production branch がこの project では staging)
# 付け忘れると preview deployment 扱いになりルート URL "Nothing is here yet" になる
```

### Staging Secret 登録 (初回のみ、ユーザー作業)

```bash
cd apps/worker
npx wrangler secret put ANTHROPIC_API_KEY --config wrangler.staging.toml  # Claude 用
npx wrangler secret put OPENAI_API_KEY --config wrangler.staging.toml     # GPT-Image-2 用
npx wrangler secret put API_KEY --config wrangler.staging.toml            # 管理画面ログイン用 (任意文字列)
```

各コマンドで入力プロンプトが出るので、秘密の値を貼り付けて Enter。
本番と同じキーでも別キーでも OK (Anthropic / OpenAI のコストは合算される)。

API_KEY は管理画面ログイン時に入力する文字列なので、本番と違う値にしておくと
誤って本番にログインする事故を防げる (例: `staging-key-2026-05-20`)。

### Staging で動作確認

1. https://line-harness-staging-admin.pages.dev/login を開く
2. Secret 登録した `API_KEY` の値を入力してログイン
3. 左上のアカウントセレクタから `Staging Test Account` を選択
4. `/agent` `/prompt-tests` `/playbook-library` `/ai-prompts` 等を触る
5. **本番に一切影響しない** (D1/R2/worker が完全分離)

---

## スナップショット (過去デプロイの閲覧)

### Cloudflare Pages の preview deployments
**全 commit に対応する preview URL が Cloudflare 側で永続保存**されているので、過去の状態に戻したい時はこちらから取得可能。

1. Cloudflare ダッシュボードを開く → Workers & Pages
2. `line-harness-test-admin-fdb73abf` を選択 → Deployments タブ
3. 各 commit ごとに `https://<hash>.line-harness-test-admin-fdb73abf.pages.dev` の preview URL あり
4. 「Rollback to this deployment」で本番を巻き戻しも可能 (※ 本番 URL は最新に戻る)

注意: Pages の preview URL でフロントは過去版を見られるが、**worker (API) は常に最新**なので、DB スキーマや API の変更があると過去フロントが動かない場合あり。完全なスナップショットは下記の staging で。

### Git タグからの復元
```bash
# 過去版を一時的に取り出してチェック
git checkout v1.0-mvp-phase3
# 本番に巻き戻す場合
pnpm --filter worker run deploy
cd apps/web && pnpm build && \
  npx wrangler pages deploy out --project-name=line-harness-test-admin-fdb73abf --commit-dirty=true
```

---

## ステージング環境のセットアップ (新規構築手順)

「本番に影響なく触れる完全な別環境」が必要な場合の手順。
`apps/worker/wrangler.toml` に既に `[env.staging]` セクションあり。

### Step 1: Cloudflare ダッシュボードでリソース作成
1. **D1**: Workers & Pages → D1 → Create database
   - 名前: `line-harness-staging`
   - 作成後、表示される `database_id` をメモ
2. **R2**: Workers & Pages → R2 → Create bucket
   - 名前: `line-harness-staging-images`

### Step 2: wrangler.toml に staging セクションを追記
`apps/worker/wrangler.toml` は秘密情報を含むため git 管理外。下記を末尾に追記し、`YOUR_STAGING_D1_DATABASE_ID` を Step 1 で取得した ID に差し替える。

```toml
# ═══════════════════════════════════════════════════════════════
# ステージング環境 (テスト用、本番に影響なく触れる別 URL)
# ═══════════════════════════════════════════════════════════════
[env.staging]
name = "line-harness-staging"
account_id = "64f3d8910fc87b527850d0545c15537f"
workers_dev = true

[env.staging.assets]
directory = "dist/client"
binding = "ASSETS"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "line-harness-staging"
database_id = "YOUR_STAGING_D1_DATABASE_ID"
migrations_dir = "../../packages/db/migrations"

[[env.staging.r2_buckets]]
binding = "IMAGES"
bucket_name = "line-harness-staging-images"

# staging では cron を止めて本番だけ自動配信させる
[env.staging.triggers]
crons = []
```

### Step 3: シークレット登録
```bash
cd apps/worker
npx wrangler secret put ANTHROPIC_API_KEY --env staging
npx wrangler secret put OPENAI_API_KEY --env staging
npx wrangler secret put API_KEY --env staging          # 管理画面ログイン用、任意の文字列
```

### Step 4: DB セットアップ
```bash
# 1. schema.sql で基本テーブル作成
npx wrangler d1 execute line-harness-staging --remote --env staging \
  --file=../../packages/db/schema.sql

# 2. 個別 migration を適用 (045〜052)
for n in 045 046 047 048 049 050 051 052; do
  npx wrangler d1 execute line-harness-staging --remote --env staging \
    --file=../../packages/db/migrations/${n}_*.sql
done

# 3. dev 用のテスト line_accounts を 1 件投入 (任意)
npx wrangler d1 execute line-harness-staging --remote --env staging --command "
  INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, display_order, created_at, updated_at)
  VALUES ('staging-acc-1', 'staging-channel', 'Staging Test', 'dummy', 'dummy', 1, 1, datetime('now'), datetime('now'))
"
```

### Step 5: Worker デプロイ
```bash
cd apps/worker
npx wrangler deploy --env staging
# → https://line-harness-staging.<your-subdomain>.workers.dev
```

### Step 6: Pages 新規プロジェクト作成 + デプロイ
```bash
cd apps/web
# .env.production.staging を作成
echo "NEXT_PUBLIC_API_URL=https://line-harness-staging.<your-subdomain>.workers.dev" \
  > .env.production.local
pnpm build
npx wrangler pages deploy out --project-name=line-harness-staging-admin \
  --commit-dirty=true --commit-message="staging initial"
# → https://line-harness-staging-admin.pages.dev
```

### Step 7: 動作確認
- staging Pages URL を開いて API キー (Step 3 で登録した値) でログイン
- `/agent` `/prompt-tests` 等を触る → 本番には影響しない

---

## どれを使うか

| シチュエーション | 推奨方法 |
|---|---|
| 「過去にちゃんと動いていた状態を見たい」 | Cloudflare Pages の deployments 履歴 |
| 「過去のコードに戻って機能の比較がしたい」 | `git checkout v1.0-mvp-phase3` |
| 「本番に影響なく新機能を試したい」 | staging 環境を Step 1〜7 で構築 |
| 「ユーザー受け入れテストを別 URL でやりたい」 | staging 環境 (本番データに触らない) |
| 「災害復旧でロールバックしたい」 | Pages deployment の Rollback ボタン (フロントのみ) + git tag からの worker 再デプロイ |

---

## バックアップ運用

D1 のスナップショット:
```bash
# 全テーブル dump (定期推奨)
npx wrangler d1 export line-harness-test --remote --output=backups/$(date +%Y%m%d).sql
```

R2 のバックアップ: Cloudflare ダッシュボードから手動 export、または `wrangler r2 object list` でリスト確認。

---

## 関連タグ

- `v0.14.0` — OSS リリース版 (L-アシスト機能投入前)
- `v1.0-mvp-phase3` — 運用代行業務 7 フェーズ自動化 (Big Move 1〜5 完了)
