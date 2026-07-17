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

export const round2 = (x) => Math.round(x * 100) / 100;

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
};

// 逐 key 三态复算（与 settleRound 341-354 逐字节同口径）：返回 { yourResult, rawTotalPayout }
export function computeDetail(gameName, selections, drawResult) {
  const { e, hp } = ENGINES[gameName];
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
