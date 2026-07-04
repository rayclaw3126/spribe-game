import { useState, useRef } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, DICE } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'

// 单D1: Spribe Dice 1:1 visual replica, purple→green, PURE UI — no betting,
// no rolling, no settlement. Mechanic upgrade locked in: 0–100 roll (old 1–6
// die UI scrapped). Slider is draggable for display linkage only.

// D2 校准占位: chance ∈ [4, 96] %, payout = RTP·100/chance with RTP = 0.97.
// Thresholds shown on the buttons/bands: under = chance, over = 100 − chance.
const RTP = 0.97
const CHANCE_MIN = 4
const CHANCE_MAX = 96
const round2 = x => Math.round(x * 100) / 100

// static fake history — display only, real rounds land here in D2
const FAKE_HISTORY = ['63.95', '12.40', '50.01', '77.31', '5.62', '94.20', '48.50', '66.01', '23.77', '81.09']

// slider handle: a small football drawn in SVG (white ball, black patches)
function BallHandle({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill="#f5f7fa" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8 15.4,10.5 14.1,14.4 9.9,14.4 8.6,10.5" fill="#16181d" />
      <g stroke="#16181d" strokeWidth="1.1" fill="none">
        <line x1="12" y1="8" x2="12" y2="3.4" />
        <line x1="15.4" y1="10.5" x2="19.6" y2="8.9" />
        <line x1="14.1" y1="14.4" x2="16.8" y2="18.2" />
        <line x1="9.9" y1="14.4" x2="7.2" y2="18.2" />
        <line x1="8.6" y1="10.5" x2="4.4" y2="8.9" />
      </g>
    </svg>
  )
}

export default function Dice({ balance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [chance, setChance] = useState(48.5)   // slider-driven display state
  const trackRef = useRef(null)
  const dragRef = useRef(false)

  const payout = round2(RTP * 100 / chance)
  const underT = round2(chance)          // UNDER wins below this
  const overT = round2(100 - chance)     // OVER wins above this
  const sliderPos = (CHANCE_MAX - chance) / (CHANCE_MAX - CHANCE_MIN)   // right = higher payout

  function chanceFromPointer(e) {
    const r = trackRef.current.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setChance(round2(CHANCE_MAX - p * (CHANCE_MAX - CHANCE_MIN)))
  }
  function onDown(e) { dragRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); chanceFromPointer(e) }
  function onMove(e) { if (dragRef.current) chanceFromPointer(e) }
  function onUp() { dragRef.current = false }

  // ---------- visual layer (Spribe Dice 1:1, green felt) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: DICE.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  // ribbed scale band: colored teeth over the dark panel
  const ribbed = color => `repeating-linear-gradient(90deg, ${color} 0px, ${color} 3px, rgba(0,0,0,0.5) 3px, rgba(0,0,0,0.5) 5px)`
  const bigBtn = bg => ({
    minWidth: 118, padding: '8px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: 'not-allowed', opacity: 0.92,
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3,
  })

  return (
    <GameLayout title="Total Goals" emoji="⚽" color={DICE.teal}>
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${DICE.bgCenter}, ${DICE.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
      }}>
        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 14px' : '-18px -18px 16px',
          padding: '8px 14px',
          background: DICE.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
        }}>
          <span style={navPill}>TOTAL GOALS ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: DICE.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${DICE.gold}`, color: DICE.gold,
              fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
        </div>

        {/* ---- roll history strip: value pills + refresh pill ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: DICE.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', marginBottom: 14, overflow: 'hidden',
        }}>
          {(isMobile ? FAKE_HISTORY.slice(0, 5) : FAKE_HISTORY).map((v, i) => (
            <span key={i} style={{
              padding: '3px 10px', borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.3)', color: COLORS.white,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{v}</span>
          ))}
          <span style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: DICE.circleBlue, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>⟲ ˅</span>
        </div>

        {/* ---- main track panel: big number + double scale bands + ball ---- */}
        <div style={{
          background: DICE.panel, border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 12, padding: isMobile ? '14px 12px 10px' : '18px 16px 12px',
          marginBottom: 16,
        }}>
          <div style={{
            textAlign: 'center', color: COLORS.white,
            fontSize: isMobile ? 44 : 60, fontWeight: 900, lineHeight: 1.1,
            fontFamily: "'Space Grotesk', sans-serif", marginBottom: 12,
          }}>50.00</div>

          <div style={{ position: 'relative', padding: '10px 0 4px' }}>
            {/* tick marks above the bands */}
            {[0, 25, 50, 75, 100].map(p => (
              <span key={p} style={{
                position: 'absolute', top: 0, left: `${p}%`, width: 1, height: 7,
                background: 'rgba(255,255,255,0.65)',
                transform: p === 0 ? 'none' : p === 100 ? 'translateX(-1px)' : 'translateX(-0.5px)',
              }} />
            ))}

            {/* upper band — OVER: red lose 0→overT, blue win overT→100 */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${overT}%`, background: ribbed(DICE.red) }} />
              <div style={{ flex: 1, background: ribbed(DICE.blue) }} />
            </div>

            {/* golden landing ball (static at 50 until D2 wires the roll) */}
            <div style={{
              position: 'relative', height: 10, margin: '−2px 0',
            }}>
              <div style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 26, height: 26, borderRadius: '50%',
                background: DICE.ball, border: '2px solid rgba(0,0,0,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16181d' }} />
              </div>
            </div>

            {/* lower band — UNDER: teal win 0→underT, red lose underT→100 */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${underT}%`, background: ribbed(DICE.teal) }} />
              <div style={{ flex: 1, background: ribbed(DICE.red) }} />
            </div>

            {/* scale labels */}
            <div style={{ position: 'relative', height: 16, marginTop: 4 }}>
              {[0, 25, 50, 75, 100].map(p => (
                <span key={p} style={{
                  position: 'absolute', left: `${p}%`, top: 0,
                  transform: p === 0 ? 'none' : p === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                  color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700,
                }}>{p}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ---- payout panel: payout box + slider + potential win / chance ---- */}
        <div style={{
          maxWidth: 470, margin: '0 auto 16px',
          background: DICE.panel, border: '1px solid rgba(0,0,0,0.25)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: isMobile ? '10px 12px' : '12px 16px',
          }}>
            <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
              <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Payout</div>
              <div style={{
                padding: '6px 18px', borderRadius: 8,
                background: DICE.panelDeep, border: '1px solid rgba(255,255,255,0.3)',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}>{payout.toFixed(2)} x</div>
            </div>
            {/* slider — football handle, pure display linkage */}
            <div
              ref={trackRef}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ flex: 1, position: 'relative', height: 34, cursor: 'pointer', touchAction: 'none' }}
            >
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 12, height: 6,
                borderRadius: 3, background: DICE.panelDeep, border: '1px solid rgba(0,0,0,0.4)',
              }} />
              {/* ruler teeth under the track */}
              <div style={{
                position: 'absolute', left: 2, right: 2, top: 22, height: 5,
                background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0px, rgba(255,255,255,0.35) 1px, transparent 1px, transparent 7px)',
              }} />
              <div style={{
                position: 'absolute', top: 3, left: `${sliderPos * 100}%`,
                transform: 'translateX(-50%)', pointerEvents: 'none',
              }}>
                <BallHandle size={24} />
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 16px', background: DICE.panelDeep,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700 }}>
              Potential win: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{(bet * payout).toFixed(2)} USD</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700 }}>
              Chance: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{chance.toFixed(2)} %</span>
            </span>
          </div>
        </div>

        {/* ---- bottom bet band (controls disabled — logic lands in D2) ---- */}
        <div style={{
          margin: isMobile ? '0 -12px -12px' : '0 -18px -18px',
          padding: '12px 14px',
          background: DICE.band,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: DICE.panelDeep, border: '1px solid rgba(255,255,255,0.3)',
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
            background: DICE.circleBlue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled style={bigBtn(DICE.btnUnder)}>
            <span>UNDER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↓ {underT.toFixed(2)}</span>
          </button>
          <button type="button" disabled style={bigBtn(DICE.btnOver)}>
            <span>OVER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↑ {overT.toFixed(2)}</span>
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
