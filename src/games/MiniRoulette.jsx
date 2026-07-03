import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, ROULETTE } from '../components/shell/tokens'

// Static Team Roulette board — pure UI, no betting/spin/settlement logic.
// Pixel-level copy of the Spribe Mini Roulette reference screenshot
// (scratchpad/roulette-ref-1.jpg). Only the hover player-card keeps the
// sports theme; it is invisible at rest.

const playerGlob = import.meta.glob('../assets/roulette/player_*.png', { eager: true, import: 'default' })
const PLAYER = Object.keys(playerGlob).sort().map(k => playerGlob[k])

const CX = 150, CY = 150, R = 130
// Wheel order and colors read straight from the reference (perfect alternation).
const WHEEL_ORDER = [11, 1, 9, 5, 4, 10, 6, 12, 2, 8, 7, 3]
const RED_SET = new Set([1, 3, 5, 8, 10, 12])
const ROW_EVEN = [2, 4, 6, 8, 10, 12]
const ROW_ODD = [1, 3, 5, 7, 9, 11]
const OUTSIDE = ['1-6', 'Even', 'black', 'red', 'Odd', '7-12']
const CHIPS = [
  { label: '1', color: ROULETTE.chipGrey },
  { label: '10', color: ROULETTE.chipRed },
  { label: '50', color: ROULETTE.chipBlue },
  { label: '100', color: ROULETTE.chipGreen },
  { label: '500', color: ROULETTE.chipBlack },
  { label: '1K', color: ROULETTE.chipPurple },
]

const rad = d => (d * Math.PI) / 180
function sectorPath(i, r = R) {
  const a1 = rad(-90 + i * 30), a2 = rad(-90 + (i + 1) * 30)
  const x1 = (CX + r * Math.cos(a1)).toFixed(1), y1 = (CY + r * Math.sin(a1)).toFixed(1)
  const x2 = (CX + r * Math.cos(a2)).toFixed(1), y2 = (CY + r * Math.sin(a2)).toFixed(1)
  return `M${CX},${CY} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`
}
const numColor = n => (RED_SET.has(n) ? ROULETTE.red : ROULETTE.black)

// glossy disc face (bet grid + chips)
const gloss = base => `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.36), rgba(255,255,255,0) 45%), ${base}`

export default function MiniRoulette({ balance }) {
  const isMobile = useIsMobile()
  const [hoverNum, setHoverNum] = useState(null)
  const [chip, setChip] = useState('10')

  const pillBtn = {
    padding: '6px 18px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.18)', color: COLORS.white,
    border: `1.5px solid ${COLORS.white}`,
    fontSize: 12, fontWeight: 800, cursor: 'not-allowed', opacity: 0.55,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
  const cellBorder = `1px solid ${ROULETTE.line}`

  const numCell = n => (
    <button key={n} type="button"
      onMouseEnter={() => setHoverNum(n)}
      onMouseLeave={() => setHoverNum(null)}
      style={{
        border: cellBorder, background: 'transparent',
        padding: '7px 0', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
      <span style={{
        width: 40, height: 40, borderRadius: RADIUS.pill,
        background: gloss(numColor(n)),
        border: `2px solid ${hoverNum === n ? COLORS.white : 'rgba(255,255,255,0.2)'}`,
        color: COLORS.white, fontSize: 17, fontWeight: 900,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s',
        fontFamily: "'Space Grotesk', sans-serif",
      }}>{n}</span>
    </button>
  )

  return (
    <GameLayout title="Team Roulette" emoji="⚽" color={COLORS.green}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 38%, ${ROULETTE.feltCenter}, ${ROULETTE.feltEdge})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
      }}>
        {/* ---- top bar: name pill + How to Play + balance ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 16px',
          padding: '8px 14px',
          background: ROULETTE.band,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.25)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
          }}>
            TEAM ROULETTE ▾
          </span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: ROULETTE.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 15, height: 15, borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.3)', fontSize: 10, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>?</span>
            How to Play?
          </span>
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 13, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 26, alignItems: isMobile ? 'center' : 'flex-start' }}>

          {/* ---- wheel ---- */}
          <div style={{ flex: '0 0 auto', width: isMobile ? 280 : 360 }}>
            <svg viewBox="0 0 300 300" width="100%">
              {/* soft shadow + dark outer ring */}
              <circle cx={CX} cy={CY} r={R + 12} fill="rgba(0,0,0,0.25)" />
              <circle cx={CX} cy={CY} r={R + 6} fill={ROULETTE.rim} />
              {/* sectors */}
              {WHEEL_ORDER.map((n, i) => (
                <path key={n} d={sectorPath(i)} fill={numColor(n)} stroke={ROULETTE.rim} strokeWidth="0.8" />
              ))}
              {/* two-tone depth: darker inner cone */}
              <circle cx={CX} cy={CY} r="86" fill="rgba(0,0,0,0.26)" />
              {/* numbers along the rim, reading outward */}
              {WHEEL_ORDER.map((n, i) => {
                const deg = i * 30 + 15
                const a = rad(-90 + deg)
                const x = CX + 108 * Math.cos(a)
                const y = CY + 108 * Math.sin(a)
                return (
                  <text key={`t${n}`} x={x.toFixed(1)} y={y.toFixed(1)}
                    fontSize="23" fontWeight="800" fill={COLORS.white}
                    fontFamily="'Space Grotesk', sans-serif"
                    textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(${deg}, ${x.toFixed(1)}, ${y.toFixed(1)})`}>
                    {n}
                  </text>
                )
              })}
              {/* golden ball resting at the inner edge of sector 6 (as in the ref) */}
              {(() => {
                const idx = WHEEL_ORDER.indexOf(6)
                const a = rad(-90 + idx * 30 + 15)
                return <circle cx={(CX + 72 * Math.cos(a)).toFixed(1)} cy={(CY + 72 * Math.sin(a)).toFixed(1)} r="7" fill={ROULETTE.ball} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
              })()}
              {/* big warm-white hub with spinner cross (dots capping the arms) */}
              <circle cx={CX} cy={CY} r="56" fill={ROULETTE.hub} />
              <g stroke={ROULETTE.black} strokeWidth="5" strokeLinecap="round">
                <line x1={CX - 20} y1={CY - 20} x2={CX + 20} y2={CY + 20} />
                <line x1={CX - 20} y1={CY + 20} x2={CX + 20} y2={CY - 20} />
              </g>
              {[[-20, -20], [20, -20], [-20, 20], [20, 20]].map(([dx, dy], k) => (
                <circle key={k} cx={CX + dx} cy={CY + dy} r="6" fill={ROULETTE.black} />
              ))}
              <circle cx={CX} cy={CY} r="7" fill={ROULETTE.black} />
            </svg>
          </div>

          {/* ---- bet table ---- */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', width: '100%', paddingTop: isMobile ? 0 : 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>
                <span style={{ opacity: 0.75, fontWeight: 700 }}>Bet: </span>0.00 USD
              </span>
              <span style={{ color: COLORS.white, fontSize: 12, fontWeight: 800, textDecoration: 'underline', cursor: 'default' }}>Paytable</span>
            </div>

            <div style={{ border: cellBorder, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {ROW_EVEN.map(numCell)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {ROW_ODD.map(numCell)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {OUTSIDE.map(label => {
                  const dot = label === 'red' ? ROULETTE.red : label === 'black' ? ROULETTE.black : null
                  return (
                    <button key={label} type="button" style={{
                      border: cellBorder, background: 'transparent',
                      color: COLORS.white, fontSize: 12, fontWeight: 700,
                      padding: '6px 0', cursor: 'pointer', minHeight: 46,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {dot
                        ? <span style={{ width: 36, height: 36, borderRadius: RADIUS.pill, background: gloss(dot), display: 'inline-block' }} />
                        : label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Back / Clear left, Rebet right */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" disabled style={pillBtn}>↩ Back</button>
              <button type="button" disabled style={pillBtn}>✕ Clear</button>
              <button type="button" disabled style={{ ...pillBtn, marginLeft: 'auto' }}>⟳ Rebet</button>
            </div>

            {/* hover player card — invisible at rest */}
            {hoverNum && (
              <div style={{
                position: 'absolute', top: isMobile ? -8 : 18, right: 0, transform: 'translateY(-100%)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: COLORS.panel, border: `1.5px solid ${RED_SET.has(hoverNum) ? ROULETTE.red : 'rgba(255,255,255,0.4)'}`,
                borderRadius: RADIUS.btn, padding: 8, pointerEvents: 'none', zIndex: 3,
              }}>
                <img src={PLAYER[hoverNum - 1]} alt="" style={{ width: 68, height: 68, objectFit: 'contain', display: 'block' }} />
                <div>
                  <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 900 }}>Team {String(hoverNum).padStart(2, '0')}</div>
                  <div style={{ color: RED_SET.has(hoverNum) ? '#ff8a80' : COLORS.textMuted, fontSize: 11, fontWeight: 700 }}>
                    {RED_SET.has(hoverNum) ? '红队' : '黑队'} · 王牌球星
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- chip rail band (inset, rounded) + SPIN ---- */}
        <div style={{
          margin: isMobile ? '14px 0 0' : '18px 8px 0',
          padding: '10px 18px',
          background: ROULETTE.band,
          borderRadius: 12,
          display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center',
        }}>
          {CHIPS.map(c => {
            const selected = chip === c.label
            return (
              <button key={c.label} type="button" onClick={() => setChip(c.label)} style={{
                width: selected ? 50 : 42, height: selected ? 50 : 42,
                borderRadius: RADIUS.pill,
                background: gloss(c.color),
                border: '3px dashed rgba(255,255,255,0.75)',
                color: COLORS.white, fontSize: selected ? 13 : 11, fontWeight: 900,
                cursor: 'pointer', boxSizing: 'border-box',
                transform: selected ? 'translateY(-3px)' : 'none',
                boxShadow: selected ? '0 5px 12px rgba(0,0,0,0.5)' : '0 2px 5px rgba(0,0,0,0.35)',
                transition: 'all 0.15s',
              }}>
                {c.label}
              </button>
            )
          })}
          <button type="button" disabled style={{
            width: 62, height: 62, borderRadius: RADIUS.pill, marginLeft: 14,
            background: `radial-gradient(circle at 40% 32%, #1c8f45, ${ROULETTE.band})`,
            color: COLORS.white,
            border: '2px dashed rgba(255,255,255,0.6)',
            fontSize: 22, fontWeight: 900,
            cursor: 'not-allowed',
          }}>
            ⟳
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
