// 单V2：通用「本地重算」验证器（排期器 9 款）。⚖ 两抽屉懒加载本件（→ 独立 async chunk，主包零增重引擎）。
// 铁律·单一出处：rng 用同构 makeSeededRng（server/src/lib/seededRng.js，浏览器走纯 JS HMAC-SHA256 分支）；
// 派生用 ROUND_SPINS（server/src/game/roundSpins.js，与 roundHub 结算同一份）——前端【不手抄】第二份逻辑。
// 输入 serverSeed+clientSeed+nonce → 本地重算 drawResult，与实际开奖逐字段 ✓/✗ 比对。
//
// 单V3a/V3b：per-player 款（即时 6 + 多步 3）并入本件。两类游戏派生形状不同，故走两条路径：
//   · 排期器 9 款：ROUND_SPINS[game](rng) → drawResult，逐字段比（原路径，零改动）。
//   · per-player 9 款：各引擎派生签名各异（rollDice/deriveMines/drawKeno/…），走 INSTANT_VERIFY
//     注册表按款适配（./instantVerify.js，同样直 import 引擎导出，禁手抄公式）。
//     注册表独立成文件是为了让静态 import 它的 SeedFairness 不被牵连拖进 roundSpins——详见该文件。
//
// ⚠ 预埋（单V3b 查明）：本件只被 HistoryDrawer / CommitRevealFairness 渲染，而那两个只挂在
//   【轮次彩 9 款】页面上 → 下方 INSTANT_VERIFY 分支目前【不可达】。per-player 9 款的本地重算
//   实际走 SeedFairness 的「验整局 by roundId」路径（同一份注册表，故逻辑不会分叉）。
//   本分支为「per-player 历史局抽屉」（待办池）预留：那个抽屉接入后即自动生效，无需再改本件。
import { useMemo } from 'react';
import { makeSeededRng } from '../../../server/src/lib/seededRng.js';
import { ROUND_SPINS } from '../../../server/src/game/roundSpins.js';
import { INSTANT_VERIFY, fieldsOf } from './instantVerify';
import { COLORS, RADIUS, MONO } from './tokens';


// 顺序无关规范化深比（对象键递归排序；数组保原序——与后端 A补/psql 口径一致）。
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}
const deepEq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const fmt = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

// props: { game(backendId), serverSeed, clientSeed, nonce, drawResult }
export default function LocalVerify({ game, serverSeed, clientSeed, nonce, drawResult }) {
  const result = useMemo(() => {
    try {
      const spin = ROUND_SPINS[game];
      const inst = INSTANT_VERIFY[game];
      if (!spin && !inst) return { error: '该游戏暂不支持本地重算' };
      if (!serverSeed || nonce == null || !drawResult) return { error: '缺少重算要素（serverSeed/nonce/开奖结果）' };
      let got, fields;
      if (spin) {
        // 排期器 9 款（原路径，零改动）：整个 drawResult 都是派生产物，逐字段全比。
        const rng = makeSeededRng(serverSeed, clientSeed ?? '', nonce); // nonce 原样传（与后端 room.nonce 字符串插值同口径）
        got = spin(rng).drawResult;
        fields = Object.keys(drawResult);
      } else {
        // 模型A per-player 款（即时 6 + 多步 3）：result 里混着玩家输入与结算产物，
        // 只比 fields 列的派生产物；needs（plinko rows / streak risk / mines mineCount /
        // hilo step / goal tier）从 result 回显值取——它们是派生的【输入】不是产物。
        const missing = inst.needs.filter((nd) => drawResult[nd.key] == null);
        if (missing.length) return { error: `缺少重算要素（${missing.map((m) => m.key).join('/')}）` };
        got = inst.derive(serverSeed, clientSeed ?? '', nonce, drawResult);
        fields = fieldsOf(inst, drawResult);   // goal 的靶随终局形状变（cashed/bust），故走 fieldsOf
      }
      const rows = fields.map((k) => ({ k, want: drawResult[k], got: got[k], ok: deepEq(drawResult[k], got[k]) }));
      return { rows, allOk: rows.length > 0 && rows.every((r) => r.ok), got };
    } catch (e) {
      return { error: e?.message || '重算异常' };
    }
  }, [game, serverSeed, clientSeed, nonce, drawResult]);

  const box = {
    marginTop: 8, padding: '10px 12px', borderRadius: RADIUS.input,
    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
  };
  if (result.error) {
    return <div style={{ ...box, color: COLORS.textMuted, fontSize: 12 }}>· {result.error}</div>;
  }

  const okColor = result.allOk ? COLORS.green : COLORS.redDark;
  const okBg = result.allOk ? COLORS.greenTint : COLORS.slateTint;
  return (
    <div style={box}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 900,
        color: okColor, background: okBg, border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.pill, padding: '4px 12px', marginBottom: 8,
      }}>
        {result.allOk
          ? '✓ 本地重算一致 · 开奖结果由 serverSeed+clientSeed+nonce 完全复现'
          : '✗ 本地重算不一致（请核对输入是否被篡改）'}
      </div>
      {/* 逐字段 重算值 vs 实际开奖 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {result.rows.map((r) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, fontFamily: MONO }}>
            <span style={{ flex: '0 0 auto', color: r.ok ? COLORS.green : COLORS.redDark, fontWeight: 900 }}>{r.ok ? '✓' : '✗'}</span>
            <span style={{ flex: '0 0 auto', color: COLORS.textFaint, minWidth: 62 }}>{r.k}</span>
            <span style={{ flex: '1 1 auto', color: COLORS.text, wordBreak: 'break-all' }}>
              {fmt(r.want)}
              {!r.ok && <span style={{ color: COLORS.redDark }}> ≠ 重算 {fmt(r.got)}</span>}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.6, color: COLORS.textFaint }}>
        重算在你的浏览器本地完成（纯 JS HMAC-SHA256，与服务端同一算法）；结果不经任何网络请求，可断网验证。
      </div>
    </div>
  );
}
