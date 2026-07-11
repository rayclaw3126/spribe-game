-- ============================================================
-- 跨商家风控告警 —— risk_alerts 表 + 种子
--
-- 用途：供货商总控「跨商家风控」页的真数据源。真规则引擎（自动产出告警）超出本单范围，
--       留 TODO；本单先建表 + 造种子 + 只读聚合接口，让前端读真。
--
-- 约定：
--   · tenant_id → tenants(id)；agent_id/player_id 可空（命中主体，规则引擎接入后再填）。
--   · risk_type ∈ {abnormal_bet, wash, big_withdraw, multi_account}
--   · level ∈ {high, mid, low}；status ∈ {pending, handled, ignored}。
--   · 幂等：空表时才灌种子（WHERE NOT EXISTS）。
--
-- TODO(规则引擎)：后续由风控引擎按下注/提现/多账号信号自动 INSERT 告警，
--                 本表结构即为其落点；本单不实现引擎。
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_alerts (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id),
    agent_id    BIGINT REFERENCES agents(id),
    player_id   BIGINT REFERENCES players(id),
    risk_type   TEXT NOT NULL
                    CHECK (risk_type IN ('abnormal_bet', 'wash', 'big_withdraw', 'multi_account')),
    level       TEXT NOT NULL
                    CHECK (level IN ('high', 'mid', 'low')),
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'handled', 'ignored')),
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_tenant  ON risk_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_level   ON risk_alerts (level);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_status  ON risk_alerts (status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_created ON risk_alerts (created_at DESC);

-- 种子：18 条，规模呼应商家大小（GameHub 最多 → NeoSpin 最少）；
-- created_at 用 now() - N 小时，部分落在今天（供「今日拦截」计数）。
INSERT INTO risk_alerts (tenant_id, risk_type, level, status, detail, created_at)
SELECT v.tenant_id, v.risk_type, v.level, v.status, v.detail, now() - make_interval(hours => v.h)
FROM (VALUES
    (1, 'wash',          'high', 'pending', '同一设备多账号在同房间对刷',        2),
    (1, 'big_withdraw',  'high', 'pending', '单笔提现超日常均值 20 倍',          5),
    (1, 'abnormal_bet',  'mid',  'pending', '短时间内下注频率异常飙升',          9),
    (1, 'multi_account', 'mid',  'handled', '同 IP 段批量注册疑似小号',          30),
    (1, 'abnormal_bet',  'low',  'ignored', '偶发大额单注，人工核对正常',        52),
    (1, 'wash',          'high', 'handled', '两账号对打转移额度',                74),
    (2, 'big_withdraw',  'high', 'pending', '新号首充即大额提现',                4),
    (2, 'abnormal_bet',  'mid',  'pending', '胜率异常偏高，疑似外挂',            12),
    (2, 'multi_account', 'low',  'handled', '同实名多账号登录',                  40),
    (2, 'wash',          'mid',  'ignored', '低频对刷，金额小，暂忽略',          64),
    (3, 'abnormal_bet',  'mid',  'pending', '固定时段规律性下注',                7),
    (3, 'big_withdraw',  'high', 'handled', '大额提现已人工放行',                33),
    (3, 'multi_account', 'low',  'ignored', '家庭共用 IP 多账号',                58),
    (4, 'wash',          'high', 'pending', '疑似团伙对刷套利',                  6),
    (4, 'abnormal_bet',  'low',  'handled', '单日投注笔数偏高',                  46),
    (5, 'multi_account', 'mid',  'pending', '批量新号集中活跃',                  8),
    (5, 'big_withdraw',  'low',  'ignored', '提现金额略高于均值',                70),
    (6, 'abnormal_bet',  'mid',  'pending', '新商家首周下注波动大',              10)
) AS v(tenant_id, risk_type, level, status, detail, h)
WHERE NOT EXISTS (SELECT 1 FROM risk_alerts);
