import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, PLINKO } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'

// 单P1: Spribe Plinko 1:1 visual replica, football-pitch skin, PURE UI —
// no dropping, no betting, no settlement. Placeholder multipliers copied
// from the reference shot; P2 swaps in computed values + logic.

const ROWS = 14                       // pin rows: 3 pins at the top → 16 at the bottom
// reference-shot paytable (15 slots per row) — P2 替换为计算值
const MULT_GREEN = [18, 3.2, 1.6, 1.3, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.3, 1.6, 3.2, 18]
const MULT_YELLOW = [55, 12, 5.6, 3.2, 1.6, 1, 0.7, 0.2, 0.7, 1, 1.6, 3.2, 5.6, 12, 55]
const MULT_RED = [353, 49, 14, 5.3, 2.1, 0.5, 0.2, 0, 0.2, 0.5, 2.1, 5.3, 14, 49, 353]
// static fake history — red/yellow/green mini pills (real results land in P2)
const FAKE_HISTORY = [
  { v: '1.6', c: 'yellow' }, { v: '0.5', c: 'green' }, { v: '2.1', c: 'red' },
  { v: '1.2', c: 'green' }, { v: '12', c: 'yellow' }, { v: '1', c: 'green' },
  { v: '5.3', c: 'red' }, { v: '1.3', c: 'green' }, { v: '0.7', c: 'yellow' }, { v: '3.2', c: 'green' },
]
const ROW_BG = { green: '#56a80e', yellow: '#f08c00', red: '#e8352c' }

// small football: white ball, center pentagon + edge patches (block faces)
function Football({ size = 16 }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={PLINKO.ball} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill="#16181d" />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill="#16181d" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export default function Plinko({ balance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)

  // ---------- visual layer (Spribe Plinko 1:1, pitch green) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: PLINKO.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const bigBtn = bg => ({
    minWidth: 96, padding: '11px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: 'not-allowed', opacity: 0.92,
  })

  // pin triangle geometry: percentage positions inside the board box
  const pinRows = []
  for (let r = 0; r < ROWS; r++) {
    const count = 3 + r
    pinRows.push({ count, y: (r / (ROWS - 1)) * 100 })
  }
  const slotCount = MULT_GREEN.length   // 15
  // each row spans proportionally to its pin count, centered — bottom row
  // (16 pins) spans the full board width, same look as the reference
  const xFor = (row, i) => {
    const spread = (row.count - 1) / (ROWS + 1)
    const start = 0.5 - spread / 2
    return (start + (row.count === 1 ? 0 : (i / (row.count - 1)) * spread)) * 100
  }

  return (
    <GameLayout title="Free Kick" emoji="⚽" color={PLINKO.btnGreen}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${PLINKO.bgCenter}, ${PLINKO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
      }}>
        {/* pitch markings — two big side circles + corner arc, like the ref */}
        <div style={{
          position: 'absolute', left: -130, top: '46%', width: 260, height: 260,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: -130, top: '46%', width: 260, height: 260,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          transform: 'translateY(-50%)', pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', left: -60, bottom: -60, width: 120, height: 120,
          border: `2px solid ${PLINKO.line}`, borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: PLINKO.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1,
        }}>
          <span style={navPill}>FREE KICK ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: PLINKO.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${PLINKO.gold}`, color: PLINKO.gold,
              fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
        </div>

        {/* ---- second row: Pins pill + result history + refresh ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: PLINKO.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', marginBottom: 12, overflow: 'hidden', minHeight: 24,
          position: 'relative', zIndex: 1,
        }}>
          <span style={{
            padding: '3px 22px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
            color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
          }}>Pins: {ROWS}</span>
          {(isMobile ? FAKE_HISTORY.slice(0, 5) : FAKE_HISTORY).map((h, i) => (
            <span key={i} style={{
              padding: '3px 9px', borderRadius: RADIUS.pill,
              background: ROW_BG[h.c], color: COLORS.white,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{h.v}</span>
          ))}
          <span style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>⟲ ˅</span>
        </div>

        {/* ---- pin board: triangle of pearls + dashed funnel + static ball ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: isMobile ? '100%' : 480, maxWidth: '100%',
          height: isMobile ? 300 : 330, margin: '0 auto 2px',
        }}>
          {/* dashed funnel borders — from beside the apex down to the corners */}
          <svg width="100%" height="100%" viewBox="0 0 480 330" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
            <line x1="204" y1="-6" x2="6" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="276" y1="-6" x2="474" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="6" y1="238" x2="6" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="474" y1="238" x2="474" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
          </svg>
          {/* static football waiting at the apex */}
          <div style={{ position: 'absolute', left: '50%', top: -4, transform: 'translateX(-50%)' }}>
            <Football size={16} />
          </div>
          {pinRows.map((row, r) => (
            Array.from({ length: row.count }).map((_, i) => (
              <span key={`${r}-${i}`} style={{
                position: 'absolute',
                left: `${xFor(row, i)}%`, top: `${4 + row.y * 0.93}%`,
                width: isMobile ? 6 : 7, height: isMobile ? 6 : 7,
                borderRadius: '50%', transform: 'translate(-50%, -50%)',
                background: `radial-gradient(circle at 35% 30%, #ffffff, ${PLINKO.pin} 55%, #b9c2c9)`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
              }} />
            ))
          ))}
        </div>

        {/* ---- three-row multiplier table ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: isMobile ? '100%' : 480, maxWidth: '100%', margin: '0 auto 14px',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {[
            { cells: MULT_GREEN, bg: PLINKO.rowGreen, dim: PLINKO.rowGreenDim },
            { cells: MULT_YELLOW, bg: PLINKO.rowYellow, dim: PLINKO.rowYellowDim },
            { cells: MULT_RED, bg: PLINKO.rowRed, dim: PLINKO.rowRedDim },
          ].map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: 2 }}>
              {row.cells.map((m, ci) => {
                const center = Math.abs(ci - (slotCount - 1) / 2) <= 1.5
                return (
                  <span key={ci} style={{
                    flex: 1, minWidth: 0, textAlign: 'center',
                    padding: isMobile ? '3px 0' : '4px 0', borderRadius: 3,
                    background: center ? row.dim : row.bg,
                    color: COLORS.white, fontSize: isMobile ? 8 : 9.5, fontWeight: 800,
                    overflow: 'hidden',
                  }}>{m}</span>
                )
              })}
            </div>
          ))}
        </div>

        {/* ---- bottom bet band (controls disabled — logic lands in P2) ---- */}
        <div style={{
          margin: isMobile ? '0 -12px -12px' : '0 -18px -18px',
          padding: '12px 14px',
          background: PLINKO.band,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" onClick={() => setBet(b => Math.max(1, b - 10))} style={circleBtn}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" onClick={() => setBet(b => b + 10)} style={circleBtn}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled style={bigBtn(PLINKO.btnGreen)}>GREEN</button>
          <button type="button" disabled style={bigBtn(PLINKO.btnYellow)}>YELLOW</button>
          <button type="button" disabled style={bigBtn(PLINKO.btnRed)}>RED</button>
        </div>
      </Panel>
    </GameLayout>
  )
}
