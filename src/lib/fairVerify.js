// 可验证公平 —— 前端本地重算（浏览器原生 crypto.subtle，零依赖）
//
// ⚠️ 铁律：本文件的派生必须与 server/src/game/dice.js 的 rollDice() 逐位一致。
//         改一处必须改两处，否则玩家本地重算与后端开奖对不上，验证器直接失效。
//
// 关键坑（务必踩对）：后端 Node 的 createHmac('sha256', serverSeed) 里 serverSeed 是
// hex【字符串】，Node 把这【字符串本身的 UTF-8 字节】当 HMAC key（不是把 hex 解码成
// 32 字节）。所以这里 key 必须用 TextEncoder().encode(serverSeed)（hex 字符串的 utf-8），
// 【绝不能】hexToBytes(serverSeed) —— 解码就永远对不上。

const enc = new TextEncoder();

/** ArrayBuffer → 小写十六进制字符串 */
function bufToHex(buf) {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * HMAC-SHA256，返回十六进制摘要。
 * key/msg 均按 UTF-8 编码（与后端 Node createHmac 对字符串参数的处理一致）。
 * @param {string} keyStr - HMAC key（serverSeed 的 hex 字符串，按 utf-8 取字节）
 * @param {string} msgStr - 消息（`${clientSeed}:${nonce}`）
 * @returns {Promise<string>} 64 位十六进制
 */
async function hmacSha256Hex(keyStr, msgStr) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyStr),               // ← hex 字符串的 UTF-8 字节，不是 hexToBytes
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
  return bufToHex(sig);
}

/**
 * 本地重算一局 Dice 的 roll（0–100，2 位小数）。
 * 逐位复刻 server/src/game/dice.js rollDice()：
 *   hex  = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`)
 *   r    = parseInt(hex.slice(0,13), 16) / 2^52
 *   roll = Math.floor(r * 100 * 100) / 100
 * @param {string} serverSeed - reveal 后拿到的明文种子
 * @param {string} clientSeed
 * @param {string|number} nonce
 * @returns {Promise<number>} roll ∈ [0,100)，2 位小数
 */
export async function verifyDice(serverSeed, clientSeed, nonce) {
  const hex = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  const r = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  return Math.floor(r * 100 * 100) / 100;
}
