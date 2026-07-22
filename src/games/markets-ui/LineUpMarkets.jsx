// #41 单16：LineUp 盘口区（投注盘 A 列表 / B 矩阵 双视图 · 维度 全局/L1-L5 · 42 键同源同 key）——
// 从 LineUp.jsx marketSection 机械切片，逐字节搬 JSX + 样式 + cellBase/cellName/cellRange/cellOdds/secHead/secBox/
// stakeChip/marketCell/pairRows/viewA/viewB，视觉原样。点击回调外置为 onPick(key)；betting 态由 disabled 反推；
// stakes(Map|obj) 贴额；flying 快投 loading；selected/hits 选中/命中态（原页传 picks / result?.hits，多桌不传→空）；
// chipMode 角标改用筹码码。A/B 视图 + 维度 dim 为本件内部 UI 态（原页顶层 state，随件移入，钱路零改）。
// 原页 import 本件组装（桌面/手机双卡同一份）——键区单一出处，逐像素同源。
import { useState } from 'react'
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { MARKETS } from '../markets/lineup'
import Chip from '../../components/shell/Chip'

const EMPTY = new Set()
const ROW_LABELS = ['锋线', '前腰', '中场', '后腰', '后卫']   // L1-L5
// 普通盘四区（足球叙事换皮，段位照参考原文）
const ZONES = [
  { key: 'zone-releg', name: '降级区', range: '0–95' },
  { key: 'zone-mid', name: '中游', range: '96–112' },
  { key: 'zone-euro', name: '欧战区', range: '113–129' },
  { key: 'zone-champ', name: '夺冠', range: '130–225' },
]
// 维度→键名映射：0 全局走普通盘键，1-5 走行式键；引擎无「行高低/行段位」键，禁造键
const keyOf = (d, slot) => d === 0
  ? { home: 'home-more', away: 'away-more', big: 'big', small: 'small', odd: 'odd', even: 'even' }[slot]
  : `L${d}-${slot}`
const DIM_CHIPS = ['全局', ...ROW_LABELS.map((l, i) => `L${i + 1}${l}`)]
// B 视图 6 列（列=主客大小单双，格内只赔率）
const MATRIX_COLS = [
  { slot: 'home', name: '黄', bg: COLORS.amberDeep },
  { slot: 'away', name: '红', bg: DERBY.away },
  { slot: 'big', name: '大', bg: DERBY.grey },
  { slot: 'small', name: '小', bg: DERBY.grey },
  { slot: 'odd', name: '单', bg: DERBY.grey },
  { slot: 'even', name: '双', bg: DERBY.grey },
]

export default function LineUpMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, chipMode = false, big = false }) {
  // #47 三区放大：big 仅调【字号/内距】，A/B 双视图的结构与栅格一字不动（Ray 定版）
  const betting = !disabled
  const [view, setView] = useState('A')       // 投注盘视图：A 列表 / B 矩阵
  const [dim, setDim] = useState(0)           // A 视图维度：0 全局，1-5 行 L1-L5
  const selSet = selected || EMPTY   // null 安全（原页传 picks）
  const hitSet = hits || EMPTY       // null 安全（原页传 result?.hits，仅 settled 非空）
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框；命中=绿框绿晕，同 Derby 惯例）----
  // settled 相位三档：命中+有注 = 绿框绿晕+注码chip；命中+无注 = 绿框亮灯弱一档
  // （无晕）；未命中压暗（有注留金框认输）。A/B 双视图同走这一份，key 同源天然同步；
  // betting/drawing（无 result → hitSet 空）恢复常态不残留
  const cellBase = (key, bg) => {
    const sel = selSet.has(key)
    const isHit = hitSet.has(key)
    const staked = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : big ? '8px 4px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${isHit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: isHit && staked
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: hitSet.size
        ? (isHit ? 1 : staked ? 0.6 : 0.45)
        : betting || staked ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.2s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : big ? 15 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : big ? 11 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : big ? 14.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: big ? 12 : 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${amt}</span>
  }
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: DERBY.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBase 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲(WinFx 样式语言)。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 ? ' luWin' : '')

  // 键格两款：row = 单行（名称左/区间中/赔率右，照参考 Common Bets 行式）；
  // col = 竖排三行（段位 4 键窄格用）
  const marketCell = (key, name, range, bg, layout = 'row') => (
    <button key={key} type="button" className={`luCell${wonCls(key)}`} data-key={key} disabled={!betting} onClick={() => onPick(key)}
      style={{
        ...cellBase(key, bg),
        ...(layout === 'row' ? {
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
        } : { padding: isMobile ? '4px 2px' : '4px' }),
      }}>
      <span style={cellName}>{name}</span>
      <span style={layout === 'row' ? { ...cellRange, flex: 1, textAlign: 'center' } : cellRange}>{range}</span>
      <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
      {stakeChip(key)}{flyDot(key)}
    </button>
  )
  // 高低对 + 段位排（A 全局尾部 / B 矩阵下方共用同一份）
  const hiLoPair = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
      {marketCell('high', '高', '5-9 ≥13', DERBY.grey)}
      {marketCell('low', '低', '0-4 ≥13', DERBY.grey)}
    </div>
  )
  const zonesRow = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
      {ZONES.map(z => marketCell(z.key, z.name, z.range, DERBY.grey, isMobile ? 'col' : 'row'))}
    </div>
  )
  // A 视图：维度 chip + 成对两列（行序固定 主客 → 大小 → 单双 → 高低）
  const pairRows = d => [
    [
      // 键名沿用 home/away（data-key 不动），显示层红黄牌皮；黄键底 = 共享 amberDeep
      { slot: 'home', name: '黄牌多', range: d === 0 ? '黄牌 ≥13' : '黄牌 ≥3', bg: COLORS.amberDeep },
      { slot: 'away', name: '红牌多', range: d === 0 ? '红牌 ≥13' : '红牌 ≥3', bg: DERBY.away },
    ],
    [
      { slot: 'big', name: '大', range: d === 0 ? '113–225' : '23–45', bg: DERBY.grey },
      { slot: 'small', name: '小', range: d === 0 ? '0–112' : '0–22', bg: DERBY.grey },
    ],
    [
      { slot: 'odd', name: '单', range: d === 0 ? '和值单' : '行和单', bg: DERBY.grey },
      { slot: 'even', name: '双', range: d === 0 ? '和值双' : '行和双', bg: DERBY.grey },
    ],
  ]
  const viewA = (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap' }}>
        {DIM_CHIPS.map((label, i) => (
          <button key={i} type="button" onClick={() => setDim(i)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: dim === i ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: dim === i ? '#083a1b' : DERBY.dim,
            border: `1px solid ${dim === i ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>
      {pairRows(dim).map((pair, i) => (
        <div key={i} style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
          {pair.map(m => marketCell(keyOf(dim, m.slot), m.name, m.range, m.bg))}
        </div>
      ))}
      {/* 高低 + 段位仅全局维度（行式引擎无此键） */}
      {dim === 0 && hiLoPair}
      {dim === 0 && zonesRow}
    </>
  )
  // B 视图：6×6 矩阵（列=主客大小单双，行=全局/L1-L5，格内只赔率）+ 高低/段位排底
  const viewB = (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: `${isMobile ? 50 : 64}px repeat(6, 1fr)`,
        gap: 3, marginBottom: isMobile ? 5 : 6,
      }}>
        <span />
        {MATRIX_COLS.map(c => (
          <span key={c.slot} style={{
            textAlign: 'center', fontSize: isMobile ? 10 : big ? 13 : 11, fontWeight: 900,
            color: c.slot === 'home' ? DERBY.gold : c.slot === 'away' ? '#f0938a' : DERBY.dim,
          }}>{c.name}</span>
        ))}
        {[0, 1, 2, 3, 4, 5].map(d => (
          [
            <span key={`r${d}`} style={{
              display: 'inline-flex', alignItems: 'center',
              color: DERBY.text, fontSize: isMobile ? 9.5 : big ? 12.5 : 10.5, fontWeight: 900, whiteSpace: 'nowrap',
            }}>{d === 0 ? '全局' : `L${d} ${ROW_LABELS[d - 1]}`}</span>,
            ...MATRIX_COLS.map(c => {
              const key = keyOf(d, c.slot)
              return (
                <button key={key} type="button" className={`luCell${wonCls(key)}`} data-key={key} disabled={!betting}
                  onClick={() => onPick(key)}
                  style={{ ...cellBase(key, c.bg), padding: big ? '5px 0' : '2px 0' }}>
                  <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
                  {stakeChip(key)}{flyDot(key)}
                </button>
              )
            }),
          ]
        ))}
      </div>
      {hiLoPair}
      {zonesRow}
    </>
  )

  return (
    <>
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }
        @keyframes luWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .luWin { animation: luWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
      <div style={secBox}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={secHead}>投注盘 · {view === 'A' ? DIM_CHIPS[dim] : '总览矩阵'}</div>
          {/* A/B 小切换钮（右上角，选中态两视图互通） */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
            {['A', 'B'].map(v => (
              <button key={v} type="button" onClick={() => setView(v)} style={{
                padding: '2px 8px', borderRadius: RADIUS.pill,
                background: view === v ? DERBY.sel : 'rgba(0,0,0,0.35)',
                color: view === v ? '#083a1b' : DERBY.dim,
                border: `1px solid ${view === v ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
                fontSize: 9, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{v === 'A' ? 'A 列表' : 'B 矩阵'}</button>
            ))}
          </div>
        </div>
        {view === 'A' ? viewA : viewB}
      </div>
    </>
  )
}
