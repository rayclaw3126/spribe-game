import { useEffect, useMemo, useRef, useState } from 'react'
import GameLayout, { Panel, ActionButton } from '../components/GameLayout'
import { useIsMobile } from '../hooks/useMediaQuery'
import ballUrl from '../assets/covers/ball-3d.png'
import bgmUrl from '../assets/covers/bgm.mp3'

const GREEN = '#16C784'
const ROBOTS = ['Striker88', 'GoalRush', 'PitchPro', 'VARKing', 'Crossbar', 'Derby7', 'UltraBet', 'FastBoot', 'Sweeper', 'TopBins', 'NorthEnd', 'CapTen']
const HISTORY_SEED = [1.42, 2.81, 1.06, 5.24, 1.88, 3.37, 9.12, 1.19, 2.05, 4.63]

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

function multColor(mult) {
  if (mult < 2.5) return GREEN
  if (mult < 6) return '#facc15'
  return '#fb923c'
}

function maskName(name) {
  if (name === '你') return name
  if (name.length <= 2) return name[0] + '***'
  return `${name[0]}***${name[name.length - 1]}`
}

function makeBots() {
  const count = Math.floor(rand(6, 15))
  return Array.from({ length: count }, (_, i) => {
    const bet = Math.round(rand(3, 80))
    return {
      id: `${Date.now()}-${i}-${Math.random()}`,
      name: ROBOTS[Math.floor(Math.random() * ROBOTS.length)],
      bet,
      target: rand(1.25, 5.8),
      status: 'live',
      payout: null,
    }
  })
}

export default function Balloon({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const canvasRef = useRef(null)
  const ballRef = useRef(null)
  const frameRef = useRef(null)
  const phaseRef = useRef('betting')
  const startRef = useRef(0)
  const crashRef = useRef(2)
  const multRef = useRef(1)
  const particlesRef = useRef([])
  const burstRef = useRef(false)
  const flashRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false, engine: null })
  const bgmRef = useRef({ audio: null })

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('betting')
  const [countdown, setCountdown] = useState(3)
  const [multiplier, setMultiplier] = useState(1)
  const [crashPoint, setCrashPoint] = useState(null)
  const [playerBet, setPlayerBet] = useState(null)
  const [cashedOut, setCashedOut] = useState(null)
  const [history, setHistory] = useState(HISTORY_SEED)
  const [players, setPlayers] = useState(() => makeBots())
  const [online, setOnline] = useState(() => Math.floor(rand(820, 980)))
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)
  const [message, setMessage] = useState('')

  const displayPlayers = useMemo(() => {
    const you = playerBet ? [{
      id: 'you',
      name: '你',
      bet: playerBet.amount,
      target: cashedOut?.mult || null,
      status: cashedOut ? 'cashed' : phase === 'crashed' ? 'crashed' : 'live',
      payout: cashedOut?.win || null,
      you: true,
    }] : []
    return [...you, ...players].slice(0, 15)
  }, [cashedOut, phase, playerBet, players])

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
    multRef.current = 1
    particlesRef.current = []
    burstRef.current = false
    flashRef.current = 0
    setPhase('betting')
    setCountdown(3)
    setMultiplier(1)
    setCrashPoint(null)
    setPlayerBet(null)
    setCashedOut(null)
    setPlayers(makeBots())
    setMessage('')
    stopEngine()
  }

  function launchRound() {
    const cp = Number(generateCrash().toFixed(2))
    crashRef.current = cp
    startRef.current = performance.now()
    phaseRef.current = 'flying'
    setPhase('flying')
    setCrashPoint(cp)
    setMessage('')
    startEngine()
  }

  function crashRound() {
    phaseRef.current = 'crashed'
    flashRef.current = 0.7
    stopEngine()
    playCrash()
    setPhase('crashed')
    setCrashPoint(crashRef.current)
    setHistory(h => [Number(crashRef.current.toFixed(2)), ...h].slice(0, 12))
    setPlayers(list => list.map(p => p.status === 'live' ? { ...p, status: 'crashed' } : p))
    setMessage(`本轮 ${crashRef.current.toFixed(2)}× 射偏了`)
    setTimeout(resetRound, 2200)
  }

  function placeBet() {
    if (phase !== 'betting' || playerBet || bet < 1 || bet > balance) return
    ensureAudio()
    const amount = Number(bet)
    setBalance(b => Number((b - amount).toFixed(2)))
    setPlayerBet({ amount })
    setMessage(`已下注 $${money(amount)}，本轮生效`)
  }

  function cashOut() {
    if (phase !== 'flying' || !playerBet || cashedOut) return
    ensureAudio()
    const mult = Number(multRef.current.toFixed(2))
    const win = Number((playerBet.amount * mult).toFixed(2))
    setBalance(b => Number((b + win).toFixed(2)))
    setCashedOut({ mult, win })
    setMessage(`已套现 ${mult.toFixed(2)}× — +$${money(win)}`)
    playDing()
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
    const img = ballRef.current
    const r = (isMobile ? 23 : 30) * dpr
    if (img?.complete && mode !== 'crashed') {
      ctx.save()
      ctx.translate(x, y)
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
      setCountdown(c => {
        if (c <= 1) {
          launchRound()
          return 0
        }
        return c - 1
      })
    }, 1000)

    const animate = now => {
      if (phaseRef.current === 'flying') {
        const seconds = (now - startRef.current) / 1000
        const next = Math.exp(0.17 * seconds)
        const capped = Math.min(next, crashRef.current)
        multRef.current = capped
        setMultiplier(Number(capped.toFixed(2)))
        updateEngine(capped)
        setPlayers(list => list.map(p => {
          if (p.status !== 'live') return p
          if (capped >= p.target && capped < crashRef.current) {
            const payout = Number((p.bet * p.target).toFixed(2))
            return { ...p, status: 'cashed', payout, target: Number(p.target.toFixed(2)) }
          }
          return p
        }))
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

  const canBet = phase === 'betting' && !playerBet
  const canCash = phase === 'flying' && playerBet && !cashedOut
  const bigColor = phase === 'crashed'
    ? '#e2564a'
    : multiplier < 2.5 ? '#16C784' : multiplier < 6 ? '#e0b100' : '#e2564a'
  const bigValue = phase === 'crashed' ? (crashPoint?.toFixed(2) || multiplier.toFixed(2)) : multiplier.toFixed(2)
  const topTag = phase === 'betting' ? '起脚' : phase === 'flying' ? '飞行中' : '射偏'
  const statusText = phase === 'betting'
    ? `起脚倒计时 ${countdown}s…`
    : phase === 'flying'
      ? '飞行中 — 及时套现!'
      : '射偏了 — 下一轮马上来'
  const potentialWin = playerBet ? playerBet.amount * multiplier : 0

  return (
    <GameLayout
      title="Long Shot"
      emoji="⚽"
      color={GREEN}
      sidebar={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel style={{ background: '#101923', borderColor: '#243142', padding: 18 }}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', color: '#8a97a6', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>下注</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number" min="1" value={bet}
                  onChange={e => setBet(Math.max(1, Number(e.target.value)))}
                  disabled={!canBet}
                  style={{
                    flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: 10, minHeight: 40, boxSizing: 'border-box',
                    border: '1.5px solid #243142', background: '#0a1119', color: '#e8edf2', fontSize: 15, fontWeight: 600,
                  }}
                />
                <button onClick={() => setBet(b => Math.max(1, Math.floor(b / 2)))} disabled={!canBet} style={{
                  padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  background: '#1a2230', color: '#8a97a6', border: '1.5px solid #243142',
                }}>½</button>
                <button onClick={() => setBet(b => Math.max(1, b * 2))} disabled={!canBet} style={{
                  padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  background: '#1a2230', color: '#8a97a6', border: '1.5px solid #243142',
                }}>2×</button>
              </div>
            </div>
            {phase === 'flying' ? (
              <ActionButton onClick={cashOut} disabled={!canCash} color={multColor(multiplier)}>
                套现 ({multiplier.toFixed(2)}×) ${money(potentialWin)}
              </ActionButton>
            ) : (
              <ActionButton onClick={placeBet} disabled={!canBet || bet > balance} color={GREEN}>
                下注下一轮
              </ActionButton>
            )}
            {message && (
              <div style={{ marginTop: 12, color: '#8a97a6', fontSize: 13, lineHeight: 1.5 }}>
                {message}
              </div>
            )}
          </Panel>

          <Panel style={{ background: '#101923', borderColor: '#243142', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ color: '#e8edf2', fontSize: 14 }}>实时下注</strong>
              <span style={{ color: GREEN, fontSize: 12, fontWeight: 800 }}>{online} 在线</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: isMobile ? 220 : 360, overflow: 'hidden' }}>
              {displayPlayers.map(p => (
                <div key={p.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '9px 10px',
                  borderRadius: 10,
                  background: p.you ? 'rgba(22,199,132,0.14)' : '#1a2230',
                  border: `1px solid ${p.you ? 'rgba(22,199,132,0.45)' : '#232c39'}`,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: p.you ? '#d7ffe8' : '#e8edf2', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {maskName(p.name)}
                    </div>
                    <div style={{ color: '#7d8a99', fontSize: 12 }}>${money(p.bet)}</div>
                  </div>
                  <div style={{
                    color: p.status === 'cashed' ? GREEN : p.status === 'crashed' ? '#f87171' : '#facc15',
                    fontSize: 12,
                    fontWeight: 900,
                    textAlign: 'right',
                  }}>
                    {p.status === 'cashed' ? `+${Number(p.target).toFixed(2)}×` : p.status === 'crashed' ? '射偏' : '进行中'}
                    {p.payout && <div style={{ color: '#8a97a6', fontWeight: 700 }}>${money(p.payout)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      }
    >
      <Panel style={{ background: '#0a1119', borderColor: '#232c39', padding: isMobile ? 12 : 18, overflow: 'hidden' }}>
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
        <div style={{ position: 'relative', animation: phase === 'crashed' ? 'bkShake 0.4s ease' : 'none' }}>
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: isMobile ? 290 : 430,
              borderRadius: 16,
              background: '#0a1119',
              border: '1px solid #172333',
            }}
          />

          {/* Recent multipliers — vertical column, newest on top */}
          <div style={{
            position: 'absolute', top: 10, left: 10,
            display: 'flex', flexDirection: 'column', gap: 5,
            maxHeight: 'calc(100% - 20px)', overflow: 'hidden',
          }}>
            {history.slice(0, isMobile ? 6 : 9).map((v, i) => (
              <span key={`${v}-${i}`} style={{
                padding: '3px 9px',
                borderRadius: 999,
                textAlign: 'center',
                background: v >= 2 ? 'rgba(22,199,132,0.16)' : v >= 1.5 ? 'rgba(250,204,21,0.15)' : 'rgba(248,113,113,0.16)',
                color: v >= 2 ? '#86efac' : v >= 1.5 ? '#fde68a' : '#fca5a5',
                fontSize: 11,
                fontWeight: 900,
              }}>
                {v.toFixed(2)}×
              </span>
            ))}
          </div>

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

          {/* Big multiplier + status — centered overlay */}
          <div style={{
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
          </div>
        </div>
      </Panel>
    </GameLayout>
  )
}
