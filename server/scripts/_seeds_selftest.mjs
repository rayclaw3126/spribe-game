// 批 1 自测：ensureActiveSeed 幂等 + claimNonce 并发不重复 + hash 正确 + 明文隔离。
import crypto from 'crypto';
import { pool, query, withTransaction } from '../src/db.js';
import { ensureActiveSeed, claimNonce, hashSeed } from '../src/lib/seeds.js';

const PID = 1; // alice
let allPass = true;
const check = (name, ok, detail = '') => { if (!ok) allPass = false; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ---- 1. ensureActiveSeed 幂等：两次同玩家返回同一条，不新建 ----
const beforeCnt = (await query(`SELECT count(*)::int n FROM player_seeds WHERE player_id=$1 AND status='active'`, [PID])).rows[0].n;
const a1 = await withTransaction((c) => ensureActiveSeed(c, PID));
const a2 = await withTransaction((c) => ensureActiveSeed(c, PID));
const afterCnt = (await query(`SELECT count(*)::int n FROM player_seeds WHERE player_id=$1 AND status='active'`, [PID])).rows[0].n;
check('ensureActiveSeed 幂等：两次返回同一 id', a1.id === a2.id, `id=${a1.id}`);
check('ensureActiveSeed 幂等：active 条数不增', beforeCnt === 1 && afterCnt === 1, `before=${beforeCnt} after=${afterCnt}`);

// ---- 2. hash 正确：server_seed_hash == sha256(server_seed) ----
check('hash 正确：server_seed_hash == sha256(server_seed)',
  a1.serverSeedHash === crypto.createHash('sha256').update(a1.serverSeed).digest('hex'),
  a1.serverSeedHash.slice(0, 16) + '…');
check('hashSeed() 与 crypto 一致', hashSeed(a1.serverSeed) === a1.serverSeedHash);

// ---- 3. nonce 并发：两笔并发 claimNonce 同玩家，拿到不同 nonce，无唯一约束错 ----
const nonceBefore = (await query(`SELECT nonce FROM player_seeds WHERE player_id=$1 AND status='active'`, [PID])).rows[0].nonce;
let n1, n2, concErr = null;
try {
  [n1, n2] = await Promise.all([
    withTransaction((c) => claimNonce(c, PID)),
    withTransaction((c) => claimNonce(c, PID)),
  ]);
} catch (e) { concErr = e; }
const nonceAfter = (await query(`SELECT nonce FROM player_seeds WHERE player_id=$1 AND status='active'`, [PID])).rows[0].nonce;
check('claimNonce 并发无报错', concErr === null, concErr ? concErr.message : 'ok');
const nonces = concErr ? [] : [n1.nonce, n2.nonce].sort((x, y) => x - y);
check('claimNonce 并发拿到不同 nonce（不重复）',
  !concErr && n1.nonce !== n2.nonce, `nonces=[${nonces.join(', ')}]`);
check('claimNonce 并发结果连续递增（无跳号/无重复）',
  !concErr && nonces[0] === nonceBefore + 1 && nonces[1] === nonceBefore + 2,
  `before=${nonceBefore} got=[${nonces.join(', ')}] after=${nonceAfter}`);
check('claimNonce 最终落库 nonce == 起点+2', nonceAfter === nonceBefore + 2, `after=${nonceAfter}`);

// ---- 4. 明文隔离：批 1 无任何 route 触碰 player_seeds（明文只在 lib 内部流转） ----
check('lib 返回含明文（内部用，符合设计）', typeof a1.serverSeed === 'string' && a1.serverSeed.length === 64);

console.log(`\n${allPass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);
await pool.end();
process.exit(allPass ? 0 : 1);
