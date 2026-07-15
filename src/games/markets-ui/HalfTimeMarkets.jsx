// #41 单15：HalfTime 盘口区（大小单双·过关 / 球场五段 / 半场）——从 HalfTime.jsx 机械切片，
// 逐字节搬 JSX + 样式 + cellBtn/cellName/cellRange/cellOdds/betCell/hover<style>，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits 选中/命中态（原页传 picks / result?.hits ?? preHits，多桌不传→空）；chipMode 角标改用筹码码。
// 原页 desktop 三行(行①②③) 与 mobile 手风琴三段(body1/2/3) 布局各异且卡型绑定（768–1024 手机卡 isMobile=false）——
// 故除多桌标准签名外，追加可选 section='m1'|'m2'|'m3' 渲染单段（供原页锁死手风琴逐段接入，保分毫不变）：
//   · section 给定       → 渲染该段紧凑 body（原页锁死手风琴内）
//   · 无 section & isMobile → 三段折叠 groupBox（多桌手风琴，openMode）
//   · 无 section & !isMobile → 桌面 行①②③（原页中区，无组头，分毫不变）
import { useState } from 'react'
import { RADIUS, HALFTIME } from '../../components/shell/tokens'
import { MARKETS } from '../markets/halftime'
import Chip from '../../components/shell/Chip'
import { ROW1, PARLAY, ZONES, ROW3, GROUPS } from './halftimeMarketsData'   // 盘面数据（纯常量单一出处）

const EMPTY = new Set()

export default function HalfTimeMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, chipMode = false, openMode = 'all', section }) {
  const betting = !disabled
  // 三段折叠/展开（多桌手风琴，每卡独立）：openMode='first' 仅开第一段，'all' 全开
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits ?? preHits 可能为 null）
  const hitSet = hits || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // cellBtn/cellName/cellRange/cellOdds —— 逐字节搬自 HalfTime.jsx（sel/hit/placed 改读传入 set/stake）
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, padding: compact ? '7px 2px' : '9px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? HALFTIME.selTint : HALFTIME.grey,
      border: `1px solid ${hit ? HALFTIME.gold : sel || placed ? HALFTIME.sel : HALFTIME.cellBorder}`,
      boxShadow: hit
        ? `0 0 12px ${HALFTIME.gold}`
        : sel ? `0 0 10px ${HALFTIME.selTint}` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      position: 'relative',
    }
  }
  const cellName = { color: HALFTIME.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HALFTIME.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HALFTIME.odds, fontSize: isMobile ? 11 : 13, fontWeight: 900 }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 3, right: 4, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return <span style={{ position: 'absolute', top: 3, right: 4, padding: '1px 6px', borderRadius: RADIUS.pill, background: HALFTIME.sel, color: '#083a1b', fontSize: 8.5, fontWeight: 900 }}>${amt}</span>
  }
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: HALFTIME.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBtn 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 ? ' htimeWin' : '')

  const betCell = (m, opts) => (
    <button key={m.key} type="button" className={`htCell${wonCls(m.key)}`} disabled={!betting}
      onClick={() => onPick(m.key)} style={cellBtn(m.key, opts)}>
      <span style={cellName}>{m.name}</span>
      {m.range && <span style={cellRange}>{m.range}</span>}
      <span style={cellOdds}>{MARKETS[m.key].odds.toFixed(2)}</span>
      {stakeChip(m.key)}
      {flyDot(m.key)}
    </button>
  )

  // ---- 段 body（紧凑；原页手机手风琴 body1/body2/body3 逐字节搬）----
  const body1 = (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 100%', display: 'flex', gap: 6 }}>{ROW1.map(m => betCell(m))}</div>
      <div style={{ flex: '1 1 100%', display: 'flex', gap: 6 }}>{PARLAY.map(m => betCell(m, { compact: true }))}</div>
    </div>
  )
  const body2 = (
    <div style={{ position: 'relative', padding: 2 }}>
      <div style={{ position: 'absolute', left: '50%', top: 4, bottom: 4, width: 1, background: 'rgba(255,255,255,0.18)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 34, height: 34, border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', gap: 4, position: 'relative' }}>{ZONES.map(m => betCell(m))}</div>
    </div>
  )
  const body3 = (
    <div style={{ display: 'flex', gap: 6, width: '100%' }}>{ROW3.map(m => betCell(m))}</div>
  )
  const bodyFor = (id) => (id === 'm1' ? body1 : id === 'm2' ? body2 : body3)

  const hoverStyle = (
    <style>{`.htCell:hover:not(:disabled) { filter: brightness(1.3); }
      @keyframes htimeWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
      .htimeWin { animation: htimeWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
  )

  // ① 单段模式（原页锁死手风琴逐段接入）
  if (section) {
    return <>{hoverStyle}{bodyFor(section)}</>
  }

  // ② 多桌手风琴：三段 groupBox + 组头 ▾/▸ 折叠（openMode）
  if (isMobile) {
    const groupHead = (i) => (
      <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        marginBottom: open[i] ? 6 : 0, textAlign: 'left',
      }}>
        <span style={{ color: HALFTIME.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
        <span style={{ color: HALFTIME.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUPS[i].title}</span>
      </button>
    )
    return (
      <>
        {hoverStyle}
        {GROUPS.map((g, i) => (
          <div key={g.id} style={{ borderRadius: 12, padding: 6, background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)' }}>
            {groupHead(i)}
            {open[i] && bodyFor(g.id)}
          </div>
        ))}
      </>
    )
  }

  // ③ 桌面 行①②③（原页中区，无组头，分毫不变）
  return (
    <>
      {hoverStyle}
      {/* 行① Over/Under + Odd/Even + Parlay */}
      <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
          {ROW1.map(m => betCell(m))}
        </div>
        <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
          {PARLAY.map(m => betCell(m, { compact: true }))}
        </div>
      </div>

      {/* 行② 球场五段 — 中场线贯穿，五格贴片 */}
      <div style={{
        position: 'relative', borderRadius: 12, padding: isMobile ? 6 : 8,
        background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{
          position: 'absolute', left: '50%', top: 6, bottom: 6, width: 1,
          background: 'rgba(255,255,255,0.18)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: '50%', top: '50%', width: isMobile ? 34 : 46, height: isMobile ? 34 : 46,
          border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%',
          transform: 'translate(-50%, -50%)', pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', gap: isMobile ? 4 : 8, position: 'relative' }}>
          {ZONES.map(m => betCell(m))}
        </div>
      </div>

      {/* 行③ 1st Half / Draw / 2nd Half */}
      <div style={{ display: 'flex', gap: isMobile ? 6 : 8, width: '100%' }}>
        {ROW3.map(m => betCell(m))}
      </div>
    </>
  )
}
