// #41 单15：NumberUp 珠盘路墙（号码/位数/大小 页签 + 6×N 珠矩阵）——从 NumberUp.jsx beadRoad 机械切片。
// beadFor 走本页显示口径（号码/尾位奇偶/大小；跟 GoldenBootRoad 一样属珠盘显示分类，非命中判定表，
// 数值只经引擎 pad2 与 25 分界，禁二份命中表）。props {history,tab,onTab,cols,rows,style}（照 GoldenBootRoad
// 口径无 isMobile：桌面路珠固定 18px，手机三段版另有 2 行内联路珠留在原页）：
// history = 号码数组 [n,...]（原页 state / 多桌 /round/history 派生）；style 覆外框边距（原页 18px / 多桌 0）。
import { COLORS, RADIUS, NUMBERUP } from '../../components/shell/tokens'
import { pad2 } from '../markets/numberup'

// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照 Derby/HalfTime 先例分离）
const ROAD_TABS = ['NUMBER', 'DIGIT', 'H-L']
const ROAD_TAB_LABELS = { NUMBER: '号码', DIGIT: '位数', 'H-L': '大小' }
function beadFor(tab, n) {
  if (tab === 'NUMBER') return { t: pad2(n), c: n >= 25 ? NUMBERUP.hi : NUMBERUP.lo }
  if (tab === 'DIGIT') { const d = n % 10; return { t: String(d), c: d % 2 ? NUMBERUP.hi : NUMBERUP.lo } }
  return n >= 25 ? { t: 'H', c: NUMBERUP.hi } : { t: 'L', c: NUMBERUP.lo }
}

export default function NumberUpRoad({ history = [], tab, onTab, cols = 20, rows = 6, style }) {
  const beads = history.slice(-(cols * rows)).map(n => beadFor(tab, n))
  return (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, ...style }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: tab === t ? NUMBERUP.sel : 'rgba(0,0,0,0.35)',
            color: tab === t ? '#083a1b' : NUMBERUP.dim,
            border: `1px solid ${tab === t ? NUMBERUP.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, 18px)`, gridTemplateColumns: `repeat(${cols}, 18px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 7 : 9, fontWeight: 900,
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
