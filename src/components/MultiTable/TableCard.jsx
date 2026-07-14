import { useState, useRef } from 'react'
import { MULTI_DARK as M } from '../shell/tokens'
import { MOCK, nameOf, venueOf, mockRoundNo } from './mockData'

// 相位 → 文案 + 色（三态：投注中绿 / 锁盘黄 / 开奖中蓝），色全走 MULTI_DARK。
const PHASE = {
  betting: { text: '投注中', c: M.betting, bg: M.bettingTint },
  locked:  { text: '锁盘',   c: M.locked,  bg: M.lockedTint },
  drawing: { text: '开奖中', c: M.drawing, bg: M.drawingTint },
}
// 路珠 tone → 色
const BEAD_C = { up: M.beadUp, down: M.beadDown, tie: M.beadTie }

// 倒计时补 mm:ss（mockData 存 'm:ss'，分钟补 2 位）；'—' 原样
const fmtCd = (s) => {
  if (!s || s === '—' || !s.includes(':')) return s
  const [mm, ss] = s.split(':')
  return `${mm.padStart(2, '0')}:${ss}`
}

// 性能桩：离屏桌不跑高频渲染（倒计时）。静态版无高频，先恒 true，仅埋结构 —— 单3 接活时启用 IO。
function useInViewport(/* ref */) {
  const [inView] = useState(true)
  // 单3 启用：
  // useEffect(() => {
  //   const el = ref.current; if (!el) return
  //   const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '120px' })
  //   io.observe(el); return () => io.disconnect()
  // }, [ref])
  return inView
}

// 单张桌卡：头行（名+期号+相位chip+⤢死钮+×下桌） / 迷你舞台（按相位填内容，倒计时过视口 gate）/
// 盘口分组手风琴（默认展开第一组，grid 大阵默认收）/ 迷你路珠 8 颗。全静态，onAddBet 唯一出口。
export default function TableCard({ id, onAddBet, onClose, flash }) {
  const m = MOCK[id]
  const ph = PHASE[m.phase] || PHASE.betting
  const rootRef = useRef(null)
  const inView = useInViewport(rootRef)

  // 展开状态每桌独立记忆（本地 state；换桌/下桌因 key=id 天然隔离，不串）。默认只开第 0 组（主盘）。
  const [open, setOpen] = useState({ 0: true })
  const toggle = (gi) => setOpen((o) => ({ ...o, [gi]: !o[gi] }))

  return (
    <div ref={rootRef} data-table-id={id} style={{
      display: 'flex', flexDirection: 'column',
      background: M.card, border: `1px solid ${flash ? M.accent : M.line}`, borderRadius: 12,
      overflow: 'hidden', minHeight: 0,
      boxShadow: flash ? `0 0 0 2px ${M.accent}` : 'none', transition: 'box-shadow 0.2s, border-color 0.2s',
    }}>
      {/* —— 头行 —— */}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderBottom: `1px solid ${M.line}`,
      }}>
        <span style={{ color: M.txt, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{nameOf(id)}</span>
        <span title={mockRoundNo(id)} style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>#{m.seq}</span>
        <span style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
          background: ph.bg, color: ph.c, border: `1px solid ${ph.c}`,
          borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: ph.c }} />
          {ph.text}{m.cd !== '—' && ` · ${m.cd}`}
        </span>
        {/* ⤢ 全屏死钮占位（禁用，单5 接真） */}
        <button type="button" disabled aria-label="全屏（占位）" style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, cursor: 'not-allowed',
          background: M.cardHi, border: `1px solid ${M.line}`, color: M.txtMute, fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⤢</button>
        {/* × 下桌钮 */}
        <button type="button" onClick={() => onClose(id)} aria-label="下桌" style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
          background: M.cardHi, border: `1px solid ${M.line}`, color: M.txtDim, fontSize: 13, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      {/* —— 迷你舞台：按相位填内容 —— */}
      <div style={{
        flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 6, padding: '14px 10px', background: M.panel, minHeight: 96,
      }}>
        <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{venueOf(id)}</span>

        {m.phase === 'drawing' ? (
          <>
            <span style={{ color: M.drawing, fontSize: 11, fontWeight: 900, letterSpacing: 1 }}>开奖</span>
            <span style={{ color: M.drawing, fontSize: 34, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{m.draw}</span>
          </>
        ) : m.phase === 'locked' ? (
          <>
            <span style={{ color: M.locked, fontSize: 40, fontWeight: 900, lineHeight: 1 }}>封盘</span>
            <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>上期 {m.draw}</span>
          </>
        ) : (
          <>
            {/* 倒计时过视口 gate（单3 启用后离屏不渲染）；静态 inView 恒 true */}
            {inView && (
              <span style={{ color: M.betting, fontSize: 64, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtCd(m.cd)}</span>
            )}
            <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>上期 {m.draw}</span>
          </>
        )}
      </div>

      {/* —— 盘口分组手风琴 —— */}
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
        {m.markets.map((grp, gi) => {
          const isOpen = !!open[gi]
          return (
            <div key={grp.group} style={{ borderTop: `1px solid ${M.line}` }}>
              {/* 组头 */}
              <button type="button" onClick={() => toggle(gi)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '8px 10px', textAlign: 'left',
              }}>
                <span style={{ color: M.txtMute, fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, color: isOpen ? M.txt : M.txtDim, fontSize: 12, fontWeight: 800 }}>{grp.group}</span>
                <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 700 }}>{grp.keys.length}</span>
              </button>
              {/* 组体 */}
              {isOpen && (grp.grid ? (
                // 直选大阵：紧凑网格化
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))', gap: 4,
                  padding: '0 10px 10px',
                }}>
                  {grp.keys.map(q => (
                    <button key={q.key} type="button" onClick={() => onAddBet(id, q.label, q.odds)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      background: M.cardHi, border: `1px solid ${M.line}`, borderRadius: 6,
                      padding: '5px 1px', cursor: 'pointer',
                    }}>
                      <span style={{ color: M.txt, fontSize: 11, fontWeight: 800, lineHeight: 1.1 }}>{q.label}</span>
                      <span style={{ color: M.amount, fontSize: 8, fontWeight: 700 }}>{q.odds}</span>
                    </button>
                  ))}
                </div>
              ) : (
                // 常规盘：3 列
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, padding: '0 10px 10px' }}>
                  {grp.keys.map(q => (
                    <button key={q.key} type="button" onClick={() => onAddBet(id, q.label, q.odds)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                      background: M.cardHi, border: `1px solid ${M.line}`, borderRadius: 8,
                      padding: '6px 2px', cursor: 'pointer',
                    }}>
                      <span style={{ color: M.txt, fontSize: 12, fontWeight: 800 }}>{q.label}</span>
                      <span style={{ color: M.amount, fontSize: 10, fontWeight: 700 }}>{q.odds}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* —— 迷你路珠 8 颗 —— */}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
        padding: '8px 10px', borderTop: `1px solid ${M.line}`,
      }}>
        {m.beads.map((b, i) => (
          <span key={i} style={{
            width: 18, height: 18, borderRadius: '50%', flex: '0 0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: BEAD_C[b.tone] || M.txtMute, color: M.accentInk,
            fontSize: 9, fontWeight: 900,
          }}>{b.t}</span>
        ))}
      </div>
    </div>
  )
}
