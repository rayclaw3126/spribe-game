import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT, KENO } from '../components/shell/tokens'
import RoundHistoryBar from '../components/shell/RoundHistoryBar'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import ballUrl from '../assets/covers/ball-3d.png'
import badgeWinUrl from '../assets/shared/badge_win.png'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'

const G = GAME_BY_ID['Keno']

// Team Keno — Spribe-aligned rules: 36-ball pool, pick up to 10, 10 balls
// drawn per round. Visual layer is the 1:1 Spribe replica from K1.

const TOTAL = 36   // number pool = the visible 6×6 board
const DRAW = 10    // balls drawn per round

// Standard keno paytable for draw-10-of-36, [picks][hits] = multiplier.
// Multipliers calibrated against the hypergeometric hit distribution
// (RTP ≈ 84.3–94.4% per pick size — 超几何精确值, matching typical Spribe-style keno).
const PAYOUTS = {
  1:  { 1: 3.4 },
  2:  { 2: 13 },
  3:  { 2: 2, 3: 35 },
  4:  { 2: 1, 3: 7, 4: 80 },
  5:  { 3: 3, 4: 22, 5: 450 },
  6:  { 3: 1, 4: 8, 5: 90, 6: 1500 },
  7:  { 4: 4, 5: 30, 6: 350, 7: 8000 },
  8:  { 4: 2, 5: 13, 6: 110, 7: 1200, 8: 10000 },
  9:  { 5: 6, 6: 60, 7: 500, 8: 5000, 9: 10000 },
  10: { 5: 3, 6: 25, 7: 150, 8: 2500, 9: 10000, 10: 10000 },
}
// 幂等键：优先 crypto.randomUUID，不支持则退化拼接

const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '球场从 36 个号码（1–36）里，每期无放回开出 10 个中奖球。下注前你先在 6×6 号码盘上选 1 到 10 个号码，开奖后看你选中的号码里命中了几个，命中越多赔得越高。',
  },
  {
    icon: '📊', title: '赔付表',
    body: '按「你选了几个号 × 命中几个号」查表结算，举几个档位：\n· 选 1 个：命中 1 = 3.4×。\n· 选 2 个：全中 = 13×。\n· 选 5 个：全中 = 450×。\n· 选 10 个：中 5=3× / 中 6=25× / 中 7=150× / 中 8=2500× / 中 9 或 10=10000×。\n顶赔封顶约 10000 倍。选的号越多，冲击高倍的空间越大，但要命中的门槛也越高。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '在号码盘上点选号码（最多 10 个），或点 RANDOM 机选、CLEAR 清空。用 − / + 或输入框设每注金额，选好号后点 BET 开奖，10 个球逐个落下，命中的号码高亮，赔付直接入余额。点「再来一轮」清盘重下。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 选号越少越稳、选号越多越搏大：想赚高倍就多选，想中奖率高就少选。\n· 每期开奖独立，上期号码不影响下期，别追号。\n· 本游戏理论返还率约 84–94%（随选号数不同：选 1 约 94%、选 10 约 84%），属娱乐性质，理性游戏。',
  },
]

export default function Keno({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })   // 统一后端封装
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState([])
  const [drawn, setDrawn] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | drawing | done
  const [roundHistory, setRoundHistory] = useState([])   // won multiplier per round, newest first
  const [message, setMessage] = useState(null)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明弹窗
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { audioRef.current.muted = muted }, [muted])

  // ---------- audio (Web Audio synth) ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playPick() {   // soft click on select/deselect
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.value = 560
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.07)
  }
  function playDraw() {   // "哒" per drawn number
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 360 + Math.random() * 130
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06)
  }
  function playMatch() {   // bright "叮" on a hit
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[1180, 1770].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(i ? 0.05 : 0.1, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.28)
    })
  }
  function playWin() {   // celebration
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1180, 1560].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.1
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.13, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
    })
  }
  function playLose() {   // low tone
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime; const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }

  function toggleNumber(n) {
    if (phase !== 'idle' || drawing) return
    ensureAudio(); playPick()
    setSelected(s =>
      s.includes(n) ? s.filter(x => x !== n) : s.length < 10 ? [...s, n] : s
    )
  }

  function clearSelection() {
    if (phase !== 'idle') return
    setSelected([])
  }

  function quickPick(count) {
    if (phase !== 'idle') return
    const nums = []
    while (nums.length < count) {
      const n = Math.floor(Math.random() * TOTAL) + 1
      if (!nums.includes(n)) nums.push(n)
    }
    setSelected(nums)
  }

  async function play() {
    // 余额以服务器为准：serverBalance 为 null（登录后尚未拿到过 balanceAfter）时不拦
    if (drawing || bet < 1 || selected.length === 0 || (serverBalance != null && bet > serverBalance)) return
    ensureAudio()
    setPhase('drawing')
    setDrawing(true)
    setDrawn([])
    setMessage(null)
    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only)

    // 开奖不信前端：摇号/命中/赔付全走后端 /round/keno/play，前端只提供 selected
    let data
    try {
      // 余额（balanceAfter）留到下方开奖流程手动回写；幂等键由 apiPlay 内部生成
      data = await api.apiPlay(G.backendId, { amount: bet, selected }, { autoBalance: false })
    } catch (err) {
      // 服务端业务错（有 err.data）沿用原「下注失败」兜底；网络层异常（无 err.data）显「网络异常」
      setMessage({ text: err?.data ? (err.data.error || '下注失败，请重试') : '网络异常，请稍后重试', win: false })
      setPhase('idle'); setDrawing(false)
      return
    }

    const { drawn: serverDrawn, matches, mult, payout, balanceAfter } = data
    const picks = selected.length

    // 摇号动画保留：用后端返回的 drawn 逐球落下（视觉不动，数据来自后端）
    const drawResult = []
    for (let i = 0; i < serverDrawn.length; i++) {
      await new Promise(r => setTimeout(r, 200))
      drawResult.push(serverDrawn[i])
      setDrawn([...drawResult])
      playDraw()
      if (selected.includes(serverDrawn[i])) playMatch()
    }

    const won = Number(payout) > 0
    if (won) playWin(); else playLose()
    setMessage(
      won
        ? { text: `${matches}/${picks} matched — ${mult}× — Won $${Number(payout).toFixed(2)}!`, win: true }
        : { text: `${matches}/${picks} matched — No win this time`, win: false }
    )
    setRoundHistory(h => [mult, ...h].slice(0, 20))
    // 余额只认后端 balanceAfter，不本地加减
    if (balanceAfter != null) setServerBalance(Number(balanceAfter))
    setPhase('done')
    setDrawing(false)
    // fake feed rows settle for the round: ~45% cash green, the rest grey out
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  function reset() {
    setPhase('idle')
    setDrawn([])
    setSelected([])
    setMessage(null)
  }

  // ---------- visual layer (Spribe 1:1) ----------
  const roundBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: KENO.ctrl, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const wideBtn = enabled => ({
    flex: 1, padding: '9px 0', borderRadius: RADIUS.pill,
    background: KENO.ctrl,
    border: '1px solid rgba(255,255,255,0.35)',
    color: enabled ? COLORS.white : 'rgba(255,255,255,0.45)',
    fontSize: 13, fontWeight: 800, letterSpacing: 1,
    cursor: enabled ? 'pointer' : 'not-allowed',
  })

  // ring sync while balls drop: hit = green ring, drawn-but-unpicked = white ring
  const ballStyle = (sel, isDrawn) => {
    const hit = sel && isDrawn
    return {
      aspectRatio: '1', borderRadius: RADIUS.pill, padding: 0,
      background: sel
        ? `radial-gradient(circle at 32% 28%, #ff7aa8, ${KENO.pill} 58%, ${KENO.ballDeep})`
        : `radial-gradient(circle at 32% 28%, #57323e, ${KENO.ball} 62%)`,
      border: hit
        ? `2px solid ${KENO.green}`
        : isDrawn
          ? '2px solid rgba(255,255,255,0.9)'
          : sel ? '2px solid rgba(255,255,255,0.85)' : `1px solid ${KENO.ballRim}`,
      boxShadow: hit
        ? `0 0 14px ${KENO.green}`
        : isDrawn
          ? '0 0 10px rgba(255,255,255,0.35)'
          : sel ? '0 0 12px rgba(255,255,255,0.3)' : 'inset 0 -6px 10px rgba(0,0,0,0.5)',
      color: COLORS.white, fontSize: 15, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: drawing ? 'not-allowed' : 'pointer',
      transition: 'border-color 0.12s, box-shadow 0.12s',
    }
  }
  const drawnSet = new Set(drawn)

  // 号码球上浮背景（方案A）— 6 颗白系幽灵号码球从卡底缓浮至上带淡出，
  // 贴左右边避开 36 格阵热区；号码纯装饰静态写死
  const FLOAT_BALLS = [
    { n: 7,  s: 30, pos: { left: '3%' },  op: 0.42, dur: '12s', del: '0s',    sway: '10px' },
    { n: 23, s: 22, pos: { left: '8%' },  op: 0.32, dur: '15s', del: '-6s',   sway: '-12px' },
    { n: 14, s: 34, pos: { right: '3%' }, op: 0.50, dur: '11s', del: '-3s',   sway: '14px' },
    { n: 31, s: 24, pos: { right: '8%' }, op: 0.35, dur: '14s', del: '-9s',   sway: '-8px' },
    { n: 5,  s: 28, pos: { left: '5%' },  op: 0.40, dur: '13s', del: '-10s',  sway: '12px' },
    { n: 36, s: 26, pos: { right: '6%' }, op: 0.38, dur: '15s', del: '-1.5s', sway: '-14px' },
  ]
  const floatBalls = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes knFloat {
          0%   { transform: translate(0, 0); opacity: 0; }
          12%  { opacity: var(--op); }
          55%  { transform: translate(var(--sway), -55vh); }
          85%  { opacity: var(--op); }
          100% { transform: translate(0, -110vh); opacity: 0; }
        }
        .knFloat { animation: knFloat var(--d) linear infinite; animation-delay: var(--dl); }
        @media (prefers-reduced-motion: reduce) { .knFloat { animation: none; opacity: 0; } }
      `}</style>
      {FLOAT_BALLS.map((b, i) => (
        <span key={i} className="knFloat" style={{
          position: 'absolute', bottom: -40, ...b.pos,
          width: b.s, height: b.s, borderRadius: '50%',
          background: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9), rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.08))',
          color: 'rgba(255,255,255,0.9)', fontSize: Math.round(b.s * 0.42), fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          '--op': b.op, '--d': b.dur, '--dl': b.del, '--sway': b.sway,
          opacity: 0,
        }}>{b.n}</span>
      ))}
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${KENO.bgCenter}, ${KENO.bgOuter})`,
        borderColor: COLORS.border, padding: 0,
        overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {floatBalls}
        {/* giant side chevrons (dark X texture) */}
        <div style={{
          position: 'absolute', left: -140, top: '52%', width: 260, height: 260,
          border: `46px solid ${KENO.xDark}`, transform: 'translateY(-50%) rotate(45deg)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', right: -140, top: '52%', width: 260, height: 260,
          border: `46px solid ${KENO.xDark}`, transform: 'translateY(-50%) rotate(45deg)',
          pointerEvents: 'none',
        }} />

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName} band={KENO.band} onBack={onBack} onHowTo={() => setRulesOpen(true)} onFairness={() => setFairOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)} venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        {/* ---- middle zone: flexes to fill the card, board vertically centered ---- */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: isMobile ? '12px 12px' : '14px 18px', boxSizing: 'border-box',
        }}>

        {/* ---- board ---- */}
        <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative', zIndex: 1, width: '100%' }}>
          <style>{`
            @keyframes kenoDrop {
              from { transform: translateY(-18px) scale(0.6); opacity: 0; }
              to { transform: translateY(0) scale(1); opacity: 1; }
            }
          `}</style>
          {!isDesk && <RoundHistoryBar rounds={roundHistory} />}
          <div style={{
            padding: '6px 0', borderRadius: RADIUS.pill, marginBottom: 12,
            background: KENO.strip, textAlign: 'center',
            color: message ? (message.win ? KENO.green : '#ff8a80') : KENO.green,
            fontSize: 12, fontWeight: 800, letterSpacing: 1.5,
          }}>
            {phase === 'drawing' ? 'DRAWING…' : message ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
                {message.win && <img src={badgeWinUrl} alt="" draggable={false} style={{ height: 16, width: 'auto', pointerEvents: 'none', display: 'block' }} />}
                {message.text}
              </span>
            ) : 'PICK NUMBERS FOR START'}
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 14 }}>
            {/* 6×6 number balls */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: isMobile ? 8 : 10 }}>
              {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => {
                const sel = selected.includes(n)
                return (
                  <button key={n} type="button" onClick={() => toggleNumber(n)} style={ballStyle(sel, drawnSet.has(n))}>
                    <span>{n}</span>
                    {sel && <img src={ballUrl} alt="" draggable={false} style={{
                      width: 9, height: 9, marginTop: 1, pointerEvents: 'none', display: 'block',
                    }} />}
                  </button>
                )
              })}
            </div>

            {/* draw column — balls drop in one by one with a springy landing */}
            <div style={{
              width: isMobile ? '100%' : 92,
              minHeight: isMobile ? 64 : 'auto',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: 10,
              background: 'rgba(0,0,0,0.12)',
              display: 'flex', flexDirection: isMobile ? 'row' : 'column',
              flexWrap: 'wrap', alignContent: 'flex-start',
              gap: 6, padding: 8, boxSizing: 'border-box',
            }}>
              {drawn.map(n => {
                const hit = selected.includes(n)
                return (
                  <span key={n} style={{
                    width: 24, height: 24, borderRadius: RADIUS.pill,
                    background: hit ? KENO.pill : KENO.ball,
                    border: `1.5px solid ${hit ? KENO.green : 'rgba(255,255,255,0.3)'}`,
                    boxShadow: hit ? `0 0 8px ${KENO.green}` : 'none',
                    color: COLORS.white, fontSize: 11, fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'kenoDrop 0.3s cubic-bezier(0.34,1.56,0.64,1)',
                  }}>{n}</span>
                )
              })}
            </div>
          </div>

          {/* RANDOM / CLEAR */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button type="button" onClick={() => quickPick(10)} style={wideBtn(true)}>RANDOM</button>
            <button type="button" onClick={clearSelection} style={wideBtn(selected.length > 0)}>CLEAR</button>
          </div>
        </div>

        </div>{/* /middle zone */}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 18px',
          background: KENO.band,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1, flexWrap: 'wrap',
        }}>
          <div style={{
            padding: '5px 22px', borderRadius: RADIUS.pill,
            background: KENO.ctrl, border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center',
          }}>
            <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              type="number" min="1" value={bet}
              onChange={e => setBet(Math.max(1, Number(e.target.value)))}
              style={{
                width: 72, background: 'transparent', border: 'none', textAlign: 'center',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" onClick={() => setBet(b => Math.max(1, b - 10))} style={roundBtn}>−</button>
          <button type="button" style={{ ...roundBtn, fontSize: 12 }} title="筹码">≡</button>
          <button type="button" onClick={() => setBet(b => b + 10)} style={roundBtn}>+</button>
          <button type="button" disabled title="自动" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: KENO.blue, color: COLORS.white,
            border: '2px solid rgba(255,255,255,0.4)',
            fontSize: 16, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          {(() => {
            const canBet = phase === 'idle' && selected.length > 0 && (serverBalance == null || bet <= serverBalance) && bet >= 1
            const isDone = phase === 'done'
            const enabled = isDone || canBet
            return (
              <button type="button" disabled={!enabled} onClick={isDone ? reset : play} style={{
                minWidth: 200, padding: '11px 0', borderRadius: RADIUS.pill, marginLeft: 6,
                background: `linear-gradient(180deg, ${KENO.bet}, ${KENO.betDark})`,
                color: COLORS.white, border: '1px solid rgba(255,255,255,0.25)',
                fontSize: 15, fontWeight: 900, letterSpacing: 2,
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.55,
                transition: 'opacity 0.15s',
              }}>
                {isDone ? '再来一轮' : '▷ BET'}
              </button>
            )
          })()}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Team Roulette ----
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
    <GameLayout color={KENO.pill}>
      {gameCard}
    </GameLayout>
  )
}
