-- ============================================================
-- 接真建模（路线 A：商家 = 顶级代理）—— agents 挂 tenant_id
--
-- 设计：
--   · agents 加 tenant_id → tenants(id)，表示该代理所属商家。
--   · 全树每个代理都回填 tenant_id（= 所属树根商家），不只顶级，聚合直接按 agents.tenant_id。
--   · players 不加（查商家走 player→agents.tenant_id 一跳）；commissions 已带 agent_id，一跳到 tenant。
--
-- 数据落位（6 商家各配一个顶级代理）：
--   · 现有 2 棵树认领：boss 树(root #1) → tenant #1；ml_boss 树(root #6) → tenant #2。
--   · 缺的 4 个商家(tenant #3~#6)各新建一个顶级代理(parent_id=NULL, level=1)。
--   · 兜底：回填后仍为 NULL 的散挂 agent 一律归 tenant #1，最后 SET NOT NULL 强约束。
--
-- 幂等：可重复执行（ADD COLUMN IF NOT EXISTS / INSERT ... WHERE NOT EXISTS / UPDATE 幂等）。
-- 铁律：只 agents 加列 + 回填 + 建 4 个顶级代理；玩家/下注/结算写入路径本单不动。
-- ============================================================

-- 1) 加列 + 外键 + 索引
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_id ON agents (tenant_id);

-- 2) 按 parent_id 递归从树根回填（不依赖 path，最稳）。
--    root #1(boss) → tenant #1；root #6(ml_boss) → tenant #2。
WITH RECURSIVE tree AS (
    SELECT id, id AS root_id FROM agents WHERE parent_id IS NULL
    UNION ALL
    SELECT a.id, t.root_id FROM agents a JOIN tree t ON a.parent_id = t.id
)
UPDATE agents a
   SET tenant_id = m.tid
  FROM tree
  JOIN (VALUES (1::bigint, 1::bigint), (6::bigint, 2::bigint)) AS m(root_id, tid)
    ON tree.root_id = m.root_id
 WHERE a.id = tree.id;

-- 3) 缺的 4 个商家(tenant #3~#6)各建一个顶级代理。
--    密码哈希复用现有 boss（dev 种子：这 4 个账号密码 = boss123），仅测试环境。
INSERT INTO agents (parent_id, username, password_hash, level, role, status, tenant_id)
SELECT NULL, v.username, (SELECT password_hash FROM agents WHERE username = 'boss'),
       1, 'agent', 'active', v.tid
  FROM (VALUES
        ('luckybet_boss', 3::bigint),
        ('starwin_boss',  4::bigint),
        ('acearena_boss', 5::bigint),
        ('neospin_boss',  6::bigint)
  ) AS v(username, tid)
 WHERE NOT EXISTS (SELECT 1 FROM agents WHERE username = v.username);

-- 4) 新建的顶级代理补 path（材料化路径 = 自身 id）。
UPDATE agents SET path = ARRAY[id::text]
 WHERE parent_id IS NULL AND (path IS NULL OR array_length(path, 1) IS NULL);

-- 5) 兜底：仍为 NULL 的散挂 agent 归 tenant #1，别留 NULL。
UPDATE agents SET tenant_id = 1 WHERE tenant_id IS NULL;

-- 6) 强约束：全部回填后置 NOT NULL（未来新代理由 /agent/create 继承父级 tenant_id）。
ALTER TABLE agents ALTER COLUMN tenant_id SET NOT NULL;
