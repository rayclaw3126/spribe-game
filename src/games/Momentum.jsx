import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, MOMENTUM } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetPanel from '../components/shell/BetPanel'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import bayBgUrl from '../assets/shared/bay_bg.png'
import tackleBurstUrl from '../assets/shared/tackle_burst_sm.png'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'

const G = GAME_BY_ID['Momentum']

// Momentum —— 实时 crash 随机游走（逐柱 700ms），第 21 卡（收官）。
// 全服务器权威：连 /ws/momentum，走势线逐柱用后端广播的 x（不本地 Math.random 走），
// 下注/兑现发 WS 消息，兑现按服务端当前柱 X 结算（前端不报 X），余额只认后端 balanceAfter。
// 可验证公平（照 Aviator 共享 crash）：betting 广播 commitHash（无 serverSeed），done reveal serverSeed，
// 本地可用 game/momentum.js 的 walkPath 重算整条 31 柱路径校验。
const BETTING_MS = 5000        // 对齐后端 betting 窗口
const MAX_BARS = 31            // 封顶 31 柱

const RULES = [
  {
    icon: '📊', title: '怎么玩',
    body: '每局一条随机走势线，逐柱（每 700ms 一根）实时展开，走势值 X 随之上下波动。开球前下注，走势途中随时点「兑现」，按当前柱的 X 结算收益（本金 × X）。走势收官或跌破前没兑现，即按最终结果结算。',
  },
  {
    icon: '📈', title: '走势与崩盘',
    body: 'X 会涨也会跌，可能跌破 1.00× 甚至崩到接近 0。逐柱由服务器权威广播（前端不本地随机、也拿不到未来柱），可验证公平：betting 给承诺哈希，收官揭晓 serverSeed，本地可用 walkPath 重算 31 柱路径校验。',
  },
  {
    icon: '💰', title: '随时兑现',
    body: '飞行中点「兑现」即按服务端当前柱的 X 锁定收益，立刻入余额；也可设自动兑现倍率到点自动收。每局一注，X 与结算全部以后端为准（前端不上报 X）。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 长期期望 E[F] ≈ 0.97（理论返还率约 97%），属娱乐性质。\n· 早兑现稳、命中率高；贪高柱风险大，可能被跌破/崩盘吃掉本金。\n· 走势由服务器随机、可验证，理性游戏。',
  },
]
const round2 = x => Math.round(x * 100) / 100
// log height mapping: 0.05 → 4%, 1 → ~50%, 20 → ~94% (防爆表)
const barH = x => Math.min(94, Math.max(4, 6 + 88 * Math.log(Math.max(x, 0.055) / 0.05) / Math.log(400)))

export default function Momentum({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const balance = serverBalance ?? 0
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('betting')   // betting | running | done
  const [countdown, setCountdown] = useState(BETTING_MS / 1000)
  const [bars, setBars] = useState([])            // {x, up} per bar（后端逐柱）
  const [busted, setBusted] = useState(false)
  const [playerBet, setPlayerBet] = useState(null)   // { amount, cashed, win }
  const [autoBet, setAutoBet] = useState(false)
  const [autoCashOn, setAutoCashOn] = useState(false)
  const [autoCashMult, setAutoCashMult] = useState(2)
  const [lastRange, setLastRange] = useState({ min: 0.9, max: 1.47 })
  const [roundHistory, setRoundHistory] = useState([])
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())
  const [toasts, setToasts] = useState([])
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [roundId, setRoundId] = useState(0)
  const [commitHash, setCommitHash] = useState(null)   // betting 承诺（可验证公平）
  const [revealedSeed, setRevealedSeed] = useState(null) // done reveal
  const [netErr, setNetErr] = useState(null)

  const phaseRef = useRef('betting')
  const barsRef = useRef([])
  const playerBetRef = useRef(null)
  const autoRef = useRef({ betOn: false, cashOn: false, mult: 2 })
  const betAmtRef = useRef(10)
  const roundIdRef = useRef(0)
  const timersRef = useRef([])
  const toastIdRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false })
  // WS
  const wsRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const cdTimerRef = useRef(null)

  useEffect(() => { betAmtRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => { autoRef.current = { betOn: autoBet, cashOn: autoCashOn, mult: autoCashMult } }, [autoBet, autoCashOn, autoCashMult])
  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  // 涨/跌异声 tick — deterministic synth (no Math.random: engine queue safety)
  function playStep(up) {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'
    if (up) { o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1080, t + 0.07) }
    else { o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.07) }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.12)
  }
  function playCrash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
    const d = nb.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700
    const ng = ctx.createGain(); ng.gain.value = 0.22
    ns.connect(lp); lp.connect(ng); ng.connect(ctx.destination); ns.start(t); ns.stop(t + 0.25)
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.47)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }
  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }
  // ---------- 倒计时（betting 显示用；相位由 WS 驱动）----------
  function startCountdown(ms) {
    if (cdTimerRef.current) clearInterval(cdTimerRef.current)
    const deadline = performance.now() + ms
    setCountdown(Math.ceil(ms / 1000))
    cdTimerRef.current = setInterval(() => {
      const remain = Math.max(0, deadline - performance.now())
      setCountdown(Math.ceil(remain / 1000))
      if (remain <= 0 && cdTimerRef.current) { clearInterval(cdTimerRef.current); cdTimerRef.current = null }
    }, 250)
  }

  // ---------- WS 消息处理（唯一相位/数值/资金来源）----------
  function onBettingMsg(msg) {
    phaseRef.current = 'betting'; setPhase('betting')
    barsRef.current = []; setBars([]); setBusted(false)
    playerBetRef.current = null; setPlayerBet(null)
    roundIdRef.current = msg.roundId; setRoundId(msg.roundId)
    setCommitHash(msg.commitHash); setRevealedSeed(null)
    setFeedBets(makeFeedBots())
    startCountdown(msg.remainingMs != null ? msg.remainingMs : (msg.waitMs || BETTING_MS))
    // 自动下注：本局 betting 开窗就发（若上一局勾了自动）
    if (autoRef.current.betOn && !playerBetRef.current) later(() => placeBet(), 80)
  }
  function pushBar(barIdx, x) {
    const prev = barsRef.current.length ? barsRef.current[barsRef.current.length - 1].x : 1
    const up = x >= prev && x > 0
    barsRef.current = [...barsRef.current, { x, up, barIdx }]
    setBars(barsRef.current)
    if (phaseRef.current !== 'running') { phaseRef.current = 'running'; setPhase('running') }
    playStep(up)
  }
  function onBarMsg(msg) { pushBar(msg.barIdx, msg.x) }
  function onDoneMsg(msg) {
    phaseRef.current = 'done'; setPhase('done')
    const finalX = Number(msg.finalX)
    const bust = finalX <= 0
    setBusted(bust)
    setRevealedSeed(msg.serverSeed)   // reveal（可用 walkPath 本地重算校验）
    if (bust) playCrash()
    const xs = [1, ...barsRef.current.map(b => b.x)]
    setLastRange({ min: Math.min(...xs), max: Math.max(...xs) })
    setRoundHistory(h => [round2(finalX), ...h].slice(0, 12))
    setFeedBets(list => list.map(r => Math.random() < 0.45
      ? { ...r, status: 'cashed', target: Number(r.target.toFixed(2)), payout: Number((r.bet * r.target).toFixed(2)) }
      : { ...r, status: 'crashed' }))
    // 未兑现且 bust → 本局输（余额已在下注时扣，不返）；survive 由后端发 final cashout_ok 处理
  }
  function onBetAck(msg) {
    if (msg.idempotent) return
    playerBetRef.current = { amount: Number(msg.amount), cashed: false, win: 0 }
    setPlayerBet({ ...playerBetRef.current })
    if (msg.balanceAfter != null) setServerBalance(Number(msg.balanceAfter))
    setNetErr(null)
  }
  function onBetRejected(msg) {
    playerBetRef.current = null; setPlayerBet(null)
    setNetErr(msg.reason || '下注被拒')
  }
  function onCashoutOk(msg) {
    const b = playerBetRef.current
    if (b) { b.cashed = true; b.win = Number(msg.payout); setPlayerBet({ ...b }) }
    if (msg.balanceAfter != null) setServerBalance(Number(msg.balanceAfter))
    pushToast(`${Number(msg.multiplier).toFixed(2)}×`, Number(msg.payout))
    playCash()
  }
  function onCashoutRejected(msg) { setNetErr(msg.reason || '兑现被拒') }
  function onSnapshot(msg) {
    // 断线重连 / 中途加入：按当前相位重放
    if (msg.phase === 'betting') { onBettingMsg(msg) }
    else if (msg.phase === 'running') {
      phaseRef.current = 'running'; setPhase('running')
      roundIdRef.current = msg.roundId; setRoundId(msg.roundId)
      setCommitHash(msg.commitHash); setRevealedSeed(null)
      barsRef.current = (msg.bars || []).map((b, i, arr) => ({ x: b.x, up: b.x >= (i ? arr[i - 1].x : 1) && b.x > 0, barIdx: b.barIdx }))
      setBars(barsRef.current); setBusted(false)
    } else {
      phaseRef.current = 'done'; setPhase('done')
      setCommitHash(msg.commitHash); setRevealedSeed(msg.serverSeed)
    }
  }

  // ---------- player actions（发 WS，服务端权威）----------
  function placeBet() {
    if (phaseRef.current !== 'betting' || playerBetRef.current) return
    const amt = betAmtRef.current
    if (amt > balance || amt < 1) return
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) { setNetErr('连接断开，正在重连…'); return }
    ensureAudio()
    playerBetRef.current = { amount: amt, cashed: false, win: 0, pending: true }   // 乐观占位，等 bet_ack
    setPlayerBet({ ...playerBetRef.current })
    ws.send(JSON.stringify({ type: 'bet', amount: amt, autoTarget: autoRef.current.cashOn ? autoRef.current.mult : undefined }))
  }
  function cashNow() {
    if (phaseRef.current !== 'running' || !playerBetRef.current || playerBetRef.current.cashed) return
    if (barsRef.current.length === 0) return   // 首柱后才可兑现
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'cashout' }))   // 不报 X，服务端按当前柱结算
  }

  // ---------- WebSocket 连接（唯一相位/数值/资金来源；照 Aviator 前端）----------
  useEffect(() => {
    if (!playerToken) return undefined
    let cancelled = false
    function dispatch(msg) {
      switch (msg.type) {
        case 'hello': if (msg.balance != null) setServerBalance(Number(msg.balance)); break
        case 'snapshot': onSnapshot(msg); break
        case 'betting': onBettingMsg(msg); break
        case 'bar': onBarMsg(msg); break
        case 'done': onDoneMsg(msg); break
        case 'settled': break
        case 'bet_ack': onBetAck(msg); break
        case 'bet_rejected': onBetRejected(msg); break
        case 'cashout_ok': onCashoutOk(msg); break
        case 'cashout_rejected': onCashoutRejected(msg); break
        default: break
      }
    }
    function connect() {
      if (cancelled) return
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/momentum?token=${encodeURIComponent(playerToken)}`)
      wsRef.current = ws
      ws.onopen = () => {
        const wasReconnect = reconnectAttemptRef.current > 0
        reconnectAttemptRef.current = 0
        if (wasReconnect) ws.send(JSON.stringify({ type: 'sync' }))
      }
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data) } catch { return } dispatch(m) }
      ws.onclose = () => {
        if (cancelled) return
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        reconnectTimerRef.current = setTimeout(connect, Math.min(10000, 1000 * Math.pow(2, attempt - 1)))
      }
      ws.onerror = () => {}
    }
    connect()
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (cdTimerRef.current) { clearInterval(cdTimerRef.current); cdTimerRef.current = null }
      timersRef.current.forEach(clearTimeout); timersRef.current = []
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.onmessage = null; wsRef.current.close() }
    }
    // 相位/数值全由 WS 分发；重连只依赖 token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerToken])

  // ---------- derived ----------
  const X = bars.length ? bars[bars.length - 1].x : 1
  const statusText = phase === 'betting' ? '等待下一局'
    : phase === 'running' ? '进行中'
      : busted ? '被绝杀' : '完场'
  const pillColor = v => {
    const n = Number(v)
    if (n === 0) return { bg: 'rgba(255,255,255,0.12)', fg: MOMENTUM.greyPill }
    if (n < 1) return { bg: 'rgba(224,75,58,0.2)', fg: MOMENTUM.red }
    return { bg: 'rgba(53,208,127,0.16)', fg: MOMENTUM.green }
  }
  const shellBtn = (() => {
    if (phase === 'betting') {
      if (playerBet) return { state: 'waiting', label: '已下注', sub: `$${playerBet.amount.toFixed(2)}`, disabled: true }
      return { state: 'bet', label: `下注 $${Number(bet).toFixed(2)}`, onClick: placeBet, disabled: bet > balance || bet < 1 }
    }
    if (phase === 'running' && playerBet && !playerBet.cashed) {
      return { state: 'cashout', label: '兑现', sub: `$${round2(playerBet.amount * X).toFixed(2)}`, onClick: cashNow, disabled: bars.length === 0 }
    }
    if (playerBet?.cashed) return { state: 'waiting', label: '已兑现', sub: `$${playerBet.win.toFixed(2)}`, disabled: true }
    return { state: 'waiting', label: '等待下一局', disabled: true }
  })()

  // real multiplier history pills — desktop 34px row / mobile in-card
  const historyStrip = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(0,0,0,0.28)', borderRadius: RADIUS.pill,
        padding: '4px 6px', overflow: 'hidden', minHeight: 24,
      }}>
        {(isMobile ? roundHistory.slice(0, 6) : roundHistory).map((v, i) => {
          const c = pillColor(v)
          return (
            <span key={roundHistory.length - i} style={{
              padding: '3px 10px', borderRadius: RADIUS.pill,
              background: c.bg, color: c.fg,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{Number(v).toFixed(2)}x</span>
          )
        })}
      </div>
  )

  const gameCard = (
      <Panel style={{
        background: `linear-gradient(180deg, ${MOMENTUM.bgTop}, ${MOMENTUM.bgBot})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative', minHeight: isMobile ? 360 : 420,
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        <style>{`@keyframes mmtProgress { from { width: 100% } to { width: 0% } }`}</style>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `repeating-linear-gradient(0deg, ${MOMENTUM.grid} 0px, ${MOMENTUM.grid} 1px, transparent 1px, transparent 42px),
            repeating-linear-gradient(90deg, ${MOMENTUM.grid} 0px, ${MOMENTUM.grid} 1px, transparent 1px, transparent 42px)`,
        }} />
        <WinToast toasts={toasts} />

        {/* 共享顶栏（PC 单行 / 手机两行自适应；← 大厅 + 名 + 余额 + ?/音乐/静音）
            ⚖ 不接：Momentum 公平为共享局 inline commit-reveal 角标（见下方），无抽屉可开 */}
        <GameTopBar
          balance={balance}
          venue={G.venue ?? G.displayName}
          onBack={onBack}
          onHowTo={() => setRulesOpen(true)}
        />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
          venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        {/* 游戏区：卡内边距内移到这层，让上方 GameTopBar 贴满卡边 */}
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: isMobile ? 12 : 18 }}>

        {/* ⚖ 可验证公平（共享 crash commit-reveal）：betting 显 commitHash 承诺；done reveal serverSeed */}
        <div style={{
          position: 'absolute', top: isDesk ? 44 : 52, right: 12, zIndex: 2,
          padding: '3px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.14)', maxWidth: isMobile ? 130 : 190,
        }} title={revealedSeed ? `serverSeed(reveal): ${revealedSeed}` : `commitHash: ${commitHash || ''}`}>
          <span style={{ color: MOMENTUM.dim, fontSize: 9, fontWeight: 800 }}>⚖ {revealedSeed ? 'seed揭晓' : '承诺'} </span>
          <span style={{ color: revealedSeed ? MOMENTUM.green : MOMENTUM.dim, fontSize: 9, fontWeight: 700, fontFamily: 'monospace' }}>
            {(revealedSeed || commitHash || '……').slice(0, 10)}…
          </span>
        </div>
        {netErr && (
          <div style={{
            position: 'absolute', top: isDesk ? 44 : 84, left: '50%', transform: 'translateX(-50%)', zIndex: 4,
            background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 8,
            padding: '5px 12px', color: '#ff8a9a', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
          }} onClick={() => setNetErr(null)}>{netErr}</div>
        )}

        {/* 音乐/静音已并入 GameTopBar 内建钮（顶栏右侧），此处不再浮动挂钮 */}

        <div style={{ position: 'relative', zIndex: 1, marginBottom: 10 }}>{historyStrip}</div>

        {/* last-round range badge */}
        <div style={{
          position: 'absolute', top: isDesk ? 44 : 52, left: 14, zIndex: 1,
          padding: '3px 10px', borderRadius: 6, background: MOMENTUM.badgeBg,
          display: 'inline-flex', gap: 8, alignItems: 'center',
        }}>
          <span style={{ color: MOMENTUM.dim, fontSize: 11, fontWeight: 800 }}>{lastRange.min.toFixed(2)}</span>
          <span style={{ color: MOMENTUM.green, fontSize: 11, fontWeight: 900 }}>{lastRange.max.toFixed(2)}</span>
        </div>

        {/* center: status + live X + dots / waiting ceremony */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginTop: isDesk ? 26 : 18 }}>
          <span style={{
            padding: '3px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)',
            color: busted && phase === 'done' ? MOMENTUM.red : MOMENTUM.dim,
            fontSize: 11, fontWeight: 800, letterSpacing: 1,
          }}>{statusText}</span>
          {phase === 'betting' ? (
            <div style={{ marginTop: 10 }}>
              <div style={{
                width: 64, height: 64, margin: '0 auto', borderRadius: '50%',
                border: `3px solid ${MOMENTUM.green}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: MOMENTUM.text, fontSize: 26, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
              }}>{countdown}</div>
              <div style={{ width: 180, height: 4, margin: '10px auto 0', borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                <div key={roundId} style={{ height: '100%', background: MOMENTUM.green, animation: `mmtProgress ${BETTING_MS}ms linear forwards` }} />
              </div>
            </div>
          ) : (
            <>
              <div style={{
                marginTop: 10, color: busted && phase === 'done' ? MOMENTUM.red : MOMENTUM.green,
                fontSize: isMobile ? 46 : 64, fontWeight: 900, lineHeight: 1,
                fontFamily: "'Space Grotesk', sans-serif",
              }}>{X.toFixed(2)}x</div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 5 }}>
                {[0.35, 0.9, 0.35].map((o, i) => (
                  <span key={i} style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: MOMENTUM.green, opacity: phase === 'running' ? o : 0.25,
                  }} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* chart: live bars + 1–31 axis */}
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 140, marginTop: 8 }}>
          {bars.map((b, i) => {
            const isBustBar = b.x === 0
            const up = b.up && !isBustBar
            return (
              <span key={i} style={{
                position: 'absolute', bottom: 0,
                left: `${((i + 0.5) / MAX_BARS) * 100}%`, transform: 'translateX(-50%)',
                width: isMobile ? 9 : 13, height: `${isBustBar ? 8 : barH(b.x)}%`,
                borderRadius: '7px 7px 2px 2px',
                background: isBustBar
                  ? MOMENTUM.red
                  : up
                    ? `linear-gradient(180deg, ${MOMENTUM.barTop}, ${MOMENTUM.green})`
                    : `linear-gradient(180deg, #ff8a75, ${MOMENTUM.red})`,
                boxShadow: isBustBar ? `0 0 16px ${MOMENTUM.red}` : up ? '0 0 12px rgba(53,208,127,0.35)' : '0 0 10px rgba(224,75,58,0.3)',
              }}>{isBustBar && <img src={tackleBurstUrl} alt="" draggable={false} style={{
                position: 'absolute', top: -24, left: '50%', transform: 'translateX(-50%)',
                height: 18, width: 'auto', pointerEvents: 'none', display: 'block',
              }} />}</span>
            )
          })}
        </div>
        <div style={{
          position: 'relative', zIndex: 1, display: 'flex', marginTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4,
        }}>
          {Array.from({ length: MAX_BARS }, (_, i) => i + 1).map(m => (
            <span key={m} style={{
              flex: 1, textAlign: 'center', color: MOMENTUM.dim,
              fontSize: isMobile ? 7 : 9, fontWeight: 700,
            }}>{m}</span>
          ))}
        </div>
        </div>{/* /游戏区 contentWrapper */}
      </Panel>
  )

  const locked = phase !== 'betting' || !!playerBet
  const bayPanel = (
        <BetPanel
          bare={isDesk}
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={locked}
          chipDisabled={locked}
          button={shellBtn}
          auto={{
            betOn: autoBet, cashOn: autoCashOn, cashMult: autoCashMult,
            onToggleBet: () => setAutoBet(v => !v),
            onToggleCash: () => setAutoCashOn(v => !v),
            onCashMult: v => setAutoCashMult(v),
          }}
        />
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Dribble ----
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
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
            <div style={{
              flex: '0 0 auto', minHeight: LAYOUT.bottomH,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 -12px -12px',
              background: `linear-gradient(rgba(10,17,25,0.78), rgba(10,17,25,0.78)), url(${bayBgUrl}) center / cover no-repeat`,
              borderTop: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ width: LAYOUT.bayW, maxWidth: '100%' }}>{bayPanel}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout color={MOMENTUM.green}>
      {gameCard}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bayPanel}</div>
    </GameLayout>
  )
}
