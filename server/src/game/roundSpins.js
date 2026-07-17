// 单V2：排期器 9 款「开奖派生」单一出处（spin: rng => { drawResult, hits, pushes }）。
// —— roundHub 回引本表作结算真源；前端 LocalVerify 同 import 作浏览器本地重算，
//    禁前端手抄第二份（单一出处铁律）。
// —— 本文件只是把 roundHub 原 ROOM_ENGINES.spin 的表达式【等价搬家】，钱层逻辑零变；
//    引擎（speedGrid/…/lineUp）本体零改动。
// —— 具名 import 只取派生函数（drawCar/hitsOf/spin），不引 hashSeed/newServerSeed 等
//    含 node:crypto 的种子助手 → 浏览器打包时它们连同 crypto 一并被 tree-shake（POC 已证）。
import { drawCar, hitsOf as speedGridHitsOf } from './speedGrid.js';
import { spin as numberUpSpin } from './numberUp.js';
import { spin as derbyDaySpin } from './derbyDay.js';
import { spin as dominoDuelSpin } from './dominoDuel.js';
import { spin as hatTrickSpin } from './hatTrick.js';
import { spin as goldenBootSpin } from './goldenBoot.js';
import { spin as halfTimeSpin } from './halfTime.js';
import { spin as wuXingSpin } from './wuXing.js';
import { spin as lineUpSpin } from './lineUp.js';

// key = backendId；value = (rng) => { drawResult, hits, pushes }（与 roundHub 结算契约一致）。
export const ROUND_SPINS = {
  // speedgrid 原为 roundHub 内联 spin（单随机数抽车 + hitsOf）——原样搬家。
  speedgrid: (rng) => {
    const n = drawCar(rng);
    return { drawResult: { n }, hits: speedGridHitsOf(n), pushes: new Set() };
  },
  numberup: numberUpSpin,
  derbyday: derbyDaySpin,
  dominoduel: dominoDuelSpin,
  hattrick: hatTrickSpin,
  goldenboot: goldenBootSpin,
  halftime: halfTimeSpin,
  wuxing: wuXingSpin,
  lineup: lineUpSpin,
};
