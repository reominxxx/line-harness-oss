#!/usr/bin/env bash
# 本番 (production) へまとめてデプロイ。
# Worker: line-harness-test (内部 API、後で rename 可) / Pages: l-port-admin
# 顧客が実際に使う環境なので慎重に。
set -euo pipefail
cd "$(dirname "$0")/.."

read -p "🚨 本番環境にデプロイします。続けますか? [y/N]: " ans
[[ "$ans" =~ ^[Yy]$ ]] || { echo "中断しました"; exit 1; }

# 本番へ出す前ゲート: staging の顧客ゴールデンパスが健全か確認する。
# (staging には本番と同じコードが先にデプロイ済みの前提。両環境反映が運用ルール)
echo "===> 事前ゲート: staging スモークテスト"
if ! bash scripts/smoke.sh; then
  echo ""
  echo "🚨 staging スモーク失敗。まず staging を直してから本番デプロイしてください。中断します。"
  echo "   (staging を先にデプロイしていない場合は scripts/deploy-staging.sh を先に実行)"
  exit 1
fi

echo "===> [1/3] Worker build + deploy (production)"
cd apps/worker
npm run build
npx wrangler deploy

echo "===> [2/3] Web build (NEXT_PUBLIC_API_URL=production)"
cd ../web
echo "NEXT_PUBLIC_API_URL=https://line-harness-test.reoyakyu428z.workers.dev" > .env.production
npm run build

echo "===> [3/4] Pages (l-port-admin = 顧客向け app.line-port.com) deploy"
npx wrangler pages deploy out --project-name l-port-admin --branch main --commit-dirty=true

echo "===> [4/4] Pages (l-port-team = 運用チーム team.line-port.com) deploy"
npx wrangler pages deploy out --project-name l-port-team --branch main --commit-dirty=true

echo ""
echo "✓ production deploy 完了"
echo "  Worker:  https://api.line-port.com"
echo "  Customer (app):  https://app.line-port.com"
echo "  Team (admin):    https://team.line-port.com"
echo "  LP:              https://line-port.com"
