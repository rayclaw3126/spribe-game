#!/usr/bin/env bash
# 端到端冒烟测试：登录 -> 下注 -> 幂等重放 -> 结算(输,触发分成) -> 查询 -> (可选)win 加钱
# 用法：BASE=http://localhost:4000 bash test/smoke.sh
set -e

BASE="${BASE:-http://localhost:4000}"

# 提取 JSON 字段的小工具：优先尝试用 grep -o（不依赖 jq），
# 兼容形如 "key":"value" 或 "key":123 的简单场景。
extract() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"\{0,1\}[^,\"}]*\"\{0,1\}" | head -1 | sed -E "s/\"$key\":\"?//; s/\"$//"
}

echo "=================================================="
echo "步骤 1：玩家 alice 登录"
echo "=================================================="
PLAYER_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123","type":"player"}')
echo "响应：$PLAYER_LOGIN_RESP"
echo "$PLAYER_LOGIN_RESP" | grep -q '"token"'
PLAYER_TOKEN=$(extract "$PLAYER_LOGIN_RESP" "token")
if [ -z "$PLAYER_TOKEN" ]; then
  echo "❌ 玩家登录未拿到 token"
  exit 1
fi
echo "✅ 玩家登录成功，拿到 token（不打印明文）"

echo ""
echo "=================================================="
echo "步骤 2：代理 boss 登录（证明代理也能登录）"
echo "=================================================="
AGENT_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"boss","password":"boss123","type":"agent"}')
echo "响应：$AGENT_LOGIN_RESP"
echo "$AGENT_LOGIN_RESP" | grep -q '"token"'
echo "✅ 代理登录成功"

echo ""
echo "=================================================="
echo "步骤 3：下注 100（固定幂等键 smoke-key-001）"
echo "=================================================="
BET_RESP=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"game":"aviator","amount":"100.00","clientSeed":"smoke-seed","idempotencyKey":"smoke-key-001"}')
echo "响应：$BET_RESP"
echo "$BET_RESP" | grep -q '"idempotent":false'
ROUND_ID=$(extract "$BET_RESP" "roundId")
BALANCE_AFTER_BET=$(extract "$BET_RESP" "balanceAfter")
echo "roundId=$ROUND_ID  balanceAfter=$BALANCE_AFTER_BET"
if [ "$BALANCE_AFTER_BET" != "900.00" ]; then
  echo "❌ 下注扣款后余额应为 900.00，实际为 $BALANCE_AFTER_BET"
  exit 1
fi
echo "✅ 下注成功，扣款后余额 900.00 正确"

echo ""
echo "=================================================="
echo "步骤 4：重复下注（同一幂等键 smoke-key-001），证明幂等不重复扣钱"
echo "=================================================="
BET_RESP_2=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"game":"aviator","amount":"100.00","clientSeed":"smoke-seed","idempotencyKey":"smoke-key-001"}')
echo "响应：$BET_RESP_2"
echo "$BET_RESP_2" | grep -q '"idempotent":true'
BALANCE_AFTER_REPEAT=$(extract "$BET_RESP_2" "balance")
echo "重复下注后余额=$BALANCE_AFTER_REPEAT（应仍为 900.00，未被重复扣款）"
if [ "$BALANCE_AFTER_REPEAT" != "900.00" ]; then
  echo "❌ 幂等重放不应重复扣钱，但余额变成了 $BALANCE_AFTER_REPEAT"
  exit 1
fi
echo "✅ 幂等验证通过：两次请求余额均为 900.00，未重复扣款"

echo ""
echo "=================================================="
echo "步骤 5：结算该局为 lose（触发链式分成）"
echo "=================================================="
SETTLE_RESP=$(curl -s -X POST "$BASE/round/settle" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"roundId\":$ROUND_ID,\"outcome\":\"lose\",\"payout\":\"0.00\"}")
echo "响应：$SETTLE_RESP"
echo "$SETTLE_RESP" | grep -q '"outcome":"lose"'
echo "✅ 结算(lose)成功"

echo ""
echo "=================================================="
echo "步骤 6：查询该局详情，断言 status=settled"
echo "=================================================="
DETAIL_RESP=$(curl -s -X GET "$BASE/round/$ROUND_ID" \
  -H "Authorization: Bearer $PLAYER_TOKEN")
echo "响应：$DETAIL_RESP"
echo "$DETAIL_RESP" | grep -q '"status":"settled"'
echo "✅ 查询成功，status=settled"

echo ""
echo "=================================================="
echo "步骤 6.5：佐证 commissions 表确实写入了一条分成记录（psql 直查）"
echo "=================================================="
if [ -n "$DB_URL" ]; then
  psql "$DB_URL" -c "SELECT agent_id, player_id, round_id, type, amount FROM commissions WHERE round_id=$ROUND_ID;"
else
  echo "（未设置 DB_URL 环境变量，跳过 psql 直查；建议设置 DB_URL 后重跑本脚本以查看 commissions 记录）"
fi

echo ""
echo "=================================================="
echo "步骤 7（可选）：再下一局并结算为 win，证明派彩加钱"
echo "=================================================="
BET_RESP_WIN=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"game":"aviator","amount":"50.00","clientSeed":"smoke-seed-win","idempotencyKey":"smoke-key-002"}')
echo "下注响应：$BET_RESP_WIN"
ROUND_ID_WIN=$(extract "$BET_RESP_WIN" "roundId")

SETTLE_RESP_WIN=$(curl -s -X POST "$BASE/round/settle" \
  -H "Authorization: Bearer $PLAYER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"roundId\":$ROUND_ID_WIN,\"outcome\":\"win\",\"payout\":\"200.00\"}")
echo "结算响应：$SETTLE_RESP_WIN"
echo "$SETTLE_RESP_WIN" | grep -q '"outcome":"win"'
WIN_BALANCE=$(extract "$SETTLE_RESP_WIN" "balance")
echo "赢钱结算后余额=$WIN_BALANCE（预期 900.00 - 50.00 下注 + 200.00 派彩 = 1050.00）"
if [ "$WIN_BALANCE" != "1050.00" ]; then
  echo "❌ 赢钱结算后余额应为 1050.00，实际为 $WIN_BALANCE"
  exit 1
fi
echo "✅ 赢钱派彩验证通过"

echo ""
echo "✅ SMOKE 全绿"
