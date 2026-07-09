import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOAL } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots, createArenaFx, drawArenaFx } from '../components/shell/arenaFx'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import ballUrl from '../assets/covers/ball-3d.png'
import tackleBurstUrl from '../assets/shared/tackle_burst_sm.png'
import { useSfxMuted } from '../components/shell/bgmManager'

// 单G2: Goal gameplay — Field tiers, column-by-column advance, bomb bust,
// Auto Game.
//
// 赔率推导（禁拍脑袋）: 7 列 × 4 行。Field 档位 = 每列炸弹数 n:
//   ▪ n=1 → P(safe)=3/4    ▪▪ n=2 → P(safe)=2/4    ▪▪▪ n=3 → P(safe)=1/4
//   每步倍数 = RTP / P(safe)（RTP = 0.97）→ 1.2933 / 1.94 / 3.88，
//   安全推进一列即累乘（内部全精度，显示才 round2）。
//   炸弹行在点击时对该列均匀抽取（Fisher-Yates 前 n 个），与结算同一映射。
const RTP = 0.97
const COLS = 7
const ROWS = 4
const TIERS = { sm: { label: '▪', bombs: 1 }, md: { label: '▪▪', bombs: 2 }, lg: { label: '▪▪▪', bombs: 3 } }
const stepMult = tier => RTP / ((ROWS - TIERS[tier].bombs) / ROWS)   // 仅用于「下一列倍数」展示；真 cum 以后端为准
const genIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `goal-${Date.now()}-${Math.random()}`)
const round2 = x => Math.round(x * 100) / 100

// 本地随机挑一行（仅 AUTO / RANDOM 用来"替玩家点哪一格"，雷位仍由后端判定）
const randomRow = () => Math.floor(Math.random() * ROWS)

export default function Goal({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()

  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')      // idle | playing | done
  const [tier, setTier] = useState('md')
  const [tierOpen, setTierOpen] = useState(false)
  const [picks, setPicks] = useState([])          // picked row per completed column
  const [bustInfo, setBustInfo] = useState(null)  // { col, bombs, picked }
  const [cum, setCum] = useState(1)               // display copy of running product（以后端 cum 为准）
  const [revealing, setRevealing] = useState(false)
  const [autoOn, setAutoOn] = useState(false)
  const [roundHistory, setRoundHistory] = useState([])   // final mult per round, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [, setRoundId] = useState(null)   // 后端本局 id（走 ref 用）
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）

  const phaseRef = useRef('idle')
  const tierRef = useRef('md')
  const picksRef = useRef([])
  const cumRef = useRef(1)
  const revealingRef = useRef(false)
  const autoRef = useRef(false)
  const roundIdRef = useRef(null)
  const busyRef = useRef(false)
  const audioRef = useRef({ ctx: null, muted: false })
  const timersRef = useRef([])
  const fxCanvasRef = useRef(null)   // arenaFx backdrop — pure decoration
  const fxRef = useRef(null)

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // arenaFx backdrop — same engine as Breakaway, mounted read-only in idle
  // mode (no params added to arenaFx.js). One rAF loop, canvas sized to the
  // card; prefers-reduced-motion renders a single static frame instead.
  useEffect(() => {
    const canvas = fxCanvasRef.current
    if (!canvas) return
    if (fxRef.current === null) fxRef.current = createArenaFx()
    const drawFrame = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(1, Math.floor(rect.width * dpr))
      const H = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      drawArenaFx(ctx, fxRef.current, { W, H, dpr, now: performance.now(), mode: 'idle', mult: 1 })
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      drawFrame()   // static backdrop, engine stays off
      return
    }
    let raf
    const loop = () => { drawFrame(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

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
  function playRun() {   // 揭格唰
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
  function playPass() {   // 安全欢呼短音
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
  function playTackle() {   // 爆炸
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
  function playCash() {   // 兑现收金
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.26 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  }
  function playWin() {   // 通关
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }

  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- flow（服务器权威：雷位/累乘/派彩全走后端；余额只认 balanceAfter）----------
  async function apiPost(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${playerToken}` },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) { const e = new Error(data?.error || '请求失败，请重试'); e.data = data; throw e }
    return data
  }

  // 单局收尾：历史条 + 假 feed 结算（展示用），phase 置 done
  function finishRound(finalMult) {
    setRoundHistory(h => [round2(finalMult), ...h].slice(0, 20))
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    phaseRef.current = 'done'; setPhase('done')
  }

  async function start() {
    if (phaseRef.current === 'playing' || busyRef.current || bet < 1 || (serverBalance != null && bet > serverBalance)) return
    busyRef.current = true
    ensureAudio(); setNetErr(null)
    setFeedBets(makeFeedBots())
    let data
    try {
      data = await apiPost('/round/goal/start', { amount: bet, tier: tierRef.current, idempotencyKey: genIdemKey() })
    } catch (e) { setNetErr(e.message); busyRef.current = false; return }
    roundIdRef.current = data.roundId; setRoundId(data.roundId)
    if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))   // 余额只认后端
    picksRef.current = []; setPicks([])
    cumRef.current = 1; setCum(1)
    setBustInfo(null)
    revealingRef.current = false; setRevealing(false)
    phaseRef.current = 'playing'; setPhase('playing')
    busyRef.current = false
    if (autoRef.current) later(autoStep, 450)
  }

  async function pickCell(row) {
    if (phaseRef.current !== 'playing' || revealingRef.current || busyRef.current) return
    busyRef.current = true
    revealingRef.current = true; setRevealing(true)
    playRun()
    let data
    try {
      data = await apiPost('/round/goal/pick', { roundId: roundIdRef.current, row })
    } catch (e) {
      revealingRef.current = false; setRevealing(false); busyRef.current = false
      setNetErr(e.message); return
    }
    // 短暂揭示动画（视觉保留，结果数据来自后端）
    await new Promise(r => setTimeout(r, 320))
    revealingRef.current = false; setRevealing(false); busyRef.current = false

    if (data.safe === false) {
      // 踩雷终局：后端返回本列雷行
      setBustInfo({ col: data.col, bombs: data.bombs || [], picked: row })
      finishRound(0)
      playTackle()
    } else {
      cumRef.current = data.cum; setCum(data.cum)
      const np = [...picksRef.current, row]; picksRef.current = np; setPicks(np)
      if (data.cleared) {
        // 走满 7 列自动结算（后端已钳制 payout + 记 balanceAfter）
        if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))
        finishRound(data.cum)
        playWin()
      } else {
        playPass()
        if (autoRef.current) later(autoStep, 600)
      }
    }
  }

  function autoStep() {
    if (phaseRef.current !== 'playing' || revealingRef.current || !autoRef.current) return
    pickCell(randomRow())
  }

  function randomPick() {   // RANDOM = 当前列随机点一格
    if (phaseRef.current !== 'playing' || revealingRef.current) return
    pickCell(randomRow())
  }

  function toggleAuto() {
    const next = !autoRef.current
    autoRef.current = next; setAutoOn(next)
    if (next && phaseRef.current === 'playing' && !revealingRef.current) later(autoStep, 300)
  }

  async function cashOut() {
    if (phaseRef.current !== 'playing' || revealingRef.current || busyRef.current) return
    busyRef.current = true
    let data
    try { data = await apiPost('/round/goal/cashout', { roundId: roundIdRef.current }) }
    catch (e) { setNetErr(e.message); busyRef.current = false; return }
    if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))   // 余额只认后端
    cumRef.current = data.cum; setCum(data.cum)
    finishRound(data.cum)
    playCash()
    busyRef.current = false
  }

  function switchTier(t) {   // 局中锁
    if (phaseRef.current === 'playing') return
    tierRef.current = t; setTier(t)
    setTierOpen(false)
  }

  // ---------- visual layer (Spribe Goal 1:1) ----------
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: GOAL.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const playing = phase === 'playing'
  const curCol = picks.length
  const cellFace = (white, clickable) => ({
    borderRadius: 6, padding: 0,
    background: white
      ? `linear-gradient(180deg, ${GOAL.cellWhiteTop}, ${GOAL.cellWhiteBot})`
      : `linear-gradient(180deg, ${GOAL.cellTop}, ${GOAL.cellBot})`,
    border: '1px solid rgba(0,0,0,0.18)',
    aspectRatio: '82 / 70', width: '100%', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: clickable ? 'pointer' : 'default',
  })
  const nextMult = round2(cum * stepMult(tier))
  const cashable = round2(bet * cum)
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the

  // Darkened arena floor — derived in place from the GOAL felt greens
  // (bgCenter #4a7a1a / bgOuter #1c3a06) so the arenaFx star field reads.
  const BG_CENTER_DIM = '#2e4d10'
  const BG_OUTER_DIM = '#101f04'

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 22%, ${BG_CENTER_DIM}, ${BG_OUTER_DIM})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {/* arenaFx star-drift backdrop — decoration only, below all content */}
        <canvas ref={fxCanvasRef} aria-hidden style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          zIndex: 0, pointerEvents: 'none',
        }} />

        {/* left giant football line art */}
        <svg width="300" height="300" viewBox="0 0 100 100" style={{ position: 'absolute', left: -120, top: '38%', pointerEvents: 'none' }}>
          <circle cx="50" cy="50" r="48" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <polygon points="50,32 66,44 60,63 40,63 34,44" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <g stroke={GOAL.line} strokeWidth="2" fill="none">
            <line x1="50" y1="32" x2="50" y2="4" />
            <line x1="66" y1="44" x2="90" y2="34" />
            <line x1="60" y1="63" x2="74" y2="86" />
            <line x1="40" y1="63" x2="26" y2="86" />
            <line x1="34" y1="44" x2="10" y2="34" />
          </g>
        </svg>
        {/* right half-pitch line art */}
        <svg width="260" height="380" viewBox="0 0 130 190" style={{ position: 'absolute', right: -90, top: '18%', pointerEvents: 'none' }}>
          <rect x="30" y="5" width="130" height="180" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <rect x="30" y="45" width="46" height="100" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <rect x="30" y="75" width="18" height="40" fill="none" stroke={GOAL.line} strokeWidth="2" />
          <path d="M76 75 A 22 22 0 0 1 76 115" fill="none" stroke={GOAL.line} strokeWidth="2" />
        </svg>

        {/* ---- top bar（共享件；特有件：即时兑现指示 pill 经 rightExtra 原样传）---- */}
        <GameTopBar gameName="GOAL" band={GOAL.band} onBack={onBack} onFairness={() => setFairOpen(true)} rightExtra={
          <span style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: GOAL.win, color: '#083a1b',
            fontSize: 11, fontWeight: 900, opacity: playing ? 1 : 0.55,
            flex: '0 0 auto',
          }}>+{(playing ? cashable : 0).toFixed(2)} USD</span>
        } />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue="GOAL" playerToken={playerToken} game="goal" />

        {/* ---- middle zone: flexes to fill the card, keeps the grid group as
             the vertical visual center; leftover space is absorbed here ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '12px 12px' : '14px 18px', boxSizing: 'border-box',
        }}>

        {/* ---- second row: Field selector + Next multiplier ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto 10px',
          background: GOAL.strip, borderRadius: RADIUS.pill,
          padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 8,
          position: 'relative', zIndex: 3, boxSizing: 'border-box',
        }}>
          <span style={{ position: 'relative', flex: '0 0 auto' }}>
            <button type="button"
              onClick={() => { if (!playing) setTierOpen(v => !v) }}
              style={{
                padding: '3px 18px', borderRadius: RADIUS.pill,
                background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
                color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                cursor: playing ? 'not-allowed' : 'pointer', opacity: playing ? 0.6 : 1,
              }}>Field: {TIERS[tier].label} ▾</button>
            {tierOpen && (
              <span style={{
                position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 6,
                display: 'flex', gap: 4, padding: 6,
                background: GOAL.band, border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
              }}>
                {Object.keys(TIERS).map(t => (
                  <button key={t} type="button" onClick={() => switchTier(t)}
                    style={{
                      minWidth: 42, height: 26, borderRadius: 6,
                      background: t === tier ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: COLORS.white, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}>{TIERS[t].label}</button>
                ))}
              </span>
            )}
          </span>
          <span style={{
            marginLeft: 'auto', padding: '3px 14px', borderRadius: RADIUS.pill,
            background: GOAL.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>Next: {nextMult.toFixed(2)}x</span>
        </div>

        {/* ---- main 7×4 grid ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto 10px',
          display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 6,
          position: 'relative', zIndex: 1,
        }}>
          {Array.from({ length: ROWS }).map((_, r) => (
            Array.from({ length: COLS }).map((_, c) => {
              const isBustCol = bustInfo && bustInfo.col === c
              const done = c < curCol
              const isCurrent = playing && !bustInfo && c === curCol
              const clickable = isCurrent && !revealing
              let content = null
              if (done) {
                if (picks[c] === r) {
                  content = (c === curCol - 1 && !bustInfo)
                    ? <img src={ballUrl} alt="" draggable={false} style={{
                        width: isMobile ? 22 : 30, height: isMobile ? 22 : 30,
                        pointerEvents: 'none', display: 'block',
                      }} />
                    : <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
                }
              } else if (isBustCol) {
                // tackle burst = tackled; the picked cell shows it full-strength,
                // other bomb cells dimmed
                if (bustInfo.picked === r) content = <img src={tackleBurstUrl} alt="" draggable={false} style={{
                  height: isMobile ? 24 : 32, width: 'auto', pointerEvents: 'none', display: 'block',
                }} />
                else if (bustInfo.bombs.includes(r)) content = <img src={tackleBurstUrl} alt="" draggable={false} style={{
                  height: isMobile ? 20 : 26, width: 'auto', opacity: 0.55, pointerEvents: 'none', display: 'block',
                }} />
              }
              return (
                <button key={`${r}-${c}`} type="button"
                  disabled={!clickable}
                  onClick={() => clickable && pickCell(r)}
                  style={cellFace(isCurrent, clickable)}
                >{content}</button>
              )
            })
          ))}
        </div>

        {/* ---- RANDOM / refresh / Auto Game row ---- */}
        <div style={{
          width: isMobile ? '100%' : 640, maxWidth: '100%', margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          position: 'relative', zIndex: 1,
        }}>
          <button type="button" disabled={!playing || revealing} onClick={randomPick} style={{
            flex: 1, maxWidth: 260, padding: '7px 0', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.55)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 1,
            cursor: playing && !revealing ? 'pointer' : 'not-allowed',
            opacity: playing ? 1 : 0.6,
          }}>RANDOM</button>
          <button type="button" disabled={!playing || revealing} onClick={randomPick} style={{
            width: 32, height: 32, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)',
            color: COLORS.white, fontSize: 14, fontWeight: 900,
            cursor: playing && !revealing ? 'pointer' : 'not-allowed',
            opacity: playing ? 1 : 0.6,
          }}>⟳</button>
          <button type="button" onClick={toggleAuto} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px 5px 6px', borderRadius: RADIUS.pill,
            background: GOAL.strip, border: 'none', cursor: 'pointer',
          }}>
            <span style={{
              width: 34, height: 18, borderRadius: RADIUS.pill,
              background: autoOn ? GOAL.win : 'rgba(255,255,255,0.25)',
              position: 'relative', display: 'inline-block', transition: 'background 0.15s',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: autoOn ? 18 : 2, width: 14, height: 14,
                borderRadius: '50%', background: autoOn ? '#083a1b' : '#9aa7b0', transition: 'left 0.15s',
              }} />
            </span>
            <span style={{ color: autoOn ? COLORS.white : 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: 800 }}>Auto Game</span>
          </button>
        </div>

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 14px',
          background: GOAL.band,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
            opacity: playing ? 0.6 : 1,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              disabled={playing}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={playing} onClick={() => setBet(b => Math.max(1, b - 10))} style={{ ...circleBtn, opacity: playing ? 0.5 : 1, cursor: playing ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={playing} onClick={() => setBet(b => b + 10)} style={{ ...circleBtn, opacity: playing ? 0.5 : 1, cursor: playing ? 'not-allowed' : 'pointer' }}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: GOAL.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          {playing ? (
            <button type="button" onClick={cashOut} disabled={revealing} style={{
              minWidth: isMobile ? 170 : 230, padding: '7px 0', borderRadius: RADIUS.pill,
              background: '#d63b10', color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.3,
              cursor: revealing ? 'not-allowed' : 'pointer', opacity: revealing ? 0.6 : 1,
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span>CASHOUT</span>
              <span style={{ fontSize: 12, opacity: 0.92 }}>{cashable.toFixed(2)} USD</span>
            </button>
          ) : (
            <button type="button" onClick={start} disabled={bet < 1 || (serverBalance != null && bet > serverBalance)} style={{
              minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
              background: GOAL.bet, color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 14, fontWeight: 900, letterSpacing: 1,
              cursor: (bet < 1 || (serverBalance != null && bet > serverBalance)) ? "not-allowed" : "pointer",
              opacity: (bet < 1 || (serverBalance != null && bet > serverBalance)) ? 0.55 : 1,
            }}>▷ BET</button>
          )}
          {netErr && (
            <div style={{
              marginTop: 8, color: '#ff8a9a', fontSize: 12, fontWeight: 700, textAlign: 'center',
            }}>{netErr}</div>
          )}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Rating Hi-Lo ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Goal</strong>
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
    <GameLayout title="Goal" color={GOAL.win}>
      {gameCard}
    </GameLayout>
  )
}
