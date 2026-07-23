import { useRef, useEffect } from 'react'   // #47 A 案：右端锚定
// #41 单16：LineUp 珠盘路墙（大小 / 单双 / 段位 页签 + 20×6 珠矩阵）——从 LineUp.jsx beadRoad 机械切片。
// 判定走引擎口径（ROAD_VIEWS.judge，段位复用 MARKETS zone-* .hit，禁二份表）。props {history,tab,onTab,isMobile,cols,rows,style}：
// history = 整局总和数组 [total,...]（原页 state road / 多桌 /round/history 派生）；判定一律从整值 total 派生。
// style 覆外框边距（原页 isMobile ? '0 12px 8px' : '0 18px 8px' / 多桌 0）。
// 手机三段锁死的内联 2 行路珠留在 LineUp.jsx（分毫不变），与本件同读 lineupRoadViews.ROAD_VIEWS（单一出处）。
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { ROAD_VIEWS } from './lineupRoadViews'
import { roadWindow, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT , roadAnchorLeft} from './roadWindow'   // #47：路珠动效（共用）

export default function LineUpRoad({ history = [], tab, onTab, isMobile = false, cols = 20, rows = 6, bead, freshIndex = -1, slide = false, style }) {
  // #47 专单：slide = 列对齐滑动窗口（整列丢最旧 + 右端恒留 2 空列），默认 false = 原逐颗裁法，
  //   桌面调用点一字不动。手机/多桌调用点传 slide，按本件【自己的 cols/rows】开窗（同一函数，各面参数）。
  const roadBead = bead ?? (isMobile ? 18 : 14)   // #47：可选 bead，默认原值（移动端大一档，桌面压一档保总高）
  const curView = ROAD_VIEWS.find(v => v.key === tab) || ROAD_VIEWS[0]   // 路珠视角（切了两端一致）
  const beads = slide ? roadWindow(history, { cols, rows }) : history.slice(-(cols * rows))
  // #47 A 案：右端锚定最新珠（未满窗时自然停在 0 —— 珠从左往右填，锚 scrollWidth 会滚到空白区）
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, beads.length, (bead ?? 18) + 2) }, [beads.length, bead])

  return (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, ...style }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {ROAD_VIEWS.map(v => {
          const on = tab === v.key
          return (
            <button key={v.key} type="button" onClick={() => onTab(v.key)} style={{
              padding: '3px 12px', borderRadius: RADIUS.pill,
              background: on ? DERBY.sel : 'rgba(0,0,0,0.35)', color: on ? '#083a1b' : DERBY.dim,
              border: `1px solid ${on ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
              fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{v.label}</button>
          )
        })}
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
            // road 存整局 total；按当前视角 curView.judge 派生（同一份函数，桌面/手机共用）
            const n = beads[i]
            const d = n != null ? curView.judge(n) : null
            // #47 动效：新珠弹入（仅 WS 真新珠）／下一空格呼吸游标（只此一格）
            const cls = i === freshIndex ? ROAD_FX_FRESH : (d == null && beads.length > 0 && i === beads.length ? ROAD_FX_NEXT : undefined)
            return (
              <span key={i} className={cls} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: d ? d.c : 'rgba(255,255,255,0.05)',
                border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{d ? d.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
