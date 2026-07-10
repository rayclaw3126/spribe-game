// Derby Day（主客对抗 Keno · 主队 10 珠 vs 客队 10 珠比和值）可验证公平引擎（纯函数，便于单测/对拍）。
// 原子轮次局：押盘口（半/全场胜负/大小单双/半全场组合）→ 主客各抽 20 → 逐盘口结算（含 push 退注）。
//
// ⚠️ 埋尸点铁律：drawMatch / deriveMatch / ODDS / MARKETS(含 hit + push 判定) 逐位照抄前端
//    src/games/DerbyDay.jsx，改一处必须改两处，一个数都别动别重算。
//
// ⚠️ push（平局退注）铁律 —— 本作【首个有 push 的游戏】，通用 handler 靠 pushesOf/pushes 判退注：
//    · H/A 胜负盘：主客该阶段和值【相等】→ push（退本金，不算赢不算输）。
//    · 半全场 ht-ft-* 四键：HT 平【或】FT 平 → 四键全 push。
//    push 与 hit 互斥（平局时 hit 必假）；push→退 stake（amount），非 amount×odds。
//
// 开奖不信前端：drawMatch(rng) 用注入的 seededRng（HMAC 派生 [0,1)），主 20 珠先抽、客 20 珠后抽
//    （各部分 FY 80→20，共 40 次 rng），seededRng 的 counter 续熵支持。52-bit floor 偏差可忽略。
import crypto from 'crypto';

// 开奖：主客各自独立 80 池部分 FY 抽 20（home 先 away 后）。rng 由 makeSeededRng 注入。逐位照抄前端。
export function drawMatch(rng) {
  const draw20 = () => {
    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let k = 0; k < 20; k++) {
      const j = k + Math.floor(rng() * (80 - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    return pool.slice(0, 20);
  };
  const home20 = draw20();
  const away20 = draw20();
  return { home20, away20 };
}

// 派生：半场 = 前 10 珠和；全场 = 20 珠累计和。逐位照抄前端。
const sumOf = (a) => a.reduce((x, y) => x + y, 0);
export function deriveMatch({ home20, away20 }) {
  const htHome = sumOf(home20.slice(0, 10));
  const htAway = sumOf(away20.slice(0, 10));
  const ftHome = sumOf(home20);
  const ftAway = sumOf(away20);
  return {
    home20, away20,
    htHome, htAway, htTotal: htHome + htAway,
    ftHome, ftAway, ftTotal: ftHome + ftAway,
  };
}

// 赔率配置表（逐位照抄前端）：胜负/单双 1.95 / 小盘 1.92 / 半全场同向 2.65 / 反转 7.1。
export const ODDS = { main: 1.95, side: 1.95, small: 1.92, htftSame: 2.65, htftFlip: 7.1 };
const HT_BIG = 811, FT_BIG = 1621;

// 盘区判定表（逐位照抄前端）：12 键 + 半全场 4 键 = 16 键。hit = 赢；push = 退注。
export const MARKETS = {
  'ht-home': { odds: ODDS.main, hit: (r) => r.htHome > r.htAway, push: (r) => r.htHome === r.htAway },
  'ht-away': { odds: ODDS.main, hit: (r) => r.htAway > r.htHome, push: (r) => r.htHome === r.htAway },
  'ft-home': { odds: ODDS.main, hit: (r) => r.ftHome > r.ftAway, push: (r) => r.ftHome === r.ftAway },
  'ft-away': { odds: ODDS.main, hit: (r) => r.ftAway > r.ftHome, push: (r) => r.ftHome === r.ftAway },
  'ht-big': { odds: ODDS.side, hit: (r) => r.htTotal >= HT_BIG },
  'ht-small': { odds: ODDS.small, hit: (r) => r.htTotal < HT_BIG },
  'ht-odd': { odds: ODDS.side, hit: (r) => r.htTotal % 2 === 1 },
  'ht-even': { odds: ODDS.side, hit: (r) => r.htTotal % 2 === 0 },
  'ft-big': { odds: ODDS.side, hit: (r) => r.ftTotal >= FT_BIG },
  'ft-small': { odds: ODDS.small, hit: (r) => r.ftTotal < FT_BIG },
  'ft-odd': { odds: ODDS.side, hit: (r) => r.ftTotal % 2 === 1 },
  'ft-even': { odds: ODDS.side, hit: (r) => r.ftTotal % 2 === 0 },
};
// 半全场四键：严格不等判胜（任一段平局 hit 必假），push 四键共用同一判定（HT 平或 FT 平）。
const htftPush = (r) => r.htHome === r.htAway || r.ftHome === r.ftAway;
Object.assign(MARKETS, {
  'ht-ft-hh': { odds: ODDS.htftSame, hit: (r) => r.htHome > r.htAway && r.ftHome > r.ftAway, push: htftPush },
  'ht-ft-ha': { odds: ODDS.htftFlip, hit: (r) => r.htHome > r.htAway && r.ftAway > r.ftHome, push: htftPush },
  'ht-ft-ah': { odds: ODDS.htftFlip, hit: (r) => r.htAway > r.htHome && r.ftHome > r.ftAway, push: htftPush },
  'ht-ft-aa': { odds: ODDS.htftSame, hit: (r) => r.htAway > r.htHome && r.ftAway > r.ftHome, push: htftPush },
});
const MARKET_KEYS = Object.keys(MARKETS);

/** 给定派生结果 r，返回命中的盘口 key 集合。 */
export function hitsOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].hit(r)));
}

/** 给定派生结果 r，返回 push（退注）的盘口 key 集合。首个真用 push 的游戏。 */
export function pushesOf(r) {
  return new Set(MARKET_KEYS.filter((k) => MARKETS[k].push?.(r)));
}

/** 合法盘口 key 校验。 */
export function isValidMarketKey(key) {
  return Object.prototype.hasOwnProperty.call(MARKETS, key);
}

// DerbyDay 【有 push】：H/A 平局 + 半全场任一半平局退注。通用 handler push 分支靠此。
export const HAS_PUSH = true;

/** 通用轮次 handler 接口：开奖 + 派生 + 命中 + 退注。返回 { drawResult, hits:Set, pushes:Set }。 */
export function spin(rng) {
  const { home20, away20 } = drawMatch(rng);
  const r = deriveMatch({ home20, away20 });
  return {
    drawResult: {
      home20, away20,
      htHome: r.htHome, htAway: r.htAway, htTotal: r.htTotal,
      ftHome: r.ftHome, ftAway: r.ftAway, ftTotal: r.ftTotal,
    },
    hits: hitsOf(r),
    pushes: pushesOf(r),
  };
}

export function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}
export function newServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}
export function newClientSeed() {
  return crypto.randomBytes(8).toString('hex');
}
