// #41 单16：WuXing 盘口区（主盘 大小/单双 · 龙虎·上下 · 过关四组合 · 五行五段）——
// 从 WuXing.jsx 机械切片，逐字节搬 JSX + 样式 + cellBase/cellName/cellRange/cellOdds/secBox/stakeChip/rowCell +
// 桌面 ② 盘区并排布局（主盘 flex1 / 龙虎上下 flex1.4 一行，过关/五行整行），视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits 选中/命中态（原页传 picks / result?.hits ?? preHits，多桌不传→空）；chipMode 角标改用筹码码；
// openMode 折叠记忆（'all' 原页习惯全开 / 'first' 多桌手风琴仅开首组）。
// 判定/赔率单一出处走引擎 markets/wuxing（赔率数字照原页硬字面）；WUXING 五段走 wuxingShared（禁二份表）。
import { useState } from 'react'
import { COLORS, RADIUS, DERBY, LAYOUT } from '../../components/shell/tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import Chip from '../../components/shell/Chip'
import { WUXING } from './wuxingShared'

const EMPTY = new Set()
// 四玩法组名（单16）：原页 secHead 四条真实中文标题，逐字节沿用（禁硬造英文）。
const GROUP_TITLES = ['主盘 · 总和', '龙虎（和值十位/末位）｜ 上下（1-40/41-80 计数）', '过关四组合', '五行 · 总和五段']

export default function WuXingMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, isDesk: isDeskProp, chipMode = false, openMode = 'all' }) {
  const isDeskMedia = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const isDesk = isDeskProp == null ? isDeskMedia : isDeskProp
  const betting = !disabled
  // 四组折叠/展开（单16）：默认全开=原页习惯（secHead 常显）；openMode='first' 时仅开第一组（多桌手风琴记忆，每卡独立）
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false, false] : [true, true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits ?? preHits 可能为 null）
  const hitSet = hits || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框，同 Line Up 惯例；命中=绿框绿晕）——逐字节搬原页 ----
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
  const wonCls = key => (hitSet.has(key) && stakeOf(key) > 0 ? ' wxWin' : '')
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 组头 ▾/▸ 折叠钮（单16）：原 secHead(gold 标题) → 可开合钮，视觉沿用（gold 标题 + 前置 chevron）。
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
    <button key={key} type="button" className={`wxCell${wonCls(key)}`} data-key={key} disabled={!betting} onClick={() => onPick(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{odds}</span>
      {stakeChip(key)}{flyDot(key)}
    </button>
  )

  // ---- ② 盘区：主盘 / 龙虎·上下 / 过关四组合 / 五行五段 ----
  const mainBoard = (
    <div style={secBox}>
      {groupHead(0)}
      {open[0] && (
      <>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '811-1410', '1.95')}
        {rowCell('small', '小', '210-810', '1.92')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('odd', '单', '总和单', '1.95')}
        {rowCell('even', '双', '总和双', '1.95')}
      </div>
      </>
      )}
    </div>
  )
  const dtudBoard = (
    <div style={secBox}>
      {groupHead(1)}
      {open[1] && (
      <>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('dragon', '龙', '十位', '2.13')}
        {rowCell('dt-tie', '龙虎和', '', '9.55')}
        {rowCell('tiger', '虎', '末位', '2.13')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('up', '上', '≥11 个', '2.40')}
        {rowCell('ud-tie', '上下和', '10-10', '4.70')}
        {rowCell('down', '下', '≥11 个', '2.40')}
      </div>
      </>
      )}
    </div>
  )
  const parlayBoard = (
    <div style={secBox}>
      {groupHead(2)}
      {open[2] && (
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {rowCell('big-odd', '大单', '', '3.82')}
        {rowCell('small-odd', '小单', '', '3.82')}
        {rowCell('big-even', '大双', '', '3.82')}
        {rowCell('small-even', '小双', '', '3.82')}
      </div>
      )}
    </div>
  )
  // 五行五段：双端横排 5 列 grid（金→土），格内竖排 字大/区间小/赔率；
  // 430 区间小字降到 8px 保全字（禁截断禁溢出）
  const wuxingBoard = (
    <div style={secBox}>
      {groupHead(3)}
      {open[3] && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {WUXING.map(w => (
          <button key={w.key} type="button" className={`wxCell${wonCls(w.key)}`} data-key={w.key} disabled={!betting} onClick={() => onPick(w.key)}
            style={{ ...cellBase(w.key, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px' }}>
            <span style={{ ...cellName, fontSize: isMobile ? 14 : 16 }}>{w.name}</span>
            <span style={{ ...cellRange, fontSize: isMobile ? 8 : 9.5 }}>{w.range}</span>
            <span style={cellOdds}>{w.odds}</span>
            {stakeChip(w.key)}{flyDot(w.key)}
          </button>
        ))}
      </div>
      )}
    </div>
  )

  return (
    <>
      <style>{`.wxCell:hover { filter: brightness(1.2); }
        @keyframes wxWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .wxWin { animation: wxWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
      {/* desk 主盘/龙虎上下并排（flex1 / flex1.4 压总高）；mobile 纵排 */}
      <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
        <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
        <div style={isDesk ? { flex: '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{dtudBoard}</div>
      </div>
      {/* 过关一行；五行 desk 独占整行 */}
      {parlayBoard}
      {wuxingBoard}
    </>
  )
}
