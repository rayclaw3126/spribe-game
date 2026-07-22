// #41 单16：DerbyDay 珠盘路墙（半场/全场 × 胜负/大小/单双 六页签 + 占比条 + 6×N 珠矩阵）——
// 从 DerbyDay.jsx beadRoad(桌面 6×20 + 占比条含「和」) + 锁底 road(手机 2×20 15px 细占比条) 机械切片。
// 判定 beadFor 走引擎口径（HT_BIG/FT_BIG 与 markets/derbyday 同源阈值，禁二份表）。
// props {history,tab,onTab,cols,rows,style,compact,isMobile}：history = [[htHome,htAway,ftHome,ftAway],...]
//   （原页 state / 多桌派生；beadFor 消费该四元数组）；compact = 手机锁底/多桌紧凑变体（页签横滚 + 2 行 15px
//   + 细占比条只显主/客），非 compact = 桌面 6 行 + 占比条含「和」+ 页签换行。style 覆外框（桌面 margin / 手机 padding）。
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { HT_BIG, FT_BIG } from '../markets/derbyday'
import { ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT } from './roadWindow'   // #47：路珠动效（共用）

// ---------- 珠盘路（六页签）——从原页机械切至此（页签/判定单一出处）----------
const ROAD_TABS = ['HT-H/A', 'HT-O/U', 'HT-O/E', 'FT-H/A', 'FT-O/U', 'FT-O/E']
// 页签中文显示标签（key = 内部值不碰，仅译显示层）
const ROAD_TAB_LABELS = {
  'HT-H/A': '半场胜负', 'HT-O/U': '半场大小', 'HT-O/E': '半场单双',
  'FT-H/A': '全场胜负', 'FT-O/U': '全场大小', 'FT-O/E': '全场单双',
}
function beadFor(tab, r) {
  const [hh, ha, fh, fa] = r
  const half = tab.startsWith('HT')
  const home = half ? hh : fh
  const away = half ? ha : fa
  const total = home + away
  if (tab.endsWith('H/A')) {
    if (home === away) return { t: 'D', c: 'rgba(255,255,255,0.3)' }
    return home > away ? { t: 'H', c: DERBY.home } : { t: 'A', c: DERBY.away }
  }
  if (tab.endsWith('O/U')) {
    return total >= (half ? HT_BIG : FT_BIG) ? { t: 'O', c: DERBY.away } : { t: 'U', c: DERBY.home }
  }
  return total % 2 ? { t: 'O', c: DERBY.away } : { t: 'E', c: DERBY.home }   // O/E 单双
}

export default function DerbyDayRoad({ history = [], tab, onTab, cols = 20, rows, bead, freshIndex = -1, style, compact = false, isMobile = false }) {
  // 紧凑变体 = 显式 compact 或多桌 isMobile；驱动页签横滚 + 2 行 15px 珠矩阵 + 细占比条
  const cmp = compact || isMobile
  const roadBead = bead ?? (cmp ? 15 : (isMobile ? 16 : 14))   // #47：可选 bead，默认原值（桌面压一档保总高；紧凑固定 15）
  const nRows = rows ?? (cmp ? 2 : 6)
  const beads = history.map(r => beadFor(tab, r))
  // 占比条：近 30 期按当前页签所属盘（HT/FT）的 H/A 重算
  const ratioSrc = history.slice(-30)
  const ratioHalf = tab.startsWith('HT')
  let hw = 0, dw = 0, aw = 0
  ratioSrc.forEach(([hh, ha, fh, fa]) => {
    const home = ratioHalf ? hh : fh, away = ratioHalf ? ha : fa
    if (home > away) hw++; else if (home === away) dw++; else aw++
  })
  const pct = n => Math.round((n / Math.max(1, ratioSrc.length)) * 100)
  return (
    <div style={{ position: 'relative', zIndex: 1, ...(cmp ? {} : { flex: '0 0 auto' }), ...style }}>
      {/* 页签：桌面换行 / 紧凑横滚 */}
      <div style={cmp
        ? { display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }
        : { display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            ...(cmp ? { flex: '0 0 auto', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }),
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: tab === t ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: tab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${tab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      {/* 占比条：近 30 期 H/A 分布（随页签 HT/FT 切换重算）；紧凑细条只显主/客 */}
      {cmp ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ color: DERBY.home, fontSize: 8.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主 {pct(hw)}%</span>
          <div style={{ flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
            <span style={{ width: `${pct(hw)}%`, background: DERBY.home }} />
            <span style={{ width: `${pct(dw)}%`, background: 'rgba(255,255,255,0.4)' }} />
            <span style={{ width: `${pct(aw)}%`, background: DERBY.away }} />
          </div>
          <span style={{ color: DERBY.away, fontSize: 8.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客 {pct(aw)}%</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: DERBY.home, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主队 {pct(hw)}%</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
            <span style={{ width: `${pct(hw)}%`, background: DERBY.home }} />
            <span style={{ width: `${pct(dw)}%`, background: 'rgba(255,255,255,0.4)' }} />
            <span style={{ width: `${pct(aw)}%`, background: DERBY.away }} />
          </div>
          <span style={{ color: DERBY.dim, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>和 {pct(dw)}%</span>
          <span style={{ color: DERBY.away, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客队 {pct(aw)}%</span>
        </div>
      )}
      <style>{ROAD_FX_CSS}</style>
      <div style={{
        overflowX: 'auto', borderRadius: cmp ? 8 : 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: cmp ? 3 : 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${nRows}, ${roadBead}px)`, gridTemplateColumns: `repeat(${cols}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * nRows }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} className={i === freshIndex ? ROAD_FX_FRESH : (!b && i === beads.length ? ROAD_FX_NEXT : undefined)} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: cmp ? 7.5 : 8.5, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
