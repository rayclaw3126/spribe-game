import { useEffect, useMemo, useRef, useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, LAYOUT } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import { createArenaFx, drawArenaFx, drawWaiting, makeFeedBots } from '../components/shell/arenaFx'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import ballUrl from '../assets/covers/ball-3d.png'
import bgmUrl from '../assets/covers/bgm.mp3'
import bayBgUrl from '../assets/shared/bay_bg.png'

const GREEN = '#16C784'
const HISTORY_SEED = [1.42, 2.81, 1.06, 5.24, 1.88, 3.37, 9.12, 1.19, 2.05, 4.63]
// Betting window — the countdown, the waiting-bay progress bar and auto-bet
// all pace off this single constant.
const BETTING_MS = 5000
const BETTING_S = BETTING_MS / 1000

function generateCrash() {
  const r = Math.random()
  if (r < 0.01) return 1
  return Math.max(1, 0.99 / (1 - r))
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function money(n) {
  return Number(n).toFixed(2)
}

// One bet bay's full state — both panels share the same money path.
function makePanel() {
  return {
    bet: 10,
    playerBet: null,
    cashedOut: null,
    autoBet: false,
    autoCashOn: false,
    autoCashMult: 2.0,
    note: '',      // per-round hint, cleared on reset
    autoNote: '',  // sticky hint (auto-bet stopped), cleared on re-enable
  }
}

export default function Aviator({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const canvasRef = useRef(null)
  const ballRef = useRef(null)
  const frameRef = useRef(null)
  const phaseRef = useRef('betting')
  const countdownRef = useRef(BETTING_S)
  const startRef = useRef(0)
  const crashRef = useRef(2)
  const multRef = useRef(1)
  const particlesRef = useRef([])
  const burstRef = useRef(false)
  const flashRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false, engine: null })
  const bgmRef = useRef({ audio: null })
  // Synchronous mirrors — actions guard/settle through these so rapid clicks,
  // the rAF loop and timers all see committed values instantly (race safety).
  const panelsRef = useRef(null)
  const balanceRef = useRef(balance)
  // Backdrop FX + waiting-ceremony timing (pure visuals)
  const fxRef = useRef(null)
  const bettingStartRef = useRef(0)
  const launchAtRef = useRef(0)
  const roundIdRef = useRef(0)   // keys the player's feed row per round
  const crashAtRef = useRef(0)   // crash timestamp — drives the ball fly-out
  if (fxRef.current === null) fxRef.current = createArenaFx()

  function pushToast(mult, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, mult, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  const [panels, setPanels] = useState(() => [makePanel(), makePanel()])
  const [phase, setPhase] = useState('betting')
  const [countdown, setCountdown] = useState(BETTING_S)
  const [multiplier, setMultiplier] = useState(1)
  const [crashPoint, setCrashPoint] = useState(null)
  const [history, setHistory] = useState(HISTORY_SEED)
  const [players, setPlayers] = useState(() => makeFeedBots())
  const [myBets, setMyBets] = useState([])   // player's last 20 settled rounds (display only)
  const [toasts, setToasts] = useState([])   // cash-out toasts (display only)
  const toastIdRef = useRef(0)
  const [online, setOnline] = useState(() => Math.floor(rand(820, 980)))
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const [message, setMessage] = useState('')

  if (panelsRef.current === null) panelsRef.current = panels

  useEffect(() => { balanceRef.current = balance }, [balance])

  function updatePanel(i, patch) {
    panelsRef.current = panelsRef.current.map((p, j) => (j === i ? { ...p, ...patch } : p))
    setPanels(panelsRef.current)
  }

  // Single money path — every balance change in the game goes through here.
  function credit(delta) {
    balanceRef.current = Number((balanceRef.current + delta).toFixed(2))
    setBalance(b => Number((b + delta).toFixed(2)))
  }

  const displayPlayers = useMemo(() => {
    const p = panels[0]
    const you = p.playerBet ? [{
      id: `you-${roundIdRef.current}`,
      name: '你',
      bet: p.playerBet.amount,
      target: p.cashedOut?.mult || null,
      status: p.cashedOut ? 'cashed' : phase === 'crashed' ? 'crashed' : 'live',
      payout: p.cashedOut?.win || null,
      you: true,
    }] : []
    return [...you, ...players]
  }, [panels, phase, players])

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
    osc.frequency.value = 68
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
    engine.osc.frequency.setTargetAtTime(68 + Math.min(mult, 12) * 18, engine.ctx.currentTime, 0.05)
  }

  function playDing() {
    const ctx = ensureAudio()
    if (!ctx || audioRef.current.muted) return
    const gain = ctx.createGain()
    gain.gain.value = 0.001
    gain.connect(ctx.destination)
    ;[880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(ctx.currentTime + i * 0.06)
      osc.stop(ctx.currentTime + 0.28 + i * 0.06)
    })
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
  }

  function playCrash() {
    const ctx = ensureAudio()
    if (!ctx || audioRef.current.muted) return
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.45, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)

    const noise = ctx.createBufferSource()
    const boom = ctx.createOscillator()
    const whistle = ctx.createOscillator()
    const gain = ctx.createGain()
    const boomGain = ctx.createGain()
    const whistleGain = ctx.createGain()
    noise.buffer = noiseBuffer
    boom.type = 'triangle'
    boom.frequency.setValueAtTime(95, ctx.currentTime)
    boom.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.42)
    whistle.type = 'sine'
    whistle.frequency.setValueAtTime(1700, ctx.currentTime)
    whistle.frequency.exponentialRampToValueAtTime(620, ctx.currentTime + 0.5)
    gain.gain.value = 0.16
    boomGain.gain.value = 0.18
    whistleGain.gain.value = 0.05
    noise.connect(gain).connect(ctx.destination)
    boom.connect(boomGain).connect(ctx.destination)
    whistle.connect(whistleGain).connect(ctx.destination)
    noise.start()
    boom.start()
    whistle.start()
    noise.stop(ctx.currentTime + 0.45)
    boom.stop(ctx.currentTime + 0.5)
    whistle.stop(ctx.currentTime + 0.5)
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

  function resetRound() {
    phaseRef.current = 'betting'
    bettingStartRef.current = performance.now()
    roundIdRef.current += 1
    multRef.current = 1
    particlesRef.current = []
    burstRef.current = false
    flashRef.current = 0
    setPhase('betting')
    countdownRef.current = BETTING_S
    setCountdown(BETTING_S)
    setMultiplier(1)
    setCrashPoint(null)
    panelsRef.current = panelsRef.current.map(p => ({ ...p, playerBet: null, cashedOut: null, note: '' }))
    setPanels(panelsRef.current)
    setPlayers(makeFeedBots())
    setMessage('')
    stopEngine()
    autoBetsOnRoundStart()
  }

  function launchRound() {
    const cp = Number(generateCrash().toFixed(2))
    crashRef.current = cp
    startRef.current = performance.now()
    launchAtRef.current = performance.now()
    phaseRef.current = 'flying'
    setPhase('flying')
    setCrashPoint(cp)
    setMessage('')
    startEngine()
  }

  function crashRound() {
    phaseRef.current = 'crashed'
    crashAtRef.current = performance.now()
    flashRef.current = 0.7
    stopEngine()
    playCrash()
    setPhase('crashed')
    setCrashPoint(crashRef.current)
    setHistory(h => [Number(crashRef.current.toFixed(2)), ...h].slice(0, 20))
    setPlayers(list => list.map(p => p.status === 'live' ? { ...p, status: 'crashed' } : p))
    // record the player's lost stake in the feed's My Bets (display only)
    panelsRef.current.forEach(p => {
      if (p.playerBet && !p.cashedOut) {
        setMyBets(m => [{ bet: p.playerBet.amount, mult: 0, win: 0 }, ...m].slice(0, 20))
      }
    })
    setMessage(`本轮 ${crashRef.current.toFixed(2)}× 飞了`)
    setTimeout(resetRound, 2200)
  }

  function placeBetFor(i, { auto = false } = {}) {
    const p = panelsRef.current[i]
    if (phaseRef.current !== 'betting' || p.playerBet || p.bet < 1 || p.bet > balanceRef.current) return
    if (!auto) ensureAudio()
    const amount = Number(p.bet)
    updatePanel(i, { playerBet: { amount }, note: `已下注 $${money(amount)}，本轮生效` })
    credit(-amount)
  }

  function cancelBetFor(i) {
    const p = panelsRef.current[i]
    if (phaseRef.current !== 'betting' || !p.playerBet) return
    const amount = p.playerBet.amount
    updatePanel(i, { playerBet: null, note: '已取消下注' })
    credit(amount)
  }

  // Manual cashout settles at the current multiplier; auto passes its target
  // and settles at exactly that (not the trigger frame's multiplier).
  function cashOutFor(i, targetMult = null) {
    const p = panelsRef.current[i]
    if (phaseRef.current !== 'flying' || !p.playerBet || p.cashedOut) return
    if (!targetMult) ensureAudio()
    const mult = targetMult ?? Number(multRef.current.toFixed(2))
    const win = Number((p.playerBet.amount * mult).toFixed(2))
    updatePanel(i, {
      cashedOut: { mult, win },
      note: `已${targetMult ? '自动兑现' : '套现'} ${mult.toFixed(2)}× — +$${money(win)}`,
    })
    credit(win)
    setMyBets(m => [{ bet: p.playerBet.amount, mult, win }, ...m].slice(0, 20))
    pushToast(mult, win)
    playDing()
  }

  function toggleAutoBet(i) {
    const p = panelsRef.current[i]
    const next = !p.autoBet
    updatePanel(i, { autoBet: next, autoNote: '' })
    if (next && phaseRef.current === 'betting' && !p.playerBet) placeBetFor(i, { auto: true })
  }

  function autoBetsOnRoundStart() {
    panelsRef.current.forEach((p, i) => {
      if (!p.autoBet) return
      if (p.bet < 1 || p.bet > balanceRef.current) {
        updatePanel(i, { autoBet: false, autoNote: '余额不足，自动下注已停' })
        return
      }
      placeBetFor(i, { auto: true })
    })
  }

  function drawArena(current, mode = phaseRef.current) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(320, Math.floor(rect.width * dpr))
    const height = Math.max(220, Math.floor(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const pad = W * 0.08
    const baseY = H - H * 0.12
    const maxMult = Math.max(6, Math.min(crashRef.current * 1.35, 18))
    const progress = Math.min(Math.log(Math.max(current, 1)) / Math.log(maxMult), 1)
    const x = pad + progress * (W * 0.66)
    const y = baseY - Math.pow(progress, 1.45) * (H * 0.58)
    // Pure dark background — no goal, no turf.
    ctx.fillStyle = '#0a1119'
    ctx.fillRect(0, 0, W, H)

    // Speed-sense backdrop: rotating radial wedges + parallax star drift.
    drawArenaFx(ctx, fxRef.current, { W, H, dpr, now: performance.now(), mode, mult: current })

    // Rising climb line — straight, thick, solid, green→red gradient (longer = redder).
    const startX = pad
    const startY = baseY
    if (x > startX + 0.5 || y < startY - 0.5) {
      const grad = ctx.createLinearGradient(startX, startY, x, y)
      grad.addColorStop(0, '#16C784')
      grad.addColorStop(0.6, '#e0b100')
      grad.addColorStop(1, '#e2564a')
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(x, y)
      ctx.strokeStyle = grad
      ctx.lineWidth = 5 * dpr
      ctx.shadowColor = '#e2564a'
      ctx.shadowBlur = 10 * dpr
      ctx.stroke()
      ctx.restore()
    }

    // Grass-litter particle trail.
    if (mode === 'flying') {
      particlesRef.current.push({
        x: x - rand(12, 28) * dpr,
        y: y + rand(4, 18) * dpr,
        vx: -rand(0.4, 1.6) * dpr,
        vy: rand(-0.8, 1.2) * dpr,
        life: 1,
        color: Math.random() > 0.5 ? '#4ade80' : '#2f9e5a',
      })
    }

    // Crash burst — one-time red/orange debris exploding from the ball position.
    if (mode === 'crashed' && !burstRef.current) {
      burstRef.current = true
      for (let i = 0; i < 34; i++) {
        const a = (Math.PI * 2 * i) / 34 + rand(-0.28, 0.28)
        const sp = rand(3, 7) * dpr
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - rand(0, 1.5) * dpr,
          g: 0.16 * dpr,
          life: 1,
          decay: 0.016,
          size: rand(3, 5) * dpr,
          color: Math.random() > 0.5 ? '#e2564a' : '#f5a623',
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

    // Waving ball — transparent PNG, flying along the curve + rotating.
    // On crash the ball vanishes (it has exploded into debris above).
    // While betting: waiting bay (center ball + label + countdown bar); at
    // launch the ball glides from center onto the curve (no position jump).
    const img = ballRef.current
    const r = (isMobile ? 23 : 30) * dpr
    if (mode === 'betting') {
      drawWaiting(ctx, {
        W, H, dpr, now: performance.now(), img,
        progress: (performance.now() - bettingStartRef.current) / BETTING_MS,
      })
    } else if (mode === 'crashed') {
      // Fly-out: for ~400ms the ball accelerates along the curve's tangent
      // off-canvas, spinning faster. Fresh full repaint each frame — no trails.
      const t = (performance.now() - crashAtRef.current) / 400
      if (img?.complete && t < 1) {
        const dirX = W * 0.66
        const dirY = -1.45 * Math.pow(Math.max(progress, 0.001), 0.45) * (H * 0.58)
        const len = Math.hypot(dirX, dirY) || 1
        const dist = t * t * 900 * dpr
        ctx.save()
        ctx.translate(x + (dirX / len) * dist, y + (dirY / len) * dist)
        ctx.rotate(performance.now() / 60)
        ctx.drawImage(img, -r, -r, r * 2, r * 2)
        ctx.restore()
      }
    } else if (img?.complete) {
      const sinceLaunch = performance.now() - launchAtRef.current
      let bx = x, by = y
      if (sinceLaunch < 300) {
        const k = sinceLaunch / 300
        bx = W / 2 + (x - W / 2) * k
        by = H / 2 + (y - H / 2) * k
      }
      ctx.save()
      ctx.translate(bx, by)
      ctx.rotate((performance.now() / 240) + progress * 8)
      ctx.drawImage(img, -r, -r, r * 2, r * 2)
      ctx.restore()
    }

    // Crash white flash — full-screen, decays fast.
    if (flashRef.current > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flashRef.current})`
      ctx.fillRect(0, 0, W, H)
      flashRef.current *= 0.85
    }

  }

  useEffect(() => {
    const img = new Image()
    img.src = ballUrl
    ballRef.current = img
    img.onload = () => drawArena(multRef.current)
    // drawArena intentionally reads refs and current canvas size for the render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    audioRef.current.muted = muted
    if (muted) stopEngine()
    if (!muted && phaseRef.current === 'flying') startEngine()
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

  useEffect(() => {
    const onlineTimer = setInterval(() => {
      setOnline(v => Math.max(600, Math.min(1200, v + Math.floor(rand(-7, 9)))))
    }, 1500)
    return () => clearInterval(onlineTimer)
  }, [])

  useEffect(() => {
    resetRound()
    const countdownTimer = setInterval(() => {
      if (phaseRef.current !== 'betting') return
      // Tick through a ref, then set state — calling launchRound() inside the
      // setCountdown updater made StrictMode double-invoke it (two crash rolls).
      const next = countdownRef.current - 1
      countdownRef.current = Math.max(0, next)
      setCountdown(countdownRef.current)
      if (next <= 0) launchRound()
    }, 1000)

    const animate = now => {
      if (phaseRef.current === 'flying') {
        const seconds = (now - startRef.current) / 1000
        const next = Math.exp(0.17 * seconds)
        const capped = Math.min(next, crashRef.current)
        multRef.current = capped
        setMultiplier(Number(capped.toFixed(2)))
        updateEngine(capped)
        setPlayers(list => {
          // same computation as before, but keep the array identity when no
          // row changed so the feed doesn't re-render every frame
          let changed = false
          const next = list.map(p => {
            if (p.status !== 'live') return p
            if (capped >= p.target && capped < crashRef.current) {
              changed = true
              const payout = Number((p.bet * p.target).toFixed(2))
              return { ...p, status: 'cashed', payout, target: Number(p.target.toFixed(2)) }
            }
            return p
          })
          return changed ? next : list
        })
        // Auto-cashout — settles at the panel's target multiplier. capped never
        // exceeds the crash point, so this only fires when target ≤ crash.
        panelsRef.current.forEach((p, i) => {
          if (p.autoCashOn && p.playerBet && !p.cashedOut && capped >= p.autoCashMult) {
            cashOutFor(i, p.autoCashMult)
          }
        })
        if (next >= crashRef.current) crashRound()
      }
      drawArena(multRef.current)
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)

    return () => {
      clearInterval(countdownTimer)
      cancelAnimationFrame(frameRef.current)
      stopEngine()
      stopBgm()
    }
    // The arena loop owns round transitions through refs; restarting it on render would duplicate timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canBetPhase = phase === 'betting'
  const bigColor = phase === 'crashed'
    ? '#e2564a'
    : multiplier < 2.5 ? '#16C784' : multiplier < 6 ? '#e0b100' : '#e2564a'
  const bigValue = phase === 'crashed' ? (crashPoint?.toFixed(2) || multiplier.toFixed(2)) : multiplier.toFixed(2)
  const topTag = phase === 'betting' ? '下一轮' : phase === 'flying' ? '飞行中' : '本轮结束'
  const statusText = phase === 'betting'
    ? `下一轮 ${countdown}s…`
    : phase === 'flying'
      ? '飞行中 — 及时套现!'
      : '球飞了 — 下一轮马上来'
  // Shell BetButton state per bay — mapped from phase/playerBet/cashedOut only.
  function panelButton(i) {
    const p = panels[i]
    if (phase === 'flying') {
      if (!p.playerBet) return { state: 'waiting', label: '等待下一局', disabled: true }
      if (p.cashedOut) return { state: 'waiting', label: '已兑现', sub: `$${money(p.cashedOut.win)}`, disabled: true }
      return { state: 'cashout', label: '兑现', sub: `$${money(p.playerBet.amount * multiplier)}`, onClick: () => cashOutFor(i), disabled: false }
    }
    if (canBetPhase && p.playerBet) {
      return { state: 'cancel', label: '取消', sub: `$${money(p.playerBet.amount)}`, onClick: () => cancelBetFor(i), disabled: false }
    }
    return {
      state: 'bet',
      label: '下注',
      sub: `$${money(p.bet)}`,
      onClick: () => placeBetFor(i),
      disabled: !canBetPhase || !!p.playerBet || p.bet > balance,
    }
  }

  function setBetFor(i, next) {
    const p = panelsRef.current[i]
    updatePanel(i, { bet: typeof next === 'function' ? next(p.bet) : next })
  }

  // Shared blocks composed into either the Spribe-parity desktop skeleton
  // (≥1024) or the stacked mobile layout (<1024).
  const arena = (
      <Panel style={{
        background: '#0a1119', borderColor: '#232c39', overflow: 'hidden',
        padding: isDesk ? 0 : (isMobile ? 12 : 18),
        borderRadius: LAYOUT.canvasRadius,
        ...(isDesk ? { height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' } : {}),
      }}>
        <style>{`
          @keyframes bkShake {
            0%,100% { transform: translateX(0); }
            15% { transform: translateX(-6px); }
            30% { transform: translateX(6px); }
            45% { transform: translateX(-5px); }
            60% { transform: translateX(4px); }
            75% { transform: translateX(-3px); }
            90% { transform: translateX(2px); }
          }
          @keyframes bkPop {
            0% { transform: scale(1.4); }
            55% { transform: scale(0.94); }
            100% { transform: scale(1); }
          }
        `}</style>
        {isDesk && (
          <div style={{
            height: LAYOUT.demoBarH, flex: '0 0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: COLORS.amberTint, color: COLORS.amber,
            fontSize: 11, fontWeight: 900, letterSpacing: 3,
          }}>
            DEMO MODE
          </div>
        )}
        {!isDesk && <RoundHistoryBar rounds={history} />}
        <div style={{
          position: 'relative',
          animation: phase === 'crashed' ? 'bkShake 0.4s ease' : 'none',
          ...(isDesk ? { flex: 1, minHeight: 0, margin: 10 } : {}),
        }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: isDesk ? '100%' : (isMobile ? 290 : 430),
              borderRadius: 16,
              background: '#0a1119',
              border: '1px solid #172333',
            }}
          />

          {/* Cash-out toast stack — top center of the arena */}
          <WinToast toasts={toasts} />

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
              color: bgmOn ? GREEN : '#7d8a99',
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
              color: muted ? '#7d8a99' : GREEN,
              border: '1px solid #232c39',
              fontSize: 18,
            }}
            title={muted ? '取消静音' : '静音'}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          {/* Big multiplier + status — centered overlay. Hidden while betting:
              the canvas waiting bay (ball + 等待下一局 + progress) owns that phase. */}
          {phase !== 'betting' && <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', textAlign: 'center',
          }}>
            <div style={{ color: '#7d8a99', fontSize: 12, fontWeight: 800, letterSpacing: 1, marginBottom: 4 }}>
              {topTag}
            </div>
            <div style={{
              color: bigColor,
              fontSize: isMobile ? 44 : 56,
              fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              lineHeight: 1,
              textShadow: '0 2px 18px rgba(0,0,0,0.6)',
              animation: phase === 'crashed' ? 'bkPop 0.3s ease-out' : 'none',
            }}>
              {bigValue}×
            </div>
            <div style={{ color: '#8a97a6', fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              {statusText}
            </div>
          </div>}
        </div>
      </Panel>
  )

  // Single bet bay — dual-bay panel architecture retained, only bay 0 rendered.
  const p0 = panels[0]
  const locked0 = !canBetPhase || !!p0.playerBet
  const bay = (
    <BetPanel
      bare={isDesk}
      bet={p0.bet}
      setBet={next => setBetFor(0, next)}
      max={balance}
      inputDisabled={locked0}
      chipDisabled={locked0}
      button={panelButton(0)}
      hint={p0.note || p0.autoNote || message}
      auto={{
        betOn: p0.autoBet,
        cashOn: p0.autoCashOn,
        cashMult: p0.autoCashMult,
        onToggleBet: () => toggleAutoBet(0),
        onToggleCash: () => updatePanel(0, { autoCashOn: !panelsRef.current[0].autoCashOn }),
        onCashMult: v => updatePanel(0, { autoCashMult: v }),
      }}
    />
  )

  // ---- Spribe-parity desktop skeleton (≥1024, 1440×900 basis) ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        {/* a. full-width in-game header: name left, balance right */}
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Breakaway</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {money(balance)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* b. bet feed — 400px, full height, edge-flush, internal scroll */}
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={displayPlayers} myBets={myBets} online={online} fill />
          </div>

          {/* c. right column: history row → arena card → bottom bay */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              <RoundHistoryBar rounds={history} />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {arena}
            </div>
            <div style={{
              flex: '0 0 auto', minHeight: LAYOUT.bottomH,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // full-bleed strip: cancel the column padding, ambient art under a
              // dark scrim so the controls stay readable, hairline on top
              margin: '0 -12px -12px',
              background: `linear-gradient(rgba(10,17,25,0.78), rgba(10,17,25,0.78)), url(${bayBgUrl}) center / cover no-repeat`,
              borderTop: `1px solid ${COLORS.border}`,
            }}>
              {/* d. single centered bay */}
              <div style={{ width: LAYOUT.bayW, maxWidth: '100%' }}>{bay}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged mobile arrangement ----
  return (
    <GameLayout title="Breakaway" emoji="✈️" color={GREEN}>
      {arena}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bay}</div>
      <div style={{ marginTop: 14 }}>
        <BetFeed bets={displayPlayers} myBets={myBets} online={online} maxHeight={300} />
      </div>
    </GameLayout>
  )
}
