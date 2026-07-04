import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DICE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import bgmUrl from '../assets/covers/bgm.mp3'

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
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const audioRef = useRef({ ctx: null, bus: null, muted: false })
  const bgmRef = useRef({ audio: null })
  const trackRef = useRef(null)
  const dragRef = useRef(false)
  const numRef = useRef(null)
  const ballRef = useRef(null)
  const shownRef = useRef(50)                    // currently displayed roll value
  const rafRef = useRef(null)
  const lossTimerRef = useRef(null)
  const toastIdRef = useRef(0)

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => {
    if (bgmOn) { if (!bgmRef.current.audio) { const a = new Audio(bgmUrl); a.loop = true; a.volume = 0.25; a.play().catch(() => {}); bgmRef.current.audio = a } }
    else if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => {
    if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)
  }, [])

  // ---------- audio (mechanical recipe, shared compressor bus — Hotline) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function bus() {
    const ctx = ensureAudio(); if (!ctx) return null
    if (!audioRef.current.bus) {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6
      comp.attack.value = 0.002; comp.release.value = 0.12
      const master = ctx.createGain(); master.gain.value = 0.9
      comp.connect(master); master.connect(ctx.destination)
      audioRef.current.bus = comp
    }
    return audioRef.current.bus
  }
  function clickLayer(ctx, out, t, { freq, vol, dur = 0.025 }) {
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.005)
    src.connect(bp); bp.connect(g); g.connect(out)
    src.start(t); src.stop(t + dur)
  }
  function woodLayer(ctx, out, t, { freq, vol, dur = 0.045 }) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.01)
  }
  function playTick() {   // mechanical ratchet click, ±10% pitch/volume humanized
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const j = 0.9 + Math.random() * 0.2
    clickLayer(ctx, out, t, { freq: 3000 * j, vol: 0.09 * j })
    woodLayer(ctx, out, t, { freq: 200 * j, vol: 0.05 * j })
  }
  function playChip() {   // bet/step clack — same recipe, lighter & tighter
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const j = 0.9 + Math.random() * 0.2
    clickLayer(ctx, out, t, { freq: 2200 * j, vol: 0.07 * j, dur: 0.02 })
    woodLayer(ctx, out, t, { freq: 260 * j, vol: 0.035 * j, dur: 0.035 })
  }
  function playLand() {   // pocket thunk: low noise + bass drop + lock knock
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.09)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource(); src.buffer = buf
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
    const ng = ctx.createGain(); ng.gain.value = 0.22
    src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.09)
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t)
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.11)
    clickLayer(ctx, out, t + 0.01, { freq: 700, vol: 0.1, dur: 0.015 })
  }
  // Rising three-note chime, each note a detuned pair, with a short delay tail.
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const tail = ctx.createDelay(0.4); tail.delayTime.value = 0.16
    const fb = ctx.createGain(); fb.gain.value = 0.24
    const wet = ctx.createGain(); wet.gain.value = 0.35
    tail.connect(fb); fb.connect(tail); tail.connect(wet); wet.connect(out)
    ;[520, 690, 920].forEach((f, i) => {
      const s = t + i * 0.085
      ;[0.997, 1.004].forEach(dt => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * dt
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, s)
        g.gain.exponentialRampToValueAtTime(0.07, s + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
        o.connect(g); g.connect(out); g.connect(tail)
        o.start(s); o.stop(s + 0.32)
      })
    })
  }
  function playLose() {   // muffled descending thud
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const out = bus(); const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.46)
  }

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

  // ~1.2s ease-out roll: ball + big number driven per frame via refs.
  // Ticks fire on 2-point boundary crossings of the eased value, so they
  // thin out naturally with the deceleration; a thunk lands at the stop.
  function animateRoll(to, onDone) {
    const from = shownRef.current
    let t0 = null
    let lastK = Math.floor(from / 2)
    const step = now => {
      if (t0 === null) t0 = now
      const t = Math.min(1, (now - t0) / ROLL_MS)
      const e = 1 - Math.pow(1 - t, 3)
      const v = from + (to - from) * e
      shownRef.current = v
      if (numRef.current) numRef.current.textContent = v.toFixed(2)
      if (ballRef.current) ballRef.current.style.left = `${v}%`
      const k = Math.floor(v / 2)
      if (k !== lastK) { lastK = k; playTick() }
      if (t < 1) rafRef.current = requestAnimationFrame(step)
      else { playLand(); onDone() }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  function betOn(side) {
    if (rolling || bet > balance || bet < 1) return
    const roll = rollPoint()   // roll first — SFX jitter randoms must not sit ahead of it
    ensureAudio()
    playChip()
    setBalance(b => round2(b - bet))
    setRolling(true)
    setResult(null)
    setNumColor(null)
    if (lossTimerRef.current) clearTimeout(lossTimerRef.current)

    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only; after the roll)
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
        playWin()
      } else {
        setNumColor('lose')
        lossTimerRef.current = setTimeout(() => setNumColor(null), 700)
        playLose()
      }
      setResult({ roll, win, side, payout: pay })
      setHistory(h => [{ v: roll, win }, ...h].slice(0, 12))
      // fake feed rows settle for the round: ~45% cash green, the rest grey out
      setFeedBets(list => list.map(b => Math.random() < 0.45
        ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
        : { ...b, status: 'crashed' }))
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
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)

  // roll-value pill strip — desktop renders it in the 34px skeleton row,
  // mobile keeps it inside the card (never both)
  const historyStrip = (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: DICE.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', overflow: 'hidden', minHeight: 24,
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
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${DICE.bgCenter}, ${DICE.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
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
          <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
            color: COLORS.white, border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
            fontSize: 13, cursor: 'pointer',
          }}>🎵</button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 14, cursor: 'pointer',
          }}>{muted ? '🔇' : '🔊'}</button>
        </div>

        {/* ---- roll history strip (mobile only — desktop row has it) ---- */}
        {!isDesk && <div style={{ marginBottom: 14 }}>{historyStrip}</div>}

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
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => Math.max(1, b - 10)) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={rolling} onClick={() => { playChip(); setBet(b => b + 10) }} style={{ ...circleBtn, opacity: rolling ? 0.5 : 1, cursor: rolling ? 'not-allowed' : 'pointer' }}>+</button>
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
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Hotline ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Total Goals</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              {historyStrip}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged ----
  return (
    <GameLayout title="Total Goals" emoji="⚽" color={DICE.teal}>
      {gameCard}
    </GameLayout>
  )
}
