// 单V3a/V3b：模型A per-player 款（即时 6 + 多步 3）本地重算派生注册表。
//   · 即时 6 款（V3a）：dice/plinko/limbo/keno/streakRoll/miniRoulette —— 一次请求派生完。
//   · 多步 3 款（V3b）：mines/hilo/goal —— 状态逐步展开，派生按 step/col 分次算。
// 文件名保留 instantVerify（不改名防 churn），语义已扩为「模型A per-player 款」。
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
import { deriveMines } from '../../../server/src/game/mines.js';
import { deriveCard } from '../../../server/src/game/hilo.js';
import { deriveBombRows, TIERS } from '../../../server/src/game/goal.js';
import { generateCrash } from '../../../server/src/game/aviator.js';
import { walkPath } from '../../../server/src/game/momentum.js';
import { drawBall, remainingPool } from '../../../server/src/game/rollingBall.js';
import { makeSeededRng } from '../../../server/src/lib/seededRng.js';

// backendId → { fields, needs, derive, manualOk? }
// manualOk（默认 true）：能否走 SeedFairness 的【手填】路径（只给 seed/client/nonce + needs，无 result）。
//   goal=false —— 它的靶 result.bombRows 本身就在局记录里，手填等于让玩家自己抄答案再对答案，
//   毫无意义；goal 只走「验整局」（按 roundId 拉 result）路径。
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

  // ───────── 单V3b 多步 3 款 ─────────
  // 多步款的 result 里混着玩家输入（mineCount/tier/picks）、结算产物（cum）与派生产物；
  // 只列派生产物作靶，其余进 needs 或干脆不碰。

  // mines：整副雷位在建局时就落 result（活局期由 safeResultForView 白名单剥除），终局可整副验。
  mines: {
    fields: ['mines'], needs: [{ key: 'mineCount', label: '雷数 mineCount' }],
    derive: (s, c, n, x) => ({ mines: deriveMines(s, c, n, Number(x?.mineCount)) }),
  },

  // hilo：牌序由 step 逐张派生。result 存 card（=第 step 张）与 history[j].n（=第 j+1 张）。
  //   ⚠ history[j].n 是【该步抽出的牌】，不是该步的明牌——差一位就全红（实测 11/11 局确认）。
  //   skip 与 guess 都各消耗一个 step、都进 history，故 history 与 step 的对应不受 skip 影响。
  hilo: {
    fields: ['card', 'history'], needs: [{ key: 'step', label: '步数 step' }],
    derive: (s, c, n, x) => {
      const step = Number(x?.step);
      const seq = [];
      for (let i = 0; i <= step; i++) seq.push(deriveCard(s, c, n, i));
      // 只重建 n（抽出的牌）；dir/correct 是玩家动作与判定，不是派生产物，原样回填以便逐字段深比。
      const hist = (Array.isArray(x?.history) ? x.history : []).map((h, j) => ({ ...h, n: seq[j + 1] }));
      return { card: seq[step], history: hist };
    },
  },

  // goal：按列独立派生。单V3b 起 /goal/pick 把【已走列】雷行落进 result.bombRows。
  //   两种终局形状不同，故 fields 是【函数】而非定值：
  //     · cashed：bombRows = 走过的每一列
  //     · bust  ：bombRows = 出事【之前】的各列（bust 路径不往里追加），出事那列单独存 bombs
  //   老 cashed 局（补落上线前）无 bombRows → derive 抛错 → 上层显「缺要素」，预期分叉。
  //   未来列雷行【永不落库】，故本地重算也只验已走列——与服务端同一不变量。
  //   ⚠ 顺序铁律：不排序。落库存的是 `[...bombSet]`（Fisher-Yates 洗出的插入序），
  //     排序会让深比假红；引擎确定性保证同输入同顺序，原样比即可。
  goal: {
    manualOk: false,   // 靶在 result 里，手填无意义 —— 只走「验整局」
    fields: (r) => (r?.bustCol != null ? ['bombRows', 'bombs'] : ['bombRows']),
    needs: [{ key: 'tier', label: '档位 tier（sm/md/lg）' }],
    derive: (s, c, n, x) => {
      const bombs = TIERS[x?.tier]?.bombs;
      if (!bombs) throw new Error('缺 tier');
      if (!Array.isArray(x?.bombRows)) throw new Error('本局无 bombRows（补落上线前的老局），缺重算要素');
      const out = { bombRows: x.bombRows.map((_, col) => [...deriveBombRows(s, c, n, col, bombs)]) };
      // bust 局：出事那列（列号 = bustCol）的雷行单独比 result.bombs
      if (x.bustCol != null) out.bombs = [...deriveBombRows(s, c, n, x.bustCol, bombs)];
      return out;
    },
  },
};

// ───────── 单V3c 收官 3 款 ─────────

// aviator（共享局 crash）：整局唯一派生产物 = crashPoint。
//   消费面 = CommitRevealFairness（done reveal 后拿 serverSeed），【不走 roundId 路径】——
//   共享局 rounds.player_id 恒 NULL，GET /:id 的归属校验一律 404，这是正确后果不是 bug。
INSTANT_VERIFY.aviator = {
  fields: ['crashPoint'], needs: [],
  derive: (s, c, n) => ({ crashPoint: generateCrash(s, c, n) }),
};

// momentum（共享局 crash）：整条 31 柱路径。
//   ⚠ 靶必须取 done 广播里的【权威 bars】（momentumHub:182 推 {bars, crashBar, finalX} 全带），
//     【不能】用页面累积的 barsRef —— 中途加入/断线重连的玩家累积序列是残缺的，
//     拿残缺序列比整条 walkPath 会把好局判成作弊（制造冤案，比不验更糟）。
//   done 快照（在 done 相位才进场）只给 crashBar/finalX 不给 bars，故 fields 动态：
//     有 bars → 整条比（含每柱 f）；无 bars → 退化为只比 crashBar+finalX（仍是真比对，不是展示）。
INSTANT_VERIFY.momentum = {
  fields: (r) => (Array.isArray(r?.bars) ? ['bars', 'crashBar', 'finalX'] : ['crashBar', 'finalX']),
  needs: [],
  derive: (s, c, n) => walkPath(s, c, n),   // 返回 { bars:[{barIdx,f,x}], crashBar, finalX }，与 done payload 同形
};

// rollingball（per-player 多球）：按步现派，每球一个 nonce、从剩余池无放回抽。
//   派生层 drawBall(remaining, rng) 本就注入共享 makeSeededRng（单V3c 前就已同构）。
//   逐球重演：remaining 随已开球演化 → 每球用自己的 balls[i].nonce 单抽 → 与 result.revealed 逐位比。
//   ⚠ 顺序铁律：remaining 必须按【开球顺序】演化，不能一次性去掉全部 revealed 再抽 ——
//     那样池子不同，抽出来的球也不同（无放回的本质）。
//   消费面 = SeedFairness 验整局（RollingBall.jsx:706 已传 game；rounds.player_id 非空 → GET /:id 可用）。
INSTANT_VERIFY.rollingball = {
  fields: ['revealed'], needs: [{ key: 'balls', label: '本局球序（自动从记录取）' }],
  derive: (s, c, n, x) => {
    const balls = Array.isArray(x?.balls) ? x.balls : [];
    const out = [];
    for (const b of balls) {
      const rng = makeSeededRng(s, c, b.nonce);          // 每球一把独立 rng（key 带该球自己的 nonce）
      out.push(drawBall(remainingPool(out), rng));       // 池子按已开球演化
    }
    return { revealed: out };
  },
};

/** 取某局要比对的字段名：fields 可为定值数组，也可为 (result)=>string[]（形状随终局而变的款，如 goal/momentum）。 */
export const fieldsOf = (spec, result) => (typeof spec.fields === 'function' ? spec.fields(result) : spec.fields);
