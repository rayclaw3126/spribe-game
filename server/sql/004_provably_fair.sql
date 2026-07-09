-- ============================================================
-- 可验证公平（provably fair）—— player_seeds 承诺表
--
-- 模型 A（标准 commit-reveal）：
--   每玩家同时只有一条 active 种子（server_seed 明文在 active 期间绝不外泄，
--   只公开 server_seed_hash）。下注时按 (server_seed, nonce) 确定性派生结果，
--   nonce 每局 +1。玩家轮换（/seed/rotate）时旧种子转 revealed 并公开明文，
--   插入新的 active 种子（nonce 归零）。历史 revealed 行永久保留供事后验证。
--
-- 约定：金额无关表；时间戳 TIMESTAMPTZ；一玩家一条 active 用部分唯一索引保证。
-- 说明：aviator 是「每局一把、全场共享」的 per-round 种子模型，不纳入本表。
-- ============================================================

CREATE TABLE IF NOT EXISTS player_seeds (
    id                BIGSERIAL PRIMARY KEY,
    player_id         BIGINT NOT NULL REFERENCES players(id),
    server_seed       TEXT NOT NULL,               -- 明文，active 期间【绝不返回】，rotate 时才 reveal
    server_seed_hash  TEXT NOT NULL,               -- sha256(server_seed)，下注前就公开
    client_seed       TEXT NOT NULL,               -- 玩家可设，默认后端随机；仅 nonce=0/rotate 时可改
    nonce             INTEGER NOT NULL DEFAULT 0,   -- 该 seed 上已用到的最大 nonce（每局 +1）
    status            TEXT NOT NULL DEFAULT 'active', -- 'active' | 'revealed'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    revealed_at       TIMESTAMPTZ                  -- rotate 时填
);

-- 每玩家至多一条 active：部分唯一索引（历史 revealed 行不受约束）
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_seeds_one_active
    ON player_seeds (player_id) WHERE status = 'active';

-- 按玩家查历史种子（事后验证旧局）
CREATE INDEX IF NOT EXISTS idx_player_seeds_player
    ON player_seeds (player_id);
