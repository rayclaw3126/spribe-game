// #41 单14.4：PK10 盘口区（冠军直选车图键 / 冠亚和 / 大小单双）——从 GoldenBoot.jsx 机械切片，
// 逐字节搬 JSX + 样式 + CarImgBead + cellBtn/cellName/cellRange/cellOdds/stakeChip，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits 选中/命中态（原页传 picks / result.hits，多桌不传→空）；chipMode 角标改用筹码码。
// 原页 import 本件组装、多桌 TableCard 同 import——单一出处，键区逐像素同源。
import { useState } from 'react'
import { GOLDENBOOT, RADIUS } from '../../components/shell/tokens'
import { ODDS, SUM_N } from '../markets/goldenboot'
import Chip from '../../components/shell/Chip'
import { CAR_SRC } from './carAssets'

const EMPTY = new Set()
// 三玩法组名（单14.6 item4）：冠军直选/冠亚和 原有；大小单双组原页无独立名 → 用「大小单双」
// （i18n 待办：三组名进词表，禁在此硬造英文）。
const GROUP_TITLES = ['冠军直选', '冠亚和', '大小单双']

// 冠军直选盘口图标：Codex 真车图（car_0X，跟舞台同款）+ 左上角号码 badge（逐字节搬）
export function CarImgBead({ num, size = 30 }) {
  return (
    <div style={{ position: 'relative', width: size * 1.7, height: size }}>
      <img src={CAR_SRC[num]} alt={`car ${num}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      <span style={{
        position: 'absolute', top: -2, left: -2,
        width: size * 0.52, height: size * 0.52, borderRadius: '50%',
        background: 'rgba(0,0,0,0.75)', border: `1px solid ${GOLDENBOOT.gold}`,
        color: GOLDENBOOT.gold, fontSize: size * 0.32, fontWeight: 900, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Space Grotesk', sans-serif", boxSizing: 'border-box',
      }}>{num}</span>
    </div>
  )
}

export default function GoldenBootMarkets({ onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY, isMobile = false, chipMode = false, openMode = 'all' }) {
  const betting = !disabled
  // 三组折叠/展开（单14.6 item5）：默认全开=原页习惯；openMode='first' 时仅开第一组（多桌手风琴记忆，每卡独立）
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits ?? preHits 可能为 null）
  const hitSet = hits || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const placed = stakeOf(key) > 0
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? GOLDENBOOT.selTint : GOLDENBOOT.grey,
      border: `1px solid ${hit ? GOLDENBOOT.sel : sel ? GOLDENBOOT.gold : placed ? GOLDENBOOT.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${GOLDENBOOT.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box',
      position: 'relative',
    }
  }
  const cellName = { color: GOLDENBOOT.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: GOLDENBOOT.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: GOLDENBOOT.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return <span style={{ position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill, background: GOLDENBOOT.sel, color: '#083a1b', fontSize: 8, fontWeight: 900 }}>${amt}</span>
  }
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: GOLDENBOOT.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBtn 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲(WinFx 单8 样式语言)。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 ? ' gbWin' : '')
  // 组头 ▾/▸ 折叠钮（单14.6 item5）：原 gold 标题 → 可开合钮，视觉沿用（gold 标题 + 前置 chevron）。
  const groupHead = (i) => (
    <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      marginBottom: open[i] ? 6 : 0, textAlign: 'left',
    }}>
      <span style={{ color: GOLDENBOOT.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
      <span style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{GROUP_TITLES[i]}</span>
    </button>
  )
  const groupBox = { borderRadius: 12, padding: isMobile ? 6 : 8, background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <>
      <style>{`.gbCell:hover:not(:disabled) { filter: brightness(1.3); }
        @keyframes gbWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
        .gbWin { animation: gbWinPulse 1s ease-in-out infinite; z-index: 2; }`}</style>
      {/* 组① 冠军直选 1–10 */}
      <div style={groupBox}>
        {groupHead(0)}
        {open[0] && (
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" className={`gbCell${wonCls(`w-${n}`)}`} disabled={!betting} onClick={() => onPick(`w-${n}`)}
              style={{ ...cellBtn(`w-${n}`), flexBasis: isMobile ? '17%' : 0 }}>
              <CarImgBead num={n} size={isMobile ? 24 : 30} />
              <span style={cellOdds}>{ODDS.winner.toFixed(2)}</span>
              {stakeChip(`w-${n}`)}{flyDot(`w-${n}`)}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* 组② 冠亚和（和值 3–19）*/}
      <div style={groupBox}>
        {groupHead(1)}
        {open[1] && (
        <div style={{ display: 'flex', gap: isMobile ? 4 : 5, flexWrap: 'wrap' }}>
          {Object.keys(SUM_N).map(s => (
            <button key={s} type="button" className={`gbCell${wonCls(`sum-${s}`)}`} disabled={!betting} onClick={() => onPick(`sum-${s}`)}
              style={{ ...cellBtn(`sum-${s}`, { compact: true }), flexBasis: isMobile ? '14%' : 0, minWidth: isMobile ? 0 : 42 }}>
              <span style={{ ...cellName, fontSize: isMobile ? 11 : 12.5 }}>{s}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 9 : 10.5 }}>{ODDS.sum[s].toFixed(2)}</span>
              {stakeChip(`sum-${s}`)}{flyDot(`sum-${s}`)}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* 组③ 大小单双 */}
      <div style={groupBox}>
        {groupHead(2)}
        {open[2] && (
        <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
          {[
            { key: 's-big',   name: '大', range: '12–19', odds: ODDS.big },
            { key: 's-small', name: '小', range: '3–11',  odds: ODDS.small },
            { key: 's-odd',   name: '单', range: '和为单', odds: ODDS.odd },
            { key: 's-even',  name: '双', range: '和为双', odds: ODDS.even },
          ].map(m => (
            <button key={m.key} type="button" className={`gbCell${wonCls(m.key)}`} disabled={!betting} onClick={() => onPick(m.key)} style={cellBtn(m.key)}>
              <span style={cellName}>{m.name}</span>
              <span style={cellRange}>{m.range}</span>
              <span style={cellOdds}>{m.odds.toFixed(2)}</span>
              {stakeChip(m.key)}{flyDot(m.key)}
            </button>
          ))}
        </div>
        )}
      </div>
    </>
  )
}
