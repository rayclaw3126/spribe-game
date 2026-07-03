import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetPanel from '../components/shell/BetPanel'
import { useIsMobile } from '../hooks/useMediaQuery'
import ballUrl from '../assets/covers/ball-3d.png'
import bgmUrl from '../assets/covers/bgm.mp3'

const COLOR = '#16C784'
const MULTS = [1.0, 1.5, 2.2, 3.5, 6.0, 10.0]   // [level] → multiplier
const MAX = 5                                     // beat 5 defenders = full score
const ANIM = 700                                  // ms per dribble

function money(n) { return Number(n).toFixed(2) }
function rand(min, max) { return min + Math.random() * (max - min) }

export default function Goal({ balance, setBalance }) {
  const isMobile = useIsMobile()

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')      // idle | running | done
  const [level, setLevel] = useState(0)           // defenders beaten
  const [awaiting, setAwaiting] = useState(false)  // waiting for L/R choice
  const [message, setMessage] = useState(null)     // { text, tone }
  const [finalResult, setFinalResult] = useState(null)
  const [roundHistory, setRoundHistory] = useState([])   // final multiplier per round (0 = tackled), newest first
  const [muted, setMuted] = useState(false)
  const [bgmOn, setBgmOn] = useState(false)

  const canvasRef = useRef(null)
  const ballImgRef = useRef(null)
  const drawRef = useRef(null)
  const animRef = useRef(null)        // { active, start, picked, defSide, pass }
  const flashRef = useRef({ a: 0, c: '34,197,94' })
  const shakeRef = useRef(0)
  const particlesRef = useRef([])
  const angleRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false })
  const bgmRef = useRef({ audio: null })

  const phaseRef = useRef('idle')
  const levelRef = useRef(0)
  const timersRef = useRef([])

  useEffect(() => { phaseRef.current = phase }, [phase])
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
  function playRun() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate)
    const d = nb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.16)
    const g = ctx.createGain(); g.gain.value = 0.05
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.16)
  }
  function playPass() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 1040].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.2)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.22)
    })
  }
  function playTackle() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.3)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
    const w = ctx.createOscillator(); const wg = ctx.createGain()
    w.type = 'sine'; w.frequency.setValueAtTime(1750, t); w.frequency.exponentialRampToValueAtTime(650, t + 0.4)
    wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.05, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    w.connect(wg); wg.connect(ctx.destination); w.start(t); w.stop(t + 0.44)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.26 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  }
  function playWin() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }

  // ---------- BGM ----------
  function startBgm() {
    if (bgmRef.current.audio) return
    const audio = new Audio(bgmUrl); audio.loop = true; audio.volume = 0.25
    audio.play().catch(() => {})
    bgmRef.current.audio = audio
  }
  function stopBgm() { if (bgmRef.current.audio) { bgmRef.current.audio.pause(); bgmRef.current.audio = null } }
  useEffect(() => { if (bgmOn) startBgm(); else stopBgm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgmOn])
  useEffect(() => () => { stopBgm(); timersRef.current.forEach(clearTimeout) }, [])

  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  // ---------- flow ----------
  function start() {
    if (phaseRef.current === 'running') return
    if (bet > balance || bet < 1) return
    ensureAudio()
    setBalance(b => parseFloat((b - bet).toFixed(2)))
    levelRef.current = 0; setLevel(0)
    animRef.current = null; particlesRef.current = []; shakeRef.current = 0; flashRef.current = { a: 0, c: '34,197,94' }
    setFinalResult(null); setMessage(null)
    setPhase('running'); phaseRef.current = 'running'
    setAwaiting(true)
  }

  function choose(side) {
    if (phaseRef.current !== 'running' || !awaiting || animRef.current?.active) return
    ensureAudio()
    const defSide = Math.random() < 0.5 ? 'left' : 'right'
    const pass = side !== defSide
    setAwaiting(false)
    setMessage(null)
    animRef.current = { active: true, start: performance.now(), picked: side, defSide, pass }
    playRun()

    later(() => {
      if (animRef.current) animRef.current.active = false
      spawnParticles(pass ? '#4ade80' : '#f87171', side)
      if (pass) {
        const nl = levelRef.current + 1
        levelRef.current = nl; setLevel(nl)
        flashRef.current = { a: 0.45, c: '34,197,94' }
        if (nl >= MAX) {
          const payout = parseFloat((bet * MULTS[MAX]).toFixed(2))
          setBalance(b => parseFloat((b + payout).toFixed(2)))
          setMessage({ text: '突破成功！', tone: 'gold' })
          setFinalResult({ win: payout, level: nl })
          setRoundHistory(h => [MULTS[MAX], ...h].slice(0, 20))
          setPhase('done'); phaseRef.current = 'done'
          playWin()
        } else {
          setMessage({ text: '过人！', tone: 'good' })
          playPass()
          setAwaiting(true)
        }
      } else {
        flashRef.current = { a: 0.55, c: '239,68,68' }; shakeRef.current = 1
        setMessage({ text: '被抢断！', tone: 'bad' })
        setFinalResult({ win: 0, level: levelRef.current })
        setRoundHistory(h => [0, ...h].slice(0, 20))
        setPhase('done'); phaseRef.current = 'done'
        playTackle()
      }
    }, ANIM)
  }

  function cashOut() {
    if (phaseRef.current !== 'running' || levelRef.current < 1 || !awaiting) return
    const mult = MULTS[levelRef.current]
    const payout = parseFloat((bet * mult).toFixed(2))
    setBalance(b => parseFloat((b + payout).toFixed(2)))
    setMessage({ text: `兑现 ${mult}×`, tone: 'good' })
    setFinalResult({ win: payout, level: levelRef.current, cashed: true })
    setRoundHistory(h => [mult, ...h].slice(0, 20))
    setPhase('done'); phaseRef.current = 'done'
    playCash()
  }

  function spawnParticles(color, side) {
    const cx = side === 'left' ? 0.30 : 0.70
    for (let k = 0; k < 14; k++) {
      const ang = (Math.PI * 2 * k) / 14 + rand(-0.2, 0.2)
      const sp = rand(1.5, 4)
      particlesRef.current.push({ fx: cx, fy: 0.30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, color: Math.random() > 0.5 ? color : '#e8edf2' })
    }
  }

  // ---------- canvas ----------
  function draw(now) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(300, Math.floor(rect.width * dpr))
    const height = Math.max(220, Math.floor(rect.height * dpr))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Pitch
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0b3b28'); g.addColorStop(1, '#16643f')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)'
      const y = (H / 7) * i
      ctx.fillRect(0, y, W, H / 7)
    }

    const sh = shakeRef.current
    const wob = Math.sin(now / 22) * sh * 7 * dpr

    const anim = animRef.current
    const pickedX = a => (a === 'left' ? 0.30 : 0.70) * W
    const p = anim ? Math.min((now - anim.start) / ANIM, 1) : 0

    // Defender position
    let defX, defY = H * 0.30
    if (anim) {
      const dp = Math.min(p * 1.5, 1)
      defX = W * 0.5 + (pickedX(anim.defSide) - W * 0.5) * dp
    } else {
      defX = W * 0.5
    }
    // red range ring
    ctx.beginPath(); ctx.arc(defX + wob, defY, 34 * dpr, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(239,68,68,0.16)'; ctx.fill()
    ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.lineWidth = 2 * dpr; ctx.stroke()
    // defender emoji
    ctx.font = `${34 * dpr}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('🛡️', defX + wob, defY)

    // Ball
    let bx, by
    if (anim) {
      // tackled ball stalls at the defender; pass ball rushes past to the side & up
      const bp = anim.pass ? p : Math.min(p / 0.72, 1)
      const tx = pickedX(anim.picked)
      const ty = anim.pass ? H * 0.14 : H * 0.30
      bx = W * 0.5 + (tx - W * 0.5) * bp
      by = H * 0.82 + (ty - H * 0.82) * bp
    } else {
      bx = W * 0.5; by = H * 0.82
    }
    angleRef.current += anim && anim.active ? 0.35 : 0.02
    const img = ballImgRef.current
    const r = (isMobile ? 22 : 28) * dpr
    if (img?.complete && img.naturalWidth) {
      ctx.save(); ctx.translate(bx + wob, by); ctx.rotate(angleRef.current)
      ctx.drawImage(img, -r, -r, r * 2, r * 2); ctx.restore()
    } else {
      ctx.beginPath(); ctx.arc(bx + wob, by, r, 0, Math.PI * 2); ctx.fillStyle = '#f4f8ff'; ctx.fill()
    }

    // particles
    shakeRef.current *= 0.9
    particlesRef.current = particlesRef.current
      .map(pt => ({ ...pt, fx: pt.fx + pt.vx / W, fy: pt.fy + pt.vy / H, vy: pt.vy + 0.12, life: pt.life - 0.03 }))
      .filter(pt => pt.life > 0)
    particlesRef.current.forEach(pt => { ctx.globalAlpha = Math.max(pt.life, 0); ctx.fillStyle = pt.color; ctx.fillRect(pt.fx * W, pt.fy * H, 3 * dpr, 3 * dpr) })
    ctx.globalAlpha = 1

    // flash overlay
    if (flashRef.current.a > 0.02) {
      ctx.fillStyle = `rgba(${flashRef.current.c},${flashRef.current.a})`
      ctx.fillRect(0, 0, W, H)
      flashRef.current.a *= 0.85
    }
  }
  drawRef.current = draw

  useEffect(() => {
    const img = new Image(); img.src = ballUrl; ballImgRef.current = img
    let frameId = 0, alive = true
    const loop = now => { if (!alive) return; drawRef.current(now); frameId = requestAnimationFrame(loop) }
    frameId = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(frameId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const running = phase === 'running'
  const bigMult = MULTS[level]
  const bigColor = level <= 1 ? COLOR : level <= 3 ? '#e0b100' : '#f5a623'
  const topTag = phase === 'idle' ? '准备突破' : running ? `已过 ${level} 人` : finalResult?.win > 0 ? '突破得手' : '被抢断'

  return (
    <GameLayout title="Goal" emoji="⚽" color={COLOR}
      sidebar={
        <Panel>
          {finalResult && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 12,
              background: finalResult.win > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
              color: finalResult.win > 0 ? '#6EE7B7' : '#FCA5A5',
              fontWeight: 600, fontSize: 14, animation: 'winPop 0.4s ease',
            }}>
              {finalResult.win > 0 ? '🎉' : '💔'} 过 {finalResult.level} 人 —{' '}
              {finalResult.win > 0 ? `赢 $${money(finalResult.win)}!` : '被抢断，未中奖'}
            </div>
          )}

          {/* Multiplier ladder */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8, fontWeight: 600 }}>过人赔率</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[5, 4, 3, 2, 1].map(n => {
                const active = running && level === n
                const done = level >= n
                return (
                  <div key={n} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                    background: active ? COLOR + '20' : done ? 'rgba(16,185,129,0.12)' : 'var(--bg2)',
                    border: `1.5px solid ${active ? COLOR : done ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
                    fontSize: 13, fontWeight: 600, color: active ? COLOR : done ? '#6EE7B7' : 'var(--text3)',
                  }}>
                    <span>{done ? '✓' : ' '}</span>
                    <span>过 {n} 人{n === 5 ? '（满分）' : ''}</span>
                    <span style={{ marginLeft: 'auto' }}>{MULTS[n]}×</span>
                  </div>
                )
              })}
            </div>
          </div>
        </Panel>
      }
    >
      <Panel style={{ background: '#0a1119', borderColor: '#232c39', padding: isMobile ? 12 : 18, overflow: 'hidden' }}>
        <RoundHistoryBar rounds={roundHistory} />
        <div style={{ position: 'relative' }}>
          <canvas ref={canvasRef} style={{
            display: 'block', width: '100%', height: isMobile ? 300 : 360,
            borderRadius: 16, background: '#0b3b28', border: '1px solid #172333',
          }} />

          {/* audio toggles */}
          <button type="button" onClick={() => setBgmOn(v => !v)} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            position: 'absolute', top: 10, right: 60, width: 40, height: 40, borderRadius: '50%', zIndex: 2,
            background: bgmOn ? 'rgba(22,199,132,0.18)' : 'rgba(26,34,48,0.85)', color: bgmOn ? COLOR : '#7d8a99',
            border: `1px solid ${bgmOn ? 'rgba(22,199,132,0.5)' : '#232c39'}`, fontSize: 16, cursor: 'pointer',
          }}>🎵</button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            position: 'absolute', top: 10, right: 12, width: 40, height: 40, borderRadius: '50%', zIndex: 2,
            background: 'rgba(26,34,48,0.85)', color: muted ? '#7d8a99' : COLOR, border: '1px solid #232c39', fontSize: 18, cursor: 'pointer',
          }}>{muted ? '🔇' : '🔊'}</button>

          {/* big multiplier + tag (top center) */}
          <div style={{ position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
            <div style={{ color: '#cfe9dc', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>{topTag}</div>
            <div style={{ color: bigColor, fontSize: isMobile ? 32 : 40, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif", textShadow: '0 2px 14px rgba(0,0,0,0.6)' }}>
              {bigMult.toFixed(bigMult % 1 ? 1 : 0)}×
            </div>
          </div>

          {/* message (center) */}
          {message && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{
                fontSize: isMobile ? 34 : 44, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
                color: message.tone === 'bad' ? '#FCA5A5' : message.tone === 'gold' ? '#FCD34D' : '#6EE7B7',
                textShadow: '0 2px 18px rgba(0,0,0,0.7)', animation: 'winPop 0.35s ease',
              }}>{message.text}</div>
            </div>
          )}
        </div>

        {/* Left / Right dribble buttons */}
        {running && awaiting ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            <button onClick={() => choose('left')} style={dribbleBtn}>◀ 左路突破</button>
            <button onClick={() => choose('right')} style={dribbleBtn}>右路突破 ▶</button>
          </div>
        ) : (
          <p style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', marginTop: 14 }}>
            {phase === 'idle' ? '下注后开始 · 选左/右绕过防守，过人越多倍数越高，可随时兑现'
              : running ? '突破中…'
                : finalResult?.win > 0 ? `本轮结束 · 过 ${finalResult.level} 人` : '被抢断了 · 再来一次'}
          </p>
        )}
      </Panel>

      {/* Shell bet bay — multi-step mode: bet / live cashout while running / back to bet */}
      <div style={{ maxWidth: 480, margin: '14px auto 0' }}>
        <BetPanel
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={running}
          chipDisabled={running}
          showAuto={false}
          button={running
            ? { state: 'cashout', label: `兑现 $${money(bet * MULTS[level])}`, onClick: cashOut, disabled: level < 1 || !awaiting }
            : { state: 'bet', label: `下注 $${money(bet)}`, onClick: start, disabled: bet > balance || bet < 1 }}
        />
      </div>
    </GameLayout>
  )
}

const dribbleBtn = {
  flex: 1, padding: '14px', borderRadius: 12, border: 'none',
  background: '#16C784', color: '#06251a', fontSize: 16, fontWeight: 900, cursor: 'pointer',
}
