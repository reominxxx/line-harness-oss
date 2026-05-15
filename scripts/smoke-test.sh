#!/usr/bin/env bash
# L-アシスト 主要 API スモークテスト
# 使い方:
#   API_KEY=xxx ACCOUNT_ID=yyy bash scripts/smoke-test.sh
#
# 認証なしでアクセスして 401 が返れば route 存在 OK。
# 認証ありで 200 / 201 が返れば動作 OK。

set -u

BASE_URL="${BASE_URL:-https://line-harness-test.reoyakyu428z.workers.dev}"
API_KEY="${API_KEY:-}"
ACCOUNT_ID="${ACCOUNT_ID:-}"

if [ -z "$API_KEY" ] || [ -z "$ACCOUNT_ID" ]; then
  echo "Usage: API_KEY=xxx ACCOUNT_ID=yyy bash scripts/smoke-test.sh"
  echo ""
  echo "Without auth (route existence check only):"
  AUTH_MODE="public"
else
  AUTH_MODE="full"
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

passed=0
failed=0

probe() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local description="$4"

  if [ "$AUTH_MODE" = "full" ]; then
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" \
      -H "Authorization: Bearer $API_KEY" \
      -H "X-Line-Account-Id: $ACCOUNT_ID" \
      -H "Content-Type: application/json" \
      "$BASE_URL$path")
  else
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path")
    # Without auth, expect 401 for /api/ paths
    if [[ "$path" == /api/* ]]; then
      expected="401"
    fi
  fi

  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $method $path → $actual ($description)"
    passed=$((passed + 1))
  else
    echo -e "${RED}✗${NC} $method $path → $actual (expected $expected, $description)"
    failed=$((failed + 1))
  fi
}

echo "==> Smoke test against $BASE_URL"
echo "==> Auth mode: $AUTH_MODE"
echo ""

# Core API existence
probe GET /api/agent-jobs/types 200 "ハンドラ一覧"
probe GET /api/kpi 200 "KPI 一覧"
probe GET /api/agent-jobs 200 "ジョブ一覧"
probe GET /api/automation-policy 200 "自動化ポリシー"
probe GET /api/kb/documents 200 "KB ドキュメント一覧"
probe GET /api/prompts 200 "プロンプトモジュール一覧"
probe GET /api/ai-products 200 "商品マスタ"
probe GET /api/ai-signals/summary 200 "シグナルサマリー"
probe GET /api/ai-signals/hot 200 "ホットリード"
probe GET /api/metering 200 "テナント計量"
probe GET /api/metering/plans 200 "プラン一覧"
probe GET /api/audit-log 200 "監査ログ"
probe GET /api/pii-deletions 200 "PII 削除リクエスト一覧"
probe GET /api/playbooks 200 "プレイブック一覧"
probe GET /api/playbooks/beauty 200 "美容プレイブック詳細"
probe GET /api/playbooks/chiropractic 200 "整体プレイブック詳細"
probe GET /api/prompts/assemble/preview 200 "プロンプト合成プレビュー"

# Public routes
probe GET /reports/nonexistent/nonexistent 404 "存在しないレポート"

echo ""
echo "==================================="
echo -e "${GREEN}passed: $passed${NC}  ${RED}failed: $failed${NC}"
echo "==================================="

if [ "$failed" -gt 0 ]; then
  exit 1
fi
