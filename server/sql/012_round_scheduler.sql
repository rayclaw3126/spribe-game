-- ============================================================
-- 012 轮次排期器（#43 单1）—— 服务器按房间节奏统一开奖 / 全局期号
--
-- 背景：轮次游戏从「玩家各自 POST 触发开奖、per-player 局」改为
--       「服务器按房间相位机统一开奖、一期一号、全场共享一局」。
--       首个接入：speedgrid（其余 9 款仍走老的 per-player makeRoundGameHandler）。
--
-- 全部 IF NOT EXISTS，可重复执行（幂等）。
-- ============================================================

-- 1) rounds 加全局期号列 round_no（形如 SG-YYYYMMDD-NNN），共享房间一期一行。
--    per-player 老局（其余 9 款 + 即时游戏）该列留 NULL，互不影响。
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS round_no TEXT;

-- 期号查询/启动恢复当日序号用（WHERE game=.. AND round_no LIKE 'SG-<today>-%'）。
CREATE INDEX IF NOT EXISTS idx_rounds_game_round_no ON rounds (game, round_no);

-- 2) bets 加下注明细列 selections（{marketKey: amount}）。
--    共享房间的 rounds 行只存「开奖结果」，玩家各自押了哪些盘口/多少注额落在 bets 行，
--    结算时服务器 SELECT 本期全部 bets 读 selections 逐 key 三态。per-player 老局该列留 NULL。
ALTER TABLE bets ADD COLUMN IF NOT EXISTS selections JSONB;
