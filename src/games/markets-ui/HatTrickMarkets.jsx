// #41 单15：HatTrick 盘口区（和值 4-17 + 大小单双 / 任意豹子+指定豹子 / 指定对子）——
// 从 HatTrick.jsx 机械切片，逐字节搬 JSX + 样式 + DieFace/cellBtn/cellName/cellRange/cellOdds/
// stakeChip/winTxt/fxCls/cellCls/nearBadge/totalCell + <style> 动画块，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；
// selected/hits 选中/命中态（原页传 picks / result?.hits ?? preHits，多桌不传→空）；chipMode 角标改用筹码码。
// 富演出层（settleFx/settleHits/nearMiss/suspense）为原页专属，多桌缺省即空 → 退回 GoldenBoot 口径。
// 判定/赔率单一出处走引擎 MARKETS/ODDS（禁二份表）。DieFace 随件导出（原页 subRow/舞台/mobile 回用）。
import { useState } from 'react'
import { HATTRICK, RADIUS, COLORS } from '../../components/shell/tokens'
import { ODDS, MARKETS, round2 } from '../markets/hattrick'
import { SIDES } from './hattrickShared'
import Chip from '../../components/shell/Chip'

const EMPTY = new Set()
// 三玩法组名：原页 secHead 文案逐字搬（和值 4-17 / 豹子 / 对子）。
const GROUP_TITLES = ['和值 4-17', '豹子', '对子']

// ---------- 骰面（CSS 点阵，size 参数化；禁 emoji 禁图）——从原页机械搬，随件导出 ----------
// 3×3 宫格索引：0 1 2 / 3 4 5 / 6 7 8
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
export function DieFace({ v, size = 18 }) {
  const dot = Math.max(2.5, size * 0.17)
  return (
    <span aria-label={`骰面 ${v}`} style={{
      width: size, height: size, borderRadius: Math.max(3, size * 0.2),
      background: HATTRICK.face, border: '1px solid rgba(0,0,0,0.3)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      display: 'inline-grid',
      gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: Math.max(2, size * 0.14), boxSizing: 'border-box', flex: '0 0 auto',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{
          alignSelf: 'center', justifySelf: 'center',
          width: dot, height: dot, borderRadius: '50%',
          background: PIPS[v].includes(i) ? HATTRICK.pip : 'transparent',
        }} />
      ))}
    </span>
  )
}

export default function HatTrickMarkets({
  onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY,
  settleHits = EMPTY, settleFx = false, nearMiss = EMPTY, suspense = null,
  isMobile = false, chipMode = false, openMode = 'all', richFx = false,
  big = false,   // #47 首批：桌面放大档（键字15/赔率14.5），默认 false 即原行为；多桌与手机不传，零感
}) {
  const betting = !disabled
  // 三组折叠/展开：默认全开=原页习惯（secHead 常显）；openMode='first' 时仅开第一组（多桌手风琴记忆）
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY          // null 安全
  const hitSet = hits || EMPTY              // 边框命中（原页 result?.hits ?? preHits）
  const settleHitSet = settleHits || EMPTY  // 结算演出命中（原页 result?.hits，仅结算后）
  const nearSet = nearMiss || EMPTY
  const suspKeys = suspense?.keys || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）——逐字节搬原页 ----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, padding: compact ? '4px 2px' : '7px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? HATTRICK.selTint : HATTRICK.grey,
      border: `1px solid ${hit ? HATTRICK.sel : sel || placed ? HATTRICK.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${HATTRICK.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: HATTRICK.text, fontSize: isMobile ? 10 : big ? 15 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HATTRICK.dim, fontSize: isMobile ? 8.5 : big ? 11.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HATTRICK.gold, fontSize: isMobile ? 10.5 : big ? 14.5 : 12.5, fontWeight: 900 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: 5,
    background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 押额胶囊：原页 = $押额绿标（未中结算碎裂，就差1点不碎）；多桌 chipMode = 筹码码叠角。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, zIndex: 2, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    const lose = settleFx && !settleHitSet.has(key) && !nearSet.has(key)
    return (
      <span className={lose ? 'htLose' : undefined} style={{
        position: 'absolute', top: 2, right: 3, zIndex: 2,
        padding: '1px 5px', borderRadius: RADIUS.pill,
        background: HATTRICK.sel, color: '#083a1b',
        fontSize: 8, fontWeight: 900, pointerEvents: 'none',
      }}>${amt}</span>
    )
  }
  // 赔率位常显赢额（下注后替换赔率数字，不并列） + 结算演出 class（逐字节搬）
  const winTxt = (key, odds) => `赢 $${round2(stakeOf(key) * odds)}`
  const fxCls = (key) => {
    if (!settleFx || !(stakeOf(key) > 0)) return undefined
    if (settleHitSet.has(key)) return 'htWinFly'
    if (nearSet.has(key)) return undefined   // 就差1点：不灰碎，改橙红 badge
    return 'htLose'
  }
  // 快投 loading 点（原页无此态，flying 缺省 → 恒 null，原页分毫不变；多桌快投用，同 GoldenBoot）
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: HATTRICK.gold, pointerEvents: 'none' }} /> : null)
  // 悬念脉冲：块A 悬着的注区高亮
  const cellCls = (key) => 'htCell' + (suspKeys.has(key) ? ' htSuspense' : '')
  // 中奖高亮标准（多桌用）：押中(有码)+命中 = 你中了 → 金边脉冲(.htWin)。原页富演出层已接管(htWinFly)，richFx 抑制免重复。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 && !richFx ? ' htWin' : '')
  // 块B 就差1点橙红惋惜 badge（仅 totalCell + SIDES 用）
  const nearBadge = (key) => nearSet.has(key) && (
    <span className="htNear" style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      zIndex: 4, padding: '2px 6px', borderRadius: RADIUS.pill,
      background: 'rgba(4,10,7,0.78)', color: '#ff6a3d', border: '1px solid #ff6a3d',
      fontSize: isMobile ? 8.5 : big ? 11.5 : 9.5, fontWeight: 900, whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>就差1点！</span>
  )

  // TOTAL 4–17 小格（desk 14 连排 / mobile 7×2 折行不挤爆）——逐字节搬
  const totalCell = (s) => {
    const key = `t-${s}`
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return (
      <button key={key} type="button" className={cellCls(key) + wonCls(key)} disabled={!betting} onClick={() => onPick(key)} style={{
        minWidth: 0, padding: '3px 0',
        borderRadius: 8, cursor: betting ? 'pointer' : 'not-allowed',
        background: hit ? HATTRICK.sel : sel ? HATTRICK.selTint : HATTRICK.grey,
        border: `1px solid ${hit ? HATTRICK.sel : sel || placed ? HATTRICK.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: hit ? '0 0 10px rgba(53,208,127,0.7)' : sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        opacity: betting || hit || placed ? 1 : 0.75,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        boxSizing: 'border-box', transition: 'background 0.1s, box-shadow 0.1s',
        position: 'relative',
      }}>
        <span style={{
          color: hit ? '#083a1b' : HATTRICK.text, fontSize: isMobile ? 12 : 13, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{s}</span>
        <span className={fxCls(key)} style={{ color: hit ? '#083a1b' : HATTRICK.gold, fontSize: isMobile ? 8.5 : big ? 11.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{placed ? winTxt(key, ODDS.total[s]) : ODDS.total[s]}</span>
        {stakeChip(key)}
        {flyDot(key)}
        {nearBadge(key)}
      </button>
    )
  }

  // 组头 ▾/▸ 折叠钮：原 secHead gold 标题 → 可开合钮，视觉沿用（gold 标题 + 前置 chevron）。
  const groupHead = (i) => (
    <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      marginBottom: open[i] ? 4 : 0, textAlign: 'left',
    }}>
      <span style={{ color: HATTRICK.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
      <span style={{ color: HATTRICK.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUP_TITLES[i]}</span>
    </button>
  )

  return (
    <>
      <style>{`
        .htCell:hover:not(:disabled) { filter: brightness(1.3); }
        @keyframes htWinFly { 0% { transform: scale(1); opacity: 1; } 25% { transform: scale(1.65); opacity: 1; filter: drop-shadow(0 0 6px rgba(255,213,79,0.95)); } 100% { transform: translateY(-16px) scale(1.1); opacity: 0; } }
        .htWinFly { animation: htWinFly 1s ease-out forwards; transform-origin: right center; }
        @keyframes htLose { 0% { transform: scale(1); opacity: 1; filter: grayscale(0); } 100% { transform: scale(0.7); opacity: 0; filter: grayscale(1); } }
        .htLose { animation: htLose 0.7s ease-in forwards; transform-origin: right center; }
        @keyframes htPulseRing { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0); } 50% { box-shadow: 0 0 11px 2px rgba(255,213,79,0.9); } }
        .htSuspense { animation: htPulseRing 0.6s ease-in-out infinite; border-color: #ffd54f !important; }
        @keyframes htNearPop { 0% { transform: translate(-50%,-50%) scale(0.4); opacity: 0; } 45% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
        @keyframes htNearGlow { from { box-shadow: 0 0 6px rgba(255,106,61,0.5); } to { box-shadow: 0 0 14px rgba(255,106,61,0.95); } }
        .htNear { animation: htNearPop 0.45s ease-out both, htNearGlow 0.85s ease-in-out 0.45s infinite alternate; }
        @keyframes htWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .htWin { animation: htWinPulse 1s ease-in-out infinite; z-index: 2; }
      `}</style>

      {/* 组① 和值 4-17：14 小格 + 大小单双四大格（豹子通杀） */}
      <div style={secBox}>
        {groupHead(0)}
        {open[0] && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(7, 1fr)' : 'repeat(14, 1fr)',
            gap: isMobile ? 3 : 4, marginBottom: 6,
          }}>
            {Array.from({ length: 14 }, (_, i) => totalCell(i + 4))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {SIDES.map(m => (
              <button key={m.key} type="button" className={cellCls(m.key) + wonCls(m.key)} disabled={!betting} onClick={() => onPick(m.key)} style={cellBtn(m.key, { compact: true })}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span className={fxCls(m.key)} style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5, whiteSpace: 'nowrap' }}>{stakeOf(m.key) > 0 ? winTxt(m.key, MARKETS[m.key].odds) : ODDS.side.toFixed(2)}</span>
                <span style={{ color: HATTRICK.dim, fontSize: isMobile ? 7.5 : 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>豹子通杀</span>
                {stakeChip(m.key)}
                {flyDot(m.key)}
                {nearBadge(m.key)}
              </button>
            ))}
          </div>
        </>
        )}
      </div>

      {/* 组② 豹子：任意豹子 + 指定三同六格 */}
      <div style={secBox}>
        {groupHead(1)}
        {open[1] && (
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <button type="button" className={cellCls('tr-any') + wonCls('tr-any')} disabled={!betting} onClick={() => onPick('tr-any')}
            style={{ ...cellBtn('tr-any'), ...(isMobile ? { flex: '1 1 100%' } : { flex: 1.6 }) }}>
            <span style={cellName}>任意豹子</span>
            <span className={fxCls('tr-any')} style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{stakeOf('tr-any') > 0 ? winTxt('tr-any', MARKETS['tr-any'].odds) : ODDS.anyTriple.toFixed(2)}</span>
            {stakeChip('tr-any')}
            {flyDot('tr-any')}
          </button>
          {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
            <button key={v} type="button" className={cellCls(`tr-${v}`) + wonCls(`tr-${v}`)} disabled={!betting} onClick={() => onPick(`tr-${v}`)}
              style={{ ...cellBtn(`tr-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
              <span style={{ display: 'flex', gap: 2 }}>
                {[v, v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 13 : 15} />)}
              </span>
              <span className={fxCls(`tr-${v}`)} style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11, whiteSpace: 'nowrap' }}>{stakeOf(`tr-${v}`) > 0 ? winTxt(`tr-${v}`, MARKETS[`tr-${v}`].odds) : ODDS.triple.toFixed(2)}</span>
              {stakeChip(`tr-${v}`)}
              {flyDot(`tr-${v}`)}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* 组③ 对子：指定对子六格（含该面豹子） */}
      <div style={secBox}>
        {groupHead(2)}
        {open[2] && (
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
            <button key={v} type="button" className={cellCls(`d-${v}`) + wonCls(`d-${v}`)} disabled={!betting} onClick={() => onPick(`d-${v}`)}
              style={{ ...cellBtn(`d-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
              <span style={{ display: 'flex', gap: 2 }}>
                {[v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 14 : 16} />)}
              </span>
              <span className={fxCls(`d-${v}`)} style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11, whiteSpace: 'nowrap' }}>{stakeOf(`d-${v}`) > 0 ? winTxt(`d-${v}`, MARKETS[`d-${v}`].odds) : ODDS.double.toFixed(2)}</span>
              {stakeChip(`d-${v}`)}
              {flyDot(`d-${v}`)}
            </button>
          ))}
        </div>
        )}
      </div>
    </>
  )
}
