// #41 单16：DerbyDay 盘口区（半场组 + 全场组 各:胜负/大小/单双 + 半全场四键）——从 DerbyDay.jsx 机械切片，
// 逐字节搬 JSX + 样式 + cellBase/cellName/cellRange/cellOdds/secHead/secBox/stakeChip/hexA/ddWinBreath<style>，视觉原样。
// 点击回调外置为 onPick(key)；betting 态由 disabled 反推；stakes(Map|obj) 贴额；flying 快投 loading；
// selected/hits 选中/命中态（原页传 picks / result?.hits ?? preHits，多桌不传→空）；chipMode 角标改用筹码码。
// DerbyDay 非标扩展（原页专属，多桌缺省即退回标准口径）：
//   · pushes（H/A/半全场平局退注键集，原页 result?.pushes）→ 灰白框；缺省 EMPTY。
//   · sideWins（FT 定格胜侧呼吸光 / 败侧压暗，原页派生对象；键→true 呼吸/false 压暗）→ 缺省 null 不出。
//   · isDesk（桌面并排压总高：cellBase padding / secBox padding / 两组 flex-row）→ 缺省 false。
//   · section='ht'|'ft'|'htft'（原页手机锁死手风琴逐段接入，保分毫不变）：
//       section 给定       → 渲染该段紧凑 body（原页手风琴内，无 secBox/secHead）
//       无 section & isMobile → 三段折叠 groupBox + ▾/▸（多桌手风琴，openMode）
//       无 section & !isMobile → 桌面 两组并排 + 半全场组（原页中区，分毫不变）
// 判定/赔率单一出处走引擎 MARKETS/ODDS（禁二份表）。
import { useState } from 'react'
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { ODDS, MARKETS } from '../markets/derbyday'
import Chip from '../../components/shell/Chip'
import { GROUPS, HTFT } from './derbydayMarketsData'

const EMPTY = new Set()
// 胜侧呼吸光灯色：由 DERBY.home/away 现组 hexA 派生（原页 hexA 逐字节搬）
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export default function DerbyDayMarkets({
  onPick, stakes, disabled = false, flying, selected = EMPTY, hits = EMPTY,
  pushes = EMPTY, sideWins = null, isMobile = false, isDesk = false,
  chipMode = false, openMode = 'all', section,
}) {
  const betting = !disabled
  // 三段折叠/展开（多桌手风琴，每卡独立）：openMode='first' 仅开第一段，'all' 全开
  const [open, setOpen] = useState(() => openMode === 'first' ? [true, false, false] : [true, true, true])
  const toggleGroup = (i) => setOpen(o => o.map((v, idx) => (idx === i ? !v : v)))
  const selSet = selected || EMPTY   // null 安全（原页传 result?.hits ?? preHits 可能为 null）
  const hitSet = hits || EMPTY
  const pushSet = pushes || EMPTY
  const stakeOf = (key) => (stakes instanceof Map ? stakes.get(key) : stakes?.[key]) || 0

  // ---- 样式件（选中=金框；命中=绿框绿晕；push=灰金框；胜侧呼吸 / 败侧压暗）——逐字节搬原页 cellBase ----
  const cellBase = (key, bg) => {
    const sel = selSet.has(key)
    const hit = hitSet.has(key)
    const pushed = pushSet.has(key) && stakeOf(key) > 0
    const placed = stakeOf(key) > 0
    const sideWin = sideWins && Object.prototype.hasOwnProperty.call(sideWins, key) ? sideWins[key] : undefined
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : isDesk ? '5px 4px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : pushed ? 'rgba(255,255,255,0.6)' : sel || placed ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || pushed || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
      // 胜侧呼吸光 / 败侧压暗（覆盖在基础分层之上）
      ...(sideWin === true
        ? { animation: `${key.endsWith('home') ? 'ddWinBreathH' : 'ddWinBreathA'} 1.3s ease-in-out infinite` }
        : sideWin === false ? { opacity: 0.45 } : {}),
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 角标：原页 = 文字 $X 绿标（分毫不变）；多桌 chipMode = 筹码码叠角（不改键内布局）。
  const stakeChip = (key) => {
    const amt = stakeOf(key)
    if (!(amt > 0)) return null
    if (chipMode) return <span style={{ position: 'absolute', top: 2, right: 3, lineHeight: 0, pointerEvents: 'none' }}><Chip value={amt} size={22} /></span>
    return <span style={{ position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill, background: DERBY.sel, color: '#083a1b', fontSize: 8, fontWeight: 900 }}>${amt}</span>
  }
  // 快投 loading 点（原页无此态，flying 缺省 → 恒 null，原页分毫不变；多桌快投用，同 GoldenBoot）
  const flyDot = (key) => (flying?.[key] ? <span style={{ position: 'absolute', top: 2, left: 2, width: 5, height: 5, borderRadius: '50%', background: DERBY.gold, pointerEvents: 'none' }} /> : null)
  // 中奖高亮标准（hits 必接）：命中键走原版高亮(cellBase 内)；押中(有码)+命中 = 你中了 → 外加金边脉冲(.ddayWin)。
  const wonCls = (key) => (hitSet.has(key) && stakeOf(key) > 0 ? ' ddayWin' : '')

  // ---- 盘区两组主体（队色语义格）——逐字节搬原页 marketBody / marketGroup 单元 ----
  const homeAwayRow = (g, gap) => (
    <div style={{ display: 'flex', gap, marginBottom: gap === 5 ? 5 : (isMobile ? 5 : 6) }}>
      <button type="button" className={`ddCell${wonCls(`${g.key}-home`)}`} disabled={!betting} onClick={() => onPick(`${g.key}-home`)} style={cellBase(`${g.key}-home`, DERBY.home)}>
        <span style={cellName}>主队</span><span style={cellOdds}>{ODDS.main.toFixed(2)}</span>{stakeChip(`${g.key}-home`)}{flyDot(`${g.key}-home`)}
      </button>
      <button type="button" className={`ddCell${wonCls(`${g.key}-away`)}`} disabled={!betting} onClick={() => onPick(`${g.key}-away`)} style={cellBase(`${g.key}-away`, DERBY.away)}>
        <span style={cellName}>客队</span><span style={cellOdds}>{ODDS.main.toFixed(2)}</span>{stakeChip(`${g.key}-away`)}{flyDot(`${g.key}-away`)}
      </button>
    </div>
  )
  const sizeParRow = (g, gap) => (
    <div style={{ display: 'flex', gap }}>
      {[
        { k: 'big', name: '大', range: g.big },
        { k: 'small', name: '小', range: g.small },
        { k: 'odd', name: '单', range: '和值单' },
        { k: 'even', name: '双', range: '和值双' },
      ].map(m => (
        <button key={m.k} type="button" className={`ddCell${wonCls(`${g.key}-${m.k}`)}`} disabled={!betting} onClick={() => onPick(`${g.key}-${m.k}`)} style={cellBase(`${g.key}-${m.k}`, DERBY.grey)}>
          <span style={cellName}>{m.name}</span><span style={cellRange}>{m.range}</span><span style={cellOdds}>{MARKETS[`${g.key}-${m.k}`].odds.toFixed(2)}</span>{stakeChip(`${g.key}-${m.k}`)}{flyDot(`${g.key}-${m.k}`)}
        </button>
      ))}
    </div>
  )
  // 段 body（紧凑 gap 5；原页手机手风琴 marketBody 逐字节搬）
  const marketBody = g => (
    <>
      {homeAwayRow(g, 5)}
      {sizeParRow(g, 5)}
    </>
  )
  // 桌面组（secBox + secHead + gap isMobile?5:8；原页 marketGroup 逐字节搬）
  const marketGroup = g => (
    <div key={g.key} style={{ ...secBox, ...(isDesk ? { flex: '1 1 0', minWidth: 0 } : {}) }}>
      <div style={secHead}>{g.label}</div>
      {homeAwayRow(g, isMobile ? 5 : 8)}
      {sizeParRow(g, isMobile ? 5 : 8)}
    </div>
  )

  // ---- 半全场组合盘（D3 已定价接结算：走 MARKETS 既有 hit/push 路径）——原页 htftCell 逐字节搬 ----
  const htftCell = m => (
    <button key={m.key} type="button" className={`ddCell${wonCls(m.key)}`} data-key={m.key} disabled={!betting}
      onClick={() => onPick(m.key)} style={cellBase(m.key, DERBY.grey)}>
      <span style={cellName}>
        <span style={{ color: m.a === '主' ? DERBY.home : DERBY.away }}>{m.a}</span>
        <span style={{ color: DERBY.dim, padding: '0 3px' }}>/</span>
        <span style={{ color: m.b === '主' ? DERBY.home : DERBY.away }}>{m.b}</span>
      </span>
      <span style={cellOdds}>{MARKETS[m.key].odds.toFixed(2)}</span>
      {stakeChip(m.key)}{flyDot(m.key)}
    </button>
  )
  // 段 body（紧凑 gap 5；原页 htftBody 逐字节搬）
  const htftBody = (
    <>
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>{HTFT.slice(0, 2).map(htftCell)}</div>
      <div style={{ display: 'flex', gap: 5 }}>{HTFT.slice(2).map(htftCell)}</div>
    </>
  )
  // 桌面组（secBox + secHead + gap isMobile?5:8；原页 htftGroup 逐字节搬）
  const htftGroup = (
    <div style={secBox}>
      <div style={secHead}>半全场 · 半场胜方 / 全场胜方</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>{HTFT.slice(0, 2).map(htftCell)}</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>{HTFT.slice(2).map(htftCell)}</div>
    </div>
  )

  const hoverStyle = (
    <style>{`
      .ddCell:hover:not(:disabled) { filter: brightness(1.2); }
      @keyframes ddWinBreathH { 0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.home, 0.45)}; } 50% { box-shadow: 0 0 18px ${hexA(DERBY.home, 0.8)}, 0 0 30px ${hexA(DERBY.home, 0.4)}; } }
      @keyframes ddWinBreathA { 0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.away, 0.45)}; } 50% { box-shadow: 0 0 18px ${hexA(DERBY.away, 0.8)}, 0 0 30px ${hexA(DERBY.away, 0.4)}; } }
      @keyframes ddayWinPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0.0) } 45% { box-shadow: 0 0 0 3px rgba(255,213,79,0.95), 0 0 14px rgba(255,213,79,0.6) } }
      .ddayWin { animation: ddayWinPulse 1s ease-in-out infinite; z-index: 2; }
    `}</style>
  )

  // ① 单段模式（原页锁死手风琴逐段接入）
  if (section) {
    const body = section === 'ht' ? marketBody(GROUPS[0]) : section === 'ft' ? marketBody(GROUPS[1]) : htftBody
    return <>{hoverStyle}{body}</>
  }

  // ② 多桌手风琴：三段 groupBox + 组头 ▾/▸ 折叠（openMode）
  if (isMobile) {
    const groupHead = (i, title) => (
      <button type="button" onClick={() => toggleGroup(i)} aria-expanded={open[i]} style={{
        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        marginBottom: open[i] ? 6 : 0, textAlign: 'left',
      }}>
        <span style={{ color: DERBY.dim, fontSize: 9, width: 8, fontWeight: 900 }}>{open[i] ? '▾' : '▸'}</span>
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{title}</span>
      </button>
    )
    const groups = [
      { title: GROUPS[0].label, body: marketBody(GROUPS[0]) },
      { title: GROUPS[1].label, body: marketBody(GROUPS[1]) },
      { title: '半全场 · 半场胜方 / 全场胜方', body: htftBody },
    ]
    return (
      <>
        {hoverStyle}
        {groups.map((g, i) => (
          <div key={i} style={{ borderRadius: 12, padding: 6, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)' }}>
            {groupHead(i, g.title)}
            {open[i] && g.body}
          </div>
        ))}
      </>
    )
  }

  // ③ 桌面：两组并排（isDesk row 压总高）+ 半全场组（原页中区，分毫不变）
  return (
    <>
      {hoverStyle}
      <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
        {GROUPS.map(marketGroup)}
      </div>
      {htftGroup}
    </>
  )
}
