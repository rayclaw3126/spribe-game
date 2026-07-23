// #P0 补派脚本：排期器同轮多注单结算回滚遗留的卡单（outcome='pending' AND rounds.status='settled'）补派。
//
// 复算铁律：判定必走服务端权威引擎 helper（server/src/game/*），从 rounds.result 的原始 draw 字段
//   re-derive → hitsOf/pushesOf → 逐 key 三态 → 注行级钳制（与 settleRound 同一 SQL LEAST 公式），
//   禁手写第二份赔率/规则。settled 轮缺 result 即停手上报该行，禁默认 0。
//
// 硬闸（--execute 前强制）：每款先取 ≥2 条【已正常结算】真实行（≥1 win，优先单行局），用本脚本同一套
//   re-derive 复算，断言 payout == ledger 实付分毫不差；S2 后有 settle_detail 的行连明细数组一起对拍。
//   9 款全等才准 --execute；任一款不等 → 停手，禁调 adapter 硬凑。
//
// 双模式：默认/--dry-run 只打表不动钱；--execute 才补派（每行单事务 credit 键 repair-${bet.id}）。
// 用法：node scripts/repair_stuck_bets.mjs [--dry-run|--execute]
import { query, pool, withTransaction } from '../src/db.js';
import { credit } from '../src/lib/wallet.js';
// 复算四件（ENGINES/computeDetail/capPayout/drawOf）+ round2 抽到 src/game/settleDerive.js 单一出处，
// 与 roundHub recoverOrphans（孤儿注恢复）共用同一份判定，禁在本脚本回抄副本。
// #公期化 单1c：复算入口统一改走 detailFor(round, bet) 分发器——常规 9 款内部仍是原
//   drawOf + computeDetail 老路（逐字节不变），滚球走 bespoke 双口径分支（v:2 公期 / v1 老局）。
import { ENGINES, capPayout, detailFor, round2 } from '../src/game/settleDerive.js';

const EXECUTE = process.argv.includes('--execute');
const MODE = EXECUTE ? 'EXECUTE（动钱）' : 'DRY-RUN（只读）';

const GAMES = Object.keys(ENGINES);

// 明细数组对拍（key→{outcome,payout} 归一）
function detailEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const norm = arr => Object.fromEntries(arr.map(x => [x.key, `${x.outcome}:${round2(Number(x.payout))}`]));
  const na = norm(a), nb = norm(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) if (na[k] !== nb[k]) return false;
  return true;
}

// ============ 硬闸：对拍已正常结算行 ============
//
// #公期化 单1c 裁定③【样本硬闸收窄】：只对【本次卡单 population 里真出现的款】要求对拍样本。
//   原口径是「全 9 款逐款要 ≥2 样本，任一款样本不足即阻断 --execute」——加了第 10 款（滚球）后，
//   一个跟本次补派毫无关系的款样本不足，就能把其余款的补派一起锁死，这是纯粹的连坐。
//   收窄后：population 外的款【不要求样本、不复算、不影响放行】；population 内的款照旧
//   【全体阻断】（任一款对拍不等 → --execute 整体停手，绝不只跳过该款）。
//   population 为空 → 无事可做，自然放行。
async function calibrationGate(gamesInScope) {
  const scope = [...gamesInScope];
  if (scope.length === 0) {
    console.log('\n========== 硬闸对拍 ==========\n  （本次卡单 population 为空，无款需对拍，放行）');
    return true;
  }
  console.log(`\n========== 硬闸对拍（本次 population 涉及 ${scope.length} 款：${scope.join('/')}；population 外的款不要求样本）==========`);
  let allPass = true;
  for (const game of scope) {
    // 取该款【单行局】已结算行（一 round 一 player 一 bet），≥1 win 优先；带 result
    const rows = (await query(`
      SELECT b.id, b.player_id, b.round_id, b.amount, b.outcome, b.selections, b.settle_detail,
             b.idempotency_key, r.result
      FROM bets b JOIN rounds r ON r.id = b.round_id
      WHERE r.game = $1 AND r.status = 'settled' AND r.result IS NOT NULL AND b.outcome IN ('win','lose')
        AND b.selections IS NOT NULL   -- 只对排期器格式(selections {key:amt})对拍；排除排期器上线前的老式 per-player 局(selections NULL，另一套结算路径，非本补派 population)
        AND b.round_id IN (SELECT round_id FROM bets GROUP BY round_id, player_id HAVING count(*) = 1)
      ORDER BY (b.outcome='win') DESC, b.id DESC LIMIT 4
    `, [game])).rows;
    if (rows.length < 2 || !rows.some(r => r.outcome === 'win')) {
      console.log(`  ⚠ ${game}: 可对拍样本不足（${rows.length} 行, win=${rows.filter(r => r.outcome === 'win').length}）—— 硬闸不放行`);
      allPass = false; continue;
    }
    let gamePass = true;
    for (const b of rows.slice(0, 2).concat(rows.filter(r => r.outcome === 'win').slice(0, 1))) {
      let recomputed, capped;
      try {
        recomputed = detailFor({ id: b.round_id, game, result: b.result }, b);
        capped = await capPayout(game, recomputed.rawTotalPayout);
      } catch (err) { console.log(`  ❌ ${game} bet#${b.id}: 复算异常 ${err.message}`); gamePass = false; allPass = false; continue; }
      const led = (await query(`SELECT COALESCE(SUM(amount),0) AS p FROM ledger WHERE player_id=$1 AND round_id=$2 AND type=$3`, [b.player_id, b.round_id, `${game}_payout`])).rows[0].p;
      const payMatch = round2(Number(capped)) === round2(Number(led));
      const detMatch = b.settle_detail == null ? '(无detail跳过)' : (detailEq(recomputed.yourResult, b.settle_detail) ? '明细全等' : '明细★不等★');
      if (!payMatch || detMatch === '明细★不等★') { gamePass = false; allPass = false; }
      console.log(`  ${payMatch && detMatch !== '明细★不等★' ? '✅' : '❌'} ${game} bet#${b.id} ${b.outcome}: 复算payout=${round2(Number(capped))} vs ledger实付=${round2(Number(led))} ${payMatch ? '全等' : '★不等★'}; ${detMatch}`);
    }
    if (gamePass) console.log(`  —— ${game} 对拍通过`);
  }
  console.log(`\n硬闸结论：${allPass ? `✅ 本次涉及的 ${scope.length} 款全等，放行` : '❌ 有款不等/样本不足，阻断 --execute'}`);
  return allPass;
}

// ============ 卡单 population（先查，供硬闸按需收窄；裁定③）============
async function fetchStuck() {
  const stuck = (await query(`
    SELECT b.id, b.player_id, p.username, b.round_id, r.game, r.round_no, b.amount, b.selections,
           b.idempotency_key, r.result, b.settle_detail
    FROM bets b JOIN rounds r ON r.id = b.round_id JOIN players p ON p.id = b.player_id
    WHERE b.outcome = 'pending' AND r.status = 'settled' AND r.game = ANY($1)
      AND b.selections IS NOT NULL   -- 防御护栏：只补排期器格式局；老式 per-player(selections NULL) 不在本 population，单列不动
    ORDER BY r.game, b.round_id, b.id
  `, [GAMES])).rows;
  // 老式 NULL-selections 的卡单单独统计（本脚本不处理，避免误算成 0）
  const legacyNull = (await query(`SELECT count(*) AS n FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.outcome='pending' AND r.status='settled' AND r.game = ANY($1) AND b.selections IS NULL`, [GAMES])).rows[0].n;
  return { stuck, legacyNull: Number(legacyNull) };
}

// ============ 卡单补派 ============
async function repairStuck(gatePassed, stuck, legacyNull) {
  console.log('\n========== 卡单清单（outcome=pending AND rounds.status=settled）==========');
  if (legacyNull > 0) console.log(`  ⚠ 另有 ${legacyNull} 条老式(selections NULL) 卡单不在本补派范围（需人工核，非排期器格式）`);
  if (stuck.length === 0) { console.log('  （无卡单）'); return; }

  const loseRows = [];
  let totalCredit = 0, nWin = 0, nLose = 0, nErr = 0;
  for (const b of stuck) {
    let det, capped;
    try {
      det = detailFor({ id: b.round_id, game: b.game, result: b.result }, b);
      capped = await capPayout(b.game, det.rawTotalPayout);
    } catch (err) { console.log(`  ❌ bet#${b.id} ${b.game} ${b.round_no}: ${err.message} —— 停手上报，跳过该行`); nErr++; continue; }
    const win = Number(capped) > 0;
    const hitKeys = det.yourResult.filter(x => x.outcome !== 'lose').map(x => `${x.key}(${x.outcome})`).join(',') || '(无)';
    console.log(`  ${win ? '💰' : '·'} bet#${b.id} ${b.username} ${b.game} ${b.round_no} 注$${b.amount} → 应派$${round2(Number(capped))}  中/退:${hitKeys}`);
    if (win) {
      nWin++; totalCredit = round2(totalCredit + Number(capped));
      if (EXECUTE && gatePassed) {
        await withTransaction(async (client) => {
          const flip = await client.query(`UPDATE bets SET outcome='win', settle_detail=$2 WHERE id=$1 AND outcome='pending' RETURNING id`, [b.id, JSON.stringify(det.yourResult)]);
          if (flip.rowCount === 0) return; // 并发已被结算
          await credit(client, { playerId: b.player_id, amount: capped, type: `${b.game}_payout`, idempotencyKey: `repair-${b.id}`, roundId: b.round_id });
        });
      }
    } else {
      // 口径：settled 轮分成可能已发生（P0 回滚逐行不可知），禁自动补写，人工核
      //   —— 与 recoverOrphans（drawn 轮分成确定未发生，自动补发）是刻意不对称，见 settleDerive 单
      nLose++; loseRows.push({ id: b.id, username: b.username, game: b.game, round_no: b.round_no, amount: b.amount });
      if (EXECUTE && gatePassed) {
        await withTransaction(async (client) => {
          await client.query(`UPDATE bets SET outcome='lose', settle_detail=$2 WHERE id=$1 AND outcome='pending'`, [b.id, JSON.stringify(det.yourResult)]);
        });
      }
    }
  }
  console.log(`\n卡单汇总：共 ${stuck.length} 行 → win ${nWin}（补派合计 $${totalCredit}）/ lose ${nLose}（仅解卡不补分成）/ 复算异常 ${nErr}`);
  if (loseRows.length) {
    console.log('\n【复算=lose 的卡单——代理分成是否后补由 Ray 决定】');
    loseRows.forEach(r => console.log(`  bet#${r.id} ${r.username} ${r.game} ${r.round_no} 注$${r.amount}`));
  }
  if (EXECUTE && !gatePassed) console.log('\n⛔ 硬闸未通过，--execute 被阻断，未动任何钱。');
  if (!EXECUTE) console.log('\n（DRY-RUN：以上为预演，未动任何钱。加 --execute 且硬闸通过才补派。）');
}

console.log(`repair_stuck_bets —— 模式：${MODE}`);
// 裁定③：先查 population，硬闸只对 population 里出现的款要样本（population 外的款不连坐）。
const { stuck, legacyNull } = await fetchStuck();
const gatePassed = await calibrationGate(new Set(stuck.map((b) => b.game)));
if (EXECUTE && !gatePassed) { console.log('\n⛔ 硬闸阻断，退出，未动钱。'); await pool.end(); process.exit(2); }
await repairStuck(gatePassed, stuck, legacyNull);
await pool.end();
