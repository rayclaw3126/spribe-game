-- #42 单1：轮次彩「多房」—— rounds 加房标识列。
--
-- 为什么是新列而不是把房编进 game 列（D 段实证）：
--   · ledger.type 是从 rounds.game 拼出来的（player.js: `l.type = r.game || '_payout'`），
--     game='speedgrid15' 会让 speedgrid_bet/_payout/_refund 三套类型按房裂开 →
--     账单派彩 LATERAL / 跑马灯 / 大奖榜 / reconcile_balances 白名单全部连坐。
--   · 另有 9 张按 game 键索引的表会集体失配，其中 settleDerive.ENGINES['speedgrid15']
--     → undefined → 结算直接崩。
--   新列则 game 恒为 'speedgrid'，上述全部零改动（天然无感）。
--
-- 口径：
--   NULL = 该款的【标准房】（老局全部如此，向后兼容；无需回填）。
--   非 NULL = 房标识，值域由 roundHub 的房配置定（试点：speedgrid 的 '30s' / '15s'）。
--   ⚠ 读侧一律用 COALESCE(room, '30s') 归一（见 /round/history/:game），
--     否则老局（room IS NULL）会被 `room = '30s'` 漏掉。
--   试点期两房都【显式】写值（'30s'/'15s'），其余 8 款仍写 NULL —— 即「有房概念的款才落值」。
--
-- 索引：本单不加。history 查询（WHERE game AND status='settled' ORDER BY id DESC LIMIT 20）
--   的选择性来自 game + LIMIT，现有 idx_rounds_game_round_no (game, round_no) 已覆盖 game 前缀；
--   加 room 谓词不改访问模式。真要提速该上 (game, status, id DESC)，属另一张票。
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS room TEXT;

COMMENT ON COLUMN rounds.room IS
  '#42 房标识：NULL=该款标准房（老局/未房化的款）；非 NULL=房 key 的房段（如 speedgrid 的 30s/15s）。读侧用 COALESCE(room,''30s'') 归一。';
