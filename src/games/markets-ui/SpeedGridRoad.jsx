import { useRef, useEffect } from 'react'   // #47 A 案：右端锚定
// #41 单15：SpeedGrid 珠盘路墙（大小 / 单双 / 红黑 页签 + 20×6 珠矩阵）——从 SpeedGrid beadRoad 机械切片。
// 判定 sgBeadFor 走引擎口径（MARKETS.big/odd/red .hit，禁二份表）。props {history,tab,onTab,isMobile,cols,rows,style}：
// history = 整局冠军车号数组 [n,...]（原页 state road / 多桌 /round/history 派生）；判定一律从整值 champ 派生。
// style 覆外框边距（原页 isMobile ? '0 12px 8px' : '0 18px 8px'）。
import { COLORS, RADIUS, DERBY, ROULETTE } from '../../components/shell/tokens'
import { MARKETS } from '../markets/speedgrid'
import { roadWindow, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT , roadAnchorLeft} from './roadWindow'   // #47：路珠动效（共用）

// 珠盘路多视角（B 型：存整值 champ，判定一律走引擎 MARKETS/RED 常量，禁手写第二份表）
const SG_ROAD_TABS = ['BS', 'OE', 'RB']
const SG_ROAD_LABELS = { BS: '大小', OE: '单双', RB: '红黑' }
function sgBeadFor(tab, n) {
  if (tab === 'OE') return MARKETS.odd.hit(n) ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home }
  if (tab === 'RB') return MARKETS.red.hit(n) ? { t: '红', c: DERBY.away } : { t: '黑', c: ROULETTE.black }
  return MARKETS.big.hit(n) ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home }   // BS 大小
}

export default function SpeedGridRoad({ history = [], tab, onTab, isMobile = false, cols = 20, rows = 6, bead, freshIndex = -1, slide = false, style }) {
  // #47 专单：slide = 列对齐滑动窗口（整列丢最旧 + 右端恒留 2 空列），默认 false = 原逐颗裁法，
  //   桌面调用点一字不动。手机/多桌调用点传 slide，按本件【自己的 cols/rows】开窗（同一函数，各面参数）。
  const roadBead = bead ?? (isMobile ? 18 : 14)   // #47：可选 bead，默认原值
  const beads = (slide ? roadWindow(history, { cols, rows }) : history.slice(-(cols * rows))).map(n => sgBeadFor(tab, n))
  // #47 A 案：右端锚定最新珠（未满窗时自然停在 0 —— 珠从左往右填，锚 scrollWidth 会滚到空白区）
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, beads.length, (bead ?? 18) + 2) }, [beads.length, bead])

  return (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1, ...style,
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {SG_ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: tab === t ? DERBY.sel : 'rgba(0,0,0,0.35)', color: tab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${tab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{SG_ROAD_LABELS[t]}</button>
        ))}
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div ref={roadScrollRef} style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, ${roadBead}px)`, gridTemplateColumns: `repeat(${cols}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} className={i === freshIndex ? ROAD_FX_FRESH : (!b && beads.length > 0 && i === beads.length ? ROAD_FX_NEXT : undefined)} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
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
