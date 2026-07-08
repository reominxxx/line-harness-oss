#!/usr/bin/env bash
# 顧客(customer)ゴールデンパスのスモークテスト。
# デプロイ前ゲートとして使い、「ログインが通る」かつ「越境が塞がれている」を機械的に検証する。
# 秘密情報 (テスト用 customer キー) は scripts/.smoke.env (gitignore 済) から読む。
#
# 使い方: bash scripts/smoke.sh [BASE_URL]
#   BASE_URL 省略時は .smoke.env の SMOKE_STAGING_URL を使う。
#
# 必要な環境変数 (.smoke.env):
#   SMOKE_STAGING_URL        例: https://l-port-staging.reoyakyu428z.workers.dev
#   SMOKE_CUSTOMER_KEY       staging の role=customer テストキー (平文)
#   SMOKE_ACCOUNT_ID         そのキーの assigned_line_account_id (自分)
#   SMOKE_FOREIGN_ACCOUNT_ID 別アカウント ID (越境が 403 になることの確認用)
#
# キーが未設定なら顧客チェックはスキップし liveness のみ確認する (共同作業者を止めない)。
set -uo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="scripts/.smoke.env"
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

BASE="${1:-${SMOKE_STAGING_URL:-}}"
if [ -z "$BASE" ]; then
  echo "✗ BASE_URL が未指定 (引数 or SMOKE_STAGING_URL)"; exit 2
fi
BASE="${BASE%/}"

fail=0
pass(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad(){  printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }

# status <label> <expected> <curl args...>
status(){ local label="$1" exp="$2"; shift 2
  local got; got=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "$@")
  if [ "$got" = "$exp" ]; then pass "$label ($got)"; else bad "$label (expected $exp, got $got)"; fi
}

echo "==> smoke: $BASE"

# --- liveness (キー不要) ---
status "no-auth staff/me は 401"        401 "$BASE/api/staff/me"
status "bogus-key staff/me は 401"      401 -H "Authorization: Bearer bogus_$(date +%s)" "$BASE/api/staff/me"

if [ -z "${SMOKE_CUSTOMER_KEY:-}" ] || [ -z "${SMOKE_ACCOUNT_ID:-}" ]; then
  echo "  (SMOKE_CUSTOMER_KEY 未設定: 顧客ゴールデンパスはスキップ)"
  [ "$fail" -eq 0 ] && { echo "==> liveness OK"; exit 0; } || { echo "==> $fail 件 失敗"; exit 1; }
fi

K="$SMOKE_CUSTOMER_KEY"; A="$SMOKE_ACCOUNT_ID"; F="${SMOKE_FOREIGN_ACCOUNT_ID:-}"
AUTH=(-H "Authorization: Bearer $K")

# --- 顧客がログインできること ---
status "customer staff/me は 200 (ログイン検証経路)" 200 "${AUTH[@]}" "$BASE/api/staff/me"
status "line-accounts/lite は 200"                   200 "${AUTH[@]}" "$BASE/api/line-accounts/lite"
status "friends/count?自分 は 200"                   200 "${AUTH[@]}" "$BASE/api/friends/count?lineAccountId=$A"

# 内容: role=customer / lite は担当1件のみ
role=$(curl -s -m 20 "${AUTH[@]}" "$BASE/api/staff/me" | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('role',''))" 2>/dev/null)
[ "$role" = "customer" ] && pass "role=customer" || bad "role が customer でない (got '$role')"
lite=$(curl -s -m 20 "${AUTH[@]}" "$BASE/api/line-accounts/lite" | python3 -c "import sys,json;d=json.load(sys.stdin).get('data',[]);print(len(d), (d[0]['id'] if d else ''))" 2>/dev/null)
[ "$lite" = "1 $A" ] && pass "lite は担当1件のみ ($A)" || bad "lite が担当1件でない (got '$lite')"

# --- 越境 / IDOR / 書き込みが塞がれていること ---
[ -n "$F" ] && status "friends/count?他アカ は 403 (越境遮断)" 403 "${AUTH[@]}" "$BASE/api/friends/count?lineAccountId=$F"
status "friends/:id は 403 (IDOR 遮断)"        403 "${AUTH[@]}" "$BASE/api/friends/smoke-probe-id?lineAccountId=$A"
status "coupons は 403 (許可外)"               403 "${AUTH[@]}" "$BASE/api/coupons?lineAccountId=$A"
status "POST(write) は 403 (読み取り専用)"     403 -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{}' "$BASE/api/friends/count?lineAccountId=$A"
status "team-origin+customer は 403 (Origin ガード)" 403 "${AUTH[@]}" -H "Origin: https://l-port-team-staging.pages.dev" "$BASE/api/staff/me"

echo ""
if [ "$fail" -eq 0 ]; then echo "==> スモーク全通過 ✓"; exit 0
else echo "==> $fail 件 失敗 ✗"; exit 1; fi
