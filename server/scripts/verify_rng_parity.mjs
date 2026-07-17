// 单V2 硬闸（心脏级）：seededRng 的【Node 原生分支】vs【纯 JS 分支】逐位对拍。
// 铁律：任一位不等 → 立即停手、打印可复现输入、退出码 2；禁调参凑。
//
// 对拍口径：
//   ① 主对拍：10 万组随机 (serverSeed,clientSeed,nonce)，每组【连抽 100 次】rng()，逐位 === 比。
//   ② 边界组：空串 / >64 字节 / >128 字节 种子 & 消息（多块路径）/ nonce 0 与大数 / 中文种子。
//   ③ 独立参照：纯 JS sha256/hmac 再与 Node crypto 直算比对（不只两分支自比，防两侧同错）。
import crypto from 'node:crypto';
import { __hmacPure, __hmacNode, __makeSeededRngWith, __sha256HexPure } from '../src/lib/seededRng.js';

const GROUPS = Number(process.argv[2] || 100000);
const DRAWS = Number(process.argv[3] || 100);

if (typeof __hmacNode !== 'function') {
  console.error('❌ 本机 __hmacNode 不可用（应在 Node 下跑硬闸）'); process.exit(1);
}
const mkNode = __makeSeededRngWith(__hmacNode);
const mkPure = __makeSeededRngWith(__hmacPure);
const nodeHmacRef = (k, m) => crypto.createHmac('sha256', k).update(m).digest('hex');
const nodeSha256Ref = (m) => crypto.createHash('sha256').update(m).digest('hex');

let fail = null;
function stop(msg, ctx) { fail = { msg, ctx }; }

// ── 边界组：种子/消息覆盖空串、单块、跨块（>64）、多块（>128），nonce 0/大数，中文 ──
const rand = (n) => crypto.randomBytes(n).toString('hex');
const boundary = [
  { s: '', c: '', n: 0, tag: '全空串' },
  { s: '', c: '', n: 999999999999, tag: '空种子+大nonce' },
  { s: rand(16), c: rand(4), n: 0, tag: '常规32/8hex nonce0' },
  { s: rand(40), c: rand(4), n: 7, tag: 'key80hex(>64字节) 跨块' },       // 80 字节 key → HMAC key 先 hash
  { s: rand(80), c: rand(4), n: 7, tag: 'key160hex(>128字节) 多块' },
  { s: rand(16), c: 'x'.repeat(70), n: 12345, tag: 'msg>64字节 跨块' },   // 消息 >64 字节 → sha 2 块
  { s: rand(16), c: 'y'.repeat(140), n: 12345, tag: 'msg>128字节 多块' }, // 消息 >128 字节 → sha 3 块
  { s: '龙虎和五行开奖种子', c: '客户端中文种子', n: 88, tag: '中文种子(UTF-8多字节)' },
  { s: '中'.repeat(50), c: '文'.repeat(50), n: 0, tag: '长中文(字节数远超字符数) 多块' },
  { s: rand(16), c: rand(4), n: '9007199254740993', tag: 'nonce 超 2^53 字符串' },
];

function checkGroup(s, c, n, draws, tag) {
  // ③ 独立参照：先证纯 JS hmac/sha 与 Node crypto 直算逐位一致（counter=0 那块 + 一条消息）
  const msg0 = `${c}:${n}:0`;
  if (__hmacPure(s, msg0) !== nodeHmacRef(s, msg0)) return stop('纯JS HMAC ≠ Node crypto 直算', { s, c, n, tag, msg0, pure: __hmacPure(s, msg0), node: nodeHmacRef(s, msg0) });
  if (__sha256HexPure(msg0) !== nodeSha256Ref(msg0)) return stop('纯JS SHA256 ≠ Node crypto 直算', { s, c, n, tag, msg0 });
  // ①/② 全序列逐位比
  const rn = mkNode(s, c, n), rp = mkPure(s, c, n);
  for (let i = 0; i < draws; i++) {
    const a = rn(), b = rp();
    if (a !== b) return stop('rng 序列逐位不等', { s, c, n, tag, index: i, node: a, pure: b });
  }
}

console.log(`[硬闸] 边界组 ${boundary.length} 组（每组连抽 ${DRAWS} 次 + 独立参照）…`);
for (const g of boundary) {
  checkGroup(g.s, g.c, g.n, DRAWS, g.tag);
  if (fail) break;
}
if (!fail) console.log('[硬闸] 边界组全过 ✅');

if (!fail) {
  console.log(`[硬闸] 主对拍 ${GROUPS} 组 × 每组连抽 ${DRAWS} 次 逐位比…`);
  const t0 = Date.now();
  for (let g = 0; g < GROUPS; g++) {
    const s = rand(16), c = rand(4), n = crypto.randomBytes(4).readUInt32BE(0);
    checkGroup(s, c, n, DRAWS, 'random');
    if (fail) break;
    if ((g + 1) % 20000 === 0) console.log(`   …${g + 1}/${GROUPS} 组通过（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  }
}

if (fail) {
  console.error('\n❌❌❌ 硬闸失败——停手上报（禁调参凑）');
  console.error('原因：', fail.msg);
  console.error('可复现输入：', JSON.stringify(fail.ctx, null, 2));
  process.exit(2);
}
console.log(`\n✅ 硬闸全过：Node 分支 vs 纯 JS 分支【逐位等价】`);
console.log(`   主对拍 ${GROUPS} 组 × ${DRAWS} 抽 = ${(GROUPS * DRAWS).toLocaleString()} 次 rng() 全等；边界 ${boundary.length} 组全过；纯 JS 再与 Node crypto 直算逐位一致。`);
process.exit(0);
