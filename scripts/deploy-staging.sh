#!/usr/bin/env bash
# Staging へまとめてデプロイ。
# Worker: l-port-staging / Pages: l-port-admin-staging
set -euo pipefail
cd "$(dirname "$0")/.."

echo "===> [1/4] Worker (l-port-staging) build + deploy"
cd apps/worker
# vite-cloudflare plugin が CLOUDFLARE_ENV を .env から読む。
# --mode staging で .env.staging (CLOUDFLARE_ENV=staging) を有効化。
npm run build -- --mode staging
# 念のため --env も明示。--config で source toml を強制 (redirect config 回避)
npx wrangler deploy --config ./wrangler.toml --env staging

echo "===> dist の状態を本番用に戻す (誤って次に本番 deploy しても安全)"
npm run build


echo "===> [2/4] Web (staging) build (.env.staging から NEXT_PUBLIC_API_URL を staging に)"
cd ../web
cp .env.production .env.production.bak
cp .env.staging .env.production
# .env.local は Next.js で .env.production より優先されるため、staging ビルド中は
# 退避しないと本番 URL が焼き込まれてしまう (staging-team が本番 API を叩く事故の原因)。
if [ -f .env.local ]; then mv .env.local .env.local.bak; fi
npm run build

echo "===> [3/5] Pages (l-port-admin-staging = staging.line-port.com 顧客向け) deploy"
npx wrangler pages deploy out --project-name l-port-admin-staging --branch main --commit-dirty=true

echo "===> [4/5] Pages (l-port-team-staging = staging-team.line-port.com チーム用) deploy"
npx wrangler pages deploy out --project-name l-port-team-staging --branch main --commit-dirty=true

echo "===> [5/5] .env.production / .env.local を元に戻す"
mv .env.production.bak .env.production
if [ -f .env.local.bak ]; then mv .env.local.bak .env.local; fi

echo "===> スモークテスト (顧客ゴールデンパス + 越境ガード)"
cd ../..  # apps/web → リポジトリルート
if ! bash scripts/smoke.sh; then
  echo ""
  echo "🚨 staging スモーク失敗。顧客フローが壊れています。修正するまで本番へ進めないでください。"
  exit 1
fi

echo ""
echo "✓ staging deploy 完了"
echo "  Worker: https://l-port-staging.reoyakyu428z.workers.dev"
echo "  Pages:  https://l-port-admin-staging.pages.dev"
