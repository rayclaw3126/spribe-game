-- ============================================================
-- 白标商家（tenant）—— tenants 表
--
-- 用途：供货商总控「商家管理」页的真数据源。字段对齐前端列表：
--       name(商家名) / domain(域名) / skin(皮肤) / status(启用停用) / created_at(开通时间)。
--
-- 约定：
--   · status ∈ {active, disabled}，默认 active。
--   · 时间戳一律 TIMESTAMPTZ；updated_at 由 PATCH 路由显式 now() 刷新（照 issues 同款）。
--   · 种子 = 前端原来 6 条假数据，让接口一上来就对得上；用 NOT EXISTS 保证只在空表时灌，
--     迁移可重复执行不产生重复行。
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,                    -- 商家名（必填）
    domain      TEXT,                             -- 域名（可空）
    skin        TEXT,                             -- 皮肤（可空）
    status      TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 列表按开通时间/主键顺序取；建索引覆盖排序访问。
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

-- 种子：前端原 6 条假数据，仅在空表时灌入（可重复执行）。
-- created_at 取当天正午（12:00），避免午夜时间戳在非 UTC 时区显示成前一天。
-- skin 存英文代号（navy/purple/green/gold），前端查表显示中文——因 prod 库是 LATIN1 存不了中文。
INSERT INTO tenants (name, domain, skin, status, created_at)
SELECT * FROM (VALUES
    ('GameHub',  'gamehub.dad',  'navy',   'active',   '2025-11-02 12:00:00'::timestamptz),
    ('RedPlay',  'redplay.gg',   'purple', 'active',   '2026-01-15 12:00:00'::timestamptz),
    ('LuckyBet', 'luckybet.io',  'green',  'active',   '2026-03-08 12:00:00'::timestamptz),
    ('StarWin',  'starwin.bet',  'gold',   'disabled', '2026-04-21 12:00:00'::timestamptz),
    ('AceArena', 'acearena.club','navy',   'active',   '2026-05-30 12:00:00'::timestamptz),
    ('NeoSpin',  'neospin.vip',  'purple', 'disabled', '2026-06-12 12:00:00'::timestamptz)
) AS seed(name, domain, skin, status, created_at)
WHERE NOT EXISTS (SELECT 1 FROM tenants);
