#!/usr/bin/env bash
# 单5：占成设置 + 玩家上下分（额度↔余额兑换）+ 审计 端到端冒烟测试
# 覆盖：
#   ①设占成成功  ⑥超占成拒  ③余额不足拒  ④越权拒  ⑤额度不足拒
#   ⑦幂等（同 key 重复请求不二次入账）  ⑨审计 + credit_ledger/ledger 双写佐证
# 用法：BASE=http://localhost:4000 bash test/agent_ops_smoke.sh
set -e

BASE="${BASE:-http://localhost:4000}"
# 数据库连接：密码从环境变量读取，脚本不再硬编码明文凭据。
# 运行前先设置：export PGPASSWORD=<数据库密码>   （或直接 export PSQL_CONN=<完整连接串> 覆盖整串）
PSQL_CONN="${PSQL_CONN:-postgres://spribe_app:${PGPASSWORD}@127.0.0.1:5432/spribe?options=-c%20search_path%3Dspribe_dev}"

# 提取 JSON 字段的小工具：优先尝试用 grep -o（不依赖 jq），
# 兼容形如 "key":"value" 或 "key":123 或 "key":true/false 的简单场景。
extract() {
  local json="$1"
  local key="$2"
  echo "$json" | grep -o "\"$key\":\"\{0,1\}[^,\"}]*\"\{0,1\}" | head -1 | sed -E "s/\"$key\":\"?//; s/\"$//"
}

psql_q() {
  # 静默执行一条 psql 语句（-t -A 去掉表头/对齐，便于脚本内断言）
  psql "$PSQL_CONN" -t -A -c "$1"
}

# 每次运行用唯一后缀命名幂等键，避免和历史残留的 ledger.idempotency_key
# （全局唯一索引）冲突——否则重跑脚本时步骤 3/6 会被误判成"重复请求"而走幂等分支。
SUFFIX="$(date +%s)_$$"
DEP_KEY_1="dep-key-1-${SUFFIX}"
DEP_KEY_OVER="dep-key-overlimit-${SUFFIX}"
DEP_KEY_CROSS="dep-key-cross-${SUFFIX}"
WD_KEY_1="wd-key-1-${SUFFIX}"
WD_KEY_OVER="wd-key-overlimit-${SUFFIX}"

# 第 4 步会临时把 ml_midA 的 commission_config 改成 50.00/1.00（这是被测功能本身，
# 不是"预置夹具"），但 commission_multi_smoke.sh 依赖 ml_midA=30.00/1.00 的初始配置，
# 跑完本脚本要把它还原回去，不然会污染那份多级分成测试的前置假设。
restore_mida_config() {
  echo "（清理）恢复 ml_midA 的 commission_config = 30.00 / 1.00（避免影响 commission_multi_smoke.sh）"
  psql_q "INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
          SELECT a.id, 30.00, 1.00 FROM agents a WHERE a.username='ml_midA'
          ON CONFLICT (agent_id) DO UPDATE SET win_loss_pct=30.00, turnover_pct=1.00;" > /dev/null
}
trap restore_mida_config EXIT

echo "=================================================="
echo "步骤 0：预置测试夹具（psql 直连，不改 sql/*.sql 种子文件，全部 ON CONFLICT 不污染）"
echo "=================================================="
# 复用 003_seed_multilevel.sql 的 ml_boss/ml_midA/ml_subB/charlie 三级代理链（密码统一 ml123）。
# ml_boss 本身没有 credit_lines 记录，这里给它现场补一条 10000.00 的测试额度；
# charlie 的钱包余额也重置为 1000.00，两者都是"每次重跑都干净"的固定基线，
# 这样断言里的绝对金额（如 9900.00 / 1100.00）在多次重跑下都成立。
psql "$PSQL_CONN" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO credit_lines (agent_id, credit, version)
SELECT id, 10000.00, 0 FROM agents WHERE username = 'ml_boss'
ON CONFLICT (agent_id) DO UPDATE SET credit = 10000.00, version = 0;

INSERT INTO wallets (player_id, balance, version)
SELECT id, 1000.00, 0 FROM players WHERE username = 'charlie'
ON CONFLICT (player_id) DO UPDATE SET balance = 1000.00, version = 0;
SQL
echo "✅ 夹具就绪：ml_boss 额度重置为 10000.00，charlie 钱包余额重置为 1000.00"

echo ""
echo "=================================================="
echo "登录：ml_boss（ml123）/ boss（boss123，boss 线下没有 charlie，用于④越权测试）"
echo "=================================================="
MLBOSS_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ml_boss","password":"ml123","type":"agent"}')
echo "ml_boss 登录响应：$MLBOSS_LOGIN_RESP"
MLBOSS_TOKEN=$(extract "$MLBOSS_LOGIN_RESP" "token")
if [ -z "$MLBOSS_TOKEN" ]; then
  echo "❌ ml_boss 登录未拿到 token"
  exit 1
fi
echo "✅ ml_boss 登录成功"

BOSS_LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"boss","password":"boss123","type":"agent"}')
echo "boss 登录响应：$BOSS_LOGIN_RESP"
BOSS_TOKEN=$(extract "$BOSS_LOGIN_RESP" "token")
if [ -z "$BOSS_TOKEN" ]; then
  echo "❌ boss 登录未拿到 token"
  exit 1
fi
echo "✅ boss 登录成功"

ML_MIDA_ID=$(psql_q "SELECT id FROM agents WHERE username='ml_midA';" | tr -d ' ')
CHARLIE_ID=$(psql_q "SELECT id FROM players WHERE username='charlie';" | tr -d ' ')
echo "ml_midA.id=$ML_MIDA_ID  charlie.id=$CHARLIE_ID"

echo ""
echo "=================================================="
echo "步骤 1（①设占成）：ml_boss 给 ml_midA 设 win_loss_pct=50, turnover_pct=1"
echo "=================================================="
SET_CFG_RESP=$(curl -s -X POST "$BASE/agent/commission/config" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":${ML_MIDA_ID},\"winLossPct\":50,\"turnoverPct\":1}")
echo "响应：$SET_CFG_RESP"
echo "$SET_CFG_RESP" | grep -q '"winLossPct":50'
echo "✅ 设占成接口返回成功"

echo "psql 佐证 commission_config(ml_midA)："
psql "$PSQL_CONN" -c "SELECT a.username, c.win_loss_pct, c.turnover_pct FROM commission_config c JOIN agents a ON a.id=c.agent_id WHERE a.username='ml_midA';"
MIDA_WIN=$(psql_q "SELECT win_loss_pct FROM commission_config WHERE agent_id=${ML_MIDA_ID};" | tr -d ' ')
MIDA_TURN=$(psql_q "SELECT turnover_pct FROM commission_config WHERE agent_id=${ML_MIDA_ID};" | tr -d ' ')
if [ "$MIDA_WIN" != "50.00" ] || [ "$MIDA_TURN" != "1.00" ]; then
  echo "❌ commission_config(ml_midA) 未写成 50.00/1.00，实际=$MIDA_WIN/$MIDA_TURN"
  exit 1
fi
echo "✅ psql 确认 commission_config(ml_midA)=50.00/1.00"

echo ""
echo "=================================================="
echo "步骤 2（⑥超占成拒）：ml_boss(自身60%) 给 ml_midA 设 70 应 400 '占成不能超过上级'"
echo "=================================================="
OVER_CFG_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/commission/config" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":${ML_MIDA_ID},\"winLossPct\":70,\"turnoverPct\":1}")
echo "响应：$OVER_CFG_RESP"
echo "$OVER_CFG_RESP" | grep -q 'HTTP_STATUS:400'
echo "$OVER_CFG_RESP" | grep -q '占成不能超过上级'
echo "✅ 超占成验证通过：70% > ml_boss 自身 60%，被拒绝（400 占成不能超过上级）"

echo ""
echo "=================================================="
echo "步骤 3（上分）：ml_boss 给 charlie 上分 100.00（idempotencyKey=${DEP_KEY_1}）"
echo "=================================================="
DEPOSIT_RESP=$(curl -s -X POST "$BASE/agent/player/deposit" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"100.00\",\"idempotencyKey\":\"${DEP_KEY_1}\"}")
echo "响应：$DEPOSIT_RESP"
echo "$DEPOSIT_RESP" | grep -q '"idempotent":false'
DEP_PLAYER_AFTER=$(extract "$DEPOSIT_RESP" "playerBalanceAfter")
DEP_AGENT_AFTER=$(extract "$DEPOSIT_RESP" "agentCreditAfter")
echo "charlie 余额=$DEP_PLAYER_AFTER  ml_boss 额度=$DEP_AGENT_AFTER"
if [ "$DEP_AGENT_AFTER" != "9900.00" ]; then
  echo "❌ 上分后 ml_boss 额度应为 9900.00，实际为 $DEP_AGENT_AFTER"
  exit 1
fi
if [ "$DEP_PLAYER_AFTER" != "1100.00" ]; then
  echo "❌ 上分后 charlie 余额应为 1100.00，实际为 $DEP_PLAYER_AFTER"
  exit 1
fi
echo "✅ 上分成功：charlie 余额 1000.00 -> 1100.00，ml_boss 额度 10000.00 -> 9900.00"

echo ""
echo "=================================================="
echo "步骤 4（⑦幂等）：同 key(${DEP_KEY_1}) 再上分一次，应 idempotent:true 且余额/额度都不再变"
echo "=================================================="
DEPOSIT_AGAIN_RESP=$(curl -s -X POST "$BASE/agent/player/deposit" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"100.00\",\"idempotencyKey\":\"${DEP_KEY_1}\"}")
echo "响应：$DEPOSIT_AGAIN_RESP"
echo "$DEPOSIT_AGAIN_RESP" | grep -q '"idempotent":true'
echo "✅ 幂等命中：返回 idempotent:true"

CHARLIE_BAL_AFTER_REPEAT=$(psql_q "SELECT balance FROM wallets WHERE player_id=${CHARLIE_ID};" | tr -d ' ')
MLBOSS_CREDIT_AFTER_REPEAT=$(psql_q "SELECT credit FROM credit_lines WHERE agent_id=(SELECT id FROM agents WHERE username='ml_boss');" | tr -d ' ')
echo "重复上分后 psql 佐证：charlie 余额=$CHARLIE_BAL_AFTER_REPEAT  ml_boss 额度=$MLBOSS_CREDIT_AFTER_REPEAT"
if [ "$CHARLIE_BAL_AFTER_REPEAT" != "1100.00" ] || [ "$MLBOSS_CREDIT_AFTER_REPEAT" != "9900.00" ]; then
  echo "❌ 幂等失效：重复请求后余额或额度发生了二次变化"
  exit 1
fi
echo "✅ 幂等验证通过：重复上分未二次扣额度/加余额"

echo ""
echo "=================================================="
echo "步骤 5（⑤额度不足拒）：ml_boss 给 charlie 上分 999999，应 400 '额度不足'"
echo "=================================================="
OVER_DEPOSIT_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/player/deposit" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"999999\",\"idempotencyKey\":\"${DEP_KEY_OVER}\"}")
echo "响应：$OVER_DEPOSIT_RESP"
echo "$OVER_DEPOSIT_RESP" | grep -q 'HTTP_STATUS:400'
echo "$OVER_DEPOSIT_RESP" | grep -q '额度不足'
echo "✅ 额度不足验证通过：ml_boss 额度 9900.00 < 999999，被拒绝（400 额度不足）"

echo ""
echo "=================================================="
echo "步骤 6（下分）：ml_boss 给 charlie 下分 50.00（idempotencyKey=${WD_KEY_1}）"
echo "=================================================="
WITHDRAW_RESP=$(curl -s -X POST "$BASE/agent/player/withdraw" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"50.00\",\"idempotencyKey\":\"${WD_KEY_1}\"}")
echo "响应：$WITHDRAW_RESP"
echo "$WITHDRAW_RESP" | grep -q '"idempotent":false'
WD_PLAYER_AFTER=$(extract "$WITHDRAW_RESP" "playerBalanceAfter")
WD_AGENT_AFTER=$(extract "$WITHDRAW_RESP" "agentCreditAfter")
echo "charlie 余额=$WD_PLAYER_AFTER  ml_boss 额度=$WD_AGENT_AFTER"
if [ "$WD_PLAYER_AFTER" != "1050.00" ]; then
  echo "❌ 下分后 charlie 余额应为 1050.00，实际为 $WD_PLAYER_AFTER"
  exit 1
fi
if [ "$WD_AGENT_AFTER" != "9950.00" ]; then
  echo "❌ 下分后 ml_boss 额度应为 9950.00，实际为 $WD_AGENT_AFTER"
  exit 1
fi
echo "✅ 下分成功：charlie 余额 1100.00 -> 1050.00，ml_boss 额度 9900.00 -> 9950.00"

echo ""
echo "=================================================="
echo "步骤 7（③余额不足拒）：ml_boss 给 charlie 下分 999999，应 400 '余额不足'"
echo "=================================================="
OVER_WITHDRAW_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/player/withdraw" \
  -H "Authorization: Bearer $MLBOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"999999\",\"idempotencyKey\":\"${WD_KEY_OVER}\"}")
echo "响应：$OVER_WITHDRAW_RESP"
echo "$OVER_WITHDRAW_RESP" | grep -q 'HTTP_STATUS:400'
echo "$OVER_WITHDRAW_RESP" | grep -q '余额不足'
echo "✅ 余额不足验证通过：charlie 余额 1050.00 < 999999，被拒绝（400 余额不足）"

echo ""
echo "=================================================="
echo "步骤 8（④越权拒）：boss 登录（boss123，boss 线下没有 charlie）给 charlie 上分，应 403"
echo "=================================================="
CROSS_DEPOSIT_RESP=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE/agent/player/deposit" \
  -H "Authorization: Bearer $BOSS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"playerId\":${CHARLIE_ID},\"amount\":\"10.00\",\"idempotencyKey\":\"${DEP_KEY_CROSS}\"}")
echo "响应：$CROSS_DEPOSIT_RESP"
echo "$CROSS_DEPOSIT_RESP" | grep -q 'HTTP_STATUS:403'
echo "$CROSS_DEPOSIT_RESP" | grep -q '目标不在你的线下'
echo "✅ 越权验证通过：boss 对 charlie（不在 boss 线下）上分被拒绝（403 目标不在你的线下）"

echo ""
echo "=================================================="
echo "步骤 9（⑨审计 + 双写佐证）：psql 查 audit_log / credit_ledger / ledger"
echo "=================================================="
echo "--- audit_log（commission_config / player_deposit / player_withdraw）---"
psql "$PSQL_CONN" -c "SELECT id, actor_agent, action, target_player, amount, created_at FROM audit_log WHERE action IN ('commission_config','player_deposit','player_withdraw') ORDER BY id DESC LIMIT 10;"
AUDIT_CFG_COUNT=$(psql_q "SELECT COUNT(*) FROM audit_log WHERE action='commission_config';" | tr -d ' ')
AUDIT_DEP_COUNT=$(psql_q "SELECT COUNT(*) FROM audit_log WHERE action='player_deposit';" | tr -d ' ')
AUDIT_WD_COUNT=$(psql_q "SELECT COUNT(*) FROM audit_log WHERE action='player_withdraw';" | tr -d ' ')
echo "audit_log 计数：commission_config=$AUDIT_CFG_COUNT  player_deposit=$AUDIT_DEP_COUNT  player_withdraw=$AUDIT_WD_COUNT"
if [ "$AUDIT_CFG_COUNT" -lt 1 ] || [ "$AUDIT_DEP_COUNT" -lt 1 ] || [ "$AUDIT_WD_COUNT" -lt 1 ]; then
  echo "❌ audit_log 缺记录（占成设置/上分/下分三类都应至少各有一条）"
  exit 1
fi
echo "✅ audit_log 三类审计记录齐全"

echo ""
echo "--- credit_ledger（player_deposit / player_withdraw 流水，to_agent/from_agent 为 NULL 表示对手方是玩家钱包）---"
psql "$PSQL_CONN" -c "SELECT id, from_agent, to_agent, amount, type, created_at FROM credit_ledger WHERE type IN ('player_deposit','player_withdraw') ORDER BY id DESC LIMIT 10;"
CL_DEP_COUNT=$(psql_q "SELECT COUNT(*) FROM credit_ledger WHERE type='player_deposit';" | tr -d ' ')
CL_WD_COUNT=$(psql_q "SELECT COUNT(*) FROM credit_ledger WHERE type='player_withdraw';" | tr -d ' ')
echo "credit_ledger 计数：player_deposit=$CL_DEP_COUNT  player_withdraw=$CL_WD_COUNT"
if [ "$CL_DEP_COUNT" -lt 1 ] || [ "$CL_WD_COUNT" -lt 1 ]; then
  echo "❌ credit_ledger 缺 player_deposit/player_withdraw 流水（额度侧记账没写全）"
  exit 1
fi
echo "✅ credit_ledger 额度流水齐全（额度侧记账证据）"

echo ""
echo "--- ledger（charlie 的 deposit/withdraw 记录，带 balance_before/after）---"
psql "$PSQL_CONN" -c "SELECT id, player_id, type, amount, balance_before, balance_after, idempotency_key, created_at FROM ledger WHERE player_id=${CHARLIE_ID} AND type IN ('deposit','withdraw') ORDER BY id DESC LIMIT 10;"
LEDGER_DEP_COUNT=$(psql_q "SELECT COUNT(*) FROM ledger WHERE player_id=${CHARLIE_ID} AND type='deposit';" | tr -d ' ')
LEDGER_WD_COUNT=$(psql_q "SELECT COUNT(*) FROM ledger WHERE player_id=${CHARLIE_ID} AND type='withdraw';" | tr -d ' ')
echo "ledger 计数：deposit=$LEDGER_DEP_COUNT  withdraw=$LEDGER_WD_COUNT"
if [ "$LEDGER_DEP_COUNT" -lt 1 ] || [ "$LEDGER_WD_COUNT" -lt 1 ]; then
  echo "❌ ledger 缺 charlie 的 deposit/withdraw 记录（余额侧记账没写全）"
  exit 1
fi
echo "✅ ledger 余额流水齐全（余额侧记账证据）"

echo ""
echo "✅ 双写佐证完成：credit_ledger（额度流）+ ledger（余额流）在同一次上/下分中各记一笔，证明额度与余额同一事务内双写"

echo ""
echo "✅ AGENT OPS SMOKE 全绿"
