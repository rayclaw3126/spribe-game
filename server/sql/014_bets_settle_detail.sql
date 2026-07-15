-- ============================================================
-- 014 注级结算明细（#S2）—— bets 追加 settle_detail JSONB
--
-- 排期器 9 款结算时，每 bet 行逐 key 三态的产物 yourResult（[{key,outcome,payout}]）
-- 落此列，供账单注单行展开每注明细（中文档位名 注额→派彩 ✓/✗/退）。
-- 老数据（本列未落 / 其他范式即时局）为 NULL，前端自动回落现状显示。
-- 纯只读追记：不进任何资金写路径，settle_detail 只是结算三态的快照留痕。
--
-- 幂等（IF NOT EXISTS），可重复执行。
-- ============================================================

ALTER TABLE bets ADD COLUMN IF NOT EXISTS settle_detail JSONB;
