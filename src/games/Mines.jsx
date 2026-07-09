import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, MINES } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import tackleBurstUrl from '../assets/shared/tackle_burst_sm.png'

// 单M2: Dribble gameplay — adjustable defenders, hypergeometric multipliers,
// RANDOM/Auto, settlement (Spribe Mines model).
//
// 服务器接后端：有状态多步会话（start/reveal/cashout 三接口）。雷位置由服务器
// serverSeed 派生，前端在 reveal/cashout 拿到终局结果前完全不知道雷在哪；
// 每一步都走后端行锁 + 事务，钱只认后端 balanceAfter，本地不再算一分钱。
//
// 倍数公式（超几何逐步累乘，前端仅用于预览，不参与结算，算法与后端 mines.js
// calcMultiplier 逐位一致）: 已翻 i 格后再翻一格安全的概率
//   P_i = (safe − i) / (25 − i)，safe = 25 − 铲球数。
//   步倍数 = RTP / P_i（RTP = 0.97），累乘 = Π RTP/P_i = 0.97^k / Π P_i。
//   内部全精度，显示才 round2。
const GRID = 25  // 5x5
const RTP = 0.97
const round2 = x => Math.round(x * 100) / 100
const genIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `mines-${Date.now()}-${Math.random()}`)

function calcMultiplier(gems, mines) {
  if (gems <= 0) return 1
  const safe = GRID - mines
  let m = 1
  for (let i = 0; i < gems; i++) m *= RTP * (GRID - i) / (safe - i)
  return m   // full precision
}

const MINE_COUNTS = Array.from({ length: 24 }, (_, i) => i + 1)   // Defenders 1–24

// white block-face football (opened-safe cell icon)
function Football({ size = 22, tone = '#ffffff', ink = '#3a2c00' }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={tone} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill={ink} />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill={ink} transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}
// pentagon-football line art — backdrop watermark (stroke = existing 0.18 black)
function BallLineArt({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block' }}>
      <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
      <polygon points="50,32 66,44 60,63 40,63 34,44" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
      <g stroke="rgba(0,0,0,0.18)" strokeWidth="2" fill="none">
        <line x1="50" y1="32" x2="50" y2="4" />
        <line x1="66" y1="44" x2="90" y2="34" />
        <line x1="60" y1="63" x2="74" y2="86" />
        <line x1="40" y1="63" x2="26" y2="86" />
        <line x1="34" y1="44" x2="10" y2="34" />
      </g>
    </svg>
  )
}

export default function Mines({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [mineCount, setMineCount] = useState(3)
  const [defOpen, setDefOpen] = useState(false)
  const [phase, setPhase] = useState('idle')  // idle | playing | done
  const [roundId, setRoundId] = useState(null)
  const [minesRevealed, setMinesRevealed] = useState(null)   // 雷位置：只有局结束后才知道
  const [revealed, setRevealed] = useState([])                // 已安全揭开的格
  const [exploded, setExploded] = useState(null)
  const [busy, setBusy] = useState(false)       // await 期间禁重复点
  const [autoOn, setAutoOn] = useState(false)
  const [roundHistory, setRoundHistory] = useState([])   // final mult per round, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [cashedOut, setCashedOut] = useState(false)
  const [proof, setProof] = useState(null)      // 最近一局：{ serverSeed, commitHash } 供玩家自行验证
  const [fairOpen, setFairOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [, setShaking] = useState(false)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  const audioRef = useRef({ ctx: null, muted: false })
  const shakeTimer = useRef(null)
  const toastTimer = useRef(null)

  const gems = revealed.length
  const currentMult = calcMultiplier(gems, mineCount)
  const nextMult = calcMultiplier(gems + 1, mineCount)

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  function pushToast(msg) {
    setToastMsg(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3000)
  }

  // ---------- audio (Web Audio synth) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playGem() {   // safe cell — crisp blip
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1280, t + 0.08)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.18)
  }
  function playTackle() {   // hit a mine — low thud + whistle
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.3)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
    const w = ctx.createOscillator(); const wg = ctx.createGain()
    w.type = 'sine'; w.frequency.setValueAtTime(1750, t); w.frequency.exponentialRampToValueAtTime(640, t + 0.42)
    wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.05, t + 0.02); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    w.connect(wg); wg.connect(ctx.destination); w.start(t); w.stop(t + 0.46)
  }
  function playCash() {   // cash out — rising ding
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }
  function playWin() {   // all cleared — celebration
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }

  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  function triggerShake() {
    setShaking(true)
    if (shakeTimer.current) clearTimeout(shakeTimer.current)
    shakeTimer.current = setTimeout(() => setShaking(false), 420)
  }

  // ---------- game (服务器权威：所有钱/雷位置以后端返回为准) ----------
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

  // 单局结束的收尾：写历史条 + 假 feed 结算（展示用），phase 置 done
  function finishRound(finalMult) {
    setRoundHistory(h => [round2(finalMult), ...h].slice(0, 20))
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setPhase('done')
  }

  async function startGame() {
    if (phase === 'playing' || busy || bet > (serverBalance ?? 0) || bet < 1) return
    ensureAudio()
    setBusy(true)
    try {
      const idempotencyKey = genIdemKey()
      const data = await apiPost('/round/mines/start', {
        amount: bet, mines: mineCount, idempotencyKey,
      })
      setRoundId(data.roundId)
      setServerBalance(Number(data.balanceAfter))
      setProof({ serverSeedHash: data.serverSeedHash, nonce: data.nonce })
      setFeedBets(makeFeedBots())   // fresh fake round rides along (display only)
      setRevealed([])
      setMinesRevealed(null)
      setExploded(null)
      setCashedOut(false)
      setPhase('playing')
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function revealCell(idx) {
    if (phase !== 'playing' || busy || revealed.includes(idx) || cashedOut) return
    setBusy(true)
    try {
      const data = await apiPost('/round/mines/reveal', { roundId, cell: idx })
      if (!data.safe) {
        // 踩雷：服务器此刻才 reveal 雷位置 + seed
        setExploded(idx)
        setMinesRevealed(data.mines)
        setRevealed(prev => [...new Set([...prev, idx, ...data.mines])])
        setProof(p => ({ ...p, serverSeedHash: data.serverSeedHash, nonce: data.nonce }))
        finishRound(0)
        playTackle()
        triggerShake()
      } else {
        const newRevealed = [...revealed, idx]
        setRevealed(newRevealed)
        if (data.cleared) {
          // 揭满全部安全格：自动结算赢，服务器同时 reveal 雷位置
          setMinesRevealed(data.mines)
          setRevealed(prev => [...new Set([...prev, ...data.mines])])
          setServerBalance(Number(data.balanceAfter))
          setProof(p => ({ ...p, serverSeedHash: data.serverSeedHash }))
          finishRound(data.mult)
          playWin()
        } else {
          playGem()
        }
      }
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function cashOut() {
    if (phase !== 'playing' || busy || cashedOut) return
    setBusy(true)
    try {
      const data = await apiPost('/round/mines/cashout', { roundId })
      setCashedOut(true)
      setMinesRevealed(data.mines)
      setRevealed(prev => [...new Set([...prev, ...data.mines])])
      setServerBalance(Number(data.balanceAfter))
      setProof(p => ({ ...p, serverSeedHash: data.serverSeedHash, nonce: data.nonce }))
      finishRound(data.mult)
      playCash()
    } catch (err) {
      pushToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  function randomPick() {   // 随机点一个未翻格
    if (phase !== 'playing' || busy || cashedOut) return
    const candidates = Array.from({ length: GRID }, (_, i) => i).filter(i => !revealed.includes(i))
    if (candidates.length) revealCell(candidates[Math.floor(Math.random() * candidates.length)])
  }

  // Auto Game: one random step every 600ms until bust / clear / toggled off
  useEffect(() => {
    if (!autoOn || phase !== 'playing' || busy) return
    const id = setTimeout(() => {
      const candidates = Array.from({ length: GRID }, (_, i) => i).filter(i => !revealed.includes(i))
      if (candidates.length) revealCell(candidates[Math.floor(Math.random() * candidates.length)])
    }, 600)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, phase, revealed, busy])

  // ---------- visual layer (Spribe Mines 1:1, pitch green) ----------
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: MINES.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const cellStyle = kind => ({
    aspectRatio: '1 / 1', width: '100%', boxSizing: 'border-box',
    borderRadius: 8, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'default',
    ...(kind === 'gold' ? {
      background: `linear-gradient(180deg, ${MINES.goldTop}, ${MINES.goldBot})`,
      border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    } : kind === 'boom' ? {
      background: MINES.red,
      border: '1px solid rgba(0,0,0,0.3)',
    } : kind === 'tackle' ? {
      background: MINES.tackleDark,
      border: `1px solid ${MINES.cellBorder}`,
    } : {
      background: `linear-gradient(180deg, ${MINES.cellTop}, ${MINES.cellBot})`,
      border: `1px solid ${MINES.cellBorder}`,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
    }),
  })

  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the

  // Turf-sheen backdrop (方案C): a skewed light band sweeps the card, the
  // football line-art watermarks slowly roll + drift (near big, far small),
  // the tactics rings stay put with a gentle opacity breath. Line color is
  // the existing watermark rgba(0,0,0,0.18); layer depth via wrapper opacity.
  const pitchGlow = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes mnSweep {
          from { transform: skewX(-18deg) translateX(-40%); }
          to   { transform: skewX(-18deg) translateX(360%); }
        }
        @keyframes mnSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes mnDrift {
          0%   { transform: translate(0px, 0px); }
          50%  { transform: translate(14px, -10px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes mnRingBreath { 0% { opacity: 0.55; } 50% { opacity: 1; } 100% { opacity: 0.55; } }
        @media (prefers-reduced-motion: reduce) {
          .mnAnim { animation: none !important; }
        }
      `}</style>
      {/* sweeping turf sheen — one full pass every 11s, uniform speed */}
      <div className="mnAnim" style={{
        position: 'absolute', top: '-20%', left: 0, width: '42%', height: '140%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)',
        animation: 'mnSweep 11s linear infinite',
      }} />
      {/* rolling football line-art watermarks */}
      {[
        { size: 290, pos: { left: -120, top: '34%' },   op: 1,    spin: '75s', dur: '15s', del: '0s' },
        { size: 170, pos: { right: '5%', top: '5%' },   op: 0.75, spin: '90s', dur: '13s', del: '-4s' },
        { size: 110, pos: { left: '16%', bottom: '9%' }, op: 0.55, spin: '62s', dur: '17s', del: '-9s' },
      ].map((b, i) => (
        <div key={i} style={{ position: 'absolute', ...b.pos, opacity: b.op }}>
          <div className="mnAnim" style={{ animation: `mnDrift ${b.dur} ease-in-out infinite`, animationDelay: b.del }}>
            <div className="mnAnim" style={{ animation: `mnSpin ${b.spin} linear infinite` }}>
              <BallLineArt size={b.size} />
            </div>
          </div>
        </div>
      ))}
      {/* tactics-board rings — static position, opacity breath only */}
      <svg className="mnAnim" width="260" height="260" viewBox="0 0 100 100" style={{
        position: 'absolute', right: -100, top: '40%',
        animation: 'mnRingBreath 12s ease-in-out infinite',
      }}>
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        <circle cx="50" cy="50" r="4" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        <line x1="4" y1="50" x2="96" y2="50" stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
      </svg>
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 42% 30%, ${MINES.bgCenter}, ${MINES.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {pitchGlow}

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar gameName="DRIBBLE" band={MINES.band} onBack={onBack} onFairness={() => setFairOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue="DRIBBLE" playerToken={playerToken} game="mines" />

        {/* ---- middle zone: flexes to fill the card, keeps the grid group as
             the vertical visual center; leftover space is absorbed here ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '12px 12px' : '14px 18px', boxSizing: 'border-box',
        }}>

        {toastMsg && (
          <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, padding: '6px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.65)', color: '#ff8a8a',
            fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
          }}>{toastMsg}</div>
        )}

        {/* ---- second row: Defenders selector + Next + progress strip ---- */}
        <div style={{ width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto 10px', position: 'relative', zIndex: 3 }}>
          <div style={{
            background: MINES.strip, borderRadius: RADIUS.pill,
            padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box',
          }}>
            <span style={{ position: 'relative', flex: '0 0 auto' }}>
              <button type="button"
                onClick={() => { if (phase !== 'playing') setDefOpen(v => !v) }}
                style={{
                  padding: '3px 18px', borderRadius: RADIUS.pill,
                  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
                  color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                  cursor: phase === 'playing' ? 'not-allowed' : 'pointer',
                  opacity: phase === 'playing' ? 0.6 : 1,
                }}>Defenders: {mineCount} ▾</button>
              {defOpen && (
                <span style={{
                  position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 6,
                  display: 'flex', flexWrap: 'wrap', gap: 4, padding: 6, width: 208,
                  background: MINES.band, border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
                }}>
                  {MINE_COUNTS.map(n => (
                    <button key={n} type="button"
                      onClick={() => { setMineCount(n); setDefOpen(false) }}
                      style={{
                        width: 28, height: 24, borderRadius: 5,
                        background: n === mineCount ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                        border: '1px solid rgba(255,255,255,0.25)',
                        color: COLORS.white, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                      }}>{n}</button>
                  ))}
                </span>
              )}
            </span>
            <span style={{
              marginLeft: 'auto', padding: '3px 14px', borderRadius: RADIUS.pill,
              background: MINES.next, color: '#3a2c00',
              fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
            }}>Next: {round2(nextMult).toFixed(2)}x</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: MINES.progressTrack, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: `${(gems / (GRID - mineCount)) * 100}%`, height: '100%', background: MINES.progress, transition: 'width 0.2s' }} />
          </div>
        </div>

        {/* ---- main 5×5 grid ---- */}
        <div style={{
          width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto 10px',
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
          position: 'relative', zIndex: 1,
        }}>
          {Array.from({ length: GRID }).map((_, i) => {
            const isRev = revealed.includes(i)
            const isMine = minesRevealed?.includes(i) ?? false
            const kind = isRev ? (isMine ? (i === exploded ? 'boom' : 'tackle') : 'gold') : 'hidden'
            const clickable = phase === 'playing' && !isRev && !cashedOut && !busy
            return (
              <button key={i} type="button" disabled={!clickable}
                onClick={() => clickable && revealCell(i)}
                style={{ ...cellStyle(kind), cursor: clickable ? 'pointer' : 'default' }}>
                {kind === 'gold' && <Football size={isMobile ? 22 : 30} />}
                {kind === 'boom' && <img src={tackleBurstUrl} alt="" draggable={false} style={{
                  height: isMobile ? 22 : 30, width: 'auto', pointerEvents: 'none', display: 'block',
                }} />}
                {kind === 'tackle' && <img src={tackleBurstUrl} alt="" draggable={false} style={{
                  height: isMobile ? 20 : 26, width: 'auto', opacity: 0.5, pointerEvents: 'none', display: 'block',
                }} />}
                {kind === 'hidden' && <span style={{ width: 12, height: 12, borderRadius: '50%', background: MINES.dot }} />}
              </button>
            )
          })}
        </div>

        {/* ---- RANDOM / refresh / Auto Game row ---- */}
        <div style={{
          width: isMobile ? '100%' : 420, maxWidth: '100%', margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          position: 'relative', zIndex: 1,
        }}>
          <button type="button" disabled={phase !== 'playing' || busy} onClick={randomPick} style={{
            flex: 1, maxWidth: 200, padding: '7px 0', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.55)',
            color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 1,
            cursor: phase === 'playing' && !busy ? 'pointer' : 'not-allowed',
            opacity: phase === 'playing' && !busy ? 1 : 0.6,
          }}>RANDOM</button>
          <button type="button" disabled={phase !== 'playing' || busy} onClick={randomPick} style={{
            width: 32, height: 32, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.4)',
            color: COLORS.white, fontSize: 14, fontWeight: 900,
            cursor: phase === 'playing' && !busy ? 'pointer' : 'not-allowed',
            opacity: phase === 'playing' && !busy ? 1 : 0.6,
          }}>⟳</button>
          <button type="button" onClick={() => setAutoOn(v => !v)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px 5px 6px', borderRadius: RADIUS.pill,
            background: MINES.strip, border: 'none', cursor: 'pointer',
          }}>
            <span style={{
              width: 34, height: 18, borderRadius: RADIUS.pill,
              background: autoOn ? MINES.progress : 'rgba(255,255,255,0.25)',
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

        {/* ---- 可验证公平：显示上一局的 serverSeed + commit hash，玩家可用
             clientSeed/nonce/serverSeed 自行重算校验雷位置未被篡改 ---- */}
        {proof && proof.serverSeedHash && (
          <div style={{
            textAlign: 'center', marginTop: 8, fontSize: 10, fontWeight: 600,
            color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', position: 'relative', zIndex: 1,
          }}>
            可验证 · hash: {(proof.serverSeedHash || '').slice(0, 16)}…{proof.nonce != null ? ` · nonce: ${proof.nonce}` : ''}
          </div>
        )}

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 14px',
          background: MINES.band,
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
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: MINES.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          {phase === 'playing' ? (
            <button type="button" disabled={busy} onClick={cashOut} style={{
              minWidth: isMobile ? 170 : 230, padding: '7px 0', borderRadius: RADIUS.pill,
              background: MINES.cash, color: '#3a2c00',
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.3,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span>CASH OUT</span>
              <span style={{ fontSize: 12, opacity: 0.9 }}>{round2(bet * currentMult).toFixed(2)} USD</span>
            </button>
          ) : (
            <button type="button" onClick={startGame} disabled={busy || bet > (serverBalance ?? 0) || bet < 1} style={{
              minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
              background: '#4a9b16', color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 14, fontWeight: 900, letterSpacing: 1,
              cursor: busy || bet > (serverBalance ?? 0) || bet < 1 ? 'not-allowed' : 'pointer',
              opacity: busy || bet > (serverBalance ?? 0) || bet < 1 ? 0.55 : 1,
            }}>▷ BET</button>
          )}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Goal ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Dribble</strong>
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
    <GameLayout title="Dribble" color={MINES.progress}>
      {gameCard}
    </GameLayout>
  )
}
