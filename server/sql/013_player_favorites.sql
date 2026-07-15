-- ============================================================
-- 013 玩家收藏（#44 我的最爱）—— 玩家收藏游戏的持久化表
--
-- 一玩家一款一行；(player_id, game) 联合主键，天然去重、天然幂等 toggle。
-- game 存 backendId（如 'dice'），与 risk.js perGame 键、/player/favorites* 白名单同源。
-- 玩家删除级联清收藏（ON DELETE CASCADE）。非资金表，不进 ledger/wallet 任何路径。
--
-- 全部 IF NOT EXISTS，可重复执行（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS player_favorites (
  player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, game)
);
