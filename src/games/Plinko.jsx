import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import ballUrl from '../assets/covers/ball-3d.png'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const ROWS = 10
const COLS = ROWS + 1
const SEG_DUR = 0.32   // seconds per row segment (slower, ~2s top-to-bottom)

const MULTIPLIERS = [10, 4, 2, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 2, 4, 10]

const BUCKET_COLORS = [
  '#16C784', '#22D391', '#4ADE80', '#86EFAC', '#BBF7D0',
  '#DCFCE7', '#BBF7D0', '#86EFAC', '#4ADE80', '#22D391',
  '#16C784', '#0FA968', '#0A7F4E',
]

const W = 520, H = 440
const paddingX = 40, paddingY = 30
const availW = W - paddingX * 2
const availH = H - paddingY * 2 - 50   // leave room for buckets

function getPegPos(row, col) {
  const cols = row + 1
  const startX = paddingX + (availW / 2) - ((cols - 1) * (availW / (ROWS + 1)) / 2)
  const x = startX + col * (availW / (ROWS + 1))
  const y = paddingY + (row / (ROWS - 1)) * availH
  return { x, y }
}

function rand(min, max) { return min + Math.random() * (max - min) }

export default function Plinko({ balance, setBalance }) {
  const [bet, setBet] = useState(10)
  const [lastBucket, setLastBucket] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [history, setHistory] = useState([])
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const canvasRef = useRef(null)
  const ballImgRef = useRef(null)
  const ballsRef = useRef([])
  const flashesRef = useRef({})       // bucketIdx -> alpha
  const particlesRef = useRef([])
  const idRef = useRef(0)
  const lastTsRef = useRef(0)
  const drawRef = useRef(null)
  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx
    return ctx
  }
  function playPeg() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 620 + Math.random() * 500
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.05)
  }
  function playLandThud() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.13)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.19)
  }
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.28)
    })
  }
  function playLose() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.35)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.42)
  }

  // ---------- BGM ----------
  function startBgm() {
    if (bgmRef.current.audio) return
    const audio = new Audio(bgmUrl); audio.loop = true; audio.volume = 0.25
    audio.play().catch(() => {})
    bgmRef.current.audio = audio
  }
  function stopBgm() {
    if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null }
  }
  useEffect(() => {
    if (bgmOn) startBgm(); else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => stopBgm(), [])

  // ---------- ball creation (each ball is independent, carries its own stake) ----------
  function makeBall() {
    let col = 0
    const path = [{ x: W / 2, y: paddingY - 20 }]
    for (let row = 0; row < ROWS; row++) {
      const goRight = Math.random() > 0.5
      if (goRight) col++
      const peg = getPegPos(row, col)
      path.push({ x: peg.x + (goRight ? 14 : -14), y: peg.y + 6 })
    }
    const bucketIdx = Math.min(col, COLS - 1)
    const bucketX = paddingX + bucketIdx * (availW / COLS) + (availW / COLS) / 2
    path.push({ x: bucketX, y: H - 30 })
    return { id: ++idRef.current, path, bucketIdx, seg: 0, f: 0, angle: rand(0, 6), x: W / 2, y: paddingY - 20, landed: false, landTs: 0, bet: Number(bet) }
  }

  function takeKick() {
    if (bet < 1 || bet > balance) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    ballsRef.current.push(makeBall())
  }

  function settleBall(ball) {
    const mult = MULTIPLIERS[ball.bucketIdx] ?? 1
    const payout = parseFloat((ball.bet * mult).toFixed(2))
    if (payout > 0) setBalance(b => parseFloat((b + payout).toFixed(2)))
    setLastBucket(ball.bucketIdx)
    setLastResult({ mult, payout, win: mult >= 1 })
    setHistory(h => [{ mult, bucketIdx: ball.bucketIdx }, ...h].slice(0, 20))
    flashesRef.current[ball.bucketIdx] = 1
    const bx = paddingX + ball.bucketIdx * (availW / COLS) + (availW / COLS) / 2
    for (let k = 0; k < 12; k++) {
      const ang = (Math.PI * 2 * k) / 12 + rand(-0.2, 0.2)
      const sp = rand(1.2, 3.4)
      particlesRef.current.push({ x: bx, y: H - 40, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1, life: 1, color: Math.random() > 0.5 ? '#e8edf2' : '#4ade80' })
    }
    playLandThud()
    if (mult >= 2) playWin()
    else if (mult < 1) playLose()
  }

  function draw(ts) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dt = lastTsRef.current ? Math.min((ts - lastTsRef.current) / 1000, 0.05) : 0.016
    lastTsRef.current = ts

    // advance balls
    const balls = ballsRef.current
    for (const ball of balls) {
      if (!ball.landed) {
        ball.f += dt / SEG_DUR
        ball.angle += 0.16
        while (ball.f >= 1 && ball.seg < ball.path.length - 1) {
          ball.f -= 1
          ball.seg++
          if (ball.seg <= ROWS) {
            playPeg()
            for (let s = 0; s < 2; s++) {
              const p = ball.path[ball.seg]
              particlesRef.current.push({ x: p.x, y: p.y, vx: rand(-1, 1), vy: rand(-1.2, -0.2), life: 0.6, color: '#bff3da' })
            }
          }
          if (ball.seg >= ball.path.length - 1) { ball.landed = true; ball.landTs = ts; ball.f = 0; settleBall(ball) }
        }
      }
      const i0 = Math.min(ball.seg, ball.path.length - 1)
      const i1 = Math.min(ball.seg + 1, ball.path.length - 1)
      const a = ball.path[i0], b = ball.path[i1]
      const t = ball.landed ? 1 : ball.f
      ball.x = a.x + (b.x - a.x) * t
      ball.y = a.y + (b.y - a.y) * t + (ball.landed ? 0 : Math.sin(t * Math.PI) * 8)
    }
    // remove long-landed balls
    ballsRef.current = balls.filter(b => !(b.landed && ts - b.landTs > 650))

    // ---- render ----
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#202A38'
    ctx.fillRect(0, 0, W, H)

    // pegs
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col <= row; col++) {
        const { x, y } = getPegPos(row, col)
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#16C78444'; ctx.fill()
        ctx.strokeStyle = '#16C784'; ctx.lineWidth = 1.5; ctx.stroke()
      }
    }

    // buckets (+ flash)
    const bucketW = availW / COLS
    for (let i = 0; i < COLS; i++) {
      const bx = paddingX + i * bucketW
      const by = H - 50
      const mult = MULTIPLIERS[i] ?? 1
      const fl = flashesRef.current[i] || 0
      ctx.fillStyle = fl > 0.05 ? `rgba(255,255,255,${0.35 * fl})` : (lastBucket === i ? BUCKET_COLORS[i] : BUCKET_COLORS[i] + '55')
      ctx.beginPath(); ctx.roundRect(bx + 2, by, bucketW - 4, 40, 6); ctx.fill()
      ctx.fillStyle = fl > 0.05 ? '#0a1119' : BUCKET_COLORS[i]
      ctx.font = `bold ${mult >= 4 ? 11 : 10}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(`${mult}×`, bx + bucketW / 2, by + 26)
    }
    for (const k in flashesRef.current) { flashesRef.current[k] *= 0.88; if (flashesRef.current[k] < 0.03) delete flashesRef.current[k] }

    // particles
    particlesRef.current = particlesRef.current
      .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 0.12, life: p.life - 0.03 }))
      .filter(p => p.life > 0)
    particlesRef.current.forEach(p => { ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3) })
    ctx.globalAlpha = 1

    // balls (3D wave ball, rotating)
    const img = ballImgRef.current
    for (const ball of ballsRef.current) {
      const r = 11
      if (img?.complete && img.naturalWidth) {
        ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.angle)
        ctx.drawImage(img, -r, -r, r * 2, r * 2); ctx.restore()
      } else {
        ctx.beginPath(); ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2); ctx.fillStyle = '#f4f8ff'; ctx.fill()
      }
    }
  }
  drawRef.current = draw

  useEffect(() => {
    const img = new Image(); img.src = ballUrl; ballImgRef.current = img
    let frameId = 0, alive = true
    const loop = ts => { if (!alive) return; drawRef.current(ts); frameId = requestAnimationFrame(loop) }
    frameId = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(frameId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canKick = bet >= 1 && bet <= balance

  return (
    <GameLayout title="Free Kick" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          {/* Multiplier reference */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>Zone Multipliers</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {MULTIPLIERS.map((m, i) => (
                <span key={i} style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  background: lastBucket === i ? BUCKET_COLORS[i] : BUCKET_COLORS[i] + '33',
                  color: lastBucket === i ? '#fff' : BUCKET_COLORS[i],
                  transition: 'all 0.3s',
                }}>{m}×</span>
              ))}
            </div>
          </div>

          {lastResult && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: lastResult.win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: lastResult.win ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {lastResult.win ? '🎉' : '💔'} {lastResult.mult}× — ${lastResult.payout.toFixed(2)}
            </div>
          )}

        </Panel>
      }
    >
      <Panel style={{ padding: 12, position: 'relative' }}>
        <RoundHistoryBar rounds={history.map(h => h.mult)} />
        <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 20, right: 62, width: 40, height: 40, borderRadius: '50%', zIndex: 2,
          background: bgmOn ? 'rgba(22,199,132,0.18)' : 'rgba(26,34,48,0.85)',
          color: bgmOn ? COLOR : '#7d8a99', border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : '#232c39'}`, fontSize: 16, cursor: 'pointer',
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 20, right: 20, width: 40, height: 40, borderRadius: '50%', zIndex: 2,
          background: 'rgba(26,34,48,0.85)', color: muted ? '#7d8a99' : COLOR, border: '1px solid #232c39', fontSize: 18, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔊'}</button>

        <canvas ref={canvasRef} width={W} height={H}
          style={{ width: '100%', borderRadius: 12, display: 'block' }}
        />
      </Panel>

      {/* Shell bet bay — one-shot fire-and-forget: every click drops another ball */}
      <div style={{ maxWidth: 480, margin: '14px auto 0' }}>
        <BetPanel
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={false}
          chipDisabled={false}
          showAuto={false}
          button={{ state: 'bet', label: `下注 $${bet.toFixed(2)}`, onClick: takeKick, disabled: !canKick }}
          hint="连点可同时踢多球"
        />
      </div>
    </GameLayout>
  )
}
