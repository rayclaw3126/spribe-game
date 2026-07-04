import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, DICE } from '../components/shell/tokens'
import { useIsMobile } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'

// 单D2: Total Goals gameplay — 0–100 roll, UNDER/OVER settle, RTP-calibrated
// payouts. Slider sets the target line (4.00–96.00); the roll is uniform on
// [0,100] with 2 decimals.
//
// Payout calibration (replaces the D1 placeholder): payout = RTP·100/chance,
// RTP = 0.97. UNDER chance = target, OVER chance = 100 − target. Buttons, the
// Payout box and Potential win all go through payoutFor().
const RTP = 0.97
const TARGET_MIN = 4
const TARGET_MAX = 96
const ROLL_MS = 1200
const round2 = x => Math.round(x * 100) / 100
const payoutFor = chance => round2(RTP * 100 / chance)
// uniform 0–100 roll, 2 decimals (module-level: event-time randomness only)
const rollPoint = () => round2(Math.random() * 100)

// slider handle: block-face football (white ball, black patches — no star)
function BallHandle({ size = 24 }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill="#f5f7fa" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill="#16181d" />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill="#16181d" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export default function Dice({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(48.5)     // slider-set target line
  const [rolling, setRolling] = useState(false)
  const [, setResult] = useState(null)
  const [history, setHistory] = useState([])     // real rolls {v, win}, newest first
  const [toasts, setToasts] = useState([])
  const [numColor, setNumColor] = useState(null) // null | 'win' | 'lose'
  const trackRef = useRef(null)
  const dragRef = useRef(false)
  const numRef = useRef(null)
  const ballRef = useRef(null)
  const shownRef = useRef(50)                    // currently displayed roll value
  const rafRef = useRef(null)
  const lossTimerRef = useRef(null)
  const toastIdRef = useRef(0)

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
  }, [])

  const underChance = target                       // UNDER wins roll < target
  const overChance = round2(100 - target)          // OVER wins roll > target
  const payoutUnder = payoutFor(underChance)
  const payoutOver = payoutFor(overChance)
  const sliderPos = (target - TARGET_MIN) / (TARGET_MAX - TARGET_MIN)

  function targetFromPointer(e) {
    const r = trackRef.current.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    setTarget(round2(TARGET_MIN + p * (TARGET_MAX - TARGET_MIN)))
  }
  function onDown(e) {
    if (rolling) return
    dragRef.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    targetFromPointer(e)
  }
  function onMove(e) { if (dragRef.current && !rolling) targetFromPointer(e) }
  function onUp() { dragRef.current = false }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // ~1.2s ease-out roll: ball + big number driven per frame via refs
  function animateRoll(to, onDone) {
    const from = shownRef.current
    let t0 = null
    const step = now => {
      if (t0 === null) t0 = now
      const t = Math.min(1, (now - t0) / ROLL_MS)
      const e = 1 - Math.pow(1 - t, 3)
      const v = from + (to - from) * e
      shownRef.current = v
      if (numRef.current) numRef.current.textContent = v.toFixed(2)
      if (ballRef.current) ballRef.current.style.left = `${v}%`
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else onDone()
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function betOn(side) {
    if (rolling || bet > balance || bet < 1) return
    setBalance(b => round2(b - bet))
    setRolling(true)
    setResult(null)
    setNumColor(null)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)

    const roll = rollPoint()
    const chance = side === 'under' ? underChance : overChance
    // 边界: 两侧都用严格不等号 —— roll 恰等于 target 时两边都输
    const win = side === 'under' ? roll < target : roll > target
    const mult = payoutFor(chance)
    const pay = round2(bet * mult)

    animateRoll(roll, () => {
      if (win) {
        setBalance(b => round2(b + pay))
        pushToast(`开点 ${roll.toFixed(2)}`, pay)
        setNumColor('win')
      } else {
        setNumColor('lose')
        lossTimerRef.current = setTimeout(() => setNumColor(null), 700)
      }
      setResult({ roll, win, side, payout: pay })
      setHistory(h => [{ v: roll, win }, ...h].slice(0, 12))
      setRolling(false)
    })
  }

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
  const ribbed = color => `repeating-linear-gradient(90deg, ${color} 0px, ${color} 3px, rgba(0,0,0,0.5) 3px, rgba(0,0,0,0.5) 5px)`
  const bigBtn = (bg, locked) => ({
    minWidth: 118, padding: '8px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
    display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3,
  })
  const locked = rolling || bet > balance || bet < 1

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

        {/* ---- roll history strip: real rolls, win green / loss grey ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: DICE.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', marginBottom: 14, overflow: 'hidden', minHeight: 24,
        }}>
          {(isMobile ? history.slice(0, 5) : history.slice(0, 10)).map((h, i) => (
            <span key={history.length - i} style={{
              padding: '3px 10px', borderRadius: RADIUS.pill,
              background: h.win ? 'rgba(46,224,140,0.18)' : 'rgba(0,0,0,0.3)',
              color: h.win ? DICE.teal : 'rgba(255,255,255,0.55)',
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{h.v.toFixed(2)}</span>
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
          marginBottom: 16, position: 'relative',
        }}>
          <WinToast toasts={toasts} />
          <div ref={numRef} style={{
            textAlign: 'center',
            color: numColor === 'win' ? DICE.teal : numColor === 'lose' ? '#ff5a6e' : COLORS.white,
            fontSize: isMobile ? 44 : 60, fontWeight: 900, lineHeight: 1.1,
            fontFamily: "'Space Grotesk', sans-serif", marginBottom: 12,
            transition: 'color 0.15s',
          }}>50.00</div>

          <div style={{ position: 'relative', padding: '10px 0 4px' }}>
            {[0, 25, 50, 75, 100].map(p => (
              <span key={p} style={{
                position: 'absolute', top: 0, left: `${p}%`, width: 1, height: 7,
                background: 'rgba(255,255,255,0.65)',
                transform: p === 0 ? 'none' : p === 100 ? 'translateX(-1px)' : 'translateX(-0.5px)',
              }} />
            ))}

            {/* upper band — OVER: lose 0→target red, win target→100 blue */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${target}%`, background: ribbed(DICE.red) }} />
              <div style={{ flex: 1, background: ribbed(DICE.blue) }} />
            </div>

            {/* golden landing ball — rides the roll animation */}
            <div style={{ position: 'relative', height: 10, margin: '−2px 0' }}>
              <div ref={ballRef} style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                width: 26, height: 26, borderRadius: '50%',
                background: DICE.ball, border: '2px solid rgba(0,0,0,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16181d' }} />
              </div>
            </div>

            {/* lower band — UNDER: win 0→target teal, lose target→100 red */}
            <div style={{ display: 'flex', height: 28, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${target}%`, background: ribbed(DICE.teal) }} />
              <div style={{ flex: 1, background: ribbed(DICE.red) }} />
            </div>

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

        {/* ---- payout panel: UNDER-side readout + target slider ---- */}
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
              }}>{payoutUnder.toFixed(2)} x</div>
            </div>
            <div
              ref={trackRef}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{
                flex: 1, position: 'relative', height: 34,
                cursor: rolling ? 'not-allowed' : 'pointer', touchAction: 'none',
                opacity: rolling ? 0.6 : 1,
              }}
            >
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 12, height: 6,
                borderRadius: 3, background: DICE.panelDeep, border: '1px solid rgba(0,0,0,0.4)',
              }} />
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
              Potential win: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{round2(bet * payoutUnder).toFixed(2)} USD</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: 700 }}>
              Chance: <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>{underChance.toFixed(2)} %</span>
            </span>
          </div>
        </div>

        {/* ---- bottom bet band ---- */}
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
            opacity: rolling ? 0.6 : 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              disabled={rolling}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={rolling} onClick={() => setBet(b => Math.max(1, b - 10))} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={rolling} onClick={() => setBet(b => b + 10)} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: DICE.circleBlue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled={locked} onClick={() => betOn('under')} style={bigBtn(DICE.btnUnder, locked)}>
            <span>UNDER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↓ X{payoutUnder.toFixed(2)}</span>
          </button>
          <button type="button" disabled={locked} onClick={() => betOn('over')} style={bigBtn(DICE.btnOver, locked)}>
            <span>OVER</span>
            <span style={{ fontSize: 12, opacity: 0.9 }}>↑ X{payoutOver.toFixed(2)}</span>
          </button>
        </div>
      </Panel>
    </GameLayout>
  )
}
