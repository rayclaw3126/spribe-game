-- ============================================================
-- 系统问题附件 —— issue_images 表
--
-- 用途：一条 issue 可挂多张截图。图片文件存本地磁盘（server/uploads/issues/），
--       这张表只记录元数据（随机文件名 + 访问 url），不存图二进制。
--
-- 约定：
--   · 随机文件名（crypto hash + 原扩展名），不用原文件名，防猜测/覆盖。
--   · url 为对外访问路径（如 /uploads/issues/<filename>），由 express.static 托管。
--   · tenant_id 预留白标，默认 1，与 issues 同口径。
--   · 删除 issue 时其图片行不做级联（本步不做删除功能），仅记录。
-- ============================================================

CREATE TABLE IF NOT EXISTS issue_images (
    id          BIGSERIAL PRIMARY KEY,
    issue_id    BIGINT NOT NULL REFERENCES issues(id),
    tenant_id   BIGINT NOT NULL DEFAULT 1,        -- 预留白标
    filename    TEXT NOT NULL,                    -- 落盘的随机文件名（不含目录）
    url         TEXT NOT NULL,                    -- 对外访问路径 /uploads/issues/<filename>
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按 issue 查它的所有图片（详情页 join / 列表带图）。
CREATE INDEX IF NOT EXISTS idx_issue_images_issue_id ON issue_images (issue_id);
