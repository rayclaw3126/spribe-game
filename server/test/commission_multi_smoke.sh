#!/usr/bin/env bash
# 多级分成（算法 B）端到端冒烟测试
# 覆盖：
#   1. win_loss 多级分成（curl 端到端：登录->下注->结算lose）+ psql 直查三级金额与总和
#   2. turnover 退水路（round.js 未接线，node 直调 commission.js 补测）
#   3. 兜底/余数验证（Σwinpct=100 时，含分位余数的 loss 下三级和精确=loss）
#   4. 缺失级边界（临时删除 ml_midA 的 commission_config，验证跳过不报错、和=70）
#
# 用法：BASE=http://localhost:4000 bash test/commission_multi_smoke.sh
set -e

BASE="${BASE:-http://localhost:4000}"
# 数据库连接：密码从环境变量读取，脚本不再硬编码明文凭据。
# 运行前先设置：export PGPASSWORD=<数据库密码>   （或直接 export DB_URL=<完整连接串> 覆盖整串）
DB_URL="${DB_URL:-postgres://spribe_app:${PGPASSWORD}@127.0.0.1:5432/spribe?options=-c%20search_path%3Dspribe_dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(dirname "$SCRIPT_DIR")"

psql_q() {
  # 静默执行一条 psql 语句（-t -A 去掉表头/对齐，便于脚本内断言）
  psql "$DB_URL" -t -A -c "$1"
}

# 提取 JSON 字段的小工具：优先尝试用 grep -o（不依赖 jq），
# 兼容形如 "key":"value" 或 "key":123 的简单场景。
extract() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"\{0,1\}[^,\"}]*\"\{0,1\}" | head -1 | sed -E "s/\"$key\":\"?//; s/\"$//"
}

# 是否需要恢复 ml_midA 的 commission_config（第 4 步用）
MIDA_CONFIG_DELETED=0

restore_mida_config() {
  if [ "$MIDA_CONFIG_DELETED" = "1" ]; then
    echo "（清理）恢复 ml_midA 的 commission_config = 30.00 / 1.00"
    psql_q "INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
            SELECT a.id, 30.00, 1.00 FROM agents a WHERE a.username='ml_midA'
            ON CONFLICT (agent_id) DO UPDATE SET win_loss_pct=30.00, turnover_pct=1.00;" > /dev/null
    MIDA_CONFIG_DELETED=0
  fi
}
trap restore_mida_config EXIT

echo "=================================================="
echo "步骤 0：灌种子数据（幂等，可重复跑）sql/003_seed_multilevel.sql"
echo "=================================================="
psql "$DB_URL" -f "$SERVER_DIR/sql/003_seed_multilevel.sql"
echo "✅ 种子数据就绪：ml_boss(60/2%) -> ml_midA(30/1%) -> ml_subB(10/0.5%) -> charlie"

echo ""
echo "=================================================="
echo "步骤 1：win_loss 多级分成（curl 端到端：charlie 登录->下注100->结算lose）"
echo "=================================================="
TS="$(date +%s%N)"
LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"charlie","password":"ml123","type":"player"}')
echo "登录响应：$LOGIN_RESP"
echo "$LOGIN_RESP" | grep -q '"token"'
TOKEN=$(extract "$LOGIN_RESP" "token")
if [ -z "$TOKEN" ]; then
  echo "❌ charlie 登录未拿到 token"
  exit 1
fi
echo "✅ charlie 登录成功"

BET_RESP=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"game\":\"aviator\",\"amount\":\"100.00\",\"clientSeed\":\"ml-seed-$TS\",\"idempotencyKey\":\"ml-key-winloss-$TS\"}")
echo "下注响应：$BET_RESP"
echo "$BET_RESP" | grep -q '"idempotent":false'
ROUND_ID=$(extract "$BET_RESP" "roundId")
if [ -z "$ROUND_ID" ]; then
  echo "❌ 下注未拿到 roundId"
  exit 1
fi
echo "roundId=$ROUND_ID"
echo "✅ 下注 100.00 成功"

SETTLE_RESP=$(curl -s -X POST "$BASE/round/settle" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"roundId\":$ROUND_ID,\"outcome\":\"lose\",\"payout\":\"0.00\"}")
echo "结算响应：$SETTLE_RESP"
echo "$SETTLE_RESP" | grep -q '"outcome":"lose"'
echo "✅ 结算(lose)成功，触发链式分成"

echo ""
echo "psql 直查该局 win_loss 分成明细："
psql "$DB_URL" -c "SELECT a.username, c.type, c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='win_loss' ORDER BY a.level;"

BOSS_AMT=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='win_loss' AND a.username='ml_boss';" | tr -d ' ')
MIDA_AMT=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='win_loss' AND a.username='ml_midA';" | tr -d ' ')
SUBB_AMT=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='win_loss' AND a.username='ml_subB';" | tr -d ' ')
SUM_AMT=$(psql_q "SELECT SUM(c.amount) FROM commissions c WHERE c.round_id=$ROUND_ID AND c.type='win_loss';" | tr -d ' ')
echo "ml_boss=$BOSS_AMT  ml_midA=$MIDA_AMT  ml_subB=$SUBB_AMT  SUM=$SUM_AMT"

if [ "$BOSS_AMT" != "60.00" ] || [ "$MIDA_AMT" != "30.00" ] || [ "$SUBB_AMT" != "10.00" ]; then
  echo "❌ 三级 win_loss 分成金额不符预期（期望 60.00/30.00/10.00）"
  exit 1
fi
if [ "$SUM_AMT" != "100.00" ]; then
  echo "❌ 三级分成总和应等于输额 100.00，实际为 $SUM_AMT"
  exit 1
fi
echo "✅ win_loss 多级分成正确：ml_boss=60.00 ml_midA=30.00 ml_subB=10.00，总和=100.00=输额"

echo ""
echo "=================================================="
echo "步骤 2：turnover 退水路（round.js 未接线，node 直调 commission.js 补测）"
echo "复用步骤 1 的 roundId=$ROUND_ID，lossAmount=0（不重复写 win_loss）+ turnoverAmount=1000"
echo "=================================================="
TURNOVER_OUT=$(DB_URL="$DB_URL" ROUND_ID="$ROUND_ID" node --input-type=module -e '
import { withTransaction } from "'"$SERVER_DIR"'/src/db.js";
import { distributeLoss } from "'"$SERVER_DIR"'/src/lib/commission.js";

const roundId = process.env.ROUND_ID;

await withTransaction(async (client) => {
  const charlie = await client.query("SELECT id FROM players WHERE username=$1", ["charlie"]);
  const subB = await client.query("SELECT id FROM agents WHERE username=$1", ["ml_subB"]);
  await distributeLoss(client, {
    playerId: charlie.rows[0].id,
    agentId: subB.rows[0].id,
    roundId,
    lossAmount: "0",
    turnoverAmount: "1000",
  });
});
console.log("turnover-distributed");
process.exit(0);
' 2>&1)
echo "$TURNOVER_OUT"
echo "$TURNOVER_OUT" | grep -q "turnover-distributed"
echo "✅ node 直调 distributeLoss（turnover 路）执行成功"

echo ""
echo "psql 直查该局 turnover 分成明细："
psql "$DB_URL" -c "SELECT a.username, c.type, c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='turnover' ORDER BY a.level;"

BOSS_TO=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='turnover' AND a.username='ml_boss';" | tr -d ' ')
MIDA_TO=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='turnover' AND a.username='ml_midA';" | tr -d ' ')
SUBB_TO=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID AND c.type='turnover' AND a.username='ml_subB';" | tr -d ' ')
echo "ml_boss=$BOSS_TO  ml_midA=$MIDA_TO  ml_subB=$SUBB_TO"

if [ "$BOSS_TO" != "20.00" ] || [ "$MIDA_TO" != "10.00" ] || [ "$SUBB_TO" != "5.00" ]; then
  echo "❌ 三级 turnover 分成金额不符预期（期望 20.00/10.00/5.00）"
  exit 1
fi
echo "✅ turnover 退水路正确：ml_boss=20.00 ml_midA=10.00 ml_subB=5.00（各级独立占成，无兜底）"

echo ""
echo "=================================================="
echo "步骤 3：兜底/余数验证（Σwinpct=100 时，含分位余数的 loss 下三级和精确=loss）"
echo "使用 loss=33.33（60/30/10 配置下会产生 trunc 分位余数），curl 端到端下注+结算"
echo "=================================================="
BET_RESP_3=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"game\":\"aviator\",\"amount\":\"33.33\",\"clientSeed\":\"ml-seed-remainder-$TS\",\"idempotencyKey\":\"ml-key-remainder-$TS\"}")
echo "下注响应：$BET_RESP_3"
ROUND_ID_3=$(extract "$BET_RESP_3" "roundId")
if [ -z "$ROUND_ID_3" ]; then
  echo "❌ 余数验证下注未拿到 roundId"
  exit 1
fi

SETTLE_RESP_3=$(curl -s -X POST "$BASE/round/settle" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"roundId\":$ROUND_ID_3,\"outcome\":\"lose\",\"payout\":\"0.00\"}")
echo "结算响应：$SETTLE_RESP_3"
echo "$SETTLE_RESP_3" | grep -q '"outcome":"lose"'

psql "$DB_URL" -c "SELECT a.username, c.type, c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID_3 AND c.type='win_loss' ORDER BY a.level;"

SUM_3=$(psql_q "SELECT SUM(c.amount) FROM commissions c WHERE c.round_id=$ROUND_ID_3 AND c.type='win_loss';" | tr -d ' ')
echo "loss=33.33 场景下三级 win_loss 总和=$SUM_3（期望精确=33.33，由末级减法兜底吸收 trunc 余数）"
if [ "$SUM_3" != "33.33" ]; then
  echo "❌ 余数场景下三级和应精确等于输额 33.33，实际为 $SUM_3"
  exit 1
fi
echo "✅ 兜底验证通过：Σwinpct=100 时，即使各级 trunc 产生余数，三级和仍精确=输额 33.33"

echo ""
echo "=================================================="
echo "步骤 4：缺失级边界（临时删除 ml_midA 的 commission_config，验证跳过不报错）"
echo "=================================================="
psql_q "DELETE FROM commission_config WHERE agent_id = (SELECT id FROM agents WHERE username='ml_midA');" > /dev/null
MIDA_CONFIG_DELETED=1
echo "（临时）已删除 ml_midA 的 commission_config"

BET_RESP_4=$(curl -s -X POST "$BASE/round/bet" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"game\":\"aviator\",\"amount\":\"100.00\",\"clientSeed\":\"ml-seed-missing-$TS\",\"idempotencyKey\":\"ml-key-missing-$TS\"}")
echo "下注响应：$BET_RESP_4"
ROUND_ID_4=$(extract "$BET_RESP_4" "roundId")
if [ -z "$ROUND_ID_4" ]; then
  echo "❌ 缺失级验证下注未拿到 roundId"
  exit 1
fi

SETTLE_RESP_4=$(curl -s -X POST "$BASE/round/settle" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"roundId\":$ROUND_ID_4,\"outcome\":\"lose\",\"payout\":\"0.00\"}")
echo "结算响应：$SETTLE_RESP_4"
echo "$SETTLE_RESP_4" | grep -q '"outcome":"lose"'
echo "✅ ml_midA 缺配置时结算未报错（跳过该级）"

psql "$DB_URL" -c "SELECT a.username, c.type, c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID_4 AND c.type='win_loss' ORDER BY a.level;"

BOSS_AMT_4=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID_4 AND c.type='win_loss' AND a.username='ml_boss';" | tr -d ' ')
MIDA_COUNT_4=$(psql_q "SELECT COUNT(*) FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID_4 AND c.type='win_loss' AND a.username='ml_midA';" | tr -d ' ')
SUBB_AMT_4=$(psql_q "SELECT c.amount FROM commissions c JOIN agents a ON a.id=c.agent_id WHERE c.round_id=$ROUND_ID_4 AND c.type='win_loss' AND a.username='ml_subB';" | tr -d ' ')
SUM_4=$(psql_q "SELECT SUM(c.amount) FROM commissions c WHERE c.round_id=$ROUND_ID_4 AND c.type='win_loss';" | tr -d ' ')
echo "ml_boss=$BOSS_AMT_4  ml_midA记录数=$MIDA_COUNT_4  ml_subB=$SUBB_AMT_4  SUM=$SUM_4"

if [ "$BOSS_AMT_4" != "60.00" ]; then
  echo "❌ 缺失级场景下 ml_boss 应仍为 60.00，实际为 $BOSS_AMT_4"
  exit 1
fi
if [ "$MIDA_COUNT_4" != "0" ]; then
  echo "❌ ml_midA 缺配置应跳过、不写记录，实际记录数为 $MIDA_COUNT_4"
  exit 1
fi
if [ "$SUBB_AMT_4" != "10.00" ]; then
  echo "❌ 缺失级场景下 ml_subB 应仍为 10.00，实际为 $SUBB_AMT_4"
  exit 1
fi
if [ "$SUM_4" != "70.00" ]; then
  echo "❌ 缺失级场景下总和应为 70.00（Σpct=60+10=70），实际为 $SUM_4"
  exit 1
fi
echo "✅ 缺失级边界验证通过：ml_midA 跳过不写记录且不报错，ml_boss=60.00 ml_subB=10.00，总和=70.00"

restore_mida_config
trap - EXIT

echo ""
echo "=================================================="
echo "收尾：确认 ml_midA 的 commission_config 已恢复为 30.00 / 1.00"
echo "=================================================="
psql "$DB_URL" -c "SELECT a.username, c.win_loss_pct, c.turnover_pct FROM commission_config c JOIN agents a ON a.id=c.agent_id WHERE a.username IN ('ml_boss','ml_midA','ml_subB') ORDER BY a.level;"
RESTORED_PCT=$(psql_q "SELECT c.win_loss_pct FROM commission_config c JOIN agents a ON a.id=c.agent_id WHERE a.username='ml_midA';" | tr -d ' ')
if [ "$RESTORED_PCT" != "30.00" ]; then
  echo "❌ ml_midA 的 win_loss_pct 未正确恢复为 30.00，实际为 $RESTORED_PCT"
  exit 1
fi
echo "✅ ml_midA 配置已确认恢复"

echo ""
echo "✅ COMMISSION MULTI SMOKE 全绿"
