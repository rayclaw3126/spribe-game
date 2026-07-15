// #41 单16：WuXing 珠盘路墙（大小 / 单双 / 五行段 页签 + 6×N 珠矩阵）——从 WuXing beadRoad 机械切片。
// 判定走引擎口径（wuxingShared ROAD_VIEWS：大小 n≥811 / 单双 n%2 / 五行段 WX_BOUNDS，禁二份表）。
// props {history,tab,onTab,isMobile,cols,rows,style}：history = 整局总和 sum 数组 [n,...]
// （原页 state road / 多桌 /round/history 派生）；判定一律从整值 sum 派生。style 覆外框边距（原页 18px / 多桌 0）。
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { ROAD_VIEWS } from './wuxingShared'

export default function WuXingRoad({ history = [], tab, onTab, isMobile = false, cols = 20, rows = 6, style }) {
  const roadBead = isMobile ? 18 : 14
  const curView = ROAD_VIEWS.find(v => v.key === tab) || ROAD_VIEWS[0]   // 路珠视角（手机/桌面共用 tab，切了两端一致）
  const cells = history.slice(-(cols * rows))
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
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, ${roadBead}px)`, gridTemplateColumns: `repeat(${cols}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            // road 存整局 sum；按当前视角 curView.judge 派生（同一份函数，桌面/手机共用，禁复制第二份）
            const n = cells[i]
            const d = n != null ? curView.judge(n) : null
            return (
              <span key={i} style={{
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
