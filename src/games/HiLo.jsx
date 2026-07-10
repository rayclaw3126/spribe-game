import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HILO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import ballUrl from '../assets/covers/ball-3d.png'

// 单HL2: Rating Hi-Lo gameplay — 1–13 probability multipliers, skip, streak
// cashout (Spribe Hi Lo model).
//
// 倍数推导: 号码 1–13 均匀抽（同号可重复）。当前明牌 n:
//   HIGH OR SAME 赢 ⟺ 下一张 m ≥ n，共 14−n 个号码 → P(high) = (14−n)/13
//   LOW  OR SAME 赢 ⟺ m ≤ n，共 n 个号码       → P(low)  = n/13
//   倍数 = RTP / P（RTP = 0.97）。边界 n=13: HIGH P=1/13 → 12.61×，
//   LOW P=1 → 0.97× —— 两钮都正常可押。
//   猜对倍数累乘（内部保留全精度，显示才 round2），CASHOUT = 注金 × 累乘。
const RTP = 0.97
const SKIPS_PER_ROUND = 3   // 每局 skip 限次（后端 game/hilo.js SKIPS_PER_ROUND 同步）
const round2 = x => Math.round(x * 100) / 100
const pHigh = n => (14 - n) / 13
const pLow = n => n / 13
const genIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `hilo-${Date.now()}-${Math.random()}`)

// flat block-style football jersey: body + sleeves + collar, deep green,
// big squad number (1–13) on the chest
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function Jersey({ num, w, outline = false }) {
  return (
    <svg width={w} height={w * 0.9} viewBox="0 0 100 90" style={{ display: 'block' }}>
      <path d={JERSEY_PATH}
        fill={outline ? 'none' : '#14803c'}
        stroke={outline ? HILO.outline : 'rgba(0,0,0,0.3)'}
        strokeWidth={outline ? 3 : 2} strokeLinejoin="round" />
      {num != null && (
        <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="900"
          fill={outline ? HILO.outline : '#ffffff'}
          fontFamily="'Space Grotesk', sans-serif">{num}</text>
      )}
    </svg>
  )
}
// white card with the jersey + chest number
function JerseyCard({ num, w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10,
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Jersey num={num} w={w * 0.74} />
    </div>
  )
}

// dark football-pattern card back
function CardBack({ w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10, boxSizing: 'border-box',
      background: `repeating-linear-gradient(45deg, ${HILO.back} 0px, ${HILO.back} 8px, ${HILO.backLine} 8px, ${HILO.backLine} 10px)`,
      border: '4px solid #ffffff', boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src={ballUrl} alt="" draggable={false} style={{
        width: w * 0.3, height: w * 0.3, opacity: 0.55, pointerEvents: 'none', display: 'block',
      }} />
    </div>
  )
}

// Deal animation overlay — slide in from the deck, 3D flip, then result
// feedback. Pure presentation: the drawn number is decided BEFORE the
// animation starts and is only read here. A new deal remounts this component
// (key change), cutting any in-flight animation — no queueing.
function DealAnim({ num, kind, dx, w, h, onFlip, onReveal, onDone }) {
  const [stage, setStage] = useState('slide')   // slide | flip | feedback
  const revealedRef = useRef(false)
  const reveal = () => {
    if (revealedRef.current) return
    revealedRef.current = true
    onReveal?.()
    if (kind === 'win' || kind === 'lose') setStage('feedback')
    else onDone()
  }
  return (
    <div
      onAnimationEnd={e => { if (e.animationName === 'hlLoseShake') onDone() }}
      style={{
        position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
        animation: stage === 'feedback' && kind === 'lose' ? 'hlLoseShake 0.35s ease-in-out both' : 'none',
      }}>
      <div
        onAnimationEnd={e => {
          if (e.animationName === 'hlSlideIn') { onFlip?.(); setStage(s => (s === 'slide' ? 'flip' : s)) }
        }}
        style={{
          width: w, height: h,
          '--dx': `${dx}px`,
          animation: stage === 'slide' ? 'hlSlideIn 0.35s ease-out both' : 'none',
        }}>
        <div style={{ width: w, height: h, perspective: 700 }}>
          <div
            onAnimationEnd={e => { if (e.animationName === 'hlFlipIn') reveal() }}
            style={{
              position: 'relative', width: w, height: h,
              transformStyle: 'preserve-3d',
              transform: stage === 'slide' ? 'rotateY(180deg)' : undefined,
              animation: stage !== 'slide' ? 'hlFlipIn 0.45s ease-in-out both' : 'none',
            }}>
            <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
              <JerseyCard num={num} w={w} h={h} />
            </div>
            <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <CardBack w={w} h={h} />
            </div>
          </div>
        </div>
      </div>
      {stage === 'feedback' && kind === 'win' && (
        <div onAnimationEnd={e => { if (e.animationName === 'hlWinPulse') onDone() }} style={{
          position: 'absolute', inset: 0, borderRadius: 10,
          animation: 'hlWinPulse 0.4s ease-out both',
        }} />
      )}
      {stage === 'feedback' && kind === 'lose' && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 10,
          background: 'rgba(224,75,58,0.3)',
        }} />
      )}
    </div>
  )
}

export default function HiLo({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | playing | done
  const [roundId, setRoundId] = useState(null)
  const [card, setCard] = useState(null)       // current face-up number 1..13 — server-issued
  const [flipping, setFlipping] = useState(false)
  const [busy, setBusy] = useState(false)      // await 期间禁重复点（一次只允许一次在途请求）
  const [skips, setSkips] = useState(SKIPS_PER_ROUND)
  const [cum, setCum] = useState(1)            // server-returned running multiplier（不再本地累乘）
  const [steps, setSteps] = useState([])       // this round's flips {n, dir, correct}
  const [cardFlash, setCardFlash] = useState(null)   // 'win' | 'lose' | null
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [proof, setProof] = useState(null)     // 最近一局：{ commitHash, serverSeed, clientSeed } 供玩家自行验证
  const [fairOpen, setFairOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  const audioRef = useRef({ ctx: null, muted: false })
  const toastTimer = useRef(null)
  const timersRef = useRef([])
  const [anim, setAnim] = useState(null)       // { id, num, kind, onReveal } — presentation only
  const animIdRef = useRef(0)

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  function pushToast(msg) {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000)
  }

  // ---------- server API (服务器权威：牌序/判定/累乘/派彩全部以后端返回为准，
  // 前端不再自己发牌/算钱) ----------
  async function apiPost(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) {
      const err = new Error(data?.error || '请求失败，请重试')
      err.data = data
      throw err
    }
    return data
  }

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxWhoosh() {   // card slide — noise sweep 400→2200Hz
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.28)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.3)
  }
  function sfxSnap() {   // card flip lands — short crisp click + low knock
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.03)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.035)
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 210
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + 0.06)
  }
  function playCorrect() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26)
    })
  }
  function playWrong() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  // Kick off the deal animation. The number is already decided by the caller;
  // this layer only replays it visually. Starting a new deal replaces the anim
  // object (fresh id → remount), so an in-flight animation is cut, never queued.
  // prefers-reduced-motion: skip straight to the reveal (static feedback only).
  function beginDeal(num, kind, onReveal) {
    sfxWhoosh()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onReveal?.()
      setAnim(null)
      return
    }
    setAnim({ id: ++animIdRef.current, num, kind, onReveal })
  }

  // ---------- game (服务器权威：牌序/判定/累乘/派彩以后端为准，本地不再发牌/算钱) ----------
  async function startGame() {
    if (phase === 'playing' || busy || bet > (serverBalance ?? 0) || bet < 1) return
    ensureAudio()
    setBusy(true)
    try {
      const idempotencyKey = genIdemKey()
      const data = await apiPost('/round/hilo/start', { amount: bet, idempotencyKey })
      setFeedBets(makeFeedBots())   // fresh fake round rides along (display only)
      setServerBalance(Number(data.balanceAfter))
      setRoundId(data.roundId)
      setCum(1)
      setCard(data.card)            // server-issued first card
      setSteps([])
      setSkips(SKIPS_PER_ROUND)
      setCardFlash(null)
      setFlipping(false)
      setProof({ serverSeedHash: data.serverSeedHash, nonce: data.nonce })
      setPhase('playing')
      beginDeal(data.card, 'deal', null)   // state committed above — anim is a visual replay
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function guess(dir) {   // dir: 'high' | 'low' — both include SAME; 判定由后端 judge 决定
    if (phase !== 'playing' || flipping || busy) return
    setBusy(true)
    try {
      const data = await apiPost('/round/hilo/guess', { roundId, dir })
      const { card: next, correct } = data
      setFlipping(true)

      // Same settle block as before — now triggered by the flip's animationend
      // (reveal) instead of the old 620ms timer. Money already server-settled;
      // this only replays the already-decided result visually.
      beginDeal(next, correct ? 'win' : 'lose', () => {
        setSteps(s => [...s, { n: next, dir, correct }].slice(-10))
        setCard(next)
        if (correct) {
          setCum(data.cum)          // server-returned running product, full precision
          setCardFlash('win')
          playCorrect()
        } else {
          setCardFlash('lose')
          setPhase('done')          // stake already deducted at start — round over
          settleFeed()
          playWrong()
          setProof(p => ({ ...p, serverSeedHash: data.serverSeedHash, nonce: data.nonce }))
        }
        setFlipping(false)
        later(() => setCardFlash(null), 700)
      })
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function skip() {   // swap the face card, no settle, streak keeps (limited per round)
    if (phase !== 'playing' || flipping || busy || skips <= 0) return
    setBusy(true)
    try {
      const data = await apiPost('/round/hilo/skip', { roundId })
      setSkips(data.skipsLeft)     // server-authoritative remaining skips
      setCard(data.card)           // committed instantly, exactly as before — spam-safe
      beginDeal(data.card, 'skip', null)
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  // fake feed rows settle for the round: ~45% cash green, the rest grey out
  function settleFeed() {
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // single money path: every payout goes through here — server computes
  // payout = round2(bet_amount × cum) and returns the authoritative balance
  async function cashOut() {
    if (phase !== 'playing' || flipping || busy) return
    setBusy(true)
    try {
      const data = await apiPost('/round/hilo/cashout', { roundId })
      setServerBalance(Number(data.balanceAfter))
      setProof(p => ({ ...p, serverSeedHash: data.serverSeedHash, nonce: data.nonce }))
      setPhase('done')
      settleFeed()
      playCash()
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ---------- visual layer (Spribe Hi Lo 1:1, pitch green) ----------
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.35)', color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const CW = isMobile ? 96 : 118
  const CH = isMobile ? 126 : 155
  const choicePill = (bg, locked) => ({
    minWidth: isMobile ? 130 : 156, padding: '9px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.45)',
    fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
  })
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the

  // flip-history minis + count/multiplier badge — desktop renders it in the
  // 34px skeleton row, mobile keeps it inside the card (never both)
  const historyStrip = (
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div style={{
            flex: 1, minWidth: 0, background: HILO.band, borderRadius: 8,
            padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden',
          }}>
            {(isMobile ? steps.slice(-4) : steps).map((h, i) => (
              <div key={steps.length - i} style={{
                position: 'relative', width: 34, height: 46, borderRadius: 5, flex: '0 0 auto',
                background: '#ffffff',
                border: `2px solid ${h.correct ? HILO.green : '#e04b3a'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Jersey num={h.n} w={26} />
                <span style={{
                  position: 'absolute', top: -5, left: -5, width: 15, height: 15, borderRadius: '50%',
                  background: h.dir === 'high' ? HILO.badgeUp : HILO.badgeDown, color: COLORS.white,
                  fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.6)',
                }}>{h.dir === 'high' ? '↑' : '↓'}</span>
              </div>
            ))}
          </div>
          <div style={{
            flex: '0 0 auto', background: HILO.band, borderRadius: 8,
            padding: '6px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
              <span style={{ width: 11, height: 15, borderRadius: 2, background: '#ffffff', border: '1px solid rgba(0,0,0,0.4)', display: 'inline-block' }} />
              {steps.length}
            </span>
            <span style={{
              padding: '2px 10px', borderRadius: 4,
              background: HILO.green, color: '#083a1b',
              fontSize: 12, fontWeight: 900,
            }}>{round2(cum).toFixed(2)}x</span>
          </div>
        </div>
  )

  // Floating jersey-card parallax field — reuses JerseyCard, far layer small &
  // fainter, near layer big. Positions hug the edges, clear of the table and
  // button hot zones. Opacity 0.08–0.18 so the foreground always wins.
  const FLOATERS = [
    { num: 7,  w: 54,  pos: { left: '6%',  top: '14%' },    rot: -12, op: 0.10, dur: '17s', del: '-3s' },
    { num: 4,  w: 48,  pos: { right: '9%', top: '20%' },    rot: 10,  op: 0.09, dur: '19s', del: '-8s' },
    { num: 11, w: 56,  pos: { left: '11%', bottom: '24%' }, rot: 8,   op: 0.10, dur: '15s', del: '-5s' },
    { num: 2,  w: 50,  pos: { right: '13%', bottom: '30%' }, rot: -9, op: 0.08, dur: '18s', del: '-11s' },
    { num: 13, w: 96,  pos: { left: '-1%', top: '46%' },    rot: -14, op: 0.16, dur: '13s', del: '-2s' },
    { num: 1,  w: 104, pos: { right: '-2%', top: '36%' },   rot: 14,  op: 0.17, dur: '11s', del: '-6s' },
  ]
  const floatField = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes hlDrift {
          0%   { transform: translate(0px, 0px) rotate(-4deg); }
          50%  { transform: translate(12px, -16px) rotate(4deg); }
          100% { transform: translate(0px, 0px) rotate(-4deg); }
        }
        .hlFloat { animation: hlDrift var(--dur) ease-in-out infinite; animation-delay: var(--del); }
        /* deal animation — slide from deck, 3D flip, win ring / lose shake.
           ring green = HILO.green #35d07f, lose tint = existing #e04b3a */
        @keyframes hlSlideIn {
          from { transform: translateX(var(--dx)) scale(0.92); }
          to   { transform: translateX(0px) scale(1); }
        }
        @keyframes hlFlipIn {
          from { transform: rotateY(180deg); }
          to   { transform: rotateY(0deg); }
        }
        @keyframes hlWinPulse {
          0%   { box-shadow: 0 0 0 0 rgba(53,208,127,0.8); }
          100% { box-shadow: 0 0 0 26px rgba(53,208,127,0); }
        }
        @keyframes hlLoseShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(3px); }
        }
        @media (prefers-reduced-motion: reduce) { .hlFloat { animation: none; } }
      `}</style>
      {FLOATERS.map(f => (
        <div key={f.num} style={{
          position: 'absolute', ...f.pos, opacity: f.op,
          transform: `rotate(${f.rot}deg)`,
        }}>
          <div className="hlFloat" style={{ '--dur': f.dur, '--del': f.del }}>
            <JerseyCard num={f.num} w={f.w} h={Math.round(f.w * 1.31)} />
          </div>
        </div>
      ))}
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 34%, ${HILO.bgCenter}, ${HILO.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {floatField}

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} gameName="RATING HI-LO" band={HILO.band} onBack={onBack} onFairness={() => setFairOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue="RATING HI-LO" playerToken={playerToken} game="hilo" />

        {/* ---- upper region (mobile only — desktop 34px row has it) ---- */}
        {!isDesk && <div style={{ padding: '12px 12px 0', position: 'relative', zIndex: 1 }}>{historyStrip}</div>}

        {/* ---- middle zone: flexes to fill the card, keeps the table group as
             the vertical visual center; leftover space is absorbed here ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '14px 12px' : '16px 18px', boxSizing: 'border-box',
        }}>

        {/* ---- center: hi/lo minis + face card + deck + skip ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: isMobile ? 12 : 22, marginBottom: isMobile ? 16 : 22, position: 'relative', zIndex: 1,
        }}>
          {/* mini hi/lo indicators — up = higher rating, down = lower rating */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <button type="button" disabled onClick={() => guess('higher')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={13} w={20} />
              <span style={{ color: HILO.badgeUp, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↑</span>
            </button>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 900 }}>∨</span>
            <button type="button" disabled onClick={() => guess('lower')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={1} w={20} />
              <span style={{ color: HILO.badgeDown, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↓</span>
            </button>
          </div>

          {/* face-up jersey number card — flashes green/red on settle. While a
              deal/skip animation flies in, the slot shows a card back (the
              committed number stays hidden until the overlay flips). */}
          <div style={{
            position: 'relative',
            borderRadius: 12, transition: 'box-shadow 0.15s',
            boxShadow: cardFlash === 'win' ? `0 0 18px ${HILO.green}` : cardFlash === 'lose' ? '0 0 18px #e04b3a' : 'none',
          }}>
            {anim && (anim.kind === 'deal' || anim.kind === 'skip')
              ? <CardBack w={CW} h={CH} />
              : <JerseyCard num={card ?? 9} w={CW} h={CH} />}
            {anim && (
              <DealAnim key={anim.id} num={anim.num} kind={anim.kind}
                dx={CW + (isMobile ? 12 : 22)} w={CW} h={CH}
                onFlip={sfxSnap}
                onReveal={anim.onReveal}
                onDone={() => setAnim(a => (a && a.id === anim.id ? null : a))} />
            )}
          </div>

          {/* face-down deck: 3 offset backs + skip button below */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: CW + 10, height: CH + 8 }}>
              <div style={{ position: 'absolute', left: 10, top: 8 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 5, top: 4 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 0, top: 0 }}><CardBack w={CW} h={CH} /></div>
            </div>
            <button type="button" onClick={skip}
              disabled={phase !== 'playing' || flipping || busy || skips <= 0}
              title={`换一张（剩 ${skips} 次）`} style={{
                minWidth: 48, height: 36, borderRadius: RADIUS.pill,
                background: 'rgba(0,0,0,0.35)', color: COLORS.white,
                border: '1px solid rgba(255,255,255,0.35)',
                fontSize: 13, fontWeight: 900,
                cursor: phase === 'playing' && skips > 0 && !flipping && !busy ? 'pointer' : 'not-allowed',
                opacity: phase === 'playing' && skips > 0 ? 1 : 0.5,
              }}>⟲ {skips}</button>
          </div>
        </div>

        {/* ---- choice pills + static payout labels ---- */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: isMobile ? 12 : 26,
          position: 'relative', zIndex: 1, flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'center' }}>
            <button type="button" onClick={() => guess('low')} disabled={phase !== 'playing' || flipping || busy}
              style={choicePill(HILO.low, phase !== 'playing' || flipping || busy)}>⌄ LOW OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
              {round2(RTP / pLow(card ?? 9)).toFixed(2)}x
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button type="button" onClick={() => guess('high')} disabled={phase !== 'playing' || flipping || busy}
              style={choicePill(HILO.high, phase !== 'playing' || flipping || busy)}>⌃ HIGH OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
              {round2(RTP / pHigh(card ?? 9)).toFixed(2)}x
            </div>
          </div>
        </div>

        {/* ---- 可验证公平：显示本局的 commit hash / serverSeed（reveal 后），
             玩家可用 clientSeed/nonce/step 自行用 deriveCard 重算校验牌序未被篡改 ---- */}
        {proof && proof.serverSeedHash && (
          <div style={{
            textAlign: 'center', marginTop: 8, fontSize: 10, fontWeight: 600,
            color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', position: 'relative', zIndex: 1,
          }}>
            可验证 · hash: {(proof.serverSeedHash || '').slice(0, 16)}…{proof.nonce != null ? ` · nonce: ${proof.nonce}` : ''}
          </div>
        )}

        {toastMsg && (
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, padding: '6px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.65)', color: '#ff8a8a',
            fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
          }}>{toastMsg}</div>
        )}

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 14px',
          background: HILO.band,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              disabled={phase === 'playing'}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={phase === 'playing'} onClick={() => setBet(b => Math.max(1, b - 10))} style={{ ...circleBtn, opacity: phase === 'playing' ? 0.5 : 1, cursor: phase === 'playing' ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={phase === 'playing'} onClick={() => setBet(b => b + 10)} style={{ ...circleBtn, opacity: phase === 'playing' ? 0.5 : 1, cursor: phase === 'playing' ? 'not-allowed' : 'pointer' }}>+</button>
          {phase === 'playing' ? (
            <button type="button" onClick={cashOut} disabled={flipping || busy} style={{
              minWidth: isMobile ? 170 : 230, padding: '7px 0', borderRadius: RADIUS.pill,
              background: HILO.cashout, color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.3,
              cursor: flipping || busy ? 'not-allowed' : 'pointer', opacity: flipping || busy ? 0.6 : 1,
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span>CASHOUT</span>
              <span style={{ fontSize: 12, opacity: 0.92 }}>{round2(bet * cum).toFixed(2)} USD</span>
            </button>
          ) : (
            <button type="button" onClick={startGame} disabled={busy || bet > (serverBalance ?? 0) || bet < 1} style={{
              minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
              background: HILO.bet, color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 14, fontWeight: 900, letterSpacing: 1,
              cursor: busy || bet > (serverBalance ?? 0) || bet < 1 ? 'not-allowed' : 'pointer',
              opacity: busy || bet > (serverBalance ?? 0) || bet < 1 ? 0.55 : 1,
            }}>▷ BET</button>
          )}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Free Kick ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* history minis are 46px tall — row grows past 34px, still capped tight */}
            <div style={{ flex: '0 0 auto', minHeight: LAYOUT.historyH }}>
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
    <GameLayout title="Rating Hi-Lo" color={HILO.green}>
      {gameCard}
    </GameLayout>
  )
}
