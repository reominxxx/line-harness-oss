# Staging Worker: Secrets セットアップ

Staging worker (`l-port-staging`) は本番とは別のキーセットを持ちます。
**LINE 関連のトークンは「テスト用 LINE 公式アカウント」のものを使ってください** (本番チャネルを入れると Q2-A 違反 = 実顧客に届く事故が起きる)。

## 必須 secrets (順番に投入)

```bash
cd /Users/reo/line-harness/apps/worker

# 1. 管理画面ログイン用 (好きな文字列、自分で決める)
echo "好きなパスワード文字列" | npx wrangler secret put API_KEY --config ./wrangler.toml --env staging

# 2. Anthropic API キー (本番と別キーを発行推奨)
echo "sk-ant-..." | npx wrangler secret put ANTHROPIC_API_KEY --config ./wrangler.toml --env staging

# 3. OpenAI (画像生成用、使わなければスキップ可)
echo "sk-..." | npx wrangler secret put OPENAI_API_KEY --config ./wrangler.toml --env staging

# 4. テスト用 LINE 公式アカウントの credentials
echo "テストchannel access token" | npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --config ./wrangler.toml --env staging
echo "テストchannel secret" | npx wrangler secret put LINE_CHANNEL_SECRET --config ./wrangler.toml --env staging
echo "テストchannel ID" | npx wrangler secret put LINE_LOGIN_CHANNEL_ID --config ./wrangler.toml --env staging
echo "LIFF URL" | npx wrangler secret put LIFF_URL --config ./wrangler.toml --env staging

# 5. API key hash salt (好きなランダム文字列)
openssl rand -hex 32 | npx wrangler secret put API_KEY_HASH_SECRET --config ./wrangler.toml --env staging
```

## 投入後の確認

```bash
npx wrangler secret list --name l-port-staging --config ./wrangler.toml --env staging
```

## staging で動作確認

1. https://l-port-admin-staging.pages.dev/login
2. 上に黄色いバナー「⚠ STAGING ENVIRONMENT」が出ているはず
3. API_KEY でログイン
4. テスト LINE アカウントを追加 → webhook を `https://l-port-staging.reoyakyu428z.workers.dev/webhook` に向ける
5. テスト友達追加 → 配信テスト

## 本番にデプロイするとき

```bash
./scripts/deploy-prod.sh
```

## staging にデプロイするとき

```bash
./scripts/deploy-staging.sh
```
