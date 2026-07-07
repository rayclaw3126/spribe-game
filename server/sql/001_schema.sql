-- ============================================================
-- spribe 游戏平台后端 —— v1 数据库 schema
--
-- 约定说明：
--   1. 金额精度：所有涉及金额的字段一律使用 DECIMAL(18,2)，
--      禁止使用 float/double/money 类型，避免浮点误差导致资金问题。
--   2. 幂等键：ledger.idempotency_key、bets.idempotency_key
--      均建立 UNIQUE 索引，用于防止网络重试/重复请求导致的重复入账/重复下注。
--   3. 乐观锁：涉及余额并发更新的表（wallets、credit_lines）
--      使用 version 字段做乐观锁，更新时需校验 version 未变化。
--   4. 时间戳统一使用 TIMESTAMPTZ，默认 now()。
--   5. JSON 结构化字段统一使用 JSONB。
--   6. 本文件只建骨架表结构，不含任何业务逻辑（触发器/存储过程等）。
-- ============================================================

-- 建表顺序需满足外键依赖：
-- agents -> players -> wallets/credit_lines -> rounds -> ledger/bets/... -> audit_log

-- 1. 代理商（支持自引用的树形层级结构）
CREATE TABLE IF NOT EXISTS agents (
    id            BIGSERIAL PRIMARY KEY,
    parent_id     BIGINT REFERENCES agents(id),
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    level         INTEGER,
    path          TEXT[], -- 材料化路径，如 '{1,5,12}'
    role          TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 玩家
CREATE TABLE IF NOT EXISTS players (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    agent_id      BIGINT REFERENCES agents(id),
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. 玩家钱包（余额，乐观锁 version）
CREATE TABLE IF NOT EXISTS wallets (
    player_id  BIGINT PRIMARY KEY REFERENCES players(id),
    balance    DECIMAL(18,2) NOT NULL DEFAULT 0,
    version    INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. 代理商信用额度（乐观锁 version）
CREATE TABLE IF NOT EXISTS credit_lines (
    agent_id   BIGINT PRIMARY KEY REFERENCES agents(id),
    credit     DECIMAL(18,2) NOT NULL DEFAULT 0,
    version    INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. 游戏局（每一局的下注/结果/开奖信息）
CREATE TABLE IF NOT EXISTS rounds (
    id          BIGSERIAL PRIMARY KEY,
    game        TEXT NOT NULL,
    player_id   BIGINT REFERENCES players(id),
    bet_amount  DECIMAL(18,2),
    result      JSONB,
    payout      DECIMAL(18,2),
    server_seed TEXT,
    client_seed TEXT,
    result_hash TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. 资金流水账（玩家余额变动记录，含幂等键防重复入账）
CREATE TABLE IF NOT EXISTS ledger (
    id              BIGSERIAL PRIMARY KEY,
    player_id       BIGINT REFERENCES players(id),
    type            TEXT NOT NULL,
    amount          DECIMAL(18,2) NOT NULL,
    balance_before  DECIMAL(18,2),
    balance_after   DECIMAL(18,2),
    idempotency_key TEXT,
    round_id        BIGINT REFERENCES rounds(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ledger 幂等键唯一索引：防止同一请求被重复处理导致重复刷钱
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency_key
    ON ledger (idempotency_key);

-- 7. 代理商之间的信用额度流水
CREATE TABLE IF NOT EXISTS credit_ledger (
    id         BIGSERIAL PRIMARY KEY,
    from_agent BIGINT REFERENCES agents(id),
    to_agent   BIGINT REFERENCES agents(id),
    amount     DECIMAL(18,2) NOT NULL,
    type       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. 佣金记录
CREATE TABLE IF NOT EXISTS commissions (
    id         BIGSERIAL PRIMARY KEY,
    agent_id   BIGINT REFERENCES agents(id),
    player_id  BIGINT REFERENCES players(id),
    round_id   BIGINT REFERENCES rounds(id),
    type       TEXT,
    amount     DECIMAL(18,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. 代理商佣金比例配置
CREATE TABLE IF NOT EXISTS commission_config (
    agent_id      BIGINT PRIMARY KEY REFERENCES agents(id),
    win_loss_pct  DECIMAL(18,2),
    turnover_pct  DECIMAL(18,2),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. 下注记录（含幂等键防重复下注）
CREATE TABLE IF NOT EXISTS bets (
    id              BIGSERIAL PRIMARY KEY,
    round_id        BIGINT REFERENCES rounds(id),
    player_id       BIGINT REFERENCES players(id),
    amount          DECIMAL(18,2) NOT NULL,
    idempotency_key TEXT,
    outcome         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- bets 幂等键唯一索引：防止同一请求被重复处理导致重复下注
CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_idempotency_key
    ON bets (idempotency_key);

-- 11. 审计日志（代理商操作记录）
CREATE TABLE IF NOT EXISTS audit_log (
    id            BIGSERIAL PRIMARY KEY,
    actor_agent   BIGINT REFERENCES agents(id),
    action        TEXT NOT NULL,
    target_player BIGINT REFERENCES players(id),
    amount        DECIMAL(18,2),
    detail        JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
