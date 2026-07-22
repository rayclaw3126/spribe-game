// #41 单16：DominoDuel 盘口区（主要盘 主胜/平/客胜 · 主队总分 · 客队总分 · 全场总进球 · 正确比分波胆）——
// 从 DominoDuel.jsx 机械切片，逐字节搬 JSX + 样式 + cellName/cellRange/cellOdds/cellBase/stakeChip/rowCell/colCell/scoreCell/subLabel，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits/pushes 选中/命中/退注态（原页传 picks / result?.hits / result?.pushes，多桌不传→空）；chipMode 角标改用筹码码。
// 非标：DominoDuel 有第三态 push（主胜/客胜遇平局退本 → 橙框），故追加 pushes 集（余款无）。
// 原页 desktop（gameCard 平铺 5 盘，secHead）与 mobile（mobileCard 4 段手风琴，波胆默认收）布局各异且卡型绑定——
// 故除多桌标准签名外，追加可选 section='main'|'totals'|'goals'|'correct' 渲染单段（供原页锁死手风琴逐段接入，保分毫不变）：
//   · section 给定          → 渲染该段紧凑 body（原页锁死手风琴内，无组头）
//   · 无 section & isMobile → 4 段折叠 groupBox（多桌手风琴，openMode；cs-* 波胆默认收，即使 openMode='all'）
//   · 无 section & !isMobile → 桌面平铺 5 盘（原页中区，secHead，分毫不变）
import { useState } from 'react'
import { COLORS, RADIUS, DERBY, LAYOUT } from '../../components/shell/tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { MARKETS } from '../markets/dominoduel'
import Chip from '../../components/shell/Chip'

const EMPTY = new Set()

// 盘面玩法元数据（名/区间/底色；赔率运行时从 MARKETS 取）——逐字节搬自 DominoDuel.jsx
const MAIN = [
  { slot: 'home-win', name: '主队胜', bg: DERBY.home },
  { slot: 'draw', name: '平局', bg: DERBY.grey },
  { slot: 'away-win', name: '客队胜', bg: DERBY.away },
]
const totalRow = side => [
  { slot: `${side}-big`, name: '大', range: '5-9' },
  { slot: `${side}-small`, name: '小', range: '0-4' },
  { slot: `${side}-odd`, name: '单', range: '' },
  { slot: `${side}-even`, name: '双', range: '' },
]
const GOALS = [
  { slot: 'g-big', name: '大', range: '9-18' },
  { slot: 'g-small', name: '小', range: '0-8' },
  { slot: 'g-odd', name: '单', range: '' },
  { slot: 'g-even', name: '双', range: '' },
]
// 正确比分 · 波胆 3列×3行（列=主胜/平/客胜，行序填充）
const CORRECT = [
  { slot: 'cs-1-0', score: '1:0' }, { slot: 'cs-0-0', score: '0:0' }, { slot: 'cs-0-1', score: '0:1' },
  { slot: 'cs-2-1', score: '2:1' }, { slot: 'cs-1-1', score: '1:1' }, { slot: 'cs-1-2', score: '1:2' },
  { slot: 'cs-3-1', score: '3:1' }, { slot: 'cs-2-2', score: '2:2' }, { slot: 'cs-1-3', score: '1:3' },
]

// 4 段（多桌手风琴 / section 键）：主要盘 / 队伍总分(主+客) / 全场总进球 / 正确比分波胆。
// 组头标题照原页 mobile 手风琴标题（分毫不变）；correct=波胆默认收（即使 openMode='all'）。
const GROUPS = [
  { id: 'main', title: '主要盘 · 主胜 / 平 / 客胜' },
  { id: 'totals', title: '队伍总分 · 大小单双' },
  { id: 'goals', title: '全场总进球 · 大小单双' },
  { id: 'correct', title: '正确比分 · 波胆' },
]

export default function DominoDuelMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, pushes = EMPTY, isMobile = false, isDesk: isDeskProp, chipMode = false, openMode = 'all', section , big = false }) {
  const isDeskMedia = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const isDesk = isDeskProp == null ? isDeskMedia : isDeskProp
  const betting = !disabled
  // 4 段折叠/展开（多桌手风琴，每卡独立）：openMode='first' 仅开第一段，'all' 全开；
  // cs-*（波胆，correct 段）恒默认收（原页「波胆默认收」），玩家仍可手开。
  const [open, setOpen] = useState(() => GROUPS.map((g, i) => (g.id === 'correct' ? false : openMode === 'first' ? i === 0 : true)))
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits 可能为 null）
  const hitSet = hits || EMPTY
  const pushSet = pushes || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框；命中=绿框绿晕；push 退注=橙框）——逐字节搬自 DominoDuel.jsx ----
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 4 : 5,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
  }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  // #47 首批：可选 big（桌面放大档，对表五行定稿 键字15/赔率14.5）——默认 false 即原行为。
  // 仅骨牌原页桌面传 true；多桌 marketsUiRegistry→TableCard 与手机段均不传，逐字节零感。
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : big ? 15 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : big ? 11.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : big ? 14.5 : 12, fontWeight: 900 }
  const cellBase = (key, bg) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const push = pushSet.has(key)
    const staked = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed', background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : push ? DERBY.orange : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit ? '0 0 12px rgba(53,208,127,0.6)' : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || push || staked ? 1 : 0.7,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = key => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none', zIndex: 2 }}><Chip value={amt} size={22} /></span>
    return <span style={{
      position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b', fontSize: 8, fontWeight: 900, zIndex: 2,
    }}>${amt}</span>
  }
  const flyDot = key => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: DERBY.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBase 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲。
  const wonCls = key => (hitSet.has(key) && stakeOf(key) > 0 ? ' ddWin' : '')
  const oddsStr = slot => MARKETS[slot].odds.toFixed(2)

  const rowCell = (slot, name, range, bg = DERBY.grey) => (
    <button key={slot} type="button" className={`ddCell${wonCls(slot)}`} data-key={slot} disabled={!betting} onClick={() => onPick(slot)}
      style={{
        ...cellBase(slot, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '6px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{oddsStr(slot)}</span>
      {stakeChip(slot)}{flyDot(slot)}
    </button>
  )
  // 紧凑竖排（名 / 范围小字 / 赔率，各行 nowrap；总分 + 全场进球用，防挤爆）
  const colCell = (slot, name, range, bg = DERBY.grey) => (
    <button key={slot} type="button" className={`ddCell${wonCls(slot)}`} data-key={slot} disabled={!betting} onClick={() => onPick(slot)}
      style={{ ...cellBase(slot, bg), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={cellRange}>{range}</span> : null}
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{oddsStr(slot)}</span>
      {stakeChip(slot)}{flyDot(slot)}
    </button>
  )
  const scoreCell = m => (
    <button key={m.slot} type="button" className={`ddCell${wonCls(m.slot)}`} data-key={m.slot} disabled={!betting} onClick={() => onPick(m.slot)}
      style={{ ...cellBase(m.slot, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={{ ...cellName, fontFamily: "'Space Grotesk', sans-serif" }}>{m.score}</span>
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{oddsStr(m.slot)}</span>
      {stakeChip(m.slot)}{flyDot(m.slot)}
    </button>
  )
  const subLabel = txt => <div style={{ color: DERBY.gold, fontSize: 9.5, fontWeight: 900, letterSpacing: 1, margin: '2px 0 4px' }}>{txt}</div>

  // ---- 段 body（紧凑；原页手机手风琴 mainBody/totalsBody/goalsBody/correctBody 逐字节搬）----
  const mainBody = <div style={{ display: 'flex', gap: 5 }}>{MAIN.map(m => rowCell(m.slot, m.name, '', m.bg))}</div>
  const totalsBody = (
    <>
      {subLabel('主队总分')}
      <div style={{ display: 'flex', gap: 5 }}>{totalRow('h').map(m => colCell(m.slot, m.name, m.range))}</div>
      {subLabel('客队总分')}
      <div style={{ display: 'flex', gap: 5 }}>{totalRow('a').map(m => colCell(m.slot, m.name, m.range))}</div>
    </>
  )
  const goalsBody = <div style={{ display: 'flex', gap: 5 }}>{GOALS.map(m => colCell(m.slot, m.name, m.range))}</div>
  const correctBody = <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>{CORRECT.map(scoreCell)}</div>
  const bodyFor = id => (id === 'main' ? mainBody : id === 'totals' ? totalsBody : id === 'goals' ? goalsBody : correctBody)

  const hoverStyle = (
    <style>{`.ddCell:hover:not(:disabled) { filter: brightness(1.2); }
      @keyframes ddWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
      .ddWin { animation: ddWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
  )

  // ① 单段模式（原页锁死手风琴逐段接入）
  if (section) {
    return <>{hoverStyle}{bodyFor(section)}</>
  }

  // ② 多桌手风琴：4 段 groupBox + 组头 ▾/▸ 折叠（openMode；cs-* 波胆默认收）
  if (isMobile) {
    const groupHead = (i) => (
      <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        marginBottom: open[i] ? 6 : 0, textAlign: 'left',
      }}>
        <span style={{ color: DERBY.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUPS[i].title}</span>
      </button>
    )
    return (
      <>
        {hoverStyle}
        {GROUPS.map((g, i) => (
          <div key={g.id} style={{ borderRadius: 12, padding: 6, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)' }}>
            {groupHead(i)}
            {open[i] && bodyFor(g.id)}
          </div>
        ))}
      </>
    )
  }

  // ③ 桌面平铺 5 盘（原页中区，secHead，分毫不变）
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主要盘 · 主胜 / 平 / 客胜</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {MAIN.map(m => rowCell(m.slot, m.name, '', m.bg))}
      </div>
    </div>
  )
  const totalBoard = (side, label) => (
    <div style={secBox}>
      <div style={secHead}>{label} · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {totalRow(side).map(m => colCell(m.slot, m.name, m.range))}
      </div>
    </div>
  )
  const goalsBoard = (
    <div style={secBox}>
      <div style={secHead}>全场总进球 · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {GOALS.map(m => colCell(m.slot, m.name, m.range))}
      </div>
    </div>
  )
  const correctBoard = (
    <div style={secBox}>
      <div style={secHead}>正确比分 · 波胆</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 5 : 8 }}>
        {CORRECT.map(scoreCell)}
      </div>
    </div>
  )
  return (
    <>
      {hoverStyle}
      {mainBoard}
      <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 5, alignItems: isDesk ? 'stretch' : undefined }}>
        <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('h', '主队总分')}</div>
        <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('a', '客队总分')}</div>
      </div>
      {goalsBoard}
      {correctBoard}
    </>
  )
}
