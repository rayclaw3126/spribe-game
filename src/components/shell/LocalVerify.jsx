// 单V2：通用「本地重算」验证器（排期器 9 款）。⚖ 两抽屉懒加载本件（→ 独立 async chunk，主包零增重引擎）。
// 铁律·单一出处：rng 用同构 makeSeededRng（server/src/lib/seededRng.js，浏览器走纯 JS HMAC-SHA256 分支）；
// 派生用 ROUND_SPINS（server/src/game/roundSpins.js，与 roundHub 结算同一份）——前端【不手抄】第二份逻辑。
// 输入 serverSeed+clientSeed+nonce → 本地重算 drawResult，与实际开奖逐字段 ✓/✗ 比对。
import { useMemo } from 'react';
import { makeSeededRng } from '../../../server/src/lib/seededRng.js';
import { ROUND_SPINS } from '../../../server/src/game/roundSpins.js';
import { COLORS, RADIUS } from './tokens';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', monospace";

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
      if (!spin) return { error: '该游戏暂不支持本地重算' };
      if (!serverSeed || nonce == null || !drawResult) return { error: '缺少重算要素（serverSeed/nonce/开奖结果）' };
      const rng = makeSeededRng(serverSeed, clientSeed ?? '', nonce); // nonce 原样传（与后端 room.nonce 字符串插值同口径）
      const got = spin(rng).drawResult;
      const fields = Object.keys(drawResult);
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
