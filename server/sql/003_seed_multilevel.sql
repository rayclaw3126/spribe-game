-- ============================================================
-- spribe 游戏平台后端 —— 多级分成自测种子数据（算法 B 验证用）
--
-- 目的：建一条**全新独立**的三级代理链，专供 commission_multi_smoke.sh
-- 验证「算法 B 各级抽原始输额 + 末有效级减法兜底」的多级分成逻辑，
-- 不复用 002_seed.sql 里的 boss/alice，避免污染既有 Phase 0/3 数据。
--
-- 链路结构（parent_id 逐级向上）：
--   ml_boss（顶级，level 1，parent_id NULL）
--     └─ ml_midA（中级，level 2，parent = ml_boss）
--          └─ ml_subB（下级，level 3，parent = ml_midA）
--               └─ 玩家 charlie（agent_id = ml_subB）
--
-- commission_config 百分比约定同 002：整数百分比数值存储，
--   例如 win_loss_pct = 60.00 表示「输赢抽成 60%」。
--   三级 win_loss_pct 之和 = 60 + 30 + 10 = 100（Σ=100%，
--   算法 B 在此场景下三级分成之和应精确等于本局输额，无需兜底也不会有余数遗漏）。
--   三级 turnover_pct 独立设置（2.00 / 1.00 / 0.50），互不相关、不要求和为 100。
--
-- 密码明文：所有账号（ml_boss / ml_midA / ml_subB / charlie）统一密码 ml123，
--   哈希用 `node -e "console.log(require('bcrypt').hashSync('ml123',10))"` 预先生成，
--   各账号共用同一条 hash（仅测试环境，生产环境严禁写死密码）。
--
-- 本文件可重复执行：全部使用 ON CONFLICT DO NOTHING；
-- path 的 UPDATE 按 username 定位，重复执行会得到同样的结果，无副作用。
-- ============================================================

-- 密码 hash（明文 ml123）
-- $2b$10$ZxPjnIKPaLHGYIhjYJ.D5eURwfpgO1V3mlHKvMoeQQnjZ.sC5jSBC

-- 1. 顶级代理 ml_boss（parent_id NULL，level 1）
INSERT INTO agents (parent_id, username, password_hash, level, role, status)
VALUES (
    NULL,
    'ml_boss',
    '$2b$10$ZxPjnIKPaLHGYIhjYJ.D5eURwfpgO1V3mlHKvMoeQQnjZ.sC5jSBC',
    1,
    'agent',
    'active'
)
ON CONFLICT (username) DO NOTHING;

-- 2. 中级代理 ml_midA（parent = ml_boss，level 2）
INSERT INTO agents (parent_id, username, password_hash, level, role, status)
SELECT
    a.id,
    'ml_midA',
    '$2b$10$ZxPjnIKPaLHGYIhjYJ.D5eURwfpgO1V3mlHKvMoeQQnjZ.sC5jSBC',
    2,
    'agent',
    'active'
FROM agents a
WHERE a.username = 'ml_boss'
ON CONFLICT (username) DO NOTHING;

-- 3. 下级代理 ml_subB（parent = ml_midA，level 3）
INSERT INTO agents (parent_id, username, password_hash, level, role, status)
SELECT
    a.id,
    'ml_subB',
    '$2b$10$ZxPjnIKPaLHGYIhjYJ.D5eURwfpgO1V3mlHKvMoeQQnjZ.sC5jSBC',
    3,
    'agent',
    'active'
FROM agents a
WHERE a.username = 'ml_midA'
ON CONFLICT (username) DO NOTHING;

-- 4. 玩家 charlie，归属 ml_subB
INSERT INTO players (username, password_hash, agent_id, status)
SELECT
    'charlie',
    '$2b$10$ZxPjnIKPaLHGYIhjYJ.D5eURwfpgO1V3mlHKvMoeQQnjZ.sC5jSBC',
    a.id,
    'active'
FROM agents a
WHERE a.username = 'ml_subB'
ON CONFLICT (username) DO NOTHING;

-- 5. charlie 的钱包，初始余额 1000.00
INSERT INTO wallets (player_id, balance, version)
SELECT p.id, 1000.00, 0
FROM players p
WHERE p.username = 'charlie'
ON CONFLICT (player_id) DO NOTHING;

-- 6. 三级 commission_config：win_loss_pct 之和 = 100（60+30+10），turnover_pct 各自独立
INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
SELECT a.id, 60.00, 2.00
FROM agents a
WHERE a.username = 'ml_boss'
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
SELECT a.id, 30.00, 1.00
FROM agents a
WHERE a.username = 'ml_midA'
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO commission_config (agent_id, win_loss_pct, turnover_pct)
SELECT a.id, 10.00, 0.50
FROM agents a
WHERE a.username = 'ml_subB'
ON CONFLICT (agent_id) DO NOTHING;

-- 7. 物化路径 path（TEXT[]，从顶到底逐级 = 父.path || 自己id），按 username 定位，
--    可重复执行覆盖设置，无副作用。
UPDATE agents
SET path = ARRAY[id]::text[]
WHERE username = 'ml_boss';

UPDATE agents child
SET path = COALESCE(parent.path, '{}') || child.id::text
FROM agents parent
WHERE child.username = 'ml_midA'
  AND parent.username = 'ml_boss';

UPDATE agents child
SET path = COALESCE(parent.path, '{}') || child.id::text
FROM agents parent
WHERE child.username = 'ml_subB'
  AND parent.username = 'ml_midA';
