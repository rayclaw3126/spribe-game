// 单V3a/b/c 硬闸：全 12 款「同构化换血」的三段对拍（即时 6 + 多步 3 + crash2/滚球）。一次性验收工具（下划线前缀）。
//
// 本单把 dice/plinko/limbo/keno/streakRoll/miniRoulette（V3a）+ mines/hilo/goal（V3b）的 `import crypto from 'crypto'`
// 退役、改回引 lib/seededRng.js 的 hmacSha256Hex/sha256Hex（Node→原生 / 浏览器→纯 JS）。
// 玩家在浏览器里跑的是纯 JS 分支，后端开奖跑的是 Node 分支——两者【逐位等价】是整单地基：
// 差一个 bit，玩家本地重算就与库内 result 对不上，验证器不但没证明公平，反而制造冤案。
//
// 三段（单V3c 扩至 12 款：+ aviator/momentum/rollingBall；余下 9 款轮次彩走 roundSpins，不在本线）：
//   a) 纯 JS vs Node crypto 直算：10 万组随机 (seed,client,nonce) × 3 种消息形状 + 边界组 + 多块打靶
//   b) 12 款换血前后：scratchpad 旧副本（自带 import crypto）vs 新版，同输入 1 万组全等 + 档位全覆盖
//   c) dice 公式哨兵：测试内用 __hmacPure 就地手拼 dice 公式，vs 引擎 rollDice 1 万组全等
//
// 跑法：cd server && node scripts/_isocrypto_parity.mjs
//   b 段需要旧副本在位（OLD_DIR），缺失则 b 段跳过并【记为失败】（禁静默放行）。
import { __hmacPure, __sha256HexPure, hmacSha256Hex, sha256Hex } from '../src/lib/seededRng.js';

const nodeCrypto = process.getBuiltinModule('node:crypto');
const nodeHmac = (k, m) => nodeCrypto.createHmac('sha256', k).update(m).digest('hex');
const nodeSha = (s) => nodeCrypto.createHash('sha256').update(s).digest('hex');

const OLD_DIR = '/tmp/claude-1000/-home-userray-spribe-game/480b653c-bcf8-47de-9d03-269339ff4829/scratchpad/oldengines';

let fails = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) fails++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? `  —— ${detail}` : ''}`);
};

// 确定性伪随机（本脚本自用，不进产品路径）：不用 Math.random，保证失败可复现。
let _s = 0x2f6e2b1;
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) / 0x100000000); };
const randHex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16); return s; };

// ═══════════ a) 纯 JS vs Node crypto 直算 ═══════════
function sectionA() {
  console.log('\n════════ a) 纯 JS vs Node crypto 直算 ════════');

  // a1 主对拍：10 万组随机 (seed, client, nonce)，三种消息形状都打
  console.log('  [a1] 主对拍 100000 组（三种消息形状：无counter / 带counter / goal四段带col）…');
  let bad = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) {
    const seed = randHex(64);
    const client = randHex(16);
    const nonce = Math.floor(rnd() * 1e9);
    // 形状①（dice/limbo/plinko/streakRoll）：`${clientSeed}:${nonce}`
    const m1 = `${client}:${nonce}`;
    if (__hmacPure(seed, m1) !== nodeHmac(seed, m1)) { bad++; if (bad <= 3) console.log(`    ❌ 形状① 不等 seed=${seed.slice(0, 12)}… msg=${m1}`); }
    // 形状②（keno/miniRoulette 的 counter / mines 的 counter / hilo 的 step）：`${clientSeed}:${nonce}:${x}`
    const m2 = `${client}:${nonce}:${Math.floor(rnd() * 4)}`;
    if (__hmacPure(seed, m2) !== nodeHmac(seed, m2)) { bad++; if (bad <= 3) console.log(`    ❌ 形状② 不等 seed=${seed.slice(0, 12)}… msg=${m2}`); }
    // 形状③（单V3b goal，四段带 col）：`${clientSeed}:${nonce}:${col}:${counter}`
    const m3 = `${client}:${nonce}:${Math.floor(rnd() * 7)}:${Math.floor(rnd() * 3)}`;
    if (__hmacPure(seed, m3) !== nodeHmac(seed, m3)) { bad++; if (bad <= 3) console.log(`    ❌ 形状③ 不等 seed=${seed.slice(0, 12)}… msg=${m3}`); }
    if ((i + 1) % 25000 === 0) console.log(`    …${i + 1}/${N} 组`);
  }
  ok(bad === 0, `10 万组 × 3 形状 = 30 万次 HMAC 逐位全等`, bad ? `${bad} 次不等` : '');

  // a2 边界组：HMAC key 的 >64/>128 字节分界（HMAC 标准要求 >BLOCK 的 key 先 hash）
  console.log('  [a2] 边界组…');
  const edges = [
    ['空 key + 空 msg', '', ''],
    ['空 key', '', 'abc'],
    ['空 msg', 'k', ''],
    ['63 字节 key（BLOCK−1）', 'a'.repeat(63), 'm'],
    ['64 字节 key（=BLOCK）', 'a'.repeat(64), 'm'],
    ['65 字节 key（>BLOCK→先hash）', 'a'.repeat(65), 'm'],
    ['128 字节 key', 'a'.repeat(128), 'm'],
    ['129 字节 key', 'a'.repeat(129), 'm'],
    ['256 字节 key', 'a'.repeat(256), 'm'],
    ['UTF-8 多字节 key（中文）', '种子密钥中文', 'msg'],
    ['UTF-8 多字节 msg（中文）', 'key', '客户种子:123'],
    ['UTF-8 4 字节（emoji）', '🎲🎰', '🃏:1'],
    ['UTF-8 混合', 'ключ种子🎲', 'клиент:随机:1'],
    ['大 nonce（2^53−1）', randHex(64), `c:${Number.MAX_SAFE_INTEGER}`],
    ['大 nonce（字符串超长）', randHex(64), `c:${'9'.repeat(100)}`],
    ['msg 跨 SHA 块（>55 字节）', 'k', 'x'.repeat(56)],
    ['msg 恰 64 字节', 'k', 'x'.repeat(64)],
    ['msg 恰 119/120（padding 死点）', 'k', 'x'.repeat(119)],
    ['msg 多块（1000 字节）', 'k', 'x'.repeat(1000)],
  ];
  let ebad = 0;
  for (const [label, k, m] of edges) {
    if (__hmacPure(k, m) !== nodeHmac(k, m)) { ebad++; console.log(`    ❌ HMAC 边界不等：${label}`); }
    if (__sha256HexPure(k) !== nodeSha(k)) { ebad++; console.log(`    ❌ sha256 边界不等：${label}`); }
  }
  ok(ebad === 0, `边界组 ${edges.length} 项（HMAC + sha256 各一遍）全等`, ebad ? `${ebad} 项不等` : '');

  // a3 多块拒绝采样打靶 —— 【为什么要显式打靶】
  //   keno/miniRoulette 的续熵是 counter 重 HMAC：熵池干了才 counter++ 再派生一块。
  //   一块摘要 = 32 字节。roulette 正常只耗 1 字节、keno 约 10.5 字节，
  //   要走到 counter=1 得连续拒绝 32 次（拒绝率 4/256 → 概率 ~1e-58），
  //   【喂随机种子给 drawKeno/spinRoulette 永远打不到第二块】。
  //   故多块场景只能在 hmac 这层按真实消息形状直接打靶 counter=0..K。
  //   单V3b：mines(counter)/hilo(step) 同属形状②；goal 是形状③（每列各自一条 counter 链），
  //   goal 的多块同样不可达（m=4/2 零拒绝，仅 m=3 有 1/256，到第二块需 ~30 次连续拒绝），故一并打靶。
  console.log('  [a3] 多块续熵打靶（counter=0..K 消息形状，含 goal 四段形状）…');
  let cbad = 0, cn = 0;
  for (let t = 0; t < 200; t++) {
    const seed = randHex(64);
    const client = randHex(16);
    const nonce = Math.floor(rnd() * 1e9);
    for (let counter = 0; counter <= 40; counter++) {   // K=40 ≫ 任何真实局所需块数
      const msg = `${client}:${nonce}:${counter}`;
      cn++;
      if (__hmacPure(seed, msg) !== nodeHmac(seed, msg)) { cbad++; if (cbad <= 3) console.log(`    ❌ counter=${counter} 不等`); }
    }
    // 形状③：7 列 × counter 0..5，覆盖 goal 每列独立熵链的续熵形状
    for (let col = 0; col < 7; col++) {
      for (let counter = 0; counter <= 5; counter++) {
        const msg = `${client}:${nonce}:${col}:${counter}`;
        cn++;
        if (__hmacPure(seed, msg) !== nodeHmac(seed, msg)) { cbad++; if (cbad <= 3) console.log(`    ❌ goal col=${col} counter=${counter} 不等`); }
      }
    }
  }
  ok(cbad === 0, `多块打靶 ${cn} 次（200 组 × [counter 0..40 + 7列×counter 0..5]）全等`, cbad ? `${cbad} 次不等` : '');

  // a4 环境切导出本身（产品实际调用的是这两个，不是 __hmacPure）
  console.log('  [a4] 环境切导出 vs Node 直算…');
  let xbad = 0;
  for (let i = 0; i < 5000; i++) {
    const seed = randHex(64), client = randHex(16), nonce = Math.floor(rnd() * 1e9);
    const msg = `${client}:${nonce}`;
    if (hmacSha256Hex(seed, msg) !== nodeHmac(seed, msg)) xbad++;
    if (sha256Hex(seed) !== nodeSha(seed)) xbad++;
  }
  ok(xbad === 0, `hmacSha256Hex/sha256Hex 导出 5000 组 == Node 直算`, xbad ? `${xbad} 次不等` : '');
}

// ═══════════ b) 12 款换血前后同输入对拍 ═══════════
// 旧版 = scratchpad 临时副本（自带 import crypto，独立成链）；新版 = 现仓引擎。
// 禁 git stash：引擎与 seededRng 是同一次改动的耦合件，stash 任一侧都构不成「老版」。
async function sectionB() {
  console.log('\n════════ b) 12 款换血前后同输入对拍（旧副本 vs 新版）════════');
  let oldMods;
  try {
    oldMods = {
      dice: await import(`${OLD_DIR}/dice.old.js`),
      plinko: await import(`${OLD_DIR}/plinko.old.js`),
      limbo: await import(`${OLD_DIR}/limbo.old.js`),
      keno: await import(`${OLD_DIR}/keno.old.js`),
      streakRoll: await import(`${OLD_DIR}/streakRoll.old.js`),
      miniRoulette: await import(`${OLD_DIR}/miniRoulette.old.js`),
      mines: await import(`${OLD_DIR}/mines.old.js`),
      hilo: await import(`${OLD_DIR}/hilo.old.js`),
      goal: await import(`${OLD_DIR}/goal.old.js`),
      aviator: await import(`${OLD_DIR}/aviator.old.js`),
      momentum: await import(`${OLD_DIR}/momentum.old.js`),
      rollingBall: await import(`${OLD_DIR}/rollingBall.old.js`),
    };
  } catch (err) {
    ok(false, `旧副本加载失败 —— b 段无法对拍（记为失败，禁静默放行）`, err.message);
    return;
  }
  const newMods = {
    dice: await import('../src/game/dice.js'),
    plinko: await import('../src/game/plinko.js'),
    limbo: await import('../src/game/limbo.js'),
    keno: await import('../src/game/keno.js'),
    streakRoll: await import('../src/game/streakRoll.js'),
    miniRoulette: await import('../src/game/miniRoulette.js'),
    mines: await import('../src/game/mines.js'),
    hilo: await import('../src/game/hilo.js'),
    goal: await import('../src/game/goal.js'),
    aviator: await import('../src/game/aviator.js'),
    momentum: await import('../src/game/momentum.js'),
    rollingBall: await import('../src/game/rollingBall.js'),
  };

  // 每款：派生函数 + hashSeed 都对拍。派生签名各异，逐款给 runner。
  const CASES = [
    { name: 'dice.rollDice', run: (m, s, c, n) => m.rollDice(s, c, n) },
    { name: 'plinko.derivePath', run: (m, s, c, n) => m.derivePath(s, c, n, 8 + (n % 9)).join(',') },
    { name: 'limbo.deriveMult', run: (m, s, c, n) => m.deriveMult(s, c, n) },
    { name: 'keno.drawKeno', run: (m, s, c, n) => m.drawKeno(s, c, n).join(',') },
    { name: 'streakRoll.drawStreak', run: (m, s, c, n) => { const r = m.drawStreak(s, c, n, n % 2 ? 'high' : 'normal'); return `${r.idx}:${r.landed}`; } },
    { name: 'miniRoulette.spinRoulette', run: (m, s, c, n) => m.spinRoulette(s, c, n) },
    // —— 单V3b 多步 3 款 ——
    // 各档位必须采到，否则等于没验：mines 走全 mineCount 1..24（熵消耗随雷数变）、
    // hilo 走 step 0..19（每步一条独立 HMAC）、goal 走 7 列 × 3 档 bombs（拒绝采样分支随 bombs 变）。
    // bucket()：把本组用到的档位记下来，跑完【断言档位全覆盖】——只写 n%24 而不验覆盖，
    // 万一随机没采到某档就是静默漏测（绿得假）。
    {
      name: 'mines.deriveMines', buckets: 24,
      bucket: (n) => 1 + (n % 24),
      run: (m, s, c, n) => m.deriveMines(s, c, n, 1 + (n % 24)).join(','),
    },
    {
      name: 'hilo.deriveCard', buckets: 20,
      bucket: (n) => n % 20,
      run: (m, s, c, n) => m.deriveCard(s, c, n, n % 20),
    },
    {
      name: 'goal.deriveBombRows', buckets: 21,   // 7 列 × 3 档 bombs
      bucket: (n) => `col${n % 7}/b${1 + (n % 3)}`,
      run: (m, s, c, n) => [...m.deriveBombRows(s, c, n, n % 7, 1 + (n % 3))].sort().join(','),
    },
    // —— 单V3c 收官 3 款 ——
    // aviator：形状①（`c:n`，同 dice）。crashPoint 是整局唯一派生产物。
    { name: 'aviator.generateCrash', run: (m, s, c, n) => m.generateCrash(s, c, n) },
    // momentum：形状②（`c:n:barIdx`，同 hilo 的 step）。逐柱一条独立 HMAC，故 barIdx 各档必须采到。
    { name: 'momentum.stepFactor', buckets: 31, bucket: (n) => n % 31, run: (m, s, c, n) => m.stepFactor(s, c, n, n % 31) },
    // momentum.walkPath：整条 31 柱路径（含 bust 吸收分支）—— 逐柱对拍不等于整条对拍，
    //   路径有状态累积（x *= f）+ 提前 break，得整条比才覆盖得到 bust 分支。
    { name: 'momentum.walkPath', run: (m, s, c, n) => JSON.stringify(m.walkPath(s, c, n)) },
    // rollingBall：派生层 drawBall(remaining, rng) 是【注入式】，用的就是共享 makeSeededRng ——
    //   本就同构，无需对拍（对拍它等于对拍 makeSeededRng，那是 verify_rng_parity 的活）。
    //   本单只换了它的 hashSeed，故只对拍 hashSeed（在下方 9→12 款 hashSeed 段统一覆盖）。
  ];
  const KEY = {
    'dice.rollDice': 'dice', 'plinko.derivePath': 'plinko', 'limbo.deriveMult': 'limbo',
    'keno.drawKeno': 'keno', 'streakRoll.drawStreak': 'streakRoll', 'miniRoulette.spinRoulette': 'miniRoulette',
    'mines.deriveMines': 'mines', 'hilo.deriveCard': 'hilo', 'goal.deriveBombRows': 'goal',
    'aviator.generateCrash': 'aviator', 'momentum.stepFactor': 'momentum', 'momentum.walkPath': 'momentum',
  };
  const N = 10000;
  for (const cs of CASES) {
    const k = KEY[cs.name];
    let bad = 0;
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      const seed = randHex(64), client = randHex(16), nonce = Math.floor(rnd() * 1e9);
      if (cs.bucket) seen.add(cs.bucket(nonce));
      const a = String(cs.run(oldMods[k], seed, client, nonce));
      const b = String(cs.run(newMods[k], seed, client, nonce));
      if (a !== b) { bad++; if (bad <= 2) console.log(`    ❌ ${cs.name} 不等：旧=${a} 新=${b}（seed=${seed.slice(0, 10)}… nonce=${nonce}）`); }
    }
    ok(bad === 0, `${cs.name} 旧 vs 新 ${N} 组全等`, bad ? `${bad} 组不等` : '');
    // 档位覆盖断言（只对声明了 buckets 的多步 3 款）：漏档 = 静默漏测，必须判红
    if (cs.buckets) ok(seen.size === cs.buckets, `${cs.name} 档位全覆盖（${cs.buckets} 档）`, `实采 ${seen.size}/${cs.buckets}`);
  }
  // hashSeed 九款一起对拍
  let hbad = 0;
  for (const k of Object.keys(newMods)) {
    for (let i = 0; i < 2000; i++) {
      const seed = randHex(64);
      if (oldMods[k].hashSeed(seed) !== newMods[k].hashSeed(seed)) hbad++;
    }
  }
  ok(hbad === 0, `12 款 hashSeed 旧 vs 新 各 2000 组全等`, hbad ? `${hbad} 组不等` : '');
}

// ═══════════ c) dice 公式哨兵 ═══════════
// 【哨兵专用刻意副本，捕获引擎公式意外改动】——本段特意在测试内手拼一份 dice 派生公式，
// 与 src/game/dice.js 的 rollDice 对拍。这是【故意的】第二实现，与「禁手抄」不矛盾：
//   产品代码里只有一份公式（引擎），这份副本只活在硬闸里，作用是当有人误改引擎公式时
//   立刻报警。它不参与任何产品路径，也不被前端 import。
//   （对照：_fairverify_crosscheck.mjs 已删——那份副本是引擎自比自的假测试。
//     本哨兵不同：它用 __hmacPure【纯 JS 分支】拼公式，而 rollDice 走 Node 分支，
//     所以既验公式没被改，又顺带验了两分支在真实公式下的等价。）
async function sectionC() {
  console.log('\n════════ c) dice 公式哨兵（刻意副本 vs 引擎）════════');
  const { rollDice } = await import('../src/game/dice.js');
  // ↓↓↓ 哨兵刻意副本：逐位复刻 dice.js rollDice 的公式，故意不 import 引擎实现 ↓↓↓
  const sentinelRollDice = (serverSeed, clientSeed, nonce) => {
    const hex = __hmacPure(serverSeed, `${clientSeed}:${nonce}`);   // 纯 JS 分支
    const r = parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52);     // 13 hex = 52bit
    return Math.floor(r * 100 * 100) / 100;                         // 0–100，2 位小数
  };
  // ↑↑↑ 哨兵副本结束 ↑↑↑
  let bad = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const seed = randHex(64), client = randHex(16), nonce = Math.floor(rnd() * 1e9);
    const a = sentinelRollDice(seed, client, nonce);
    const b = rollDice(seed, client, nonce);
    if (a !== b) { bad++; if (bad <= 3) console.log(`    ❌ 哨兵 ${a} vs 引擎 ${b}（seed=${seed.slice(0, 10)}… nonce=${nonce}）`); }
  }
  ok(bad === 0, `dice 公式哨兵 ${N} 组全等（公式未被改动）`, bad ? `${bad} 组不等` : '');
}

console.log('_isocrypto_parity —— 单V3a/b/c 全 12 款同构化硬闸（即时6+多步3+crash2+滚球）');
sectionA();
await sectionB();
await sectionC();
console.log(`\n${fails === 0 ? '✅ 硬闸全过：三段全等' : `❌ 硬闸阻断：${fails} 项失败`}`);
process.exit(fails > 0 ? 1 : 0);
