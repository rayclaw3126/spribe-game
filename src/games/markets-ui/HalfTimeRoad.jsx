// #41 单15：HalfTime 珠盘路墙（大小/单双/过关/段位/半场 5 页签 + N×cols 珠矩阵）——
// 从 HalfTime.jsx beadRoad(桌面 6×18) + 锁底 road(手机 2×15) 机械切片。判定 beadFor 走引擎口径
// （sum/lowCount→half，禁二份表：zoneOf/段位边界与 markets/halftime 同源语义）。
// props {history,tab,onTab,isMobile,compact,cols,rows,style}：history = [{sum,half},...]（原页 state / 多桌派生）；
//   compact = 卡内紧凑变体（手机锁底 2 行 15px + 页签横滚），非 compact = 桌面 6 行 18px + 页签换行。
//   style 覆外框（桌面 margin / 手机 padding）。
import { COLORS, RADIUS, HALFTIME } from '../../components/shell/tokens'
import { roadWindow, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT } from './roadWindow'   // #47：路珠动效（共用）

const ROAD_TABS = ['O/U', 'ODD/EVEN', 'PARLAY', 'ZONE', 'HALF']
// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照 Derby 先例分离）
const ROAD_TAB_LABELS = { 'O/U': '大小', 'ODD/EVEN': '单双', PARLAY: '过关', ZONE: '段位', HALF: '半场' }
const zoneOf = s => (s <= 695 ? 'OG' : s <= 763 ? 'DF' : s <= 855 ? 'MF' : s <= 923 ? 'AT' : 'GL')
const ZONE_COLOR = { OG: HALFTIME.over, DF: HALFTIME.draw, MF: HALFTIME.sel, AT: HALFTIME.draw, GL: HALFTIME.over }
function beadFor(tab, sum, half) {
  const over = sum > 810
  const odd = sum % 2 === 1
  if (tab === 'O/U') return { t: over ? 'O' : 'U', c: over ? HALFTIME.over : HALFTIME.under }
  if (tab === 'ODD/EVEN') return { t: odd ? 'O' : 'E', c: odd ? HALFTIME.over : HALFTIME.under }
  if (tab === 'PARLAY') return { t: (over ? 'O' : 'U') + (odd ? 'O' : 'E'), c: over === odd ? HALFTIME.sel : HALFTIME.draw }
  if (tab === 'ZONE') { const z = zoneOf(sum); return { t: z, c: ZONE_COLOR[z] } }
  return { t: half, c: half === 'F' ? HALFTIME.over : half === 'S' ? HALFTIME.under : HALFTIME.draw }
}

export default function HalfTimeRoad({ history = [], tab, onTab, isMobile = false, compact = false, cols = 20, rows, bead, freshIndex = -1, slide = false, style }) {
  // #47 专单：slide = 列对齐滑动窗口（整列丢最旧 + 右端恒留 2 空列），默认 false = 原逐颗裁法，
  //   桌面调用点一字不动。手机/多桌调用点传 slide，按本件【自己的 cols/rows】开窗（同一函数，各面参数）。
  // 紧凑变体 = 显式 compact 或手机（多桌/锁底），驱动页签横滚 + 2 行 15px 珠矩阵
  const cmp = compact || isMobile
  const cell = bead ?? (cmp ? 15 : 18)   // #47：可选 bead，默认原值
  const nRows = rows ?? (cmp ? 2 : 6)
  // 原页口径：history 已由调用方截到容量窗口(ROAD_CAP)，本件从窗口头部起填格(beads[i])——
  // 桌面渲首 6×cols、紧凑渲首 2×cols（与原 beadRoad / 锁底 road 逐格同源，分毫不变）。
  const beads = (slide ? roadWindow(history, { cols, rows: nRows }) : history).map(h => beadFor(tab, h.sum, h.half))
  return (
    <div style={{ position: 'relative', zIndex: 1, ...(cmp ? {} : { flex: '0 0 auto' }), ...style }}>
      <div style={cmp
        ? { display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }
        : { display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            ...(cmp ? { flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 10px' } : { padding: '3px 12px' }),
            borderRadius: RADIUS.pill,
            background: tab === t ? HALFTIME.sel : 'rgba(0,0,0,0.35)',
            color: tab === t ? '#083a1b' : HALFTIME.dim,
            border: `1px solid ${tab === t ? HALFTIME.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: cmp ? 0.3 : 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div style={{
        overflowX: 'auto', borderRadius: cmp ? 8 : 10,
        background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)', padding: cmp ? 3 : 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${nRows}, ${cell}px)`, gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * nRows }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} className={i === freshIndex ? ROAD_FX_FRESH : (!b && i === beads.length ? ROAD_FX_NEXT : undefined)} style={{
                width: cell, height: cell, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? (cmp ? 6 : 6.5) : (cmp ? 8 : 9), fontWeight: 900,
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
