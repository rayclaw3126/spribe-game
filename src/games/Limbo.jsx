import { useEffect, useRef, useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, LAYOUT } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import ballUrl from '../assets/covers/ball-3d.png'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const FILL_TOP = '#5DCAA5'
const AMBER = '#F59E0B'
const HOUSE_EDGE = 0.99
const MAX_MULT = 1000000
const CLIMB_MS = 1400
const TICKS = [1, 1.5, 2, 3, 5, 10, 100]

function rand(min, max) {
  return min + Math.random() * (max - min)
}

// Shared log mapping for fill, ball and target line: 1× at the bottom,
// 10× at 80% height, everything above compressed asymptotically to the top.
function meterNorm(v) {
  if (v <= 1) return 0
  const l = Math.log10(v)
  if (l <= 1) return l * 0.8
  return 0.8 + 0.2 * (1 - 1 / l)
}

function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3)
}

export default function Limbo({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const canvasRef = useRef(null)
  const ballRef = useRef(null)
  const frameRef = useRef(null)
  const phaseRef = useRef('idle')          // idle | climbing | done
  const animRef = useRef(null)             // { to, start, bet, t }
  const multRef = useRef(1)
  const targetRef = useRef(2)
  const particlesRef = useRef([])
  const burstRef = useRef(false)           // pending win burst
  const bounceRef = useRef(0)              // loss bounce start timestamp
  const isMobileRef = useRef(false)
  const audioRef = useRef({ ctx: null, muted: false, engine: null })
  const bgmRef = useRef({ audio: null })

  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(2.0)
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [multiplier, setMultiplier] = useState(1)
  const [roundHistory, setRoundHistory] = useState([])   // final multiplier per round, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const t = Math.max(1.01, target || 1.01)
  const winChance = Math.min(99, (HOUSE_EDGE / t) * 100)
  const payout = parseFloat((bet * t).toFixed(2))
  targetRef.current = t
  isMobileRef.current = isMobile

  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    const ctx = new AudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx
    return ctx
  }

  function stopEngine() {
    const engine = audioRef.current.engine
    if (!engine) return
    engine.gain.gain.cancelScheduledValues(engine.ctx.currentTime)
    engine.gain.gain.setTargetAtTime(0, engine.ctx.currentTime, 0.04)
    setTimeout(() => {
      try {
        engine.osc.stop()
        engine.lfo.stop()
      } catch {
        // Oscillators may already be stopped after rapid route changes.
      }
    }, 180)
    audioRef.current.engine = null
  }

  // Climb tone — Aviator's engine voice, pitch driven by the fill height (same log mapping).
  function startEngine() {
    const ctx = audioRef.current.ctx
    if (!ctx || audioRef.current.muted) return
    if (ctx.state === 'suspended') ctx.resume()
    stopEngine()
    const osc = ctx.createOscillator()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 70
    lfo.frequency.value = 18
    lfoGain.gain.value = 11
    gain.gain.value = 0.0001
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    lfo.start()
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.08)
    audioRef.current.engine = { ctx, osc, lfo, gain }
  }

  function updateEngine(mult) {
    const engine = audioRef.current.engine
    if (!engine || audioRef.current.muted) return
    engine.osc.frequency.setTargetAtTime(70 + meterNorm(mult) * 260, engine.ctx.currentTime, 0.05)
  }

  // Win — short rising chime, fired on the same frame as the particle burst.
  function playWin() {
    const ctx = ensureAudio()
    if (!ctx || audioRef.current.muted) return
    const gain = ctx.createGain()
    gain.gain.value = 0.001
    gain.connect(ctx.destination)
    ;[660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(ctx.currentTime + i * 0.06)
      osc.stop(ctx.currentTime + 0.28 + i * 0.06)
    })
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
  }

  // Loss — low falling thud, fired on the same frame as the ball's dip-and-spring.
  function playLoss() {
    const ctx = ensureAudio()
    if (!ctx || audioRef.current.muted) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(58, ctx.currentTime + 0.45)
    gain.gain.value = 0.001
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.stop(ctx.currentTime + 0.55)
  }

  // Background music — real looping casino track (HTML Audio), independent of SFX mute.
  function startBgm() {
    if (bgmRef.current.audio) return
    const audio = new Audio(bgmUrl)
    audio.loop = true
    audio.volume = 0.25            // quiet — stays under the SFX (ding/crash)
    audio.play().catch(() => {})   // ignore autoplay rejection (starts on the click gesture)
    bgmRef.current.audio = audio
  }

  function stopBgm() {
    if (bgmRef.current.audio) {
      bgmRef.current.audio.pause()
      bgmRef.current.audio = null
    }
  }

  function play() {
    if (bet > balance || rolling) return
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    setResult(null)
    setRolling(true)
    const r = Math.random()
    const finalMult = Math.min(MAX_MULT, Math.max(1, parseFloat((HOUSE_EDGE / r).toFixed(2))))
    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only; after the roll)
    animRef.current = { to: finalMult, start: performance.now(), bet, t }
    particlesRef.current = []
    burstRef.current = false
    bounceRef.current = 0
    multRef.current = 1
    setMultiplier(1)
    phaseRef.current = 'climbing'
    ensureAudio()
    startEngine()
  }

  function settle() {
    const { to, bet: b, t: tt } = animRef.current
    phaseRef.current = 'done'
    multRef.current = to
    setMultiplier(to)
    const win = to >= tt
    const profit = win ? parseFloat((b * tt).toFixed(2)) : 0
    if (win) setBalance(bb => parseFloat((bb + profit).toFixed(2)))
    setResult({ mult: to, win, profit })
    setRoundHistory(h => [to, ...h].slice(0, 20))
    // fake feed rows settle for the round: ~45% cash green, the rest grey out
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setRolling(false)
    stopEngine()
    if (win) { burstRef.current = true; playWin() }
    else { bounceRef.current = performance.now(); playLoss() }
  }

  function drawMeter() {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(cv.clientWidth * dpr)
    const H = Math.round(cv.clientHeight * dpr)
    if (!W || !H) return
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const mobile = isMobileRef.current
    const now = performance.now()
    const mult = multRef.current
    const tv = targetRef.current

    ctx.fillStyle = '#0a1119'
    ctx.fillRect(0, 0, W, H)

    const padY = 28 * dpr
    const trackW = (mobile ? 40 : 54) * dpr
    const trackX = W * (mobile ? 0.26 : 0.30)
    const top = padY
    const bottom = H - padY
    const innerH = bottom - top
    const yOf = v => bottom - meterNorm(v) * innerH

    // Track
    ctx.beginPath()
    ctx.roundRect(trackX, top, trackW, innerH, trackW / 2)
    ctx.fillStyle = '#111b27'
    ctx.fill()
    ctx.strokeStyle = '#232c39'
    ctx.lineWidth = 1.5 * dpr
    ctx.stroke()

    // Scale ticks — same log mapping as fill and target line.
    ctx.font = `700 ${10.5 * dpr}px 'Space Grotesk', sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    TICKS.forEach(v => {
      const y = yOf(v)
      ctx.strokeStyle = '#243142'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.moveTo(trackX - 8 * dpr, y)
      ctx.lineTo(trackX, y)
      ctx.stroke()
      ctx.fillStyle = mult >= v ? '#86efac' : '#7d8a99'
      ctx.fillText(`${v}×`, trackX - 12 * dpr, y)
    })

    // Fill — clipped to the rounded track, green gradient climbing with the result.
    const yFill = yOf(mult)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(trackX, top, trackW, innerH, trackW / 2)
    ctx.clip()
    const grad = ctx.createLinearGradient(0, bottom, 0, top)
    grad.addColorStop(0, COLOR)
    grad.addColorStop(1, FILL_TOP)
    ctx.fillStyle = grad
    ctx.fillRect(trackX, yFill, trackW, bottom - yFill + trackW)
    if (mult > 1.001) {
      ctx.strokeStyle = FILL_TOP
      ctx.lineWidth = 2.5 * dpr
      ctx.shadowColor = COLOR
      ctx.shadowBlur = 14 * dpr
      ctx.beginPath()
      ctx.moveTo(trackX + 3 * dpr, yFill)
      ctx.lineTo(trackX + trackW - 3 * dpr, yFill)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    ctx.restore()

    // Target line — amber, positioned by the same mapping.
    const yT = Math.max(top + 8 * dpr, yOf(tv))
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 2 * dpr
    ctx.shadowColor = AMBER
    ctx.shadowBlur = 6 * dpr
    ctx.beginPath()
    ctx.moveTo(trackX - 6 * dpr, yT)
    ctx.lineTo(trackX + trackW + 6 * dpr, yT)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.font = `800 ${11.5 * dpr}px 'Space Grotesk', sans-serif`
    ctx.textAlign = 'left'
    ctx.fillStyle = AMBER
    ctx.fillText(`目标 ${tv.toFixed(2)}×`, trackX + trackW + 12 * dpr, yT)

    // Grass-litter trail while climbing (same particle look as Aviator).
    const ballX = trackX + trackW / 2
    if (phaseRef.current === 'climbing') {
      particlesRef.current.push({
        x: ballX + rand(-14, 14) * dpr,
        y: yFill + rand(6, 20) * dpr,
        vx: rand(-1.2, 1.2) * dpr,
        vy: rand(0.4, 1.4) * dpr,
        life: 1,
        color: Math.random() > 0.5 ? '#4ade80' : '#2f9e5a',
      })
    }

    // Win burst — one-time green/gold debris from the ball position.
    if (burstRef.current) {
      burstRef.current = false
      for (let i = 0; i < 30; i++) {
        const a = (Math.PI * 2 * i) / 30 + rand(-0.28, 0.28)
        const sp = rand(2.5, 6) * dpr
        particlesRef.current.push({
          x: ballX,
          y: yFill,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - rand(0, 1.5) * dpr,
          g: 0.14 * dpr,
          life: 1,
          decay: 0.016,
          size: rand(3, 5) * dpr,
          color: Math.random() > 0.5 ? '#4ade80' : '#facc15',
        })
      }
    }

    particlesRef.current = particlesRef.current
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + (p.g || 0), life: p.life - (p.decay || 0.025) }))
      .filter(p => p.life > 0)
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      const w = p.size || 4 * dpr
      const h = p.size || 2 * dpr
      ctx.fillRect(p.x, p.y, w, h)
    })
    ctx.globalAlpha = 1

    // Ball — rides the fill top; gentle bob when idle, dip-and-spring on a loss.
    let ballY = yFill
    if (phaseRef.current === 'idle') ballY += Math.sin(now / 600) * 3 * dpr
    if (bounceRef.current) {
      const p = (now - bounceRef.current) / 650
      if (p < 1) ballY += Math.sin(p * Math.PI) * (1 - p * 0.4) * 22 * dpr
      else bounceRef.current = 0
    }
    const img = ballRef.current
    const r = (mobile ? 16 : 21) * dpr
    if (img?.complete) {
      ctx.save()
      ctx.translate(ballX, ballY)
      if (phaseRef.current === 'climbing') ctx.rotate(now / 240)
      ctx.drawImage(img, -r, -r, r * 2, r * 2)
      ctx.restore()
    }
  }

  useEffect(() => {
    const img = new Image()
    img.src = ballUrl
    ballRef.current = img

    const animate = now => {
      if (phaseRef.current === 'climbing' && animRef.current) {
        const p = Math.min(1, (now - animRef.current.start) / CLIMB_MS)
        const v = 1 + (animRef.current.to - 1) * easeOutCubic(p)
        multRef.current = v
        setMultiplier(Number(v.toFixed(2)))
        updateEngine(v)
        if (p >= 1) settle()
      }
      drawMeter()
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(frameRef.current)
      stopEngine()
      stopBgm()
    }
    // The meter loop owns round settlement through refs; restarting it on render would duplicate frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    audioRef.current.muted = muted
    if (muted) stopEngine()
    if (!muted && phaseRef.current === 'climbing') startEngine()
    // Audio nodes are managed imperatively through refs to avoid restarting the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  useEffect(() => {
    // BGM starts on user interaction (BGM button click) — respects autoplay policy.
    if (bgmOn) startBgm()
    else stopBgm()
    // BGM nodes are managed imperatively through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])

  const isWin = result?.win
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)

  const side = (
        <SideControls
          bet={bet} target={target} setTarget={setTarget}
          rolling={rolling} result={result}
          t={t} winChance={winChance} payout={payout}
        />
  )

  const mainPanel = (
      <Panel style={{
        background: '#0a1119', borderColor: '#232c39', padding: isMobile ? 12 : 18, overflow: 'hidden',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {!isDesk && <RoundHistoryBar rounds={roundHistory} />}
        <style>{`
          @keyframes ocFlash {
            0%, 100% { color: #EF4444; }
            25%, 75% { color: #ff9d94; }
            50% { color: #EF4444; }
          }
        `}</style>
        <div style={{ position: 'relative' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: isMobile ? 300 : 420, display: 'block', borderRadius: 12 }} />

          {/* BGM toggle — canvas top-right (left of mute) */}
          <button
            type="button"
            onClick={() => setBgmOn(v => !v)}
            style={{
              position: 'absolute', top: 10, right: 58,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: bgmOn ? 'rgba(22,199,132,0.18)' : 'rgba(26,34,48,0.85)',
              color: bgmOn ? COLOR : '#7d8a99',
              border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : '#232c39'}`,
              fontSize: 16,
            }}
            title={bgmOn ? '关闭背景音乐' : '开启背景音乐'}
          >
            🎵
          </button>

          {/* Mute — canvas top-right */}
          <button
            type="button"
            onClick={() => setMuted(v => !v)}
            style={{
              position: 'absolute', top: 10, right: 10,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(26,34,48,0.85)',
              color: muted ? '#7d8a99' : COLOR,
              border: '1px solid #232c39',
              fontSize: 18,
            }}
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          <div style={{
            position: 'absolute', top: 0, bottom: 0, right: isMobile ? '2%' : '8%',
            width: isMobile ? 150 : 220,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', textAlign: 'center',
          }}>
            <div style={{
              fontSize: isMobile ? 40 : 64, fontWeight: 800, lineHeight: 1,
              fontFamily: "'Space Grotesk', sans-serif",
              color: result ? (isWin ? '#10B981' : '#EF4444') : COLOR,
              animation: result ? (isWin ? 'winPop 0.4s ease' : 'ocFlash 0.6s ease') : 'none',
              marginBottom: 12,
            }}>
              {multiplier.toFixed(2)}×
            </div>
            <p style={{ color: '#7d8a99', fontSize: 13, lineHeight: 1.5 }}>
              {rolling ? 'Odds climbing...' : result
                ? (isWin ? `Reached ${result.mult.toFixed(2)}× — above your ${t.toFixed(2)}× target!` : `Stopped at ${result.mult.toFixed(2)}× — needed ${t.toFixed(2)}×`)
                : 'Set target odds, kick off — win if final ≥ your target'}
            </p>
          </div>
        </div>
      </Panel>
  )

  // Shell bet bay — one-shot mode: bet → settling (greyed) → bet again. No Auto tab.
  const betBay = (
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>
        <BetPanel
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={rolling}
          chipDisabled={rolling}
          showAuto={false}
          button={rolling
            ? { state: 'waiting', label: '结算中…', disabled: true }
            : { state: 'bet', label: `下注 $${bet.toFixed(2)}`, onClick: play, disabled: bet > balance || bet < 1 }}
        />
      </div>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Total Goals ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Odds Climb</strong>
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
              <RoundHistoryBar rounds={roundHistory} />
            </div>
            {/* in-card arrangement unchanged: meter left, Target Odds right, bay under meter */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'stretch', height: '100%', boxSizing: 'border-box' }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ flex: 1, minHeight: 0 }}>{mainPanel}</div>
                  {betBay}
                </div>
                <div style={{ minWidth: 0 }}>{side}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged ----
  return (
    <GameLayout title="Odds Climb" emoji="📈" color={COLOR} sidebar={side}>
      {mainPanel}
      {betBay}
    </GameLayout>
  )
}

const darkInput = {
  width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
  border: '1.5px solid #243142', fontSize: 15, fontWeight: 600,
  background: '#0a1119', color: '#e8edf2',
}
const darkChip = {
  flex: 1, padding: '6px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  background: '#1a2230', color: '#8a97a6', border: '1.5px solid #243142',
}

function SideControls({ bet, target, setTarget, rolling, result, t, winChance, payout }) {
  return (
    <Panel style={{ background: '#101923', borderColor: '#243142', padding: 18 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', color: '#8a97a6', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Target Odds</label>
        <input type="number" min="1.01" step="0.01" value={target}
          onChange={e => setTarget(Math.max(1.01, Number(e.target.value)))}
          disabled={rolling}
          style={darkInput}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {[1.5, 2, 5, 10].map(v => (
            <button key={v} onClick={() => setTarget(v)} disabled={rolling}
              style={{ ...darkChip, borderColor: t === v ? 'rgba(22,199,132,0.5)' : '#243142', color: t === v ? COLOR : '#8a97a6' }}>{v}×</button>
          ))}
        </div>
      </div>
      <div style={{ background: '#1a2230', border: '1px solid #232c39', borderRadius: 12, padding: '12px 14px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <StatBox label="Win Chance" value={`${winChance.toFixed(1)}%`} color={COLOR} />
        <StatBox label="Multiplier" value={`${t.toFixed(2)}×`} color='#10B981' />
        <StatBox label="Payout" value={`$${payout.toFixed(2)}`} color={AMBER} />
        <StatBox label="Profit" value={`$${(payout - bet).toFixed(2)}`} color={COLOR} />
      </div>
      {result && (
        <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12,
          background: result.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${result.win ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
          color: result.win ? '#6EE7B7' : '#FCA5A5',
          fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease' }}>
          {result.win ? '🎉' : '💔'} Final {result.mult.toFixed(2)}× — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Below target'}
        </div>
      )}
    </Panel>
  )
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#7d8a99', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
