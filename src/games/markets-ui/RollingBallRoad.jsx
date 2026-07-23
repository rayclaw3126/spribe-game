// #公期化 单3 (c)：滚球【多桌迷你路珠】——单视角「大小」，2 行紧凑珠墙，照 SpeedGridRoad 模板。
//
// ⚠ 为什么只做单视角、而不像单页那样 8 视角：单页的 8 视角判定表（ROAD_VIEWS）依赖引擎
//   GROUPS/COMBO 常量，那套现在只活在 RollingBall.jsx 里；把它搬进共用件必须先建
//   markets/rollingball.js —— 那是裁定①明确划给单4 的活。本件因此只吃「大小」这一条，
//   判定 = n >= 38（大小的定义本身，不是抄第二份表），零引擎依赖、零 code-split 风险。
//   8 视角迷你路珠随单4 的引擎搬家一并补齐。
//
// props 契约与其余 9 款 Road 件一致：{history, tab, onTab, isMobile, cols, rows, slide, bead, style}
//   history = 每局三球数组 [[b1,b2,b3], ...]（旧→新），由 marketsUiRegistry.roadItem 从
//   /round/history 的 drawResult.revealed 派生 —— 与单页 road state 形状完全一致。
//   ⚠ 滚球一局 3 颗珠：展开必须在【过窗口之前】，roadWindow 按「珠」算整列滑动，喂局数会算错相位。
import { useRef, useEffect } from 'react'
import { RADIUS, DERBY } from '../../components/shell/tokens'
import { roadWindow, ROAD_FX_CSS, roadAnchorLeft } from './roadWindow'

const beadFor = (n) => (n >= 38 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home })

export default function RollingBallRoad({ history = [], isMobile = false, cols = 12, rows = 2, bead, slide = false, style }) {
  const roadBead = bead ?? (isMobile ? 18 : 14)
  // 先按局展开成珠（3 颗/局），再过窗口
  const flat = []
  for (const balls of history) if (Array.isArray(balls)) for (const n of balls) if (n != null) flat.push(n)
  const beads = (slide ? roadWindow(flat, { cols, rows }) : flat.slice(-(cols * rows))).map(beadFor)
  const ref = useRef(null)
  useEffect(() => { roadAnchorLeft(ref.current, beads.length, roadBead + 2, rows) }, [beads.length, roadBead, rows])

  return (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, ...style }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill, background: DERBY.sel, color: '#083a1b',
          fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>第N球大小</span>
      </div>
      <style>{ROAD_FX_CSS}</style>
      <div ref={ref} style={{
        overflowX: 'auto', borderRadius: 10, background: DERBY.strip,
        border: '1px solid rgba(255,255,255,0.1)', padding: 6,
        scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        <div style={{
          display: 'grid', gap: 2,
          gridTemplateRows: `repeat(${rows}, ${roadBead}px)`,
          gridTemplateColumns: `repeat(${cols}, ${roadBead}px)`,
          gridAutoFlow: 'column', width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const d = beads[i] || null
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: d ? d.c : 'rgba(255,255,255,0.05)',
                color: '#fff', fontSize: roadBead * 0.5, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              }}>{d ? d.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
