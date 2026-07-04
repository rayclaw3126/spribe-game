import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, MOMENTUM } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetPanel from '../components/shell/BetPanel'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import bayBgUrl from '../assets/shared/bay_bg.png'
import { useBgm } from '../components/shell/bgmManager'

// 单T2: Momentum random-walk engine + bet/cashout settlement.
//
// 随机游走推导（禁拍脑袋）: 每根柱 X ×= F(u)，u ~ U[0,1)：
//   u < 0.5 → F = 0.58 + 0.84u ∈ [0.58, 1.00)   （跌，均值 0.79）
//   u ≥ 0.5 → F = 1.00 + 0.6(u − 0.5) ∈ [1.00, 1.30]（涨，均值 1.15）
//   E[F] = (0.79 + 1.15)/2 = 0.97。
//   E[F] ≤ 0.97 ⇒ X_n 是超鞅（E[X_n] = 0.97^n），由可选停时定理，
//   任意停时策略（首柱后才可兑现）的期望回报 E[X_τ] ≤ E[X_1] = 0.97。
//   崩 0 吸收（X ≤ 0.05 → 0）只会再压低回报，红线保持成立。
const BETTING_MS = 5000        // 对齐 crash 游戏等待窗口
const STEP_MS = 700            // 每根柱间隔
const MAX_BARS = 31            // 比赛分钟
const BUST_AT = 0.05           // X ≤ 0.05 → 崩 0
const ROUND_GAP_MS = 2000
const round2 = x => Math.round(x * 100) / 100
const factorOf = u => (u < 0.5 ? 0.58 + 0.84 * u : 1 + 0.6 * (u - 0.5))
// module-level randomness (event/engine time only)
const drawU = () => Math.random()
// log height mapping: 0.05 → 4%, 1 → ~50%, 20 → ~94% (防爆表)
const barH = x => Math.min(94, Math.max(4, 6 + 88 * Math.log(Math.max(x, 0.055) / 0.05) / Math.log(400)))

export default function Momentum({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('betting')   // betting | running | done
  const [countdown, setCountdown] = useState(BETTING_MS / 1000)
  const [bars, setBars] = useState([])            // {f, x} per minute
  const [busted, setBusted] = useState(false)
  const [playerBet, setPlayerBet] = useState(null)   // { amount, cashed, win }
  const [autoBet, setAutoBet] = useState(false)
  const [autoCashOn, setAutoCashOn] = useState(false)
  const [autoCashMult, setAutoCashMult] = useState(2)
  const [lastRange, setLastRange] = useState({ min: 0.9, max: 1.47 })
  const [roundHistory, setRoundHistory] = useState([])
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())
  const [toasts, setToasts] = useState([])
  const [muted, setMuted] = useState(false)
  const [bgmOn, toggleBgm] = useBgm()
  const [roundId, setRoundId] = useState(0)

  const phaseRef = useRef('betting')
  const xRef = useRef(1)
  const barsRef = useRef([])
  const betRef = useRef(null)
  const autoRef = useRef({ betOn: false, cashOn: false, mult: 2 })
  const balanceRef = useRef(balance)
  const betAmtRef = useRef(10)
  const timersRef = useRef([])
  const toastIdRef = useRef(0)
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { balanceRef.current = balance }, [balance])
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
  function credit(delta) {   // single money path for payouts
    setBalance(b => round2(b + delta))
  }

  // ---------- round loop ----------
  function startBetting() {
    phaseRef.current = 'betting'; setPhase('betting')
    xRef.current = 1; barsRef.current = []
    setBars([]); setBusted(false)
    betRef.current = null; setPlayerBet(null)
    setFeedBets(makeFeedBots())
    setRoundId(id => id + 1)
    setCountdown(BETTING_MS / 1000)
    for (let s = 1; s < BETTING_MS / 1000; s++) later(() => setCountdown(c => c - 1), s * 1000)
    // auto bet places itself at window open
    later(() => { if (autoRef.current.betOn) placeBet() }, 60)
    later(startRound, BETTING_MS)
  }

  function startRound() {
    phaseRef.current = 'running'; setPhase('running')
    later(step, STEP_MS)
  }

  function step() {
    if (phaseRef.current !== 'running') return
    const u = drawU()                       // draw first — nothing else may touch the queue
    const f = factorOf(u)
    let x = xRef.current * f
    const bust = x <= BUST_AT
    if (bust) x = 0
    xRef.current = x
    barsRef.current = [...barsRef.current, { f, x }]
    setBars(barsRef.current)
    playStep(f >= 1)
    // auto cashout — 按目标价结算 (pays the target, not the overshoot)
    const b = betRef.current
    if (!bust && b && !b.cashed && autoRef.current.cashOn && x >= autoRef.current.mult) {
      settlePlayer(autoRef.current.mult)
    }
    if (bust) {
      setBusted(true)
      playCrash()
      endRound(0)
    } else if (barsRef.current.length >= MAX_BARS) {
      endRound(x)                            // 31 柱走完按最终 X 自动结算
    } else {
      later(step, STEP_MS)
    }
  }

  function settlePlayer(atX) {
    const b = betRef.current
    if (!b || b.cashed) return
    const payout = round2(b.amount * atX)
    b.cashed = true; b.win = payout
    setPlayerBet({ ...b })
    if (payout > 0) { credit(payout); pushToast(`${atX.toFixed(2)}×`, payout); playCash() }
  }

  function endRound(finalX) {
    phaseRef.current = 'done'; setPhase('done')
    const b = betRef.current
    if (b && !b.cashed && finalX > 0) settlePlayer(finalX)   // 兑现<1 也照付
    const xs = [1, ...barsRef.current.map(bb => bb.x)]
    setLastRange({ min: Math.min(...xs), max: Math.max(...xs) })
    setRoundHistory(h => [round2(finalX), ...h].slice(0, 12))
    // fake feed rows settle: ~45% cash green, the rest grey out
    setFeedBets(list => list.map(r => Math.random() < 0.45
      ? { ...r, status: 'cashed', target: Number(r.target.toFixed(2)), payout: Number((r.bet * r.target).toFixed(2)) }
      : { ...r, status: 'crashed' }))
    later(startBetting, ROUND_GAP_MS)
  }

  // ---------- player actions ----------
  function placeBet() {
    if (phaseRef.current !== 'betting' || betRef.current) return
    const amt = betAmtRef.current
    if (amt > balanceRef.current || amt < 1) return
    ensureAudio()
    setBalance(bb => round2(bb - amt))
    betRef.current = { amount: amt, cashed: false, win: 0 }
    setPlayerBet({ ...betRef.current })
  }
  function cancelBet() {
    if (phaseRef.current !== 'betting' || !betRef.current) return
    credit(betRef.current.amount)
    betRef.current = null
    setPlayerBet(null)
  }
  function cashNow() {
    if (phaseRef.current !== 'running' || !betRef.current || betRef.current.cashed) return
    if (barsRef.current.length === 0) return   // 首柱后才可兑现（RTP 红线前提）
    settlePlayer(xRef.current)
  }

  // engine lifecycle
  useEffect(() => {
    startBetting()
    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      if (playerBet) return { state: 'cancel', label: '取消', sub: `$${playerBet.amount.toFixed(2)}`, onClick: cancelBet }
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
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
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

        {/* audio toggles — card top-right */}
        <button type="button" onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          position: 'absolute', top: 10, right: 52, zIndex: 3, width: 32, height: 32, borderRadius: '50%',
          background: bgmOn ? 'rgba(53,208,127,0.2)' : 'rgba(0,0,0,0.35)',
          color: COLORS.white, border: `1px solid rgba(255,255,255,${bgmOn ? 0.5 : 0.25})`, fontSize: 13, cursor: 'pointer',
          fontFamily: "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif",
        }}>🎵</button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          position: 'absolute', top: 10, right: 12, zIndex: 3, width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(0,0,0,0.35)', color: COLORS.white,
          border: '1px solid rgba(255,255,255,0.25)', fontSize: 14, cursor: 'pointer',
          fontFamily: "'Segoe UI Emoji', 'Noto Color Emoji', 'Apple Color Emoji', sans-serif",
        }}>{muted ? '🔇' : '🔊'}</button>

        {!isDesk && <div style={{ position: 'relative', zIndex: 1, marginBottom: 10 }}>{historyStrip}</div>}

        {/* last-round range badge */}
        <div style={{
          position: 'absolute', top: isDesk ? 14 : 52, left: 14, zIndex: 1,
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
            const up = b.f >= 1 && !isBustBar
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
              }}>{isBustBar && <span style={{ position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)', fontSize: 16 }}>💥</span>}</span>
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
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Momentum</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              {historyStrip}
            </div>
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
    <GameLayout title="Momentum" emoji="📊" color={MOMENTUM.green}>
      {gameCard}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bayPanel}</div>
    </GameLayout>
  )
}
