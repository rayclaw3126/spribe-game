// #41 单15：SpeedGrid 盘口区（主盘 大小/单双/红黑 · 发车三段+车队 · 车号直选 4×6）——
// 从 SpeedGrid.jsx 机械切片，逐字节搬 JSX + 样式 + cellBase/cellName/cellRange/cellOdds/secBox/stakeChip/rowCell，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits 选中/命中态（原页传 picks / result?.hits，多桌不传→空）；chipMode 角标改用筹码码；
// openMode 折叠记忆（'all' 原页习惯全开 / 'first' 多桌手风琴仅开首组）。
// 原页 import 本件组装、多桌 TableCard 同 import——单一出处，键区逐像素同源。
import { useState } from 'react'
import { COLORS, RADIUS, DERBY, ROULETTE, LAYOUT } from '../../components/shell/tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { MARKETS } from '../markets/speedgrid'
import Chip from '../../components/shell/Chip'
import { TEAMS, teamOf } from './speedgridTeams'

const EMPTY = new Set()
// 三组组名（单15 item5）：原页 secHead 三条真实中文标题，逐字节沿用（禁硬造英文）。
const GROUP_TITLES = ['主盘 · 冠军车号', '发车三段 · 第1/2/3个8 ｜ 车队涂装', '车号直选 · 4×6']

export default function SpeedGridMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, isDesk: isDeskProp, chipMode = false, openMode = 'all' }) {
  const isDeskMedia = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const isDesk = isDeskProp == null ? isDeskMedia : isDeskProp
  const betting = !disabled
  // 三组折叠/展开（单15 item5）：默认全开=原页习惯；openMode='first' 时仅开第一组（多桌手风琴记忆，每卡独立）
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits 可能为 null）
  const hitSet = hits || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框；命中=绿框绿晕）----
  const cellBase = (key, bg) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const staked = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0,
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || staked ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = key => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return (
      <span style={{
        position: 'absolute', top: 2, right: 3,
        padding: '1px 5px', borderRadius: RADIUS.pill,
        background: DERBY.sel, color: '#083a1b',
        fontSize: 8, fontWeight: 900,
      }}>${amt}</span>
    )
  }
  const flyDot = key => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: DERBY.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBase 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲(WinFx 样式语言)。
  const wonCls = key => (hitSet.has(key) && stakeOf(key) > 0 ? ' sgWin' : '')
  // 组头 ▾/▸ 折叠钮（单15 item5）：原 secHead(gold 标题) → 可开合钮，视觉沿用（gold 标题 + 前置 chevron）。
  const groupHead = (i) => (
    <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      marginBottom: open[i] ? 4 : 0, textAlign: 'left',
    }}>
      <span style={{ color: DERBY.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
      <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUP_TITLES[i]}</span>
    </button>
  )
  // 单行键（名称左/区间中/赔率右，照 Line Up 定案行式）
  const rowCell = (key, name, range, odds, bg = DERBY.grey) => (
    <button key={key} type="button" className={`sgCell${wonCls(key)}`} data-key={key} disabled={!betting} onClick={() => onPick(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span>
      <span style={cellOdds}>{odds}</span>
      {stakeChip(key)}{flyDot(key)}
    </button>
  )

  // ---- ② 盘区：主盘 6 键 + 三段 3 键 + 车队 4 键 + 24 直选 ----
  const mainBoard = (
    <div style={secBox}>
      {groupHead(0)}
      {open[0] && (
      <>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '13-24', MARKETS.big.odds.toFixed(2))}
        {rowCell('small', '小', '1-12', MARKETS.small.odds.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('odd', '单', '车号单', MARKETS.odd.odds.toFixed(2))}
        {rowCell('even', '双', '车号双', MARKETS.even.odds.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('red', '红', '12 红号', MARKETS.red.odds.toFixed(2), DERBY.away)}
        {rowCell('black', '黑', '12 黑号', MARKETS.black.odds.toFixed(2), ROULETTE.black)}
      </div>
      </>
      )}
    </div>
  )
  const rowBoard = (
    <div style={secBox}>
      {groupHead(1)}
      {open[1] && (
      <>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('grid-front', '头排', '1-8', MARKETS['grid-front'].odds.toFixed(2))}
        {rowCell('grid-mid', '中段', '9-16', MARKETS['grid-mid'].odds.toFixed(2))}
        {rowCell('grid-rear', '尾排', '17-24', MARKETS['grid-rear'].odds.toFixed(2))}
      </div>
      {/* 车队行：430 宽一行四键装不下（team-3/4 键内溢出实测），移动改 2×2；桌面保持一行 */}
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {TEAMS.map((t, i) => rowCell(`team-${i + 1}`, t.name, t.range, MARKETS[`team-${i + 1}`].odds.toFixed(2), t.c))}
      </div>
      </>
      )}
    </div>
  )
  const pickBoard = (
    <div style={secBox}>
      {groupHead(2)}
      {open[2] && (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
        gap: isMobile ? 4 : 6,
      }}>
        {Array.from({ length: 24 }, (_, i) => {
          const n = i + 1
          const t = teamOf(n)
          return (
            <button key={n} type="button" className={`sgCell${wonCls(`car-${n}`)}`} data-key={`car-${n}`} disabled={!betting} onClick={() => onPick(`car-${n}`)}
              style={{ ...cellBase(`car-${n}`, t.c), padding: isMobile ? '4px 0' : '5px 0' }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : 14, fontFamily: "'Space Grotesk', sans-serif" }}>{n}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 8.5 : 9.5 }}>{MARKETS[`car-${n}`].odds.toFixed(2)}</span>
              {stakeChip(`car-${n}`)}{flyDot(`car-${n}`)}
            </button>
          )
        })}
      </div>
      )}
    </div>
  )

  return (
    <>
      <style>{`.sgCell:hover:not(:disabled) { filter: brightness(1.2); }
        @keyframes sgWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .sgWin { animation: sgWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
      <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
        <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
        <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{rowBoard}</div>
      </div>
      {pickBoard}
    </>
  )
}
