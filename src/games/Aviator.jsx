import { useEffect, useMemo, useRef, useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import { createArenaFx, drawArenaFx, drawWaiting, makeFeedBots } from '../components/shell/arenaFx'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import ballUrl from '../assets/covers/ball-3d.png'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import bayBgUrl from '../assets/shared/bay_bg.png'

const GREEN = '#16C784'
const HISTORY_SEED = [1.42, 2.81, 1.06, 5.24, 1.88, 3.37, 9.12, 1.19, 2.05, 4.63]

const RULES = [
  {
    icon: '🚀', title: '怎么玩',
    body: '每局倍率从 1.00× 起飞，一路向上攀升，并在某个随机点「崩盘」。开球前下注，飞行途中随时点「兑现」锁定当前倍率×本金的收益——只要在崩盘前兑现就赢，被崩盘追上还没兑现就输掉本金。',
  },
  {
    icon: '📈', title: '倍率与崩盘',
    body: '崩盘点由服务器在开局前就用可验证公平算法定好（下注阶段只给承诺哈希，崩盘后揭晓种子，可自行 sha256 校验）。倍率越高越晚兑现，赢得越多，但被崩盘截断的风险也越大。崩盘可能低至 1.00×。',
  },
  {
    icon: '💰', title: '随时兑现',
    body: '飞行中点「兑现」即按当前倍率结算，收益 = 本金 × 兑现倍率，立即入余额。也可设自动兑现倍率，到点自动收手。每局一注，结算只认服务器返回的余额。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 稳一点：低倍（1.3–2×）早兑现，命中率高。\n· 搏大赔：让它多飞，但崩盘随机、不可预测，量力而行。\n· 崩盘点开局即定、前端无法预知，属娱乐性质，理性游戏。',
  },
]
// Betting window — matches the server's aviatorHub.js BETTING_MS. The server
// is the source of truth (waitMs on every `betting` message); this constant
// is only the fallback/default used before the first message arrives.
const BETTING_MS = 5000
const BETTING_S = BETTING_MS / 1000

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function money(n) {
  return Number(n || 0).toFixed(2)
}

// One bet bay's full state. Only bay 0 is wired to the server this round —
// bay 1 stays in the panels array (unused/未渲染) for the multi-bet feature.
function makePanel() {
  return {
    bet: 10,
    playerBet: null,
    cashedOut: null,
    pending: false,        // bet 已发送、等待 bet_ack/bet_rejected
    cashoutPending: false, // cashout 已发送、等待 cashout_ok/cashout_rejected
    autoBet: false,
    autoCashOn: false,
    autoCashMult: 2.0,
    note: '',      // per-round hint, cleared on reset
    autoNote: '',  // sticky hint (auto-bet stopped), cleared on re-enable
  }
}

export default function Aviator({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const canvasRef = useRef(null)
  const ballRef = useRef(null)
  const frameRef = useRef(null)
  const phaseRef = useRef('betting')
  const countdownRef = useRef(BETTING_S)
  const launchAtRef = useRef(0)
  const multRef = useRef(1)
  const maxMultRef = useRef(6) // 曲线纵向缩放上限——只增不减，跟着当前倍数走（不再知道 crashPoint）
  const flyingStartedRef = useRef(false)
  const particlesRef = useRef([])
  const burstRef = useRef(false)
  const flashRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false, engine: null })
  // Synchronous mirror — actions guard/settle through this so rapid clicks
  // and the rAF loop all see committed values instantly (race safety).
  const panelsRef = useRef(null)
  // Backdrop FX + waiting-ceremony timing (pure visuals)
  const fxRef = useRef(null)
  const bettingStartRef = useRef(0)
  const bettingDeadlineRef = useRef(performance.now() + BETTING_MS)
  const roundIdRef = useRef(0)   // keys the player's feed row per round
  const crashAtRef = useRef(0)   // crash timestamp — drives the ball fly-out
  // WebSocket 连接 —— 唯一数值/资金来源
  const wsRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
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
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [message, setMessage] = useState('')
  // 公平校验字段：commitHash/clientSeed 下注阶段就有，serverSeed 崩盘 reveal 后才有。
  const [roundMeta, setRoundMeta] = useState({ roundId: null, nonce: null, clientSeed: '', commitHash: '' })
  const [serverSeedReveal, setServerSeedReveal] = useState(null)
  // 连接状态：connecting | open | reconnecting | closed —— 纯 UI 提示，不驱动相位。
  const [connStatus, setConnStatus] = useState('connecting')

  if (panelsRef.current === null) panelsRef.current = panels

  function updatePanel(i, patch) {
    panelsRef.current = panelsRef.current.map((p, j) => (j === i ? { ...p, ...patch } : p))
    setPanels(panelsRef.current)
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

  // ---- 自动下注：每局 betting 开始时，若上一局勾了「自动下注」就立即发一次 ----
  function autoBetOnRoundStart() {
    const p = panelsRef.current[0]
    if (!p.autoBet) return
    if (!(p.bet >= 1)) {
      updatePanel(0, { autoBet: false, autoNote: '下注金额无效，自动下注已停' })
      return
    }
    placeBetFor(0)
  }

  // ---- WS 消息驱动的相位切换 ----
  function onBettingMsg(msg) {
    phaseRef.current = 'betting'
    flyingStartedRef.current = false
    bettingStartRef.current = performance.now()
    roundIdRef.current += 1
    multRef.current = 1
    maxMultRef.current = 6
    particlesRef.current = []
    burstRef.current = false
    flashRef.current = 0
    setPhase('betting')
    setMultiplier(1)
    setCrashPoint(null)
    setServerSeedReveal(null)
    setRoundMeta({
      roundId: msg.roundId ?? null,
      nonce: msg.nonce ?? null,
      clientSeed: msg.clientSeed || '',
      commitHash: msg.commitHash || '',
    })
    const waitMs = msg.waitMs || BETTING_MS
    bettingDeadlineRef.current = performance.now() + waitMs
    countdownRef.current = Math.ceil(waitMs / 1000)
    setCountdown(countdownRef.current)
    updatePanel(0, { playerBet: null, cashedOut: null, pending: false, cashoutPending: false, note: '' })
    setPlayers(makeFeedBots())
    setMessage('')
    stopEngine()
    autoBetOnRoundStart()
  }

  function onTickMsg(msg) {
    if (!flyingStartedRef.current) {
      flyingStartedRef.current = true
      phaseRef.current = 'flying'
      launchAtRef.current = performance.now()
      setPhase('flying')
      setCrashPoint(null)
      setMessage('')
      startEngine()
    }
    const m = Number(msg.multiplier)
    multRef.current = m
    maxMultRef.current = Math.min(18, Math.max(maxMultRef.current, m * 1.35, 6))
    setMultiplier(Number(m.toFixed(2)))
    updateEngine(m)
    // 假 bots 的兑现动画 —— 纯展示，不影响真实结算
    setPlayers(list => {
      let changed = false
      const next = list.map(p => {
        if (p.status !== 'live') return p
        if (m >= p.target) {
          changed = true
          const payout = Number((p.bet * p.target).toFixed(2))
          return { ...p, status: 'cashed', payout, target: Number(p.target.toFixed(2)) }
        }
        return p
      })
      return changed ? next : list
    })
    // auto-cashout：达到目标倍数就发一次 cashout（幂等由 cashoutPending 守卫）
    const p0 = panelsRef.current[0]
    if (p0.autoCashOn && p0.playerBet && !p0.cashedOut && !p0.cashoutPending && m >= p0.autoCashMult) {
      updatePanel(0, { cashoutPending: true })
      wsRef.current?.send(JSON.stringify({ type: 'cashout' }))
    }
  }

  function onCrashedMsg(msg) {
    phaseRef.current = 'crashed'
    flyingStartedRef.current = false
    crashAtRef.current = performance.now()
    flashRef.current = 0.7
    stopEngine()
    playCrash()
    setPhase('crashed')
    const cp = Number(msg.crashPoint)
    multRef.current = cp
    maxMultRef.current = Math.min(18, Math.max(maxMultRef.current, cp * 1.35, 6))
    setMultiplier(cp)
    setCrashPoint(cp)
    setServerSeedReveal(msg.serverSeed || null)
    setHistory(h => [Number(cp.toFixed(2)), ...h].slice(0, 20))
    setPlayers(list => list.map(p => p.status === 'live' ? { ...p, status: 'crashed' } : p))

    const p0 = panelsRef.current[0]
    if (p0.playerBet && !p0.cashedOut) {
      setMyBets(m => [{ bet: p0.playerBet.amount, mult: 0, win: 0 }, ...m].slice(0, 20))
    }
    if (cp <= 1.05) {
      setMessage(`本局 ${cp.toFixed(2)}× 秒崩`)
    } else if (p0.playerBet && !p0.cashedOut) {
      setMessage(`本轮 ${cp.toFixed(2)}× 飞了，没能及时兑现`)
    } else {
      setMessage(`本轮 ${cp.toFixed(2)}× 飞了`)
    }
  }

  function onSnapshot(msg) {
    setRoundMeta({
      roundId: msg.roundId ?? null,
      nonce: msg.nonce ?? null,
      clientSeed: msg.clientSeed || '',
      commitHash: msg.commitHash || '',
    })
    if (msg.phase === 'betting') {
      phaseRef.current = 'betting'
      flyingStartedRef.current = false
      setPhase('betting')
      multRef.current = 1
      maxMultRef.current = 6
      setMultiplier(1)
      setCrashPoint(null)
      setServerSeedReveal(null)
      const remaining = msg.remainingMs ?? msg.waitMs ?? BETTING_MS
      bettingStartRef.current = performance.now() - (BETTING_MS - remaining)
      bettingDeadlineRef.current = performance.now() + remaining
      countdownRef.current = Math.max(0, Math.ceil(remaining / 1000))
      setCountdown(countdownRef.current)
    } else if (msg.phase === 'flying') {
      phaseRef.current = 'flying'
      flyingStartedRef.current = true
      setPhase('flying')
      const m = Number(msg.multiplier || 1)
      multRef.current = m
      maxMultRef.current = Math.min(18, Math.max(m * 1.35, 6))
      setMultiplier(Number(m.toFixed(2)))
      setCrashPoint(null)
      launchAtRef.current = performance.now() - (Number(msg.elapsed) || 0) * 1000
      startEngine()
    } else if (msg.phase === 'crashed') {
      phaseRef.current = 'crashed'
      flyingStartedRef.current = false
      setPhase('crashed')
      const cp = Number(msg.crashPoint)
      multRef.current = cp
      maxMultRef.current = Math.min(18, Math.max(cp * 1.35, 6))
      setMultiplier(cp)
      setCrashPoint(cp)
      setServerSeedReveal(msg.serverSeed || null)
    }
  }

  function onBetAck(msg) {
    if (msg.balanceAfter !== undefined && msg.balanceAfter !== null) {
      setServerBalance(Number(msg.balanceAfter))
    }
    updatePanel(0, {
      pending: false,
      playerBet: { amount: Number(msg.amount) },
      note: `已下注 $${money(msg.amount)}，本轮生效`,
    })
  }

  function onBetRejected(msg) {
    const p0 = panelsRef.current[0]
    if (p0.autoBet) {
      updatePanel(0, { pending: false, autoBet: false, autoNote: msg.reason || '下注失败，自动下注已停', note: '' })
    } else {
      updatePanel(0, { pending: false, note: msg.reason || '下注失败' })
    }
  }

  function onCashoutOk(msg) {
    const p0 = panelsRef.current[0]
    const mult = Number(msg.multiplier)
    const win = Number(msg.payout)
    updatePanel(0, {
      cashoutPending: false,
      cashedOut: { mult, win },
      note: `已套现 ${mult.toFixed(2)}× — +$${money(win)}`,
    })
    setServerBalance(Number(msg.balanceAfter))
    setMyBets(m => [{ bet: p0.playerBet?.amount ?? 0, mult, win }, ...m].slice(0, 20))
    pushToast(mult, win)
    playDing()
  }

  function onCashoutRejected(msg) {
    updatePanel(0, { cashoutPending: false, note: msg.reason || '兑现失败' })
  }

  function placeBetFor(i) {
    if (i !== 0) return // 第二注位本批不接服务器，禁用
    const p = panelsRef.current[0]
    if (phaseRef.current !== 'betting' || p.playerBet || p.pending || !(p.bet >= 1)) return
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      updatePanel(0, { note: '未连接服务器，请稍候重试' })
      return
    }
    ensureAudio()
    const amount = Number(p.bet)
    updatePanel(0, { pending: true, note: '下注提交中…' })
    wsRef.current.send(JSON.stringify({ type: 'bet', amount }))
  }

  function cashOutFor(i) {
    if (i !== 0) return
    const p = panelsRef.current[0]
    if (phaseRef.current !== 'flying' || !p.playerBet || p.cashedOut || p.cashoutPending) return
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    ensureAudio()
    updatePanel(0, { cashoutPending: true })
    wsRef.current.send(JSON.stringify({ type: 'cashout' }))
  }

  function toggleAutoBet(i) {
    if (i !== 0) return
    const p = panelsRef.current[0]
    const next = !p.autoBet
    updatePanel(0, { autoBet: next, autoNote: '' })
    if (next && phaseRef.current === 'betting' && !p.playerBet && !p.pending) placeBetFor(0)
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
    const maxMult = maxMultRef.current
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
    audioRef.current.muted = muted
    if (muted) stopEngine()
    if (!muted && phaseRef.current === 'flying') startEngine()
    // Audio nodes are managed imperatively through refs to avoid restarting the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted])

  useEffect(() => {
    const onlineTimer = setInterval(() => {
      setOnline(v => Math.max(600, Math.min(1200, v + Math.floor(rand(-7, 9)))))
    }, 1500)
    return () => clearInterval(onlineTimer)
  }, [])

  // ---- WebSocket 连接：唯一的相位/数值/资金来源 ----
  useEffect(() => {
    if (!playerToken) return undefined
    let cancelled = false

    function dispatch(msg) {
      switch (msg.type) {
        case 'hello':
          if (msg.balance !== undefined && msg.balance !== null) setServerBalance(Number(msg.balance))
          break
        case 'snapshot':
          onSnapshot(msg)
          break
        case 'betting':
          onBettingMsg(msg)
          break
        case 'tick':
          onTickMsg(msg)
          break
        case 'crashed':
          onCrashedMsg(msg)
          break
        case 'bet_ack':
          onBetAck(msg)
          break
        case 'bet_rejected':
          onBetRejected(msg)
          break
        case 'cashout_ok':
          onCashoutOk(msg)
          break
        case 'cashout_rejected':
          onCashoutRejected(msg)
          break
        default:
          break
      }
    }

    function connect() {
      if (cancelled) return
      // 守卫：已有连接处于 OPEN/CONNECTING 就不重复建（StrictMode 双 invoke 防重连）。
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return
      }
      setConnStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting')
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/aviator?token=${encodeURIComponent(playerToken)}`)
      wsRef.current = ws

      ws.onopen = () => {
        const wasReconnect = reconnectAttemptRef.current > 0
        reconnectAttemptRef.current = 0
        setConnStatus('open')
        if (wasReconnect) {
          ws.send(JSON.stringify({ type: 'sync' }))
        }
      }

      ws.onmessage = event => {
        let msg
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        dispatch(msg)
      }

      ws.onclose = () => {
        if (cancelled) return
        setConnStatus('closed')
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        const delay = Math.min(10000, 1000 * Math.pow(2, attempt - 1))
        reconnectTimerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // 交给 onclose 统一走重连退避，这里不重复处理。
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        wsRef.current.close()
      }
    }
    // dispatch/on* 闭包读取的是本次 effect 作用域内定义的 handler，重连逻辑只依赖 token。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerToken])

  // ---- rAF 渲染循环：只画画 + 走本地倒计时显示，相位切换完全交给上面的 WS 分发 ----
  useEffect(() => {
    const animate = now => {
      if (phaseRef.current === 'betting') {
        const remain = Math.max(0, bettingDeadlineRef.current - now)
        const remainS = Math.ceil(remain / 1000)
        if (remainS !== countdownRef.current) {
          countdownRef.current = remainS
          setCountdown(remainS)
        }
      }
      drawArena(multRef.current)
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameRef.current)
      stopEngine()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canBetPhase = phase === 'betting'
  const bigColor = phase === 'crashed'
    ? '#e2564a'
    : multiplier < 2.5 ? '#16C784' : multiplier < 6 ? '#e0b100' : '#e2564a'
  const bigValue = phase === 'crashed' ? (crashPoint?.toFixed(2) || multiplier.toFixed(2)) : multiplier.toFixed(2)
  const topTag = phase === 'betting' ? '下一轮' : phase === 'flying' ? '飞行中' : '本轮结束'
  const statusText = connStatus !== 'open'
    ? (connStatus === 'reconnecting' ? '连接已断开，正在重连…' : '正在连接服务器…')
    : phase === 'betting'
      ? `下一轮 ${countdown}s…`
      : phase === 'flying'
        ? '飞行中 — 及时套现!'
        : '球飞了 — 下一轮马上来'
  // Shell BetButton state per bay — mapped from phase/playerBet/cashedOut only.
  function panelButton(i) {
    const p = panels[i]
    if (i !== 0) {
      return { state: 'waiting', label: '多注功能下批开放', disabled: true }
    }
    if (phase === 'flying') {
      if (!p.playerBet) return { state: 'waiting', label: '等待下一局', disabled: true }
      if (p.cashedOut) return { state: 'waiting', label: '已兑现', sub: `$${money(p.cashedOut.win)}`, disabled: true }
      if (p.cashoutPending) return { state: 'cashout', label: '兑现中…', disabled: true }
      return { state: 'cashout', label: '兑现', sub: `$${money(p.playerBet.amount * multiplier)}`, onClick: () => cashOutFor(0), disabled: false }
    }
    if (p.pending) {
      return { state: 'waiting', label: '下注提交中…', disabled: true }
    }
    if (canBetPhase && p.playerBet) {
      return { state: 'waiting', label: '已下注', sub: `$${money(p.playerBet.amount)}`, disabled: true }
    }
    return {
      state: 'bet',
      label: '下注',
      sub: `$${money(p.bet)}`,
      onClick: () => placeBetFor(0),
      disabled: !canBetPhase || connStatus !== 'open' || !!p.playerBet || p.bet > (serverBalance ?? 0) || !(p.bet >= 1),
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

        {/* 共享顶栏（PC 单行 / 手机两行自适应；← 大厅 + 名 + 余额 + ?/音乐/静音）
            ⚖ 不接：Aviator 公平为共享局 inline commit-reveal 角标（见下方），无抽屉可开 */}
        <GameTopBar
          balance={serverBalance ?? 0}
          venue="Breakaway"
          onBack={onBack}
          onHowTo={() => setRulesOpen(true)}
        />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
          venue="Breakaway" title="Breakaway 玩法说明" sections={RULES} />

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
        <RoundHistoryBar rounds={history} />
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

          {/* 公平校验角标 —— betting/flying 显 commitHash，crashed 后显 reveal 的种子 */}
          {(phase === 'betting' || phase === 'flying') && roundMeta.commitHash && (
            <div style={{
              position: 'absolute', left: 10, top: 10,
              fontSize: 10, color: '#7d8a99', background: 'rgba(10,17,25,0.72)',
              padding: '4px 8px', borderRadius: 8, maxWidth: 210,
              fontFamily: 'monospace', letterSpacing: 0.3, lineHeight: 1.5,
            }}>
              <span style={{ color: '#5DCAA5', fontWeight: 700 }}>可验证公平</span>{' '}
              哈希 {roundMeta.commitHash.slice(0, 10)}…
            </div>
          )}
          {phase === 'crashed' && serverSeedReveal && (
            <div style={{
              position: 'absolute', left: 10, top: 10,
              fontSize: 10, color: '#7d8a99', background: 'rgba(10,17,25,0.72)',
              padding: '4px 8px', borderRadius: 8, maxWidth: 240,
              fontFamily: 'monospace', letterSpacing: 0.3, lineHeight: 1.5,
            }}>
              <span style={{ color: '#5DCAA5', fontWeight: 700 }}>已开奖种子</span>{' '}
              {serverSeedReveal.slice(0, 10)}…（可自行 sha256 校验哈希）
            </div>
          )}

          {/* 音乐/静音已并入 GameTopBar 内建钮（顶栏右侧），此处不再浮动挂钮 */}

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

  // Single bet bay — dual-bay panel architecture retained, only bay 0 rendered
  // and only bay 0 talks to the server (一局一注协议，双注会幂等冲突)。
  const p0 = panels[0]
  const locked0 = !canBetPhase || !!p0.playerBet || p0.pending
  const bay = (
    <BetPanel
      bare={isDesk}
      bet={p0.bet}
      setBet={next => setBetFor(0, next)}
      max={serverBalance ?? 0}
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
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* b. bet feed — 400px, full height, edge-flush, internal scroll */}
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={displayPlayers} myBets={myBets} online={online} fill />
          </div>

          {/* c. right column: arena card（含 GameTopBar+历史条）→ bottom bay */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
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
    <GameLayout title="Breakaway" color={GREEN}>
      {arena}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bay}</div>
      <div style={{ marginTop: 14 }}>
        <BetFeed bets={displayPlayers} myBets={myBets} online={online} maxHeight={300} />
      </div>
    </GameLayout>
  )
}
