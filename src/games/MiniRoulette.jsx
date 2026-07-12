import { useEffect, useRef, useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT, ROULETTE } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'

const G = GAME_BY_ID['MiniRoulette']

// Team Roulette — full bet/spin/settle round on the Spribe-replica board.
// Standard 12-number mini-roulette paytable:
//   single number 11.4× · red/black 1.9× · odd/even 1.9× · 1-6 / 7-12 1.9×
// (payout credited = stake × multiplier; stake was deducted at placement)

const playerGlob = import.meta.glob('../assets/roulette/player_*.png', { eager: true, import: 'default' })
const PLAYER = Object.keys(playerGlob).sort().map(k => playerGlob[k])

const CX = 150, CY = 150, R = 130
const WHEEL_ORDER = [11, 1, 9, 5, 4, 10, 6, 12, 2, 8, 7, 3]
const RED_SET = new Set([1, 3, 5, 8, 10, 12])
const ROW_EVEN = [2, 4, 6, 8, 10, 12]
const ROW_ODD = [1, 3, 5, 7, 9, 11]
const OUTSIDE = [
  { key: 'low', label: '1-6' },
  { key: 'even', label: 'Even' },
  { key: 'black', label: 'black' },
  { key: 'red', label: 'red' },
  { key: 'odd', label: 'Odd' },
  { key: 'high', label: '7-12' },
]
const CHIPS = [
  { label: '1', value: 1, color: ROULETTE.chipGrey },
  { label: '10', value: 10, color: ROULETTE.chipRed },
  { label: '50', value: 50, color: ROULETTE.chipBlue },
  { label: '100', value: 100, color: ROULETTE.chipGreen },
  { label: '500', value: 500, color: ROULETTE.chipBlack },
  { label: '1K', value: 1000, color: ROULETTE.chipPurple },
]
const SPIN_MS = 3500
const SINGLE_MULT = 11.4
const OUTSIDE_MULT = 1.9

const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '迷你球队轮盘只有 1–12 共 12 个号，每个号对应一位王牌球星。下注截止后转盘旋转，最终开出唯一 1 个中奖号，命中你所押盘口即赢。每盘独立开奖，上盘不影响下盘。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 单号：直接押 1–12 中的某个号，命中赔 11.4 倍。\n· 红 / 黑：红队与黑队是固定分组，不等于奇偶——红号 = {1,3,5,8,10,12}，黑号 = 其余 {2,4,6,7,9,11}，命中赔 1.9 倍。\n· 单 / 双（奇偶）：按号码本身奇偶判定，命中赔 1.9 倍。\n· 半区 1-6 / 7-12：开出号落在所押半区即中，赔 1.9 倍。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，再点号码或盘口格下注，可同时押多个号、多个盘口。下注即扣本金。开出号后逐个盘口结算，命中派彩 = 本金 × 该盘口倍数，直接入余额。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想搏大赔押单号（11.4×，命中率 1/12）；想中奖率高押红黑 / 单双 / 半区（约一半，1.9×）。\n· 记牢红黑是固定集合而非奇偶：红={1,3,5,8,10,12}，别把红当奇数。\n· 可多号多盘口组合下注分散风险，理性游戏、量力而行。',
  },
]

const rad = d => (d * Math.PI) / 180
function sectorPath(i, r = R) {
  const a1 = rad(-90 + i * 30), a2 = rad(-90 + (i + 1) * 30)
  const x1 = (CX + r * Math.cos(a1)).toFixed(1), y1 = (CY + r * Math.sin(a1)).toFixed(1)
  const x2 = (CX + r * Math.cos(a2)).toFixed(1), y2 = (CY + r * Math.sin(a2)).toFixed(1)
  return `M${CX},${CY} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`
}
const numColor = n => (RED_SET.has(n) ? ROULETTE.red : ROULETTE.black)
const gloss = base => `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.36), rgba(255,255,255,0) 45%), ${base}`

// The single source of truth tying a result number to a wheel stop position:
// rotating the wheel by -(sector center angle) brings that sector to the
// 12 o'clock pointer where the golden ball rests.
const sectorCenterDeg = n => WHEEL_ORDER.indexOf(n) * 30 + 15

// cubic-bezier(0.15,0.55,0.25,1) inversion — keeps the tick schedule in sync
// with the CSS spin transition (same helper family as Penalty Wheel).
function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = t => ((ax * t + bx) * t + cx) * t
  const sy = t => ((ay * t + by) * t + cy) * t
  const dx = t => (3 * ax * t + 2 * bx) * t + cx
  return x => { let t = x; for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-4 || d === 0) break; t -= e / d } return sy(t) }
}
const EASE = makeBezier(0.15, 0.55, 0.25, 1)
function timeForProgress(y) {
  let lo = 0, hi = 1
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (EASE(m) < y) lo = m; else hi = m }
  return (lo + hi) / 2
}

export default function MiniRoulette({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [hoverNum, setHoverNum] = useState(null)
  const [chip, setChip] = useState('10')
  const [bets, setBets] = useState({})           // key → staked amount
  const [betStack, setBetStack] = useState([])   // placement order, for Back
  const [lastBets, setLastBets] = useState(null) // previous round, for Rebet
  const [spinning, setSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [winKeys, setWinKeys] = useState(null)   // Set — winning cells highlight
  const [draws, setDraws] = useState([])         // real draw history
  const [toasts, setToasts] = useState([])
  const [note, setNote] = useState('')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉

  const balanceRef = useRef(serverBalance)
  const betsRef = useRef(bets)
  const pendingDataRef = useRef(null)   // 后端 /roulette/play 返回（settle 时消费）
  const busyRef = useRef(false)
  const timersRef = useRef([])
  const tickTimersRef = useRef([])
  const toastIdRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { balanceRef.current = serverBalance }, [serverBalance])
  useEffect(() => { betsRef.current = bets }, [bets])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout)
    tickTimersRef.current.forEach(clearTimeout)
  }, [])
  const later = (fn, ms) => { timersRef.current.push(setTimeout(fn, ms)) }

  // ---------- SFX (Web Audio synth, 🔊-gated) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx
    return ctx
  }
  function playChip() {   // placing / undoing / clearing a bet — short chip clack
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 540 + Math.random() * 220
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06)
  }
  function playTick() {   // ball click while the wheel decelerates
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 900 + Math.random() * 250
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.035)
  }
  function playLand() {   // ball settles into the pocket
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.14)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
  }
  function playWin() {   // rising chime, same frame as the gold highlight
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s)
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.28)
    })
  }
  // ticks per 30° crossing, spaced by the same bezier as the CSS transition
  function scheduleTicks(baseRot, delta) {
    tickTimersRef.current.forEach(clearTimeout)
    tickTimersRef.current = []
    const startK = Math.ceil(baseRot / 30)
    const endK = Math.floor((baseRot + delta) / 30)
    for (let k = startK; k <= endK; k++) {
      const y = (k * 30 - baseRot) / delta
      const tms = timeForProgress(y) * SPIN_MS
      tickTimersRef.current.push(setTimeout(playTick, tms))
    }
    tickTimersRef.current.push(setTimeout(playLand, SPIN_MS - 30))
  }

  // 服务器权威：钱只在「转」那一刻走后端（POST /roulette/play 一次扣总注额 + 结算派彩）。
  // 放/撤/清/复用注只在本地【暂存】bets map，不动余额；可下注额 = serverBalance − totalBet。

  const chipValue = CHIPS.find(c => c.label === chip).value
  const totalBet = Object.values(bets).reduce((a, b) => a + b, 0)

  function placeBet(key) {
    if (spinning || busyRef.current) return
    // 暂存注不扣钱，但已暂存总额 + 本次筹码不能超过后端余额
    if (serverBalance != null && chipValue > serverBalance - totalBet) { setNote('余额不足，无法下注'); return }
    setNote('')
    setBets(b => ({ ...b, [key]: Number(((b[key] || 0) + chipValue).toFixed(2)) }))
    setBetStack(s => [...s, { key, amount: chipValue }])
    playChip()
  }

  function undoBet() {
    if (spinning || !betStack.length) return
    const last = betStack[betStack.length - 1]
    setBetStack(s => s.slice(0, -1))
    setBets(b => {
      const next = { ...b, [last.key]: Number((b[last.key] - last.amount).toFixed(2)) }
      if (next[last.key] <= 0) delete next[last.key]
      return next
    })
    setNote('')
    playChip()
  }

  function clearBets() {
    if (spinning || !totalBet) return
    setBets({})
    setBetStack([])
    setNote('')
    playChip()
  }

  function rebet() {
    if (spinning || !lastBets) return
    const entries = Object.entries(lastBets)
    const total = entries.reduce((a, [, v]) => a + v, 0)
    if (serverBalance != null && total > serverBalance) { setNote('余额不足，无法复用上局注单'); return }
    setBets({ ...lastBets })
    setBetStack(entries.map(([key, amount]) => ({ key, amount })))
    setNote('')
  }

  function pushToast(n, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label: `号码 ${n}`, win }])
    later(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // 转：先走后端拿落号 n + 逐 key 结算，再把转盘停在【后端指定的 n】，动画后 settle。
  async function spin() {
    if (spinning || busyRef.current || !totalBet) return
    busyRef.current = true
    ensureAudio(); setNote('')
    let data
    try {
      data = await api.apiPlay(G.backendId, { bets: betsRef.current }, { autoBalance: false })
    } catch (e) { setNote(e.message); busyRef.current = false; return }
    pendingDataRef.current = data
    const n = data.n   // ← 后端落号（不本地 rollNumber）
    const current = ((rotation % 360) + 360) % 360
    const targetMod = (360 - sectorCenterDeg(n)) % 360
    const delta = ((targetMod - current) % 360 + 360) % 360 + 360 * 5
    scheduleTicks(rotation, delta)
    setRotation(r => r + delta)
    setSpinning(true)
    setWinKeys(null)
    setFeedBets(makeFeedBots())
    later(settle, SPIN_MS + 150)
  }

  function settle() {
    const data = pendingDataRef.current || {}
    const n = data.n
    const winners = Object.keys(data.perKeyPayout || {})   // 中奖 key（服务端定）
    const totalPayout = Number(data.totalPayout || 0)
    if (totalPayout > 0) { pushToast(n, totalPayout); playWin() }
    if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))   // 余额只认后端
    setWinKeys(new Set(winners))
    setDraws(d => [n, ...d].slice(0, 20))
    setLastBets({ ...betsRef.current })
    setBets({})
    setBetStack([])
    setSpinning(false)
    busyRef.current = false
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    later(() => setWinKeys(null), 2600)
  }

  const pillBtn = enabled => ({
    padding: '6px 18px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.18)', color: COLORS.white,
    border: `1.5px solid ${COLORS.white}`,
    fontSize: 12, fontWeight: 800,
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.5,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  })
  const cellBorder = `1px solid ${ROULETTE.line}`

  const betChip = amount => (
    <span style={{
      position: 'absolute', right: -6, bottom: -4,
      minWidth: 22, height: 22, padding: '0 3px', borderRadius: RADIUS.pill,
      background: gloss(ROULETTE.ball), color: ROULETTE.black,
      border: '1.5px dashed rgba(255,255,255,0.9)',
      fontSize: 9, fontWeight: 900,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box',
    }}>{amount}</span>
  )

  const numCell = n => {
    const key = `n${n}`
    const won = winKeys?.has(key)
    return (
      <button key={n} type="button" title={`号码 ${n}`}
        onClick={() => placeBet(key)}
        onMouseEnter={() => setHoverNum(n)}
        onMouseLeave={() => setHoverNum(null)}
        style={{
          border: cellBorder, background: 'transparent',
          padding: '7px 0', cursor: spinning ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <span style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: gloss(numColor(n)),
            border: `2px solid ${won ? ROULETTE.ball : hoverNum === n ? COLORS.white : 'rgba(255,255,255,0.2)'}`,
            boxShadow: won ? `0 0 14px ${ROULETTE.ball}` : 'none',
            color: COLORS.white, fontSize: 17, fontWeight: 900,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            transition: 'border-color 0.15s, box-shadow 0.2s',
            fontFamily: "'Space Grotesk', sans-serif",
          }}>{n}</span>
          {bets[key] > 0 && betChip(bets[key])}
        </span>
      </button>
    )
  }

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 38%, ${ROULETTE.feltCenter}, ${ROULETTE.feltEdge})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName} band={ROULETTE.band} onBack={onBack} onFairness={() => setFairOpen(true)} onHowTo={() => setRulesOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)} venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 26, alignItems: isMobile ? 'center' : 'flex-start', position: 'relative' }}>
          {/* cash-out style toast for wins */}
          <WinToast toasts={toasts} />

          {/* ---- wheel ---- */}
          <div style={{ flex: '0 0 auto', width: isMobile ? 280 : 360 }}>
            <svg viewBox="0 0 300 300" width="100%">
              <circle cx={CX} cy={CY} r={R + 12} fill="rgba(0,0,0,0.25)" />
              <circle cx={CX} cy={CY} r={R + 6} fill={ROULETTE.rim} />
              {/* rotating group — sectors + numbers */}
              <g style={{
                transform: `rotate(${rotation}deg)`,
                transformOrigin: `${CX}px ${CY}px`,
                transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.15,0.55,0.25,1)` : 'none',
              }}>
                {WHEEL_ORDER.map((n, i) => (
                  <path key={n} d={sectorPath(i)} fill={numColor(n)} stroke={ROULETTE.rim} strokeWidth="0.8" />
                ))}
                <circle cx={CX} cy={CY} r="86" fill="rgba(0,0,0,0.26)" />
                {WHEEL_ORDER.map((n, i) => {
                  const deg = i * 30 + 15
                  const a = rad(-90 + deg)
                  const x = CX + 108 * Math.cos(a)
                  const y = CY + 108 * Math.sin(a)
                  return (
                    <text key={`t${n}`} x={x.toFixed(1)} y={y.toFixed(1)}
                      fontSize="23" fontWeight="800" fill={COLORS.white}
                      fontFamily="'Space Grotesk', sans-serif"
                      textAnchor="middle" dominantBaseline="central"
                      transform={`rotate(${deg}, ${x.toFixed(1)}, ${y.toFixed(1)})`}>
                      {n}
                    </text>
                  )
                })}
              </g>
              {/* fixed golden ball pointer at 12 o'clock — the stopped sector under it is the result */}
              <circle cx={CX} cy={CY - 74} r="7" fill={ROULETTE.ball} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
              {/* static hub */}
              <circle cx={CX} cy={CY} r="56" fill={ROULETTE.hub} />
              <g stroke={ROULETTE.black} strokeWidth="5" strokeLinecap="round">
                <line x1={CX - 20} y1={CY - 20} x2={CX + 20} y2={CY + 20} />
                <line x1={CX - 20} y1={CY + 20} x2={CX + 20} y2={CY - 20} />
              </g>
              {[[-20, -20], [20, -20], [-20, 20], [20, 20]].map(([dx, dy], k) => (
                <circle key={k} cx={CX + dx} cy={CY + dy} r="6" fill={ROULETTE.black} />
              ))}
              <circle cx={CX} cy={CY} r="7" fill={ROULETTE.black} />
            </svg>
          </div>

          {/* ---- bet table ---- */}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', width: '100%', paddingTop: isMobile ? 0 : 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: COLORS.white, fontSize: 13, fontWeight: 900 }}>
                <span style={{ opacity: 0.75, fontWeight: 700 }}>Bet: </span>{totalBet.toFixed(2)} USD
              </span>
              <span style={{ color: COLORS.white, fontSize: 12, fontWeight: 800, textDecoration: 'underline', cursor: 'default' }}>Paytable</span>
            </div>

            <div style={{ border: cellBorder }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {ROW_EVEN.map(numCell)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {ROW_ODD.map(numCell)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {OUTSIDE.map(({ key, label }) => {
                  const dot = key === 'red' ? ROULETTE.red : key === 'black' ? ROULETTE.black : null
                  const won = winKeys?.has(key)
                  return (
                    <button key={key} type="button" title={label}
                      onClick={() => placeBet(key)}
                      style={{
                        border: cellBorder,
                        background: won ? 'rgba(255,179,0,0.18)' : 'transparent',
                        color: COLORS.white, fontSize: 12, fontWeight: 700,
                        padding: '6px 0', cursor: spinning ? 'not-allowed' : 'pointer', minHeight: 46,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.2s',
                      }}>
                      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 36 }}>
                        {dot
                          ? <span style={{ width: 36, height: 36, borderRadius: RADIUS.pill, background: gloss(dot), display: 'inline-block' }} />
                          : label}
                        {bets[key] > 0 && betChip(bets[key])}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <button type="button" disabled={spinning || !betStack.length} onClick={undoBet} style={pillBtn(!spinning && betStack.length > 0)}>↩ Back</button>
              <button type="button" disabled={spinning || !totalBet} onClick={clearBets} style={pillBtn(!spinning && totalBet > 0)}>✕ Clear</button>
              {note && <span style={{ color: ROULETTE.ball, fontSize: 12, fontWeight: 800 }}>{note}</span>}
              <button type="button" disabled={spinning || !lastBets} onClick={rebet} style={{ ...pillBtn(!spinning && !!lastBets), marginLeft: 'auto' }}>⟳ Rebet</button>
            </div>

            {hoverNum && (
              <div style={{
                position: 'absolute', top: isMobile ? -8 : 18, right: 0, transform: 'translateY(-100%)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: COLORS.panel, border: `1.5px solid ${RED_SET.has(hoverNum) ? ROULETTE.red : 'rgba(255,255,255,0.4)'}`,
                borderRadius: RADIUS.btn, padding: 8, pointerEvents: 'none', zIndex: 3,
              }}>
                <img src={PLAYER[hoverNum - 1]} alt="" style={{ width: 68, height: 68, objectFit: 'contain', display: 'block' }} />
                <div>
                  <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 900 }}>Team {String(hoverNum).padStart(2, '0')}</div>
                  <div style={{ color: RED_SET.has(hoverNum) ? '#ff8a80' : COLORS.textMuted, fontSize: 11, fontWeight: 700 }}>
                    {RED_SET.has(hoverNum) ? '红队' : '黑队'} · 王牌球星
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- chip rail + SPIN ---- */}
        <div style={{
          margin: isMobile ? '14px 0 0' : '18px 8px 0',
          padding: '10px 18px',
          background: ROULETTE.band,
          borderRadius: 12,
          display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center',
        }}>
          {CHIPS.map(c => {
            const selected = chip === c.label
            return (
              <button key={c.label} type="button" onClick={() => setChip(c.label)} style={{
                width: selected ? 50 : 42, height: selected ? 50 : 42,
                borderRadius: RADIUS.pill,
                background: gloss(c.color),
                border: '3px dashed rgba(255,255,255,0.75)',
                color: COLORS.white, fontSize: selected ? 13 : 11, fontWeight: 900,
                cursor: 'pointer', boxSizing: 'border-box',
                transform: selected ? 'translateY(-3px)' : 'none',
                boxShadow: selected ? '0 5px 12px rgba(0,0,0,0.5)' : '0 2px 5px rgba(0,0,0,0.35)',
                transition: 'all 0.15s',
              }}>
                {c.label}
              </button>
            )
          })}
          <button type="button" onClick={spin} disabled={spinning || !totalBet} title="SPIN" style={{
            width: 62, height: 62, borderRadius: RADIUS.pill, marginLeft: 14,
            background: `radial-gradient(circle at 40% 32%, #1c8f45, ${ROULETTE.band})`,
            color: COLORS.white,
            border: '2px dashed rgba(255,255,255,0.6)',
            fontSize: 22, fontWeight: 900,
            cursor: spinning || !totalBet ? 'not-allowed' : 'pointer',
            opacity: spinning || !totalBet ? 0.55 : 1,
            transition: 'opacity 0.15s',
          }}>
            ⟳
          </button>
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Breakaway ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={926} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              <RoundHistoryBar rounds={draws} variant="roulette" />
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout color={COLORS.green}>
      {gameCard}
    </GameLayout>
  )
}
