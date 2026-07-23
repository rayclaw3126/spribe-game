// 结算复算共享件：从 rounds.result 的原始 draw 字段 re-derive → 逐 key 三态 → 注行级钳制。
//
// 单一出处：本模块是「非正常结算路径」（scripts/repair_stuck_bets.mjs 补派 / roundHub recoverOrphans
//   孤儿注恢复）复算判定的唯一来源，与 settleRound 同口径。禁在调用方手写第二份赔率/规则。
//
// 复算铁律：判定必走服务端权威引擎 helper（server/src/game/*），从 rounds.result 的原始 draw 字段
//   re-derive → hitsOf/pushesOf → 逐 key 三态 → 注行级钳制（与 settleRound 同一 SQL LEAST 公式），
//   禁手写第二份赔率/规则。settled 轮缺 result 即停手上报该行，禁默认 0。
import { query } from '../db.js';
import { maxPayoutFor } from '../lib/risk.js';
import * as speedGrid from './speedGrid.js';
import * as numberUp from './numberUp.js';
import * as hatTrick from './hatTrick.js';
import * as halfTime from './halfTime.js';
import * as wuXing from './wuXing.js';
import * as lineUp from './lineUp.js';
import * as derbyDay from './derbyDay.js';
import * as goldenBoot from './goldenBoot.js';
import * as dominoDuel from './dominoDuel.js';
// #公期化 单1c：滚球是唯一「一局多球 + 动态赔率」的 bespoke 款，复算走本文件的双口径分支。
import * as rollingBall from './rollingBall.js';

export const round2 = (x) => Math.round(x * 100) / 100;

// 停手型错误（照 drawOf 的 err.stuck 约定）：调用方一律记错上报 + 跳过该行，禁默认 0 / 禁猜。
function stuckErr(msg) {
  const err = new Error(msg);
  err.stuck = true;
  return err;
}

// gameName(DB 小写) → { e:引擎, hp:(drawResult)=>{hits,pushes} 用引擎 deriveX re-derive }
export const ENGINES = {
  speedgrid: { e: speedGrid, hp: (d) => ({ hits: speedGrid.hitsOf(d.n), pushes: new Set() }) },
  numberup: { e: numberUp, hp: (d) => ({ hits: numberUp.hitsOf(numberUp.deriveNum(d.num)), pushes: new Set() }) },
  hattrick: { e: hatTrick, hp: (d) => ({ hits: hatTrick.hitsOf(hatTrick.deriveRoll(d.dice)), pushes: new Set() }) },
  halftime: { e: halfTime, hp: (d) => ({ hits: halfTime.hitsOf(halfTime.deriveRound(d.balls)), pushes: new Set() }) },
  wuxing: { e: wuXing, hp: (d) => ({ hits: wuXing.hitsOf(wuXing.deriveRound(d.balls)), pushes: new Set() }) },
  lineup: { e: lineUp, hp: (d) => ({ hits: lineUp.hitsOf(lineUp.deriveRound(d.grid)), pushes: new Set() }) },
  derbyday: { e: derbyDay, hp: (d) => { const r = derbyDay.deriveMatch({ home20: d.home20, away20: d.away20 }); return { hits: derbyDay.hitsOf(r), pushes: derbyDay.pushesOf(r) }; } },
  goldenboot: { e: goldenBoot, hp: (d) => ({ hits: goldenBoot.hitsOf(goldenBoot.deriveRace(d.ranking)), pushes: new Set() }) },
  dominoduel: { e: dominoDuel, hp: (d) => { const r = dominoDuel.deriveRound(d.tiles); return { hits: dominoDuel.hitsOf(r), pushes: dominoDuel.pushesOf(r) }; } },
  // —— #公期化 单1c：滚球 bespoke 双口径。上面 9 款是「一局一个 drawResult + 静态 MARKETS 表」，
  //    滚球两条都不成立（一局三球、赔率随剩余池逐球演化），故不给 hp，改给 detail(round, bet)：
  //    computeDetail 的三参签名（gameName, selections, drawResult）装不下它——老 per-player 局
  //    一局 3 个 bets 行对应 3 颗球，必须靠 bet.idempotency_key 才能定位本行是哪一颗。
  //    调用方一律走下面的 detailFor(round, bet) 分发器，别直接摸这里。
  rollingball: { e: rollingBall, bespoke: true, detail: (round, bet) => computeRollingBallDetail(round, bet) },
};

// 逐 key 三态复算（与 settleRound 341-354 逐字节同口径）：返回 { yourResult, rawTotalPayout }
export function computeDetail(gameName, selections, drawResult) {
  const { e, hp } = ENGINES[gameName];
  // bespoke 款（滚球）没有 hp：走 detailFor 分发器，别从这里进——早抛比 hp is not a function 清楚。
  if (!hp) throw stuckErr(`${gameName} 是 bespoke 复算款，请走 detailFor(round, bet)`);
  const { hits, pushes } = hp(drawResult);
  const yourResult = [];
  let raw = 0;
  for (const [key, amt] of Object.entries(selections || {})) {
    const a = Number(amt);
    if (!e.isValidMarketKey(key)) continue;
    if (hits.has(key)) { const p = round2(a * e.MARKETS[key].odds); yourResult.push({ key, outcome: 'hit', payout: p }); raw += p; }
    else if (e.HAS_PUSH && pushes.has(key)) { yourResult.push({ key, outcome: 'push', payout: a }); raw += a; }
    else { yourResult.push({ key, outcome: 'lose', payout: 0 }); }
  }
  return { yourResult, rawTotalPayout: raw };
}
// 钳制：与 settleRound 同一 SQL LEAST(round(raw,2), maxPayout)，保分毫一致
export async function capPayout(gameName, raw) {
  const maxP = String(maxPayoutFor(gameName));
  const r = await query('SELECT LEAST(round($1::numeric, 2), $2::numeric) AS payout', [String(raw), maxP]);
  return r.rows[0].payout; // string
}
// settled 轮取 result.drawResult；缺失即抛（禁默认 0）
export function drawOf(round) {
  const res = round.result;
  if (!res || !res.drawResult) { const err = new Error(`round ${round.id} settled 但 result/drawResult 缺失`); err.stuck = true; throw err; }
  return res.drawResult;
}

// ============ #公期化 单1c：滚球双口径复算 ============
//
// 两种局型靠 result.v 分流（公期局 roundHub persistRevealed 落 v:2，老 per-player 局无此字段）：
//
//   · v:2 公期局：全场共享一局三球，注单是复合 key（b1:/b2:/b3:），赔率由 hitsForBalls 逐球现算
//     —— 与 roundHub 的 settle 段【同一个函数同一份 oddsByKey】，故复算必然等于实付。
//     三球不齐一律停手（缺球残局是 recoverOrphans 退 void 的活，本路径只补 settled 局，绝不错结）。
//
//   · v1 老 per-player 局：一局 3 个 bets 行对应 result.balls 三颗球，注单是裸 key。
//     定位：按 bet.idempotency_key 在 balls[] 里找 idempotencyKey 相同的那一颗（老 handler 每球
//     一个幂等键，落库时原样记进了 ballEntry）。赔率【用引擎权威函数现算】
//     oddsFor(key, idx, revealed.slice(0, idx))，不抄落库的 bets[key].odds；再与落库锁定值交叉
//     核对，不一致即停手报错——绝不按与当时不同的赔率补派。
//
// 返回结构与 computeDetail 完全一致 { yourResult, rawTotalPayout }，上层钳制/派彩路径零改。
export function computeRollingBallDetail(round, bet) {
  const res = round.result;
  if (!res) throw stuckErr(`round ${round.id} settled 但 result 缺失`);
  const revealed = Array.isArray(res.revealed) ? res.revealed : null;
  if (!revealed) throw stuckErr(`round ${round.id} result.revealed 缺失或非数组`);
  const selections = bet.selections || {};

  // —— v:2 公期局 ——
  if (res.v === 2) {
    if (revealed.length !== 3) {
      throw stuckErr(`round ${round.id} 公期局只开出 ${revealed.length}/3 球（缺球残局归 recoverOrphans 退 void，补派脚本不补结）`);
    }
    const { hits, oddsByKey } = rollingBall.hitsForBalls(revealed);
    const yourResult = [];
    let raw = 0;
    for (const [key, amt] of Object.entries(selections)) {
      const a = Number(amt);
      if (!rollingBall.isValidBallKey(key)) continue;   // 非复合 key：防御跳过（与 settleRound 同口径）
      const odds = oddsByKey[key];
      if (hits.has(key) && odds != null) {
        const p = round2(a * odds);
        yourResult.push({ key, outcome: 'hit', payout: p });
        raw += p;
      } else {
        yourResult.push({ key, outcome: 'lose', payout: 0 });
      }
    }
    return { yourResult, rawTotalPayout: raw };
  }

  // —— v1 老 per-player 局 ——
  const ballsArr = Array.isArray(res.balls) ? res.balls : null;
  if (!ballsArr || ballsArr.length === 0) throw stuckErr(`round ${round.id} 老式滚球局 result.balls 缺失或为空`);
  const entry = ballsArr.find((x) => x && x.idempotencyKey === bet.idempotency_key);
  if (!entry) {
    throw stuckErr(`round ${round.id} bet#${bet.id} 在 result.balls 里定位不到对应球（idempotencyKey 对不上）—— 停手待人工核`);
  }
  const idx = Number(entry.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx > 2) throw stuckErr(`round ${round.id} bet#${bet.id} 球序 idx=${entry.idx} 非法`);
  if (!Number.isInteger(entry.ball)) throw stuckErr(`round ${round.id} bet#${bet.id} 球号缺失`);
  if (revealed.length <= idx || revealed[idx] !== entry.ball) {
    throw stuckErr(`round ${round.id} bet#${bet.id} revealed 与 balls[${idx}].ball 对不上（revealed=${JSON.stringify(revealed)} ball=${entry.ball}）`);
  }
  const before = revealed.slice(0, idx);   // 本球开出前的已开号（无放回演化）
  const yourResult = [];
  let raw = 0;
  for (const [key, amt] of Object.entries(selections)) {
    const a = Number(amt);
    if (!rollingBall.isValidKey(key)) continue;   // 老局是裸 key
    const odds = rollingBall.oddsFor(key, idx, before);   // 权威现算，禁抄落库值
    if (odds == null) throw stuckErr(`round ${round.id} bet#${bet.id} key ${key} 在第 ${idx + 1} 球不可押（已开号/池耗尽）—— 停手待人工核`);
    const locked = entry.bets?.[key]?.odds;
    if (locked != null && round2(Number(locked)) !== round2(odds)) {
      throw stuckErr(`round ${round.id} bet#${bet.id} key ${key} 现算赔率 ${odds} ≠ 落库锁定 ${locked} —— 停手待人工核，绝不按不同赔率补派`);
    }
    if (rollingBall.hitOf(key, entry.ball)) {
      const p = round2(a * odds);
      yourResult.push({ key, outcome: 'hit', payout: p });
      raw += p;
    } else {
      yourResult.push({ key, outcome: 'lose', payout: 0 });
    }
  }
  return { yourResult, rawTotalPayout: raw };
}

/**
 * 复算分发器（单一入口）：常规 9 款走 drawOf + computeDetail 三参老路（逐字节不变），
 * bespoke 款（滚球）走 ENGINES[game].detail(round, bet)。
 * @param {{id:any, game:string, result:any}} round - 需带 game 与 result
 * @param {{id:any, selections:any, idempotency_key?:string}} bet - 需带 selections；老滚球局还需 idempotency_key
 */
export function detailFor(round, bet) {
  const e = ENGINES[round.game];
  if (!e) throw stuckErr(`round ${round.id} 的游戏 ${round.game} 未接入复算表`);
  if (e.detail) return e.detail(round, bet);
  return computeDetail(round.game, bet.selections, drawOf(round));
}
