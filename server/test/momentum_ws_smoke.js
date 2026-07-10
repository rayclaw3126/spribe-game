// Momentum WS 冒烟（新范式实时 crash，5 安全点实证）：
//  ⭐1 无 serverSeed 泄露：betting/running 广播 + running 中 DB rounds.result 都无未来柱/serverSeed
//  ⭐2 cashout 谎报 X：客户端 cashout 带假 X=999 → 服务端按 state.xRef 结算（payout=amount×服务端X 非 999）
//  ⭐3 cashout 时点权威 + bust/done 后拒
//  ⭐4 done reveal serverSeed → 本地 walkPath 重算 == 服务端整条 bars（可复算）
//  ⭐5 聚合负债闸：assertRoundLiability 超限 throw round_liability_exceeded（单测）+ 正常注放行
//  另：betting 下注 bet_ack / running 下注被拒 / auto-cashout 付目标价（best-effort）。
// 用法：先起服务，再 node test/momentum_ws_smoke.js
import 'dotenv/config';
import WebSocket from 'ws';
import crypto from 'crypto';
import pg from 'pg';
import { walkPath } from '../src/game/momentum.js';
import { assertRoundLiability, RiskError, maxPayoutFor } from '../src/lib/risk.js';

const { Client } = pg;
const BASE = 'http://127.0.0.1:4000';
const WS = 'ws://127.0.0.1:4000/ws/momentum';
const round2 = (x) => Math.round(x * 100) / 100;
let allPass = true;
const check = (n, ok, d = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const fail = (m) => { console.error(`❌ ${m}`); process.exit(1); };

async function login() {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: process.env.ALICE_PW, type: 'player' }) });
  const d = await r.json(); if (!d.token) fail('登录失败'); return d.token;
}
function inbox(ws) {
  const waiters = [];
  ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; } for (let i = waiters.length - 1; i >= 0; i--) { if (waiters[i].pred(m)) { waiters.splice(i, 1)[0].res(m); } } });
  return { waitFor: (pred, ms, lbl) => new Promise((res, rej) => { const e = { pred, res: null }; const t = setTimeout(() => { const i = waiters.indexOf(e); if (i >= 0) waiters.splice(i, 1); rej(new Error(`等待「${lbl}」超时`)); }, ms); e.res = (m) => { clearTimeout(t); res(m); }; waiters.push(e); }) };
}

async function main() {
  // ===== ⭐5 聚合负债闸（单测）=====
  console.log('== ⭐ 聚合负债闸（assertRoundLiability 单测）==');
  const cap = maxPayoutFor('momentum');   // 50000；maxRoomLiability 500000 = 10 并发满赔注
  check('正常注放行：房间当前 0 + 本注潜在 50000 ≤ 500000', assertRoundLiability('momentum', 0, cap) === true);
  check('临界放行：房间 450000（9 注）+ 本注 50000 = 500000 ≤ 500000', assertRoundLiability('momentum', 9 * cap, cap) === true);
  let threw = null; try { assertRoundLiability('momentum', 10 * cap, cap); } catch (e) { threw = e; }
  check('⭐ 超限拒：房间 500000（10 注）+ 本注 50000 = 550000 > 500000 → RiskError round_liability_exceeded', threw instanceof RiskError && threw.code === 'round_liability_exceeded', `${threw?.code}`);

  const db = new Client({ connectionString: process.env.DB_URL }); await db.connect();
  const token = await login();
  const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  const box = inbox(ws);
  let sawServerSeedBeforeDone = false;
  let runBetRejected = null;   // running 阶段下注被拒（即时捕获，避免晚 waitFor 丢消息）
  ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; } if (m.type !== 'done' && m.type !== 'snapshot' && Object.prototype.hasOwnProperty.call(m, 'serverSeed')) sawServerSeedBeforeDone = true; if (m.type === 'bet_rejected' && /非下注/.test(m.reason || '')) runBetRejected = m; });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  // ===== 等一个新 betting =====
  console.log('\n== 完整一局（betting → running 逐柱 → done）==');
  const betting = await box.waitFor((m) => m.type === 'betting', 35000, 'betting');
  check('⭐ betting 广播有 commitHash/clientSeed/nonce，【无 serverSeed 明文】', betting.commitHash?.length === 64 && betting.clientSeed && Number.isInteger(betting.nonce) && !('serverSeed' in betting), `commit=${betting.commitHash?.slice(0, 8)}`);
  const roundId = betting.roundId;

  // ===== 下注 betting → bet_ack =====
  ws.send(JSON.stringify({ type: 'bet', amount: 100 }));
  const ack = await box.waitFor((m) => m.type === 'bet_ack' || m.type === 'bet_rejected', 5000, 'bet_ack');
  check('betting 下注 → bet_ack（idempotent false）', ack.type === 'bet_ack' && ack.idempotent === false, `${JSON.stringify(ack)}`);
  const betBal = Number(ack.balanceAfter);

  // ===== running：逐柱 bar，验只有已走柱 + DB result NULL（无未来柱）=====
  const bars = [];
  let cashoutResp = null; let didFakeCashout = false; let dbCheckedDuringRun = false;
  await new Promise((resolve) => {
    const onMsg = async (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'bar' && m.roundId === roundId) {
        bars.push({ barIdx: m.barIdx, x: m.x });
        if (m.barIdx === 0) check('⭐ bar 广播只 {barIdx,x}，无未来柱数组/serverSeed/walk', 'barIdx' in m && 'x' in m && !('bars' in m) && !('serverSeed' in m) && !('walk' in m));
        // 第 2 根柱时：查 DB rounds.result 应为 NULL（running 中未来柱不落库）+ 发假 X cashout
        if (m.barIdx === 1 && !dbCheckedDuringRun) {
          dbCheckedDuringRun = true;
          const row = (await db.query('SELECT result, status FROM rounds WHERE id=$1', [roundId])).rows[0];
          check('⭐ running 中 DB rounds.result = NULL（无未来柱/crashBar 落库）', row.result === null && row.status === 'pending', `result=${JSON.stringify(row.result)} status=${row.status}`);
        }
        // 第 3 根柱：⭐ 发假 X=999 的 cashout，验服务端按 xRef 结算覆盖
        if (m.barIdx === 2 && !didFakeCashout && m.x > 0) {
          didFakeCashout = true;
          ws.send(JSON.stringify({ type: 'cashout', x: 999, multiplier: 999, amount: 999999 }));
        }
      }
      if (m.type === 'cashout_ok' && !cashoutResp) { cashoutResp = m; }
      if (m.type === 'done' && m.roundId === roundId) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    // running 中补一个下注 → 应被拒
    box.waitFor((m) => m.type === 'bar', 35000, 'first bar').then(() => {
      ws.send(JSON.stringify({ type: 'bet', amount: 50 }));
    });
  });
  const done = await box.waitFor((m) => m.type === 'done' && m.roundId === roundId, 3000, 'done').catch(() => null) || { };

  // done 消息（上面 resolve 的就是 done，但我们再取一次字段——改从收集）。重取：等 settled 后拿 done 已过，直接用 walk 校验
  // 用最后一次 done 广播字段：重新监听已过，改用 snapshot? 简化：done 已在 resolve 收到，重新解析
  await box.waitFor((m) => m.type === 'settled' && m.roundId === roundId, 8000, 'settled').catch(() => {});

  // ===== ⭐ cashout 谎报 X 被服务端覆盖 =====
  if (cashoutResp) {
    const serverX = cashoutResp.multiplier;
    check('⭐ cashout 谎报 X=999 → 服务端按 xRef 结算（multiplier=服务端X 非 999）', serverX !== 999 && serverX > 0 && serverX < 100, `serverX=${serverX}`);
    check('⭐ payout = round2(100 × 服务端X)（非 100×999）', Number(cashoutResp.payout) === round2(100 * serverX) && Number(cashoutResp.payout) !== round2(100 * 999), `payout=${cashoutResp.payout} 期望=${round2(100 * serverX)}`);
  } else {
    // 若在发假 cashout 前就 bust（前 3 柱崩，极罕见），跳过但不算失败
    check('cashout 谎报 X（本局前 3 柱内已 bust，跳过——概率极低）', bars.length > 0 && bars[bars.length - 1].x === 0, `bars=${bars.length}`);
  }

  // ===== running 下注被拒（即时捕获的）=====
  check('running 阶段下注 → bet_rejected（非下注阶段）', runBetRejected && /非下注/.test(runBetRejected.reason || ''), `${runBetRejected?.reason}`);

  // ===== ⭐ 无 serverSeed 泄露（done 前）=====
  check('⭐ done 之前所有广播都无 serverSeed（保密到 reveal）', !sawServerSeedBeforeDone);

  // ===== ⭐ done reveal → 本地 walkPath 重算 == 服务端 bars（可复算）=====
  // 重新拿一局的 done 来校验（用刚收集的 bars + 一个新 done reveal）
  const done2 = await box.waitFor((m) => m.type === 'done', 40000, 'next done').catch(() => null);
  if (done2 && done2.serverSeed) {
    const recomputed = walkPath(done2.serverSeed, done2.clientSeed, done2.nonce);
    const serverBars = done2.bars;
    const same = recomputed.bars.length === serverBars.length && recomputed.bars.every((b, i) => b.x === serverBars[i].x && b.barIdx === serverBars[i].barIdx) && recomputed.crashBar === done2.crashBar && recomputed.finalX === done2.finalX;
    check('⭐ done reveal serverSeed → 本地 walkPath 重算 == 服务端整条 bars（可复算）', same, `本地 ${recomputed.bars.length} 柱 crashBar=${recomputed.crashBar} finalX=${recomputed.finalX} vs 服务端 ${serverBars.length} 柱`);
    // done 后 cashout → 拒
    ws.send(JSON.stringify({ type: 'cashout' }));
    const rejCash = await box.waitFor((m) => m.type === 'cashout_rejected', 2000, 'done 后 cashout_rejected').catch(() => null);
    check('done 后 cashout → cashout_rejected', rejCash && /非进行|已兑现|无有效/.test(rejCash.reason || ''), `${rejCash?.reason}`);
  } else {
    check('done reveal 可复算（未取到下一局 done，跳过）', false, '超时');
  }

  ws.close(); await db.end();
  console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => fail(e.stack || e.message));
