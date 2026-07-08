#!/usr/bin/env bash
# 代理树 + 额度下发接口端到端冒烟测试
# 步骤：boss 登录 -> 建两个直属下级代理 A/B -> A/B 各自登录 ->
#      额度锁验证（grant 到额度耗尽即拒绝）-> 越权验证（非上级 grant 应 403）->
#      reclaim 收回额度 -> 查子树 -> 查直属下级（代理+玩家混合）
# 用法：BASE=http://localhost:4000 bash test/agent_smoke.sh
set -e

BASE="${BASE:-http://localhost:4000}"
# 数据库连接串：默认沿用 Phase 0 现场约定（5432 端口，spribe 库 spribe_dev schema）
# 数据库连接：密码从环境变量读取，脚本不再硬编码明文凭据。
# 运行前先设置：export PGPASSWORD=<数据库密码>   （或直接 export PSQL_CONN=<完整连接串> 覆盖整串）
PSQL_CONN="${PSQL_CONN:-postgres://spribe_app:${PGPASSWORD}@127.0.0.1:5432/spribe?options=-c%20search_path%3Dspribe_dev}"

# 提取 JSON 字段的小工具：优先尝试用 grep -o（不依赖 jq），
# 兼容形如 "key":"value" 或 "key":123 的简单场景。
extract() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"\{0,1\}[^,\"}]*\"\{0,1\}" | head -1 | sed -E "s/\"$key\":\"?//; s/\"$//"
}

echo "=================================================="
echo "步骤 0：预置测试夹具（psql 直连，不改 sql/*.sql 种子文件）"
echo "=================================================="
# seed 里 boss 没有 path、也没有 credit_lines 记录，这里用 psql 现场补上：
#   1) boss.path = {boss.id}（材料化路径要有自己才能作为后续下级 path 的前缀）
#   2) boss 的信用额度重置为 1000.00（ON CONFLICT DO UPDATE，保证每次重跑都是干净的 1000）
psql "$PSQL_CONN" -v ON_ERROR_STOP=1 <<'SQL'
UPDATE agents SET path = ARRAY[id]::text[] WHERE username = 'boss';

INSERT INTO credit_lines (agent_id, credit, version)
SELECT id, 1000, 0 FROM agents WHERE username = 'boss'
ON CONFLICT (agent_id) DO UPDATE SET credit = 1000, version = 0;
SQL
echo "✅ 夹具就绪：boss.path 已补齐，boss 额度重置为 1000.00"

# 每次运行用唯一后缀命名测试代理，避免和历史残留的 sub_* 记录冲突，
# 也就不需要去 DELETE 历史代理（那样会牵扯 credit_lines/credit_ledger/audit_log 的外键，风险更大）。
SUFFIX="$(date +%s)_$$"
SUB_A="subA_${SUFFIX}"
SUB_B="subB_${SUFFIX}"

echo ""
echo "=================================================="
echo "步骤 1：boss 登录"
echo "=================================================="
BOSS_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"boss","password":"boss123","type":"agent"}')
echo "响应：$BOSS_LOGIN_RESP"
echo "$BOSS_LOGIN_RESP" | grep -q '"token"'
BOSS_TOKEN=$(extract "$BOSS_LOGIN_RESP" "token")
if [ -z "$BOSS_TOKEN" ]; then
  echo "❌ boss 登录未拿到 token"
  exit 1
fi
echo "✅ boss 登录成功"

echo ""
echo "=================================================="
echo "步骤 2：boss 建直属下级代理 A（${SUB_A}）"
echo "=================================================="
CREATE_A_RESP=$(curl -s -X POST "$BASE/agent/create" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SUB_A}\",\"password\":\"passA123\"}")
echo "响应：$CREATE_A_RESP"
echo "$CREATE_A_RESP" | grep -q '"username"'
A_ID=$(extract "$CREATE_A_RESP" "id")
if [ -z "$A_ID" ]; then
  echo "❌ 建代理 A 失败，未拿到 id"
  exit 1
fi
echo "✅ 代理 A 建成功，id=$A_ID"

echo ""
echo "=================================================="
echo "步骤 3：boss 建直属下级代理 B（${SUB_B}）"
echo "=================================================="
CREATE_B_RESP=$(curl -s -X POST "$BASE/agent/create" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SUB_B}\",\"password\":\"passB123\"}")
echo "响应：$CREATE_B_RESP"
echo "$CREATE_B_RESP" | grep -q '"username"'
B_ID=$(extract "$CREATE_B_RESP" "id")
if [ -z "$B_ID" ]; then
  echo "❌ 建代理 B 失败，未拿到 id"
  exit 1
fi
echo "✅ 代理 B 建成功，id=$B_ID"

echo ""
echo "=================================================="
echo "步骤 4：代理 A、B 各自登录"
echo "=================================================="
A_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SUB_A}\",\"password\":\"passA123\",\"type\":\"agent\"}")
echo "A 登录响应：$A_LOGIN_RESP"
A_TOKEN=$(extract "$A_LOGIN_RESP" "token")

B_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SUB_B}\",\"password\":\"passB123\",\"type\":\"agent\"}")
echo "B 登录响应：$B_LOGIN_RESP"
B_TOKEN=$(extract "$B_LOGIN_RESP" "token")

if [ -z "$A_TOKEN" ] || [ -z "$B_TOKEN" ]; then
  echo "❌ 代理 A 或 B 登录失败"
  exit 1
fi
echo "✅ A、B 均登录成功"

echo ""
echo "=================================================="
echo "步骤 5（额度锁验证 ①）：boss grant \$600 给 A"
echo "=================================================="
GRANT_A_RESP=$(curl -s -X POST "$BASE/agent/credit/grant" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"toAgent\":${A_ID},\"amount\":\"600.00\"}")
echo "响应：$GRANT_A_RESP"
FROM_AFTER_1=$(extract "$GRANT_A_RESP" "fromCreditAfter")
TO_AFTER_1=$(extract "$GRANT_A_RESP" "toCreditAfter")
echo "boss 额度剩=$FROM_AFTER_1  A 额度=$TO_AFTER_1"
if [ "$FROM_AFTER_1" != "400.00" ] || [ "$TO_AFTER_1" != "600.00" ]; then
  echo "❌ grant 后额度不符预期（boss 应剩 400.00，A 应为 600.00）"
  exit 1
fi
echo "✅ grant 成功：boss 剩 400.00，A 拿到 600.00"

echo ""
echo "=================================================="
echo "步骤 6（额度锁验证 ②：额度不足应被拒绝）：boss 再 grant \$600 给 B"
echo "=================================================="
GRANT_B_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/credit/grant" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"toAgent\":${B_ID},\"amount\":\"600.00\"}")
echo "响应：$GRANT_B_RESP"
echo "$GRANT_B_RESP" | grep -q 'HTTP_STATUS:400'
echo "$GRANT_B_RESP" | grep -q '额度不足'
echo "✅ 额度锁验证通过：boss 只剩 400.00，再 grant 600.00 被拒绝（400 额度不足）"

echo ""
echo "=================================================="
echo "步骤 7（越权验证：非上级 grant 应 403）：A 尝试给 B 发额度"
echo "=================================================="
CROSS_GRANT_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/credit/grant" \
  -H "Authorization: Bearer $A_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"toAgent\":${B_ID},\"amount\":\"10.00\"}")
echo "响应：$CROSS_GRANT_RESP"
echo "$CROSS_GRANT_RESP" | grep -q 'HTTP_STATUS:403'
echo "$CROSS_GRANT_RESP" | grep -q '目标不在你的线下'
echo "✅ 越权验证通过：A 对 B（不在 A 子树下）grant 被拒绝（403 目标不在你的线下）"

echo ""
echo "=================================================="
echo "步骤 8：boss 从 A 收回 \$200（reclaim）"
echo "=================================================="
RECLAIM_RESP=$(curl -s -X POST "$BASE/agent/credit/reclaim" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"fromAgent\":${A_ID},\"amount\":\"200.00\"}")
echo "响应：$RECLAIM_RESP"
A_AFTER_RECLAIM=$(extract "$RECLAIM_RESP" "fromCreditAfter")
BOSS_AFTER_RECLAIM=$(extract "$RECLAIM_RESP" "toCreditAfter")
echo "A 额度=$A_AFTER_RECLAIM  boss 额度=$BOSS_AFTER_RECLAIM"
if [ "$A_AFTER_RECLAIM" != "400.00" ] || [ "$BOSS_AFTER_RECLAIM" != "600.00" ]; then
  echo "❌ reclaim 后额度不符预期（A 应剩 400.00，boss 应回到 600.00）"
  exit 1
fi
echo "✅ reclaim 成功：A 剩 400.00，boss 回到 600.00"

echo ""
echo "=================================================="
echo "步骤 9：GET /agent/tree（boss 视角，应能看到 A 和 B）"
echo "=================================================="
TREE_RESP=$(curl -s -X GET "$BASE/agent/tree" -H "Authorization: Bearer $BOSS_TOKEN")
echo "响应：$TREE_RESP"
echo "$TREE_RESP" | grep -q "\"${SUB_A}\""
echo "$TREE_RESP" | grep -q "\"${SUB_B}\""
echo "✅ /agent/tree 能看到 A、B 两个下级代理"

echo ""
echo "=================================================="
echo "步骤 10：GET /agent/downline（boss 视角，应混合列出代理 A/B + 玩家 alice）"
echo "=================================================="
DOWNLINE_RESP=$(curl -s -X GET "$BASE/agent/downline" -H "Authorization: Bearer $BOSS_TOKEN")
echo "响应：$DOWNLINE_RESP"
echo "$DOWNLINE_RESP" | grep -q "\"${SUB_A}\""
echo "$DOWNLINE_RESP" | grep -q "\"${SUB_B}\""
echo "$DOWNLINE_RESP" | grep -q '"alice"'
echo "$DOWNLINE_RESP" | grep -q '"kind":"agent"'
echo "$DOWNLINE_RESP" | grep -q '"kind":"player"'
echo "✅ /agent/downline 混合列出代理(A/B)与玩家(alice)"

echo ""
echo "✅ AGENT SMOKE 全绿"
