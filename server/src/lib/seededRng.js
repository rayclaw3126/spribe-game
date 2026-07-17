// 轮次开奖游戏的【信任根】—— 确定性 RNG 流。
// ⚠️ 这批 10 个轮次开奖游戏（SpeedGrid/NumberUp/HatTrick/GoldenBoot/DerbyDay/LineUp/
//    WuXing/RollingBall/DominoDuel/HalfTime）全部复用本模块，改动影响【全部】——慎改、必对拍。
//
// 各游戏引擎的 drawX(rng) 都用 rng()∈[0,1) 做 floor(rng()×m) 或 Fisher-Yates。
// 只要 rng 是 52-bit/2^52 的 [0,1) uniform，floor(U×m) 的偏差 ≤ m/2^52 ≈ 1e-14（可忽略，
// 不像单字节 %m 的粗偏），所以这批【无需拒绝采样】——信任根用 52-bit 派生即可。
//
// 派生：HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}:${counter}`) 的十六进制流，
// 每次 rng() 取 13 个 hex 字符(52bit) / 2^52。counter 递增续熵，支持一局多次 rng()
// 调用（如 Fisher-Yates 洗 28 张骨牌需多次）。同 (serverSeed,clientSeed,nonce) 必得同一序列，
// 任何人事后公开 serverSeed 都能重放校验。
//
// 单V2 同构化（心脏级）：sha256/hmac 按环境切——
//   · Node：`node:crypto` 的 createHmac 同步路径【原实现语义原样保留】（浏览器打包时被
//     externalize 成空桩 → createHmac===undefined → 自动落纯 JS 分支）。
//   · 浏览器：自写纯 JS HMAC-SHA256（无依赖、同步，UTF-8 编码 key/msg，与 Node createHmac 同口径）。
//   两分支【逐位等价】由硬闸 scripts/verify_rng_parity.mjs 对拍 10 万组全序列兜底。
// ⚠ 关键：不能【静态 import 'node:crypto'】——vite dev 会把它 externalize 成「一读属性即抛」的桩，
//   且转换静态命名 import 时会在模块初始化就 eager 访问 createHmac → 浏览器 import 本模块直接抛。
//   故 Node 原生 crypto 改用 process.getBuiltinModule('node:crypto') 同步取（Node≥20.16，无静态 import），
//   浏览器（process 不存在）自然落纯 JS 分支——两端零 externalize 隐患。

const TWO_POW_52 = Math.pow(2, 52);

// ───────────────────────── 纯 JS SHA-256（浏览器分支）─────────────────────────
// 标准 FIPS 180-4 实现，输入/输出均为字节（Uint8Array）。经典死点 padding/多块/UTF-8 全覆盖。
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

// SHA-256(bytes: Uint8Array) → Uint8Array(32)
function sha256Bytes(msg) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const l = msg.length;
  // 填充：0x80 + 若干 0 + 64bit 大端比特长；总长补到 64 的倍数（>=l+9）。
  const padded = (Math.floor((l + 8) / 64) + 1) * 64;
  const buf = new Uint8Array(padded);
  buf.set(msg);
  buf[l] = 0x80;
  const bitLen = l * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padded - 8, Math.floor(bitLen / 0x100000000)); // 高 32 位
  dv.setUint32(padded - 4, bitLen >>> 0);                     // 低 32 位
  const w = new Uint32Array(64);
  for (let off = 0; off < padded; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15], w2 = w[t - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((hh, i) => odv.setUint32(i * 4, hh >>> 0));
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s); // UTF-8（中文种子同 Node Buffer.from 语义）
function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// 纯 JS HMAC-SHA256(keyStr, msgStr) → hex（与 Node createHmac('sha256',key).update(msg).digest('hex') 同口径）。
function hmacSha256HexPure(keyStr, msgStr) {
  const BLOCK = 64;
  let key = utf8(keyStr);
  if (key.length > BLOCK) key = sha256Bytes(key); // >64 字节 key 先 hash（HMAC 标准）
  const k = new Uint8Array(BLOCK);                 // 零填充到 64
  k.set(key);
  const ipad = new Uint8Array(BLOCK);
  const opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  const msg = utf8(msgStr);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad); inner.set(msg, BLOCK);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(BLOCK + 32);
  outer.set(opad); outer.set(innerHash, BLOCK);
  return toHex(sha256Bytes(outer));
}

// ───────────────────────── 环境分支 ─────────────────────────
// Node：走原生 createHmac 同步路径（语义与旧实现逐位一致）。
// 浏览器：走纯 JS。⚠ 必须先按环境判定、且【绝不在浏览器触碰 createHmac 绑定】——
//   vite dev 把 node:crypto externalize 成「一访问属性即抛」的代理（生产构建才 tree-shake 成空桩），
//   故 `typeof createHmac` 都会在 dev 浏览器抛错。用 isNode 门控：浏览器分支永不引用 createHmac。
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
let hmacNode = null;
let sha256Node = null;   // 单V3a：sha256 同款环境切（供 6 款即时游戏 hashSeed 复用）
if (isNode && typeof process.getBuiltinModule === 'function') {
  const nodeCrypto = process.getBuiltinModule('node:crypto'); // 同步取原生 crypto，无静态 import
  hmacNode = (keyStr, msgStr) => nodeCrypto.createHmac('sha256', keyStr).update(msgStr).digest('hex');
  sha256Node = (str) => nodeCrypto.createHash('sha256').update(str).digest('hex');
}
// 单V3a：即时 6 款（dice/plinko/limbo/keno/streakRoll/miniRoulette）退役各自的 import crypto，
// 统一回引本导出——前后端同一份 HMAC，前端本地重算才可能与后端逐位对上（禁手抄第二份）。
export const hmacSha256Hex = hmacNode || hmacSha256HexPure;

// 给定 hmac 实现，造 makeSeededRng（硬闸可注入两分支分别对拍）。
function makeSeededRngWith(hmacHex) {
  return function makeRng(serverSeed, clientSeed, nonce) {
    let hex = '';
    let counter = 0;
    const refill = () => {
      hex += hmacHex(serverSeed, `${clientSeed}:${nonce}:${counter++}`); // 每块 64 hex 字符
    };
    return function rng() {
      while (hex.length < 13) refill();        // 需 13 hex = 52 bit
      const chunk = hex.slice(0, 13);
      hex = hex.slice(13);
      return parseInt(chunk, 16) / TWO_POW_52; // [0,1)
    };
  };
}

/**
 * 造一个确定性 rng()：每次调用吐一个 52-bit 的 [0,1) uniform。
 * @param {string} serverSeed - 私密种子，reveal 前绝不广播
 * @param {string} clientSeed - 公开种子
 * @param {string|number} nonce
 * @returns {() => number} rng()，返回 [0,1)
 */
export const makeSeededRng = makeSeededRngWith(hmacSha256Hex);

// —— 硬闸对拍专用导出（scripts/verify_rng_parity.mjs 在 Node 下强制两分支逐位比）——
export const __hmacPure = hmacSha256HexPure;   // 纯 JS 分支
export const __hmacNode = hmacNode;            // Node 原生分支（浏览器为 null）
export const __makeSeededRngWith = makeSeededRngWith;
export const __sha256HexPure = (str) => toHex(sha256Bytes(utf8(str))); // 边界组直比 sha256 用

// 单V3a：sha256 环境切导出（Node→createHash / 浏览器→复用上面的纯 JS 件）。
// ⚠ 位置铁律：必须声明在 __sha256HexPure 之【后】——const 有 TDZ，若挪到上面的环境分支处
//   会在模块初始化时引用未初始化绑定直接抛。
export const sha256Hex = sha256Node || __sha256HexPure;
