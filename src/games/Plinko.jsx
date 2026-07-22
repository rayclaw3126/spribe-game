import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, PLINKO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import WinToast from '../components/shell/WinToast'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'

const G = GAME_BY_ID['Plinko']

// 单P2: Free Kick gameplay — three risk tiers, binomial physics drop,
// adjustable pins, RTP-calibrated paytables.
//
// 落点服务器算，不信前端：本文件的 multsFor/binomProbs 只用于 UI 展示三行赔率表，
// 不参与结算；实际下注调 POST /round/plinko/play，path/bucket/mult/payout/余额
// 全部以后端返回为准（后端 server/src/game/plinko.js 逐位照抄下面这套算法，
// 两边保证一致，对拍过）。
//
// 赔率推导（禁拍脑袋）:
//   N 行钉 → N+1 落格，落格 k 的概率是二项分布 p(k) = C(N,k) / 2^N
//   （每行独立左右各 1/2，k = 向右次数 —— 落格与飞行路径同一映射）。
//   档位曲线 raw(k) = floor + d(k)^γ，d = |2k−N|/N ∈ [0,1] 是归一化边距：
//     green  γ=3, floor=0.25  （平缓）
//     yellow γ=5, floor=0.02  （陡）
//     red    γ=8, floor=0.001 （极陡，边缘大奖）
//   归一化 s = RTP / Σ p(k)·raw(k)，mult(k) = round(s·raw(k))，RTP = 0.95。
//   四舍五入(≥10 取整、<10 一位小数)引入 <±1% 偏差，表值即结算值。
const RTP = 0.95
const TIERS = {
  green: { gamma: 3, floor: 0.25 },
  yellow: { gamma: 5, floor: 0.02 },
  red: { gamma: 8, floor: 0.001 },
}
const DROP_MS_TOTAL = 2500          // ~2.5s of row-by-row bouncing
const PINS_MIN = 8
const PINS_MAX = 16
const roundMult = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10)

const RULES = [
  {
    icon: '⚽', title: '怎么玩',
    body: '选好风险档与钉排数后发球，小球从顶部落下，每碰一排钉子就随机向左或向右弹一格，最终落进底部某个格子。每个格子标着一个倍数，用你的本金乘以命中格的倍数就是这一球的派彩。落点由二项分布决定：越靠中间的格子越容易命中（倍数低），越靠两边越难命中（倍数高）。',
  },
  {
    icon: '📈', title: '三档风险与倍数分布',
    body: '同一排钉数下，三档的中奖机率完全一样，区别只在倍数怎么分布：\n· 绿（最平缓）：边格顶赔最小、中格倍数最高，波动小、最稳。\n· 黄（居中）：介于绿红之间，风险与回报折中。\n· 红（最陡）：边格顶赔最大、中格倍数被压到最低，搏两边大奖但中间格常常亏。\n档位越陡，边格越高、中格越低——高风险高回报，但期望返还率三档一致。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '· 选档发球：直接点 绿 / 黄 / 红 三个大按钮之一，即按该档下注并发出一球。\n· 调钉数：点「钉数」下拉，可选 8–16 排，钉数越多底格越多、两边最高倍数越大、命中越分散。\n· 设金额：先用筹码设好每球本金，再发球，确认后一次扣款，落点结算直接入余额。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳一点选绿档、想搏大奖选红档，黄档折中。\n· 钉数越多两边顶赔越高但越难命中，追求极限大奖可拉满 16 排。\n· 落点由服务器按二项分布计算、前端不可控，理论返还率约 95%，属娱乐性质，理性游戏。',
  },
]

function binomProbs(n) {
  const c = [1]
  for (let r = 0; r < n; r++) for (let i = c.length - 1; i >= 0; i--) c[i + 1] = (c[i + 1] || 0) + c[i]
  const denom = Math.pow(2, n)
  return c.map(v => v / denom)
}
function multsFor(n, tier) {
  const { gamma, floor } = TIERS[tier]
  const probs = binomProbs(n)
  const raw = probs.map((_, k) => floor + Math.pow(Math.abs(2 * k - n) / n, gamma))
  const s = RTP / raw.reduce((acc, r, k) => acc + probs[k] * r, 0)
  return raw.map(r => roundMult(s * r))
}
// 生成幂等键：优先用 crypto.randomUUID，不支持则退化拼接时间戳+随机数

// ---------- audio (module-level, mechanical recipe + shared compressor bus) ----------
function ensureAudio(audio) {
  if (audio.ctx) return audio.ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
  audio.ctx = ctx; return ctx
}
function bus(audio) {
  const ctx = ensureAudio(audio); if (!ctx) return null
  if (!audio.bus) {
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6
    comp.attack.value = 0.002; comp.release.value = 0.12
    const master = ctx.createGain(); master.gain.value = 0.9
    comp.connect(master); master.connect(ctx.destination)
    audio.bus = comp
  }
  return audio.bus
}
function clickLayer(ctx, out, t, { freq, vol, dur = 0.025 }) {
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
  const src = ctx.createBufferSource(); src.buffer = buf
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.005)
  src.connect(bp); bp.connect(g); g.connect(out)
  src.start(t); src.stop(t + dur)
}
function woodLayer(ctx, out, t, { freq, vol, dur = 0.045 }) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.01)
}
// pin hit — crisp metallic ding: short high sine + faint triangle overtone,
// pitch climbs with the row (2.2k→3.6kHz) with ±10% humanizing
function sfxTick(audio, row = 0, rows = 14) {
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const j = 0.9 + Math.random() * 0.2
  const f = (2200 + (row / Math.max(1, rows - 1)) * 1400) * j
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.06 * j, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.06)
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 1.5
  const g2 = ctx.createGain()
  g2.gain.setValueAtTime(0.0001, t)
  g2.gain.exponentialRampToValueAtTime(0.02 * j, t + 0.002)
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
  o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + 0.05)
}
function sfxChip(audio) {
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const j = 0.9 + Math.random() * 0.2
  clickLayer(ctx, out, t, { freq: 2200 * j, vol: 0.07 * j, dur: 0.02 })
  woodLayer(ctx, out, t, { freq: 260 * j, vol: 0.035 * j, dur: 0.035 })
}
function sfxLand(audio) {   // pocket thunk
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const len = Math.floor(ctx.sampleRate * 0.09)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource(); src.buffer = buf
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
  const ng = ctx.createGain(); ng.gain.value = 0.18
  src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t); src.stop(t + 0.09)
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.08)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.18, t + 0.008)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
  o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.11)
}
function sfxChime(audio) {   // big-hit chime (mult ≥ 10)
  const ctx = ensureAudio(audio); if (!ctx || audio.muted) return
  const out = bus(audio); const t = ctx.currentTime
  const tail = ctx.createDelay(0.4); tail.delayTime.value = 0.16
  const fb = ctx.createGain(); fb.gain.value = 0.24
  const wet = ctx.createGain(); wet.gain.value = 0.35
  tail.connect(fb); fb.connect(tail); tail.connect(wet); wet.connect(out)
  ;[520, 690, 920].forEach((f, i) => {
    const s = t + i * 0.085
    ;[0.997, 1.004].forEach(dt => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * dt
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, s)
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
      o.connect(g); g.connect(out); g.connect(tail)
      o.start(s); o.stop(s + 0.32)
    })
  })
}

const ROW_BG = { green: PLINKO.rowGreen, yellow: PLINKO.rowYellow, red: PLINKO.rowRed }
const ROW_DIM = { green: PLINKO.rowGreenDim, yellow: PLINKO.rowYellowDim, red: PLINKO.rowRedDim }

// small football: white ball, center pentagon + edge patches (block faces)
function Football({ size = 16 }) {
  const patch = 'M12,2.2 L14.6,3.1 L15.2,5.6 L12,7.2 L8.8,5.6 L9.4,3.1 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11" fill={PLINKO.ball} stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
      <polygon points="12,8.6 15.2,10.9 14,14.7 10,14.7 8.8,10.9" fill="#16181d" />
      {[0, 72, 144, 216, 288].map(a => (
        <path key={a} d={patch} fill="#16181d" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export default function Plinko({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })   // 统一后端封装
  const [bet, setBet] = useState(10)
  const [pins, setPins] = useState(14)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [balls, setBalls] = useState([])           // flying balls (render list)
  const [history, setHistory] = useState([])       // real results {v, c}, newest first
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [toasts, setToasts] = useState([])
  const [flash, setFlash] = useState(null)         // { tier, k } landing cell glow
  const [proof, setProof] = useState(null)         // 最近一局：{ serverSeed, commitHash } 供玩家自行验证
  const [fairOpen, setFairOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const ballsRef = useRef([])
  const rafRef = useRef(null)
  const ballIdRef = useRef(0)
  const toastIdRef = useRef(0)
  const flashTimerRef = useRef(null)
  const audioRef = useRef({ ctx: null, bus: null, muted: false })
  // responsive board: measured fit-scale for the fixed 480-wide board unit
  const boardAreaRef = useRef(null)
  const boardUnitRef = useRef(null)
  const [boardScale, setBoardScale] = useState(1)
  const [boardUnitH, setBoardUnitH] = useState(410)   // measured unscaled unit height

  const TABLE = {
    green: multsFor(pins, 'green'),
    yellow: multsFor(pins, 'yellow'),
    red: multsFor(pins, 'red'),
  }
  const flying = balls.length > 0

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
  }, [])

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }

  // ---------- drop physics: one continuous rAF over all flying balls ----------
  // Ball x walks the binomial path (±half-step per row), y hops row to row
  // with a small sine arc; the same path sum k picks the landing slot, so
  // the flight and the settlement can never disagree.
  // path/k/mult/payout 全部来自后端 /round/plinko/play 的返回，本地不再算钱——
  // 落定时只把 setServerBalance 设成后端给的 balanceAfter。
  function settleBall(ball) {
    const payout = ball.payout
    sfxLand(audioRef.current)
    setServerBalance(Number(ball.balanceAfter))
    if (ball.mult >= 1) pushToast(`${ball.mult}×`, payout)
    if (ball.mult >= 10) sfxChime(audioRef.current)
    setHistory(h => [{ v: String(ball.mult), c: ball.tier }, ...h].slice(0, 12))
    // fake feed rows settle for the round: ~45% cash green, the rest grey out
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setFlash({ tier: ball.tier, k: ball.k })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), 600)
    setProof({ serverSeedHash: ball.serverSeedHash, nonce: ball.nonce })
  }
  function frame(now) {
    const list = ballsRef.current
    const done = []
    for (const ball of list) {
      if (ball.start == null) ball.start = now
      const segDur = DROP_MS_TOTAL / ball.pins
      const t = now - ball.start
      const seg = Math.min(ball.pins, Math.floor(t / segDur))   // last seg = fall into slot
      if (seg > ball.seg) {
        for (let s = ball.seg + 1; s <= Math.min(seg, ball.pins - 1); s++) sfxTick(audioRef.current, s, ball.pins)
        ball.seg = seg
      }
      const stepX = 100 / (ball.pins + 1)
      const xAt = i => 50 + (ball.path.slice(0, i).reduce((a, b) => a + b, 0) - i / 2) * stepX
      const yAt = i => (i < 0 ? -2 : 4 + (i / (ball.pins - 1)) * 93) * 0.93   // % of board box
      const p = Math.min(1, (t - seg * segDur) / segDur)
      let x, y
      if (seg < ball.pins) {
        x = xAt(seg) + (xAt(seg + 1) - xAt(seg)) * p
        y = yAt(seg - 1) + (yAt(seg) - yAt(seg - 1)) * p - Math.sin(p * Math.PI) * 1.6
      } else {
        x = xAt(ball.pins)
        y = yAt(ball.pins - 1) + (104 - yAt(ball.pins - 1)) * p
      }
      ball.rot += (ball.path[Math.min(seg, ball.pins - 1)] ? 1 : -1) * 6
      if (ball.node) ball.node.style.transform = `translate(-50%,-50%) rotate(${ball.rot}deg)`
      if (ball.node) { ball.node.style.left = `${x}%`; ball.node.style.top = `${y}%` }
      if (seg >= ball.pins && p >= 1) done.push(ball)
    }
    if (done.length) {
      ballsRef.current = list.filter(b => !done.includes(b))
      setBalls([...ballsRef.current])
      done.forEach(settleBall)
    }
    if (ballsRef.current.length) rafRef.current = requestAnimationFrame(frame)
    else rafRef.current = null
  }
  // 落点服务器算，不信前端：只把下注参数（金额/档位/pins）传给后端，
  // path/bucket/mult/payout/余额全部以后端返回为准，本地不再算一分钱。
  async function kick(tier) {
    if (bet < 1 || (serverBalance != null && bet > serverBalance)) return
    const rows = pins   // 捕获此刻的 pins——等响应期间玩家切 pins 不影响本局
    ensureAudio(audioRef.current)
    sfxChip(audioRef.current)
    setFeedBets(makeFeedBots())     // fresh fake round rides along (display only; after the roll)

    let data
    try {
      // 余额（balanceAfter）留到落球动画回调回写；幂等键由 apiPlay 内部生成
      data = await api.apiPlay(G.backendId, { amount: bet, risk: tier, rows }, { autoBalance: false })
    } catch (err) {
      // 服务端业务错（有 err.data）沿用原「下注失败」兜底；网络层异常（无 err.data）显「网络异常」
      if (err?.data) pushToast(err.data.error || '下注失败，请重试', 0)
      else pushToast('网络异常，请稍后重试', 0)
      return
    }

    const { path, bucket, mult, payout, balanceAfter, serverSeedHash, nonce } = data
    const ball = {
      id: ++ballIdRef.current, tier, bet, path, k: bucket, pins: rows,
      mult: Number(mult), payout: Number(payout), balanceAfter,
      serverSeedHash, nonce,
      start: null, seg: -1, rot: 0, node: null,
    }
    ballsRef.current = [...ballsRef.current, ball]
    setBalls([...ballsRef.current])
    if (!rafRef.current) rafRef.current = requestAnimationFrame(frame)
  }

  // ---------- visual layer (Spribe Plinko 1:1, pitch green) ----------
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: PLINKO.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const locked = bet < 1 || (serverBalance != null && bet > serverBalance)
  const bigBtn = bg => ({
    minWidth: 96, padding: '11px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    fontSize: 13, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
  })

  const pinRows = []
  for (let r = 0; r < pins; r++) pinRows.push({ count: 3 + r, y: (r / (pins - 1)) * 100 })
  const xFor = (row, i) => {
    const spread = (row.count - 1) / (pins + 1)
    const start = 0.5 - spread / 2
    return (start + (row.count === 1 ? 0 : (i / (row.count - 1)) * spread)) * 100
  }
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 340px feed — below 1200px viewport the

  // Fit-scale the fixed-coordinate board unit (board + multiplier table) to
  // the flexible middle zone. Board internals/physics stay untouched — only
  // the outer transform changes. Desk clamps by height too; stacked mode
  // scales by width only (the page scrolls vertically).
  useEffect(() => {
    const area = boardAreaRef.current
    const unit = boardUnitRef.current
    if (!area || !unit) return
    const BOARD_W = 480
    const fit = () => {
      const cs = getComputedStyle(area)
      const availW = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const availH = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      const unitH = unit.offsetHeight || 1
      const s = isDesk
        ? Math.min(availW / BOARD_W, availH / unitH, 1.6)
        : Math.min(availW / BOARD_W, 1.6)
      setBoardUnitH(unitH)
      setBoardScale(Math.max(0.2, Math.round(s * 1000) / 1000))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(area)
    ro.observe(unit)
    return () => ro.disconnect()
  }, [isDesk, pins])

  // Pins selector + tier-colored result pills + refresh — desktop renders it
  // in the 34px skeleton row, mobile keeps it inside the card (never both)
  const historyStrip = (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: PLINKO.band, borderRadius: RADIUS.pill,
          padding: '4px 6px', overflow: 'visible', minHeight: 24,
          position: 'relative', zIndex: 2,
        }}>
          <span style={{ position: 'relative', flex: '0 0 auto' }}>
            <button type="button"
              onClick={() => { if (!flying) setPinsOpen(v => !v) }}
              style={{
                padding: '3px 22px', borderRadius: RADIUS.pill,
                background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.25)',
                color: COLORS.white, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
                cursor: flying ? 'not-allowed' : 'pointer', opacity: flying ? 0.6 : 1,
              }}>钉数: {pins} ˅</button>
            {pinsOpen && (
              <span style={{
                position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 5,
                display: 'flex', gap: 4, padding: 6,
                background: PLINKO.band, border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
              }}>
                {Array.from({ length: PINS_MAX - PINS_MIN + 1 }, (_, i) => PINS_MIN + i).map(n => (
                  <button key={n} type="button"
                    onClick={() => { setPins(n); setPinsOpen(false) }}
                    style={{
                      width: 30, height: 26, borderRadius: 6,
                      background: n === pins ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: COLORS.white, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}>{n}</button>
                ))}
              </span>
            )}
          </span>
          {(isMobile ? history.slice(0, 5) : history.slice(0, 10)).map((h, i) => (
            <span key={history.length - i} style={{
              padding: '3px 9px', borderRadius: RADIUS.pill,
              background: ROW_BG[h.c], color: COLORS.white,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{h.v}</span>
          ))}
          <span style={{
            marginLeft: 'auto', padding: '3px 12px', borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
          }}>⟲ ˅</span>
        </div>
  )

  // Pitch backdrop — copied from Dice.jsx's scene block, shades re-derived
  // from the PLINKO felt greens (bgOuter #0c4a24 / bgCenter #26a055).
  // TODO: 第三个游戏要用时抽成 shell 共享件（目前 Dice/Plinko 各持一份）。
  const TURF_DARK = '#093c1d'
  const TURF_LIGHT = '#127037'
  const pitchScene = (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <style>{`
        @keyframes pkTurfDrift { from { background-position-x: 0px; } to { background-position-x: 180px; } }
        @keyframes pkGlowBreath { 0% { opacity: 0.10; } 50% { opacity: 0.22; } 100% { opacity: 0.10; } }
        .pkTurf { animation: pkTurfDrift 14s linear infinite; }
        .pkGlow { animation: pkGlowBreath 6s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .pkTurf, .pkGlow { animation: none; }
        }
      `}</style>
      {/* perspective turf — alternating stripe shades, slow sideways drift */}
      <div className="pkTurf" style={{
        position: 'absolute', left: '-25%', right: '-25%', bottom: '-4%', height: '62%',
        background: `repeating-linear-gradient(90deg, ${TURF_DARK} 0px, ${TURF_DARK} 90px, ${TURF_LIGHT} 90px, ${TURF_LIGHT} 180px)`,
        transform: 'perspective(520px) rotateX(58deg)',
        transformOrigin: '50% 100%',
        opacity: 0.55,
      }} />
      {/* white center-circle arc — hugs the card bottom, centered */}
      <div style={{
        position: 'absolute', left: '50%', bottom: 0, transform: 'translate(-50%, 55%)',
        width: 'min(46%, 420px)', aspectRatio: '1 / 1', borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.28)',
      }} />
      {/* distant goal-frame silhouette + goal line, upper area */}
      <div style={{
        position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 190, height: 56,
        border: '2px solid rgba(255,255,255,0.24)', borderBottom: 'none',
        borderRadius: '3px 3px 0 0',
        background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 1px, transparent 14px)',
      }} />
      <div style={{
        position: 'absolute', top: 'calc(10% + 56px)', left: '50%', transform: 'translateX(-50%)',
        width: 300, height: 2, background: 'rgba(255,255,255,0.20)',
      }} />
      {/* stadium light spill — breathes between 0.10 and 0.22 */}
      <div className="pkGlow" style={{
        position: 'absolute', top: '-18%', left: '50%', transform: 'translateX(-50%)',
        width: '80%', height: '55%',
        background: 'radial-gradient(ellipse at 50% 0%, #ffffff 0%, transparent 65%)',
        opacity: 0.14,
      }} />
    </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 42%, ${PLINKO.bgCenter}, ${PLINKO.bgOuter})`,
        borderColor: COLORS.border, padding: 0, overflow: 'hidden',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {pitchScene}

        {/* ---- top bar（共享件：名 pill 下拉 + ?/音频钮；砍 DEMO/余额/HowTo pill）---- */}
        <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName} band={PLINKO.band} onBack={onBack} onFairness={() => setFairOpen(true)} onHowTo={() => setRulesOpen(true)} />
        <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
        <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)} venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />

        {/* ---- second row (mobile only — desktop 34px row has it) ---- */}
        {!isDesk && <div style={{ padding: '12px 12px 0', position: 'relative', zIndex: 2 }}>{historyStrip}</div>}

        {/* ---- middle zone: measured fit area for the fixed-coordinate board
             unit. The unit (board + multiplier table) keeps its intrinsic
             480px layout and is transform-scaled as one piece, so ball
             animation, pins and payout cells can never drift apart ---- */}
        <div ref={boardAreaRef} style={{
          flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: isMobile ? '12px 12px' : '14px 18px', boxSizing: 'border-box',
        }}>
        {/* scaled footprint — reserves the true on-screen size in the layout */}
        <div style={{
          width: 480 * boardScale,
          height: boardUnitH * boardScale,
          flex: '0 0 auto', position: 'relative', maxWidth: '100%',
        }}>
        <div ref={boardUnitRef} style={{
          position: 'absolute', top: 0, left: '50%', width: 480,
          transform: `translateX(-50%) scale(${boardScale})`, transformOrigin: 'top center',
        }}>

        {/* ---- pin board: triangle of pearls + dashed funnel + flying balls ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: '100%',
          height: 330, margin: '0 auto 2px',
        }}>
          <svg width="100%" height="100%" viewBox="0 0 480 330" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
            <line x1="204" y1="-6" x2="6" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="276" y1="-6" x2="474" y2="238" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="6" y1="238" x2="6" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            <line x1="474" y1="238" x2="474" y2="330" stroke={PLINKO.dash} strokeWidth="1.5" strokeDasharray="4 5" />
          </svg>
          {!flying && (
            <div style={{ position: 'absolute', left: '50%', top: -4, transform: 'translateX(-50%)' }}>
              <Football size={16} />
            </div>
          )}
          {pinRows.map((row, r) => (
            Array.from({ length: row.count }).map((_, i) => (
              <span key={`${r}-${i}`} style={{
                position: 'absolute',
                left: `${xFor(row, i)}%`, top: `${4 + row.y * 0.93}%`,
                width: isMobile ? 6 : 7, height: isMobile ? 6 : 7,
                borderRadius: '50%', transform: 'translate(-50%, -50%)',
                background: `radial-gradient(circle at 35% 30%, #ffffff, ${PLINKO.pin} 55%, #b9c2c9)`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
              }} />
            ))
          ))}
          {balls.map(ball => (
            <div key={ball.id} ref={el => { ball.node = el }} style={{
              position: 'absolute', left: '50%', top: '-2%',
              transform: 'translate(-50%,-50%)', zIndex: 3, pointerEvents: 'none',
            }}>
              <Football size={14} />
            </div>
          ))}
          <WinToast toasts={toasts} />
        </div>

        {/* ---- three-row multiplier table (computed, RTP 0.95) — scales as
             part of the board unit ---- */}
        <div style={{
          position: 'relative', zIndex: 1,
          width: '100%', margin: '8px 0 0',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {['green', 'yellow', 'red'].map(tier => (
            <div key={tier} style={{ display: 'flex', gap: 2 }}>
              {TABLE[tier].map((m, ci) => {
                const center = Math.abs(ci - pins / 2) <= 1.5
                const hot = flash && flash.tier === tier && flash.k === ci
                return (
                  <span key={ci} style={{
                    flex: 1, minWidth: 0, textAlign: 'center',
                    padding: '4px 0', borderRadius: 3,
                    background: center ? ROW_DIM[tier] : ROW_BG[tier],
                    // mobile compensates for the ~0.75 unit scale-down so the
                    // effective size stays at least the old 8px
                    color: COLORS.white, fontSize: isMobile ? 11 : 9.5, fontWeight: 800,
                    overflow: 'hidden',
                    boxShadow: hot ? `0 0 10px 2px ${PLINKO.gold}` : 'none',
                    filter: hot ? 'brightness(1.5)' : 'none',
                    transition: 'filter 0.15s, box-shadow 0.15s',
                  }}>{m}</span>
                )
              })}
            </div>
          ))}
        </div>

        </div>{/* /board unit */}
        </div>{/* /scaled footprint */}
        </div>{/* /middle zone */}

        {/* ---- 可验证公平：显示上一局的 serverSeed + commit hash，玩家可用
             clientSeed/nonce/serverSeed 自行重算校验 path 未被篡改 ---- */}
        {proof && (
          <div style={{
            textAlign: 'center', padding: '2px 0', position: 'relative', zIndex: 1,
            fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', wordBreak: 'break-all',
          }}>
            可验证 · hash: {proof.serverSeedHash?.slice(0, 16)}… · nonce: {proof.nonce}
          </div>
        )}

        {/* ---- bottom bet band — pinned to the card bottom, full-bleed strip ---- */}
        <div style={{
          flex: '0 0 auto',
          padding: '12px 14px',
          background: PLINKO.band,
          borderTop: '1px solid rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>投注额</div>
            <input
              value={bet}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" onClick={() => { sfxChip(audioRef.current); setBet(b => Math.max(1, b - 10)) }} style={circleBtn}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" onClick={() => { sfxChip(audioRef.current); setBet(b => b + 10) }} style={circleBtn}>+</button>
          <button type="button" disabled title="刷新" style={{
            width: 40, height: 40, borderRadius: RADIUS.pill,
            background: PLINKO.blue, color: COLORS.white,
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: 17, fontWeight: 900, cursor: 'not-allowed',
          }}>⟳</button>
          <button type="button" disabled={locked} onClick={() => kick('green')} style={bigBtn(PLINKO.btnGreen)}>绿</button>
          <button type="button" disabled={locked} onClick={() => kick('yellow')} style={bigBtn(PLINKO.btnYellow)}>黄</button>
          <button type="button" disabled={locked} onClick={() => kick('red')} style={bigBtn(PLINKO.btnRed)}>红</button>
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Total Goals ----
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
            {/* overflow stays visible so the Pins dropdown can escape the 34px row */}
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'visible', position: 'relative', zIndex: 4 }}>
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
    <GameLayout color={PLINKO.btnGreen}>
      {gameCard}
    </GameLayout>
  )
}
