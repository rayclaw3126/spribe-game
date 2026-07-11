-- ============================================================
-- 修复：tenants.skin 中文乱码（prod 库是 LATIN1，存不了中文）
--
-- 方案：skin 改存英文代号（navy/purple/green/gold），前端查表显示中文。
-- 本迁移把现有 6 个 tenants 的 skin 按商家名(ASCII，可靠)刷成对应代号——
-- 全 ASCII，LATIN1 也能存；无论当前 skin 是中文还是已乱码，都覆盖成干净代号。
--
-- 代号↔中文（前端映射）：navy=深蓝专业 / purple=电竞紫 / green=足球绿 / gold=午夜黑金
-- 幂等：可重复执行（按名 UPDATE，结果恒定）。
-- ============================================================

UPDATE tenants SET skin = 'navy'   WHERE name IN ('GameHub', 'AceArena');
UPDATE tenants SET skin = 'purple' WHERE name IN ('RedPlay', 'NeoSpin');
UPDATE tenants SET skin = 'green'  WHERE name = 'LuckyBet';
UPDATE tenants SET skin = 'gold'   WHERE name = 'StarWin';
