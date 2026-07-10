-- ============================================================
-- 系统问题 / 反馈留档 —— issues 表
--
-- 用途：admin 代理后台反馈钮、vendor 供货商总控「系统问题」页提交的问题，
--       统一落这张表永久留档，可搜索追源、改状态/回复/派负责人。
--
-- 约定：
--   · tenant_id 预留白标多商家，本期默认 1（单商家）；查询按需按 tenant 收窄。
--   · priority ∈ {high, mid, low}；status ∈ {new, processing, resolved, ignored}。
--   · 提交人 submitter / submitter_type 由后端从登录态推导，不信客户端。
--   · 图片附件不在本表（下一步单独做 issue_images）。
--   · 时间戳一律 TIMESTAMPTZ；updated_at 由 PATCH 路由显式 now() 刷新。
-- ============================================================

CREATE TABLE IF NOT EXISTS issues (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       BIGINT NOT NULL DEFAULT 1,        -- 预留白标：哪个平台/商家域下的问题
    title           TEXT NOT NULL,                    -- 标题（必填）
    description     TEXT,                             -- 描述（可空）
    priority        TEXT NOT NULL DEFAULT 'mid'
                        CHECK (priority IN ('high', 'mid', 'low')),
    status          TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'processing', 'resolved', 'ignored')),
    source_tenant   TEXT,                             -- 来源商家（哪个商家的问题，可空=平台级）
    source_page     TEXT,                             -- 来源页面/游戏（如 代理树 / Aviator）
    submitter       TEXT,                             -- 提交人账号（后端从登录态取）
    submitter_type  TEXT,                             -- 提交人身份（agent / player / tester…）
    reply           TEXT,                             -- 处理回复
    assignee        TEXT,                             -- 负责人
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 列表默认按状态过滤 + 时间倒序，按 tenant 收窄；建三个索引覆盖这些访问路径。
CREATE INDEX IF NOT EXISTS idx_issues_status     ON issues (status);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_tenant_id  ON issues (tenant_id);
