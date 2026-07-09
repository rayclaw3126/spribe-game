import { useEffect, useRef, useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, LAYOUT, LIMBO } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import ballUrl from '../assets/covers/ball-3d.png'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'
import WinToast from '../components/shell/WinToast'
import badgeWinUrl from '../assets/shared/badge_win.png'
import badgeLoseUrl from '../assets/shared/badge_lose.png'
import bayBgUrl from '../assets/shared/bay_bg.png'
import SeedFairness from '../components/shell/SeedFairness'

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

// 生成幂等键：优先用 crypto.randomUUID，不支持则退化拼接时间戳+随机数
const genIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `limbo-${Date.now()}-${Math.random()}`)

export default function Limbo({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const canvasRef = useRef(null)
  const ballRef = useRef(null)
  const frameRef = useRef(null)
  const phaseRef = useRef('idle')          // idle | climbing | done
  const animRef = useRef(null)             // { to, start, bet, t }
  const pendingRef = useRef(null)          // 本局后端已返回的结算结果，settle() 落定时消费
  const multRef = useRef(1)
  const targetRef = useRef(2)
  const particlesRef = useRef([])
  const burstRef = useRef(false)           // pending win burst
  const bounceRef = useRef(0)              // loss bounce start timestamp
  const isMobileRef = useRef(false)
  const audioRef = useRef({ ctx: null, muted: false, engine: null })
  const toastIdRef = useRef(0)

  const [bet, setBet] = useState(10)
  const [target, setTarget] = useState(2.0)
  const [rolling, setRolling] = useState(false)
  const [result, setResult] = useState(null)
  const [multiplier, setMultiplier] = useState(1)
  const [roundHistory, setRoundHistory] = useState([])   // final multiplier per round, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [muted, setMuted] = useState(false)
  const [toasts, setToasts] = useState([])
  const [proof, setProof] = useState(null)   // 最近一局：{ serverSeed, commitHash } 供玩家自行验证
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [bgmOn, toggleBgm] = useBgm()

  function pushToast(label) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win: 0 }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

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

  // 开奖服务器算，不信前端：只把下注参数（金额/target）传给后端，
  // finalMult/win/payout/余额全部以后端返回为准，本地不再算一分钱。
  // 现有滚动动画照旧播放，只是动画滚到的目标值换成了后端返回的 finalMult。
  async function play() {
    if (bet < 1 || bet > (serverBalance ?? 0) || rolling) return
    setResult(null)
    setRolling(true)

    const idempotencyKey = genIdemKey()
    let data
    try {
      const resp = await fetch('/round/limbo/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
        body: JSON.stringify({ amount: bet, target: t, idempotencyKey }),
      })
      data = await resp.json()
      if (!resp.ok) {
        setRolling(false)
        pushToast(data?.error || '下注失败，请重试')
        return
      }
    } catch {
      setRolling(false)
      pushToast('网络异常，请稍后重试')
      return
    }

    const { finalMult, win, payout, balanceAfter, serverSeedHash, nonce } = data
    pendingRef.current = { win, payout: Number(payout), balanceAfter, serverSeedHash, nonce }

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
    const { to } = animRef.current
    const pending = pendingRef.current || {}
    phaseRef.current = 'done'
    multRef.current = to
    setMultiplier(to)
    const win = !!pending.win
    const profit = win ? pending.payout : 0
    // 余额只认后端 balanceAfter，不本地加减
    if (pending.balanceAfter != null) setServerBalance(Number(pending.balanceAfter))
    if (pending.serverSeedHash) setProof({ serverSeedHash: pending.serverSeedHash, nonce: pending.nonce })
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

  const isWin = result?.win
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)

  const side = (
        <SideControls
          bet={bet} target={target} setTarget={setTarget}
          rolling={rolling} result={result}
          t={t} winChance={winChance} payout={payout}
        />
  )

  // desktop bottom-bar params: the Target Odds card flattened into one column
  // (input + presets / four stats / result strip) sitting left of the bay
  const deskParams = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
        <span style={{ color: '#8a97a6', fontSize: 12, fontWeight: 600, flex: '0 0 auto' }}>Target Odds</span>
        <input type="number" min="1.01" step="0.01" value={target} disabled={rolling}
          onChange={e => setTarget(Math.max(1.01, Number(e.target.value)))}
          style={{ ...darkInput, width: 86, padding: '7px 10px', flex: '0 0 auto' }}
        />
        {[1.5, 2, 5, 10].map(v => (
          <button key={v} onClick={() => setTarget(v)} disabled={rolling}
            style={{ ...darkChip, flex: '0 0 auto', padding: '6px 10px', borderColor: t === v ? 'rgba(22,199,132,0.5)' : '#243142', color: t === v ? COLOR : '#8a97a6' }}>{v}×</button>
        ))}
      </div>
      <div style={{
        background: 'rgba(26,34,48,0.9)', border: '1px solid #232c39', borderRadius: 10,
        padding: '8px 10px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
      }}>
        <StatBox label="Win Chance" value={`${winChance.toFixed(1)}%`} color={COLOR} />
        <StatBox label="Multiplier" value={`${t.toFixed(2)}×`} color='#10B981' />
        <StatBox label="Payout" value={`$${payout.toFixed(2)}`} color={AMBER} />
        <StatBox label="Profit" value={`$${(payout - bet).toFixed(2)}`} color={COLOR} />
      </div>
      {result && (
        <div style={{
          padding: '7px 12px', borderRadius: 10,
          background: result.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          border: `1px solid ${result.win ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
          color: result.win ? '#6EE7B7' : '#FCA5A5',
          fontWeight: 600, fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <img src={result.win ? badgeWinUrl : badgeLoseUrl} alt="" draggable={false}
            style={{ height: 15, width: 'auto', pointerEvents: 'none', display: 'block' }} />
          <span>Final {result.mult.toFixed(2)}× — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Below target'}</span>
        </div>
      )}
    </div>
  )

  // 攀升背景：贴边长短刻度列整层匀速下移（镜头上升感）+ 反向上升光点。
  // 刻度周期 34/68px 公倍 68px，动画每循环恰好位移一个公周期 → 无缝接续。
  const TICK_COLS = [
    { pos: { left: 6 },   w: 16, a: 0.16, o: '0px' },
    { pos: { left: 28 },  w: 9,  a: 0.10, o: '17px' },
    { pos: { right: 6 },  w: 16, a: 0.16, o: '0px' },
    { pos: { right: 28 }, w: 9,  a: 0.10, o: '17px' },
  ]
  const RISE_DOTS = [
    { pos: { left: '4%' },   s: 3, dur: '10s', del: '0s',  op: 0.5 },
    { pos: { right: '5%' },  s: 2, dur: '13s', del: '-5s', op: 0.4 },
    { pos: { left: '9%' },   s: 2, dur: '14s', del: '-9s', op: 0.35 },
    { pos: { right: '10%' }, s: 3, dur: '9s',  del: '-3s', op: 0.45 },
  ]
  const climbScene = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes ocTicks {
          from { background-position-y: var(--o); }
          to   { background-position-y: calc(var(--o) + 68px); }
        }
        .ocTicks { animation: ocTicks 8s linear infinite; }
        @keyframes ocRise {
          0%   { transform: translateY(0); opacity: 0; }
          10%  { opacity: var(--op); }
          88%  { opacity: var(--op); }
          100% { transform: translateY(-90vh); opacity: 0; }
        }
        .ocRise { animation: ocRise var(--d) linear infinite; animation-delay: var(--dl); }
        @media (prefers-reduced-motion: reduce) { .ocTicks, .ocRise { animation: none; } }
      `}</style>
      {TICK_COLS.map((t, i) => (
        <span key={`t${i}`} className="ocTicks" style={{
          position: 'absolute', top: 0, bottom: 0, ...t.pos, width: t.w,
          background: `repeating-linear-gradient(180deg, rgba(255,255,255,${t.a}) 0px, rgba(255,255,255,${t.a}) 2px, transparent 2px, transparent ${t.w > 10 ? 68 : 34}px)`,
          '--o': t.o,
        }} />
      ))}
      {RISE_DOTS.map((d, i) => (
        <span key={`d${i}`} className="ocRise" style={{
          position: 'absolute', bottom: -8, ...d.pos,
          width: d.s, height: d.s, borderRadius: '50%',
          background: 'rgba(255,255,255,0.9)',
          '--op': d.op, '--d': d.dur, '--dl': d.del,
          opacity: 0,
        }} />
      ))}
    </div>
  )

  const mainPanel = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 30%, ${LIMBO.bgCenter}, ${LIMBO.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {climbScene}
        {/* DEMO 条 — arena 系打法（同 Breakaway 顶部金条，无顶栏胶囊碰撞问题） */}
        {isDesk && (
          <div style={{
            height: LAYOUT.demoBarH, flex: '0 0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: COLORS.amberTint, color: COLORS.amber,
            fontSize: 11, fontWeight: 900, letterSpacing: 3,
            position: 'relative', zIndex: 1,
          }}>
            DEMO MODE
          </div>
        )}

        {/* ---- middle zone: 力量表居中，弹性吸收余量 ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? 12 : 18, boxSizing: 'border-box',
        }}>
        {!isDesk && <div style={{ marginBottom: 12 }}><RoundHistoryBar rounds={roundHistory} /></div>}
        <WinToast toasts={toasts} />
        <style>{`
          @keyframes ocFlash {
            0%, 100% { color: #EF4444; }
            25%, 75% { color: #ff9d94; }
            50% { color: #EF4444; }
          }
        `}</style>
        {/* ⚖ 可验证公平 — game-card top-right，与音频钮同排（绿系区分） */}
        <button
          type="button"
          onClick={() => setFairOpen(true)}
          style={{
            position: 'absolute', top: isDesk ? 32 : 10, right: 106, zIndex: 3,
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(53,208,127,0.18)', color: '#35d07f',
            border: '1px solid rgba(53,208,127,0.5)', fontSize: 18, fontWeight: 900,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
          title="可验证公平"
        >⚖</button>
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue="ODDS CLIMB" playerToken={playerToken} game="limbo" />

        {/* BGM toggle — game-card top-right, anchored to the card not the meter */}
        <button
          type="button"
          onClick={toggleBgm}
          style={{
            position: 'absolute', top: isDesk ? 32 : 10, right: 58, zIndex: 3,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: bgmOn ? 'rgba(22,199,132,0.18)' : LIMBO.band,
            color: bgmOn ? COLOR : '#7d8a99',
            border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : 'rgba(0,0,0,0.3)'}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={bgmOn ? '关闭背景音乐' : '开启背景音乐'}
        >
          <MusicNoteIcon on={bgmOn} size={18} />
        </button>

        {/* Mute — game-card top-right */}
        <button
          type="button"
          onClick={() => setMuted(v => !v)}
          style={{
            position: 'absolute', top: isDesk ? 32 : 10, right: 10, zIndex: 3,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: LIMBO.band,
            color: muted ? '#7d8a99' : COLOR,
            border: '1px solid rgba(0,0,0,0.3)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={muted ? '取消静音' : '静音'}
        >
          <SpeakerIcon on={!muted} size={18} />
        </button>

        <div style={{ position: 'relative', ...(isDesk ? { width: '100%', maxWidth: 720, margin: '0 auto' } : {}) }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: isMobile ? 300 : 420, display: 'block', borderRadius: 12 }} />

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
        {proof && (
          <div style={{
            textAlign: 'center', marginTop: 8, fontSize: 10, fontWeight: 600,
            color: 'rgba(255,255,255,0.4)', wordBreak: 'break-all',
          }}>
            可验证 · hash: {proof.serverSeedHash?.slice(0, 16)}… · nonce: {proof.nonce}
          </div>
        )}
        </div>{/* /middle zone */}
      </Panel>
  )

  // Shell bet bay — one-shot mode: bet → settling (greyed) → bet again. No Auto tab.
  const bayPanel = (
        <BetPanel
          bare={isDesk}
          bet={bet}
          setBet={setBet}
          max={serverBalance ?? 0}
          inputDisabled={rolling}
          chipDisabled={rolling}
          showAuto={false}
          button={rolling
            ? { state: 'waiting', label: '结算中…', disabled: true }
            : { state: 'bet', label: `下注 $${bet.toFixed(2)}`, onClick: play, disabled: bet > (serverBalance ?? 0) || bet < 1 }}
        />
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
            {Number(serverBalance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
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
            {/* game card full-width, meter+number combo stays centered */}
            <div style={{ flex: 1, minHeight: 0 }}>{mainPanel}</div>
            {/* full-bleed bottom bay strip — params left, bay right, ~900 centered */}
            <div style={{
              flex: '0 0 auto', minHeight: LAYOUT.bottomH,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 -12px -12px',
              background: `linear-gradient(rgba(10,17,25,0.78), rgba(10,17,25,0.78)), url(${bayBgUrl}) center / cover no-repeat`,
              borderTop: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ width: 900, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 20, padding: '12px 16px', boxSizing: 'border-box' }}>
                {deskParams}
                <div style={{ width: LAYOUT.bayW, maxWidth: '52%', flex: '0 0 auto' }}>{bayPanel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged ----
  return (
    <GameLayout title="Odds Climb" color={COLOR} sidebar={side}>
      {mainPanel}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bayPanel}</div>
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

function SideControls({ bet, target, setTarget, rolling, result, t, winChance, payout, fill }) {
  return (
    <Panel style={{
      background: '#101923', borderColor: '#243142', padding: 18,
      // desktop: stretch to the game card's height, controls stacked on top
      ...(fill ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
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
          fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
          display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={result.win ? badgeWinUrl : badgeLoseUrl} alt="" draggable={false}
            style={{ height: 18, width: 'auto', pointerEvents: 'none', display: 'block' }} />
          <span>Final {result.mult.toFixed(2)}× — {result.win ? `Won $${result.profit.toFixed(2)}!` : 'Below target'}</span>
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
