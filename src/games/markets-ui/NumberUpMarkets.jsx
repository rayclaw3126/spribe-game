// #41 单15：NumberUp 盘口区（直选 00–49 网格 / 首位·尾数 / 大小·单双）——从 NumberUp.jsx 机械切片，
// 逐字节搬 JSX + 样式 + cellBtn/gridCell/cellName/cellRange/cellOdds/stakeChip + .nuCell hover，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading（原页无→空）；
// selected/hits 选中/命中态（原页传 picks / result?.hits ?? preHits，多桌不传→空）；chipMode 角标改用筹码码。
// 三组名 = 原手机手风琴同名（直选·赔率 / 首位·尾数 / 大小·单双）；组头 ▾/▸ 折叠沿 GoldenBoot 口径。
// 原页 import 本件组装（桌面），多桌 TableCard 同 import——键区逐像素同源；赔率全读引擎 ODDS。
import { useState } from 'react'
import { NUMBERUP, RADIUS } from '../../components/shell/tokens'
import { ODDS } from '../markets/numberup'
import Chip from '../../components/shell/Chip'

const EMPTY = new Set()

const SIDES = [
  { key: 's-high', name: '大', range: '25–49' },
  { key: 's-low',  name: '小', range: '00–24' },
  { key: 's-odd',  name: '单', range: '尾数单' },
  { key: 's-even', name: '双', range: '尾数双' },
]
const pad2 = n => String(n).padStart(2, '0')

export default function NumberUpMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, chipMode = false, openMode = 'all' }) {
  const betting = !disabled
  // 三组折叠/展开：默认全开=原页习惯；openMode='first' 时仅开第一组（多桌手风琴记忆，每卡独立）
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits ?? preHits 可能为 null）
  const hitSet = hits || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0
  // 三组标题（与原手机手风琴同名；组① 带赔率，走引擎 ODDS）
  const GROUP_TITLES = [`直选 · 赔率 ${ODDS.pick.toFixed(2)}`, '首位 · 尾数', '大小 · 单双']

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）逐字节搬 ----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? NUMBERUP.selTint : NUMBERUP.grey,
      border: `1px solid ${hit ? NUMBERUP.sel : sel || placed ? NUMBERUP.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${NUMBERUP.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box',
      position: 'relative',
    }
  }
  const cellName = { color: NUMBERUP.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: NUMBERUP.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: NUMBERUP.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const secHead = { color: NUMBERUP.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return <span style={{ position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill, background: NUMBERUP.sel, color: '#083a1b', fontSize: 8, fontWeight: 900 }}>${amt}</span>
  }
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: NUMBERUP.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBtn/gridCell 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 ? ' nuWin' : '')

  // 10×5 直选网格格（选中亮金 / 已下注金框 / 命中亮绿）逐字节搬
  const gridCell = n => {
    const key = `n-${pad2(n)}`
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return (
      <button key={key} type="button" className={`nuCell${wonCls(key)}`} disabled={!betting} onClick={() => onPick(key)} style={{
        height: isMobile ? 28 : 22, minWidth: 0, padding: 0,
        borderRadius: 6, cursor: betting ? 'pointer' : 'not-allowed',
        background: hit ? NUMBERUP.sel : sel ? NUMBERUP.gold : NUMBERUP.grey,
        border: `1px solid ${hit ? NUMBERUP.sel : sel || placed ? NUMBERUP.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: hit ? '0 0 10px rgba(53,208,127,0.7)' : sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        color: hit || sel ? '#083a1b' : NUMBERUP.text,
        fontSize: isMobile ? 10.5 : 10, fontWeight: 800,
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box',
        transition: 'background 0.1s, box-shadow 0.1s',
        position: 'relative',
      }}>{pad2(n)}</button>
    )
  }

  // 组头 ▾/▸ 折叠钮：原 gold secHead → 可开合钮，视觉沿用（gold 标题 + 前置 chevron）。
  const groupHead = (i) => (
    <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      marginBottom: open[i] ? 6 : 0, textAlign: 'left',
    }}>
      <span style={{ color: NUMBERUP.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
      <span style={{ color: NUMBERUP.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUP_TITLES[i]}</span>
    </button>
  )
  const groupBoxBase = { borderRadius: 12, padding: isMobile ? 6 : 8, background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <>
      <style>{`.nuCell:hover:not(:disabled) { filter: brightness(1.3); }
        @keyframes nuWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .nuWin { animation: nuWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>

      {/* 组① 直选 00–49（桌面内滚：minHeight130 + overflowY；手机去内滚随中滚展开）*/}
      <div style={{ ...groupBoxBase, boxSizing: 'border-box', ...(!isMobile ? { flex: '0 1 auto', minHeight: 130, overflowY: 'auto' } : {}) }}>
        {groupHead(0)}
        {open[0] && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3 }}>
          {Array.from({ length: 50 }, (_, i) => gridCell(i))}
        </div>
        )}
      </div>

      {/* 组② 首位 / 尾数（desk 并列，mobile 堆叠）*/}
      <div style={{ ...groupBoxBase, flex: '0 0 auto' }}>
        {groupHead(1)}
        {open[1] && (
        <div style={{ display: 'flex', gap: isMobile ? 8 : 14, flexDirection: isMobile ? 'column' : 'row' }}>
          {[
            { pre: 'fd', label: `首位 · ${ODDS.firstDigit.toFixed(2)}`, count: 5 },
            { pre: 'ld', label: `尾数 · ${ODDS.lastDigit.toFixed(2)}`, count: 10 },
          ].map(g => (
            <div key={g.pre} style={{ flex: 1, minWidth: 0 }}>
              <div style={secHead}>{g.label}</div>
              <div style={{ display: 'flex', gap: isMobile ? 3 : 4 }}>
                {Array.from({ length: g.count }, (_, d) => (
                  <button key={d} type="button" className={`nuCell${wonCls(`${g.pre}-${d}`)}`} disabled={!betting} onClick={() => onPick(`${g.pre}-${d}`)}
                    style={{ ...cellBtn(`${g.pre}-${d}`, { compact: true }), padding: '4px 0' }}>
                    <span style={{ ...cellName, fontSize: isMobile ? 11 : 12 }}>{d}</span>
                    {stakeChip(`${g.pre}-${d}`)}{flyDot(`${g.pre}-${d}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* 组③ 大 / 小 / 单 / 双 */}
      <div style={{ ...groupBoxBase, flex: '0 0 auto' }}>
        {groupHead(2)}
        {open[2] && (
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
          {SIDES.map(m => (
            <button key={m.key} type="button" className={`nuCell${wonCls(m.key)}`} disabled={!betting} onClick={() => onPick(m.key)} style={cellBtn(m.key, { compact: true })}>
              <span style={cellName}>{m.name}</span>
              <span style={cellRange}>{m.range}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5 }}>{ODDS.side.toFixed(2)}</span>
              {stakeChip(m.key)}{flyDot(m.key)}
            </button>
          ))}
        </div>
        )}
      </div>
    </>
  )
}
