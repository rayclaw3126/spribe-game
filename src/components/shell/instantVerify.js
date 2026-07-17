// 单V3a：即时 6 款（dice/plinko/limbo/keno/streakRoll/miniRoulette）本地重算派生注册表。
//
// 铁律·单一出处：derive 全部【直 import 服务端引擎导出】——前端禁手抄第二份公式。
// 原 src/lib/fairVerify.js 是手抄的 dice 公式（crypto.subtle 异步版），已随本单删除。
// 哈希走 lib/seededRng.js 的同构件（浏览器纯 JS 分支 / Node 原生分支逐位等价，
// 由 server/scripts/_isocrypto_parity.mjs 硬闸兜底）。
//
// ⚠ 为什么独立成文件、不并进 LocalVerify.jsx：
//   LocalVerify.jsx 是【懒加载】件（两抽屉 lazy import），而 SeedFairness.jsx 被 11 个游戏页
//   【静态 import】。若注册表寄居在 LocalVerify.jsx，SeedFairness 一引就会把 LocalVerify 连同
//   ROUND_SPINS + 排期器 9 款引擎全拖进每个游戏页的包（Dice 页平白打进 9 款轮次引擎）。
//   独立后本文件只依赖即时 6 款引擎，与 roundSpins 彻底解耦。
//   （附带好处：LocalVerify.jsx 回归「只导出组件」，不触 react-refresh/only-export-components。）
import { rollDice } from '../../../server/src/game/dice.js';
import { derivePath } from '../../../server/src/game/plinko.js';
import { deriveMult } from '../../../server/src/game/limbo.js';
import { drawKeno } from '../../../server/src/game/keno.js';
import { drawStreak } from '../../../server/src/game/streakRoll.js';
import { spinRoulette } from '../../../server/src/game/miniRoulette.js';

// backendId → { fields, needs, derive }
// fields：本地可重算、且要与 result 比对的字段名（= round.js 落 result JSONB 时的键名）。
//   ⚠ 只列【派生产物】。result 里的 target/direction/win/mult/selected/bets 等不是随机派生的——
//   它们要么是玩家输入的回显，要么是结算算出来的；拿它们比对证明不了开奖公平，只会制造噪音。
// needs：派生还需要的【玩家输入】（本身不是派生产物），LocalVerify 从 result 回显取、
//   SeedFairness（手填式，无 result）渲染成输入格让玩家填。
//   plinko 的 rows、streak 的 risk 属此类：它们决定派生形状，但是玩家下注时自己选的。
// derive：(serverSeed, clientSeed, nonce, extra) → { 字段名: 重算值 }，直调引擎导出。
export const INSTANT_VERIFY = {
  dice: { fields: ['roll'], needs: [], derive: (s, c, n) => ({ roll: rollDice(s, c, n) }) },
  limbo: { fields: ['finalMult'], needs: [], derive: (s, c, n) => ({ finalMult: deriveMult(s, c, n) }) },
  roulette: { fields: ['n'], needs: [], derive: (s, c, n) => ({ n: spinRoulette(s, c, n) }) },
  keno: { fields: ['drawn'], needs: [], derive: (s, c, n) => ({ drawn: drawKeno(s, c, n) }) },
  plinko: {
    fields: ['path'], needs: [{ key: 'rows', label: '钉盘行数 rows' }],
    derive: (s, c, n, x) => ({ path: derivePath(s, c, n, Number(x?.rows)) }),
  },
  streak: {
    fields: ['idx', 'landed'], needs: [{ key: 'risk', label: '风险档 risk（normal/high）' }],
    derive: (s, c, n, x) => { const r = drawStreak(s, c, n, x?.risk); return { idx: r.idx, landed: r.landed }; },
  },
};
