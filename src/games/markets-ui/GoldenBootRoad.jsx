import { useRef, useEffect } from 'react'   // #47 A 案：右端锚定
// #41 单14.5：PK10 珠盘路墙（冠军/冠亚和 页签 + 6×N 珠矩阵）——从 GoldenBoot beadRoad 机械切片。
// 判定 beadFor 走引擎口径（winner/sum，禁二份表）。props {history,tab,onTab,isMobile,cols,rows,style}：
// history = [{winner,sum},...]（原页 state / 多桌 /round/history 派生）；style 覆外框边距（原页 18px / 多桌 0）。
import { GOLDENBOOT, RADIUS, COLORS } from '../../components/shell/tokens'
import { roadWindow, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT , roadAnchorLeft} from './roadWindow'   // #47：路珠动效（共用）

const ROAD_TABS = ['WINNER', 'SUM', 'SIZEPAR']
// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照先例分离）
const ROAD_TAB_LABELS = { WINNER: '冠军', SUM: '冠亚和', SIZEPAR: '大小单双' }
function beadFor(tab, h) {
  if (tab === 'WINNER') return { t: String(h.winner), c: h.winner <= 5 ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
  if (tab === 'SUM') return h.sum >= 12 ? { t: 'B', c: GOLDENBOOT.dragon } : { t: 'S', c: GOLDENBOOT.tiger }
  // 大小单双（单14.6 item6）：判定走引擎 MARKETS 现成键——大小=sprintSum≥12(s-big/s-small),
  // 单双=sprintSum 奇偶(s-odd/s-even)；2 字组合珠，色随大小（矩阵渲染同现两页签）。
  const big = h.sum >= 12
  return { t: (big ? '大' : '小') + (h.sum % 2 === 1 ? '单' : '双'), c: big ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
}

export default function GoldenBootRoad({ history = [], tab, onTab, cols = 20, rows = 6, bead = 18, freshIndex = -1, slide = false, style }) {
  // #47 专单：slide = 列对齐滑动窗口（整列丢最旧 + 右端恒留 2 空列），默认 false = 原逐颗裁法，
  //   桌面调用点一字不动。手机/多桌调用点传 slide，按本件【自己的 cols/rows】开窗（同一函数，各面参数）。
  const beads = (slide ? roadWindow(history, { cols, rows }) : history.slice(-(cols * rows))).map(h => beadFor(tab, h))
  // #47 A 案：右端锚定最新珠（未满窗时自然停在 0 —— 珠从左往右填，锚 scrollWidth 会滚到空白区）
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, beads.length, (bead ?? 18) + 2) }, [beads.length, bead])

  return (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, ...style }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: tab === t ? GOLDENBOOT.sel : 'rgba(0,0,0,0.35)',
            color: tab === t ? '#083a1b' : GOLDENBOOT.dim,
            border: `1px solid ${tab === t ? GOLDENBOOT.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div ref={roadScrollRef} style={{
        overflowX: 'auto', borderRadius: 10,
        background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, ${bead}px)`, gridTemplateColumns: `repeat(${cols}, ${bead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} className={i === freshIndex ? ROAD_FX_FRESH : (!b && beads.length > 0 && i === beads.length ? ROAD_FX_NEXT : undefined)} style={{
                width: bead, height: bead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? bead * 0.39 : bead * 0.5, fontWeight: 900,   /* #47：跟随 bead */
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
