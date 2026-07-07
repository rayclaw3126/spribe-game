-- ============================================================
-- spribe 游戏平台后端 —— 种子数据（用于本地自测 / 演示环境）
--
-- 账号说明（密码均为明文，仅供测试环境使用，生产环境严禁写死密码）：
--   总代 agent: username = boss , password = boss123
--   玩家 player: username = alice, password = alice123 , 归属 boss，初始余额 1000.00
--
-- commission_config 百分比约定：字段按「整数百分比数值存储」，
--   例如 win_loss_pct = 5.00 表示「输赢抽成 5%」，业务计算时用 pct / 100。
--   本次种子只给 boss 配置了 win_loss_pct=5.00、turnover_pct=0（暂不启用流水抽成）。
--
-- 本文件可重复执行：全部使用 ON CONFLICT DO NOTHING，
-- 已存在的记录不会被覆盖，方便反复重建/重跑测试环境。
-- ============================================================

-- 1. 总代 boss（顶级代理，parent_id 为空）
-- 密码明文：boss123
INSERT INTO agents (parent_id, username, password_hash, level, role, status)
VALUES (
    NULL,
    'boss',
    '$2b$10$EnziiEEDwcmlOhO8vfILeulAkwW59bwXYvARS7qEo62lojFbrcpq.',
    1,
    'agent',
    'active'
)
ON CONFLICT (username) DO NOTHING;

-- 2. 玩家 alice，归属 boss
-- 密码明文：alice123
INSERT INTO players (username, password_hash, agent_id, status)
SELECT
    'alice',
    '$2b$10$Z1.YmNMbjGjsPxImS8H64eovUY5wJcgMIHM0bTFoJP3oImxmUuoeO',
    a.id,
    'active'
FROM agents a
WHERE a.username = 'boss'
ON CONFLICT (username) DO NOTHING;

-- 3. alice 的钱包，初始余额 1000.00
INSERT INTO wallets (player_id, balance, version)
SELECT p.id, 1000.00, 0
FROM players p
WHERE p.username = 'alice'
ON CONFLICT (player_id) DO NOTHING;

-- 4. boss 的佣金比例配置：输赢抽成 5%，流水抽成暂不启用（0%）
INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
SELECT a.id, 5.00, 0
FROM agents a
WHERE a.username = 'boss'
ON CONFLICT (agent_id) DO NOTHING;

-- 5. boss 的物化路径 path（顶级代理 = [自己id]）。
--    path 为 TEXT[]，元素是 agent id 的文本；下级代理 path = 父.path || 自己id。
--    幂等：顶级 path 恒等于 ARRAY[id]，直接覆盖设置无副作用。
UPDATE agents
SET path = ARRAY[id]::text[]
WHERE username = 'boss';

-- 6. boss 的初始额度线 credit_lines：10000.00（顶级代理可下发给下级的总额度）。
--    可重复跑：已存在则保留现状（沿用本文件 ON CONFLICT DO NOTHING 约定）。
INSERT INTO credit_lines (agent_id, credit, version)
SELECT a.id, 10000.00, 0
FROM agents a
WHERE a.username = 'boss'
ON CONFLICT (agent_id) DO NOTHING;
