// #41 单15：HatTrick 珠盘路墙（和值/大小/豹子 页签 + 6×N 珠矩阵）——从 HatTrick beadRoad 机械切片。
// 判定 beadFor 走引擎口径（hattrickShared，禁二份表）。props {history,tab,onTab,isMobile,cols,rows,style}：
// history = 三骰数组序列 [[d,d,d],...]（原页 state / 多桌 /round/history 派生）；style 覆外框边距（原页 18px / 多桌 0）。
import { HATTRICK, RADIUS, COLORS } from '../../components/shell/tokens'
import { ROAD_TABS, ROAD_TAB_LABELS, beadFor } from './hattrickShared'
import { ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT } from './roadWindow'

// #47 首批：新增可选 bead（珠径 px），默认 15 = 原行为。仅帽子戏法原页桌面传 24；
// 多桌 marketsUiRegistry→TableCard 与手机段均不传，逐字节零感。
export default function HatTrickRoad({ history = [], tab, onTab, isMobile = false, cols = 20, rows = 6, bead = 15, freshIndex = -1, style }) {
  const beads = history.slice(-(cols * rows)).map(d => beadFor(tab, d))
  return (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
      ...style,
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: tab === t ? HATTRICK.sel : 'rgba(0,0,0,0.35)',
            color: tab === t ? '#083a1b' : HATTRICK.dim,
            border: `1px solid ${tab === t ? HATTRICK.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, ${bead}px)`, gridTemplateColumns: `repeat(${cols}, ${bead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const b = beads[i]

            const cls = i === freshIndex ? ROAD_FX_FRESH : (!b && i === beads.length ? ROAD_FX_NEXT : undefined)   // #47 动效
            return (
              <span key={i} className={cls} style={{
                width: bead, height: bead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: b?.dark ? '#3a2c00' : COLORS.white,
                fontSize: b && b.t.length > 1 ? bead * 0.433 : bead * 0.567, fontWeight: 900,   /* #47：跟随 bead，比例照原 15px 档的 6.5/8.5 */
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
