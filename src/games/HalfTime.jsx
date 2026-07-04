import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HALFTIME } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'
import ballUrl from '../assets/covers/ball-3d.png'

// Half Time — 快乐8和值盘（足球皮）。
// 引擎：1–80 无重复抽 20 球（保留开出顺序），和值 210–1410。
// 轮次：BETTING(24s) → DRAWING(10s rAF 开奖舞台) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// ---------- 引擎（纯函数区，禁副作用）----------
// Fisher-Yates 洗满池取前 20，保留开出顺序；rng 可注入（对账/模拟用）
export function drawRound(rng = Math.random) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 20)
}

// 派生：总和 + 半场计数。半场盘语义 = 20 球中落在 1–40 区间的个数：
// >10 → 1ST HALF，<10 → 2ND HALF，=10 → DRAW。
// （旧版「前10和 vs 后10和」派生已废弃删除 — 开出顺序仅保留在 balls 展示）
export function deriveRound(balls) {
  const sum = balls.reduce((a, b) => a + b, 0)
  const lowCount = balls.filter(n => n <= 40).length
  return { balls, sum, lowCount }
}

export const halfOf = r => (r.lowCount > 10 ? 'F' : r.lowCount < 10 ? 'S' : 'D')

// 赔率配置表（1e6 期模拟标定，目标带 94–97.5%，实测见修正单 RTP 报告）。
// 推导注记：和值分布对称于 810（x↔81−x 双射），σ≈51.4；
//   over  1.95 × P≈.4979 → 97.1%（≥811）
//   under 1.90 × P≈.5021 → 95.4%（810 中点质量归 under，故比 over 低一档）
//   odd/even 1.95 × P=.500 精确 → 97.5% 压线
//   parlay 3.80 × P≈.25（大小×奇偶近独立）→ ≈95%
//   zone：og/gl 9.25 × P≈.103 → ≈95/96；df/at 4.70 × P≈.202 → ≈95；
//         mf 2.46 × P≈.388 → ≈95.5
//   half：X = 20 球中 1–40 区个数 ~ 超几何(N=80,K=40,n=20)，
//         精确 P(X=10)=0.20324（众数）、P(X>10)=P(X<10)=0.39838；
//         h1/h2 2.40 × .3984 → 95.6%，draw 4.70 × .2032 → 95.5%
export const ODDS = {
  over: 1.95, under: 1.90,
  odd: 1.95, even: 1.95,
  'p-oo': 3.8, 'p-oe': 3.8, 'p-uo': 3.8, 'p-ue': 3.8,
  og: 9.25, df: 4.7, mf: 2.46, at: 4.7, gl: 9.25,
  h1: 2.4, draw: 4.7, h2: 2.4,
}

// 盘区判定表 — 数据驱动，settle/珠盘路/RTP 模拟共用这一份
export const MARKETS = {
  over:  { odds: ODDS.over,   hit: r => r.sum >= 811 },
  under: { odds: ODDS.under,  hit: r => r.sum <= 810 },
  odd:   { odds: ODDS.odd,    hit: r => r.sum % 2 === 1 },
  even:  { odds: ODDS.even,   hit: r => r.sum % 2 === 0 },
  'p-oo': { odds: ODDS['p-oo'], hit: r => r.sum >= 811 && r.sum % 2 === 1 },
  'p-oe': { odds: ODDS['p-oe'], hit: r => r.sum >= 811 && r.sum % 2 === 0 },
  'p-uo': { odds: ODDS['p-uo'], hit: r => r.sum <= 810 && r.sum % 2 === 1 },
  'p-ue': { odds: ODDS['p-ue'], hit: r => r.sum <= 810 && r.sum % 2 === 0 },
  og: { odds: ODDS.og, hit: r => r.sum <= 695 },
  df: { odds: ODDS.df, hit: r => r.sum >= 696 && r.sum <= 763 },
  mf: { odds: ODDS.mf, hit: r => r.sum >= 764 && r.sum <= 855 },
  at: { odds: ODDS.at, hit: r => r.sum >= 856 && r.sum <= 923 },
  gl: { odds: ODDS.gl, hit: r => r.sum >= 924 },
  h1:   { odds: ODDS.h1,   hit: r => r.lowCount > 10 },    // 1–40 区多
  draw: { odds: ODDS.draw, hit: r => r.lowCount === 10 },  // 恰 10 / 10
  h2:   { odds: ODDS.h2,   hit: r => r.lowCount < 10 },    // 41–80 区多
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器里直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__HT = { drawRound, deriveRound, halfOf, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量（心跳 500ms/tick，DRAWING 支持半秒粒度）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const DRAWING_T = 20    // 10s = 20 球连发（末球落网 ~8.5s）+ 1s SCORE 定格 + 余量
const SETTLED_T = 6     // 3s
// 开奖舞台时间轴（rAF 内使用，毫秒）：
// 单球飞行 530ms（较初版 +40% 可跟球），间隔压到 400ms 补偿总节奏
const BALL_CADENCE = 400
const BALL_FLIGHT = 530
const FINALE_HOLD = 1000
const ROUND_DATE = '20260705'
const ROAD_CAP = 120   // 珠盘路 6×20 滚动容量

// 种子上期 + 种子历史（真开奖会逐期顶掉）
const SEED_LAST = deriveRound([3, 7, 12, 18, 22, 25, 31, 36, 40, 44, 47, 52, 55, 59, 63, 66, 70, 74, 77, 80])
const SEED_SUMS = [
  881, 742, 655, 930, 803, 812, 776, 948, 701, 860,
  795, 688, 917, 834, 758, 902, 641, 823, 787, 955,
  810, 869, 733, 891, 762, 926, 705, 848, 779, 812,
]
const SEED_HALF = 'FSFDSFFSDSFSFFSDFSSFDFSFSFDSSF'.split('')
const SEED_HISTORY = SEED_SUMS.map((sum, i) => ({ sum, half: SEED_HALF[i] }))

const zoneOf = s => (s <= 695 ? 'OG' : s <= 763 ? 'DF' : s <= 855 ? 'MF' : s <= 923 ? 'AT' : 'GL')
const ZONE_COLOR = { OG: HALFTIME.over, DF: HALFTIME.draw, MF: HALFTIME.sel, AT: HALFTIME.draw, GL: HALFTIME.over }

// ---- 盘面（名称/区间展示；赔率一律读 ODDS）----
const ROW1 = [
  { key: 'over',  name: 'OVER',  range: '811–1410' },
  { key: 'under', name: 'UNDER', range: '210–810' },
  { key: 'odd',   name: 'ODD',   range: '和值为单' },
  { key: 'even',  name: 'EVEN',  range: '和值为双' },
]
const PARLAY = [
  { key: 'p-oo', name: 'O + ODD' },
  { key: 'p-oe', name: 'O + EVEN' },
  { key: 'p-uo', name: 'U + ODD' },
  { key: 'p-ue', name: 'U + EVEN' },
]
const ZONES = [
  { key: 'og', name: 'OWN GOAL', range: '210–695' },
  { key: 'df', name: 'DEFENSE',  range: '696–763' },
  { key: 'mf', name: 'MIDFIELD', range: '764–855' },
  { key: 'at', name: 'ATTACK',   range: '856–923' },
  { key: 'gl', name: 'GOAL',     range: '924–1410' },
]
const ROW3 = [
  { key: 'h1',   name: '1ST HALF', range: 'MORE 1–40' },
  { key: 'draw', name: 'DRAW',     range: '10 / 10' },
  { key: 'h2',   name: '2ND HALF', range: 'MORE 41–80' },
]

const ROAD_TABS = ['O/U', 'ODD/EVEN', 'PARLAY', 'ZONE', 'HALF']
function beadFor(tab, sum, half) {
  const over = sum > 810
  const odd = sum % 2 === 1
  if (tab === 'O/U') return { t: over ? 'O' : 'U', c: over ? HALFTIME.over : HALFTIME.under }
  if (tab === 'ODD/EVEN') return { t: odd ? 'O' : 'E', c: odd ? HALFTIME.over : HALFTIME.under }
  if (tab === 'PARLAY') return { t: (over ? 'O' : 'U') + (odd ? 'O' : 'E'), c: over === odd ? HALFTIME.sel : HALFTIME.draw }
  if (tab === 'ZONE') { const z = zoneOf(sum); return { t: z, c: ZONE_COLOR[z] } }
  return { t: half, c: half === 'F' ? HALFTIME.over : half === 'S' ? HALFTIME.under : HALFTIME.draw }
}

// ---------- 开奖舞台：单一 rAF 循环驱动全部物理（禁 CSS transition 拼接）----------
// 20 球按开出顺序抛物线飞入球门，入网触发网格顶点弹簧回弹 + 整卡轻震；
// 号码轨逐颗点亮，SCORE 滚动累加，末球后 1s 大字定格并回调 onFinale。
// prefers-reduced-motion：不跑 rAF，直接静态示 20 珠 + SCORE。
function DrawStage({ round, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { cbRef.current.onFinale?.(); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__HT_RAF_ACTIVE = (window.__HT_RAF_ACTIVE || 0) + 1

    const img = new Image()
    img.src = ballUrl
    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    // —— 装饰性随机（结果早已定，只抖轨迹/落点，不碰确定性随机数流的位置）——
    const jit = k => (Math.random() * 2 - 1) * k

    // 网格 mesh：球门内 13×7 顶点弹簧阵
    const NC = 13, NR = 7
    const mesh = []   // { rx, ry (rest, 相对球门框 0..1), x, y, vx, vy }
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
      mesh.push({ rc: c / (NC - 1), rr: r / (NR - 1), dx: 0, dy: 0, vx: 0, vy: 0 })
    }

    const balls = round.balls.map((n, i) => ({
      n,
      launch: i * BALL_CADENCE,
      side: i % 2 ? 1 : -1,
      jx: jit(0.04), jy: jit(0.06),   // 落点微抖（球门内相对坐标）
      launched: false, landed: false,
      trail: [],
    }))
    const lastLand = (balls.length - 1) * BALL_CADENCE + BALL_FLIGHT
    let landedSum = 0, showSum = 0, landedCount = 0
    let finaleFired = false
    let shakeUntil = 0
    let lastNow = 0
    let raf = 0
    const t0 = performance.now()

    const loop = now => {
      const t = now - t0
      const dt = Math.min((now - (lastNow || now)) / 1000, 0.04)
      lastNow = now
      const W = canvas.width, H = canvas.height

      // 球门几何：居中，宽 44%，网高 52%（下方让位给两排号码轨）
      const gw = W * 0.44, gh = H * 0.52
      const gx = (W - gw) / 2, gy = H * 0.06
      const meshX = p => gx + p.rc * gw + p.dx
      const meshY = p => gy + p.rr * gh + p.dy

      // —— 物理推进 ——
      for (const b of balls) {
        if (!b.launched && t >= b.launch) {
          b.launched = true
          cbRef.current.sfx.thump()
          // 起点：底角画外；终点：球门网内（含微抖）
          b.x0 = b.side < 0 ? -30 * dpr : W + 30 * dpr
          b.y0 = H * 0.98
          b.xe = gx + gw * (0.5 + b.jx * 4 + jit(0.18))
          b.ye = gy + gh * (0.45 + b.jy * 3)
          const T = BALL_FLIGHT / 1000
          b.g = 2400 * dpr
          b.vy0 = (b.ye - b.y0 - 0.5 * b.g * T * T) / T
        }
        if (b.launched && !b.landed) {
          const p = Math.min(1, (t - b.launch) / BALL_FLIGHT)
          const tau = p * (BALL_FLIGHT / 1000)
          b.x = b.x0 + (b.xe - b.x0) * p
          b.y = b.y0 + b.vy0 * tau + 0.5 * b.g * tau * tau
          b.trail.push({ x: b.x, y: b.y })
          if (b.trail.length > 3) b.trail.shift()
          if (p >= 1) {
            b.landed = true
            landedCount++
            landedSum += b.n
            cbRef.current.sfx.swish()
            shakeUntil = now + 120
            // 入网冲量：落点半径内的顶点向后位移
            for (const m of mesh) {
              const mx = meshX(m), my = meshY(m)
              const d = Math.hypot(mx - b.xe, my - b.ye)
              const R = gw * 0.22
              if (d < R) {
                const f = (1 - d / R) * 160 * dpr
                m.vx += ((mx - b.xe) / (d + 1)) * f * 0.35
                m.vy += ((my - b.ye) / (d + 1)) * f * 0.35 + f * 0.5   // 主要向下坠
              }
            }
          }
        }
      }
      // mesh 弹簧回弹（临界阻尼附近）
      for (const m of mesh) {
        m.vx += (-140 * m.dx - 9 * m.vx) * dt
        m.vy += (-140 * m.dy - 9 * m.vy) * dt
        m.dx += m.vx * dt
        m.dy += m.vy * dt
      }
      // SCORE 滚动
      showSum += (landedSum - showSum) * Math.min(1, dt * 14)
      if (landedSum - showSum < 0.6) showSum = landedSum
      // 收尾定格
      if (!finaleFired && t >= lastLand + 80) {
        finaleFired = true
        cbRef.current.sfx.chime()
        cbRef.current.onFinale?.()
      }
      // 整卡轻震（2–3px, 120ms）
      if (shakeRef.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 9) * 2.5}px, ${Math.cos(now / 7) * 2}px)`
          : ''
      }

      // —— 绘制 ——
      ctx.clearRect(0, 0, W, H)
      // 网格
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1 * dpr
      for (let r = 0; r < NR; r++) {
        ctx.beginPath()
        for (let c = 0; c < NC; c++) {
          const m = mesh[r * NC + c]
          c === 0 ? ctx.moveTo(meshX(m), meshY(m)) : ctx.lineTo(meshX(m), meshY(m))
        }
        ctx.stroke()
      }
      for (let c = 0; c < NC; c++) {
        ctx.beginPath()
        for (let r = 0; r < NR; r++) {
          const m = mesh[r * NC + c]
          r === 0 ? ctx.moveTo(meshX(m), meshY(m)) : ctx.lineTo(meshX(m), meshY(m))
        }
        ctx.stroke()
      }
      // 门框
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth = 3 * dpr
      ctx.beginPath()
      ctx.moveTo(gx, gy + gh); ctx.lineTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.lineTo(gx + gw, gy + gh)
      ctx.stroke()
      // 飞行球 + 拖影
      const br = 9 * dpr
      for (const b of balls) {
        if (!b.launched || b.landed) continue
        b.trail.forEach((tp, ti) => {
          ctx.globalAlpha = [0.08, 0.16, 0.28][ti] ?? 0.1
          if (img.complete && img.naturalWidth) ctx.drawImage(img, tp.x - br, tp.y - br, br * 2, br * 2)
          else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tp.x, tp.y, br * 0.8, 0, 7); ctx.fill() }
        })
        ctx.globalAlpha = 1
        if (img.complete && img.naturalWidth) ctx.drawImage(img, b.x - br, b.y - br, br * 2, br * 2)
        else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, 7); ctx.fill() }
      }
      ctx.globalAlpha = 1
      // 号码轨（已入网的珠，开出顺序，10+10 两排，两位数号码可读）
      const slotW = Math.min(W / 11, 40 * dpr)
      const beadR = slotW * 0.42
      const rowY2 = H - beadR - 5 * dpr
      const rowY1 = rowY2 - beadR * 2 - 6 * dpr
      const trackX0 = (W - slotW * 10) / 2 + slotW / 2
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < landedCount; i++) {
        const n = balls[i].n
        const cx = trackX0 + (i % 10) * slotW
        const cy = i < 10 ? rowY1 : rowY2
        ctx.fillStyle = n <= 40 ? HALFTIME.over : HALFTIME.under
        ctx.beginPath(); ctx.arc(cx, cy, beadR, 0, 7); ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `800 ${Math.round(beadR * 0.95)}px 'Space Grotesk', sans-serif`
        ctx.fillText(String(n), cx, cy + 0.5)
      }
      // SCORE
      if (finaleFired) {
        ctx.fillStyle = HALFTIME.gold
        ctx.font = `900 ${Math.round(H * 0.26)}px 'Space Grotesk', sans-serif`
        ctx.shadowColor = HALFTIME.gold; ctx.shadowBlur = 18 * dpr
        ctx.fillText(`SCORE ${landedSum}`, W / 2, gy + gh * 0.48)
        ctx.shadowBlur = 0
      } else if (landedCount > 0) {
        ctx.fillStyle = HALFTIME.gold
        ctx.font = `900 ${Math.round(H * 0.12)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText(String(Math.round(showSum)), W - 10 * dpr, gy + 6 * dpr + H * 0.06)
        ctx.textAlign = 'center'
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__HT_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；round 由 key 换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {
    // 静态分支：直接示 20 珠 + SCORE
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 4, flexWrap: 'wrap', padding: '0 12px',
        background: HALFTIME.strip, borderRadius: 12,
      }}>
        {round.balls.map((n, i) => (
          <span key={i} style={{
            width: 18, height: 18, borderRadius: '50%',
            background: n <= 40 ? HALFTIME.over : HALFTIME.under, color: '#fff',
            fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
        <span style={{ color: HALFTIME.gold, fontSize: 20, fontWeight: 900, marginLeft: 10 }}>SCORE {round.sum}</span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

export default function HalfTime({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())        // 待确认选格
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())   // key → 已下注额
  const [roadTab, setRoadTab] = useState('O/U')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  const [gamePhase, setGamePhase] = useState('betting')   // betting | drawing | settled
  const [countdown, setCountdown] = useState(BETTING_T)   // 单位: tick(500ms)
  const [roundNo, setRoundNo] = useState(89)
  const [lastDraw, setLastDraw] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const [preHits, setPreHits] = useState(null)   // 开奖动画收尾的命中预亮（结算前）
  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const audioRef = useRef({ ctx: null, muted: false })
  const cardShakeRef = useRef(null)

  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxThump() {   // 踢击：低频 sine 顿击 150→55Hz
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.09)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.12)
  }
  function sfxSwish() {   // 入网：带通噪声短扫 2000→600Hz
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1
    bp.frequency.setValueAtTime(2000, t); bp.frequency.exponentialRampToValueAtTime(600, t + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.12)
  }
  function sfxChime() {   // SCORE 定格：上扬三连音
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1170].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  const stageSfx = { thump: sfxThump, swish: sfxSwish, chime: sfxChime }

  function pushToast(win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label: '本期命中', win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账
  function settleRound() {
    const r = pendingRef.current
    const hits = hitsOf(r)
    let winTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
    })
    if (winTotal > 0) {
      setBalance(b => round2(b + winTotal))
      pushToast(winTotal)
    }
    setLastDraw(r)
    setHistory(h => [...h, { sum: r.sum, half: halfOf(r) }].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    // 假注单本期落账：~45% 变现绿、其余置灰（展示用，结果已定后的装饰随机）
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // 单 interval 驱动整台状态机（500ms/tick）；StrictMode 双挂载由 cleanup 兜底
  // （首次挂载的 interval 先被清掉，引擎永远只有一个心跳在跑）
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      if (ph === 'betting') {
        // 开奖结果此刻先定 — DRAWING 段的 rAF 舞台只读它，不再碰确定性随机数
        pendingRef.current = deriveRound(drawRound())
        phaseRef.current = 'drawing'; setGamePhase('drawing')
        cdRef.current = DRAWING_T; setCountdown(DRAWING_T)
      } else if (ph === 'drawing') {
        settleRound()
        phaseRef.current = 'settled'; setGamePhase('settled')
        cdRef.current = SETTLED_T; setCountdown(SETTLED_T)
      } else {
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setPreHits(null)
        setFeedBets(makeFeedBots())   // 新一期假注单进场（展示用）
        setRoundNo(n => n + 1)
        phaseRef.current = 'betting'; setGamePhase('betting')
        cdRef.current = BETTING_T; setCountdown(BETTING_T)
      }
    }, TICK_MS)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSel = key => {
    if (phaseRef.current !== 'betting') return   // DRAWING/SETTLED 锁盘
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点：注额 × 选格数，一次性扣款后入 betsRef，清空待选
  function confirmBets() {
    if (phaseRef.current !== 'betting') return
    const keys = [...picksRef.current]
    const amount = betRef.current
    const total = round2(amount * keys.length)
    if (!keys.length || amount < 1 || total > balanceRef.current) return
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
    keys.forEach(k => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + amount)))
    setBetsPlaced(new Map(betsRef.current))
    picksRef.current = new Set()
    setPicks(new Set())
  }

  const betting = gamePhase === 'betting'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance

  // ---- 样式件 ----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先用预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '7px 2px' : '9px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel
        ? HALFTIME.selTint
        : `linear-gradient(180deg, ${HALFTIME.cellTop}, ${HALFTIME.cellBot})`,
      border: `1px solid ${hit ? HALFTIME.gold : sel || placed ? HALFTIME.sel : HALFTIME.cellBorder}`,
      boxShadow: hit
        ? `0 0 12px ${HALFTIME.gold}`
        : sel ? `0 0 10px ${HALFTIME.selTint}` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      position: 'relative',
    }
  }
  const cellName = { color: HALFTIME.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HALFTIME.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HALFTIME.odds, fontSize: isMobile ? 11 : 13, fontWeight: 900 }

  const betCell = (m, opts) => (
    <button key={m.key} type="button" className="htCell" disabled={!betting}
      onClick={() => toggleSel(m.key)} style={cellBtn(m.key, opts)}>
      <span style={cellName}>{m.name}</span>
      {m.range && <span style={cellRange}>{m.range}</span>}
      <span style={cellOdds}>{MARKETS[m.key].odds.toFixed(2)}</span>
      {betsPlaced.has(m.key) && (
        <span style={{
          position: 'absolute', top: 3, right: 4,
          padding: '1px 6px', borderRadius: RADIUS.pill,
          background: HALFTIME.sel, color: '#083a1b',
          fontSize: 8.5, fontWeight: 900,
        }}>${betsPlaced.get(m.key)}</span>
      )}
    </button>
  )

  // ---- 轮次条 ----
  const phaseChip = gamePhase === 'betting'
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: HALFTIME.sel }
    : gamePhase === 'drawing'
      ? { text: '开奖中…', c: HALFTIME.draw }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: HALFTIME.gold }
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      // desk 走骨架 34px 历史行位（外层管间距），卡内（<1024）自带边距
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '6px 10px', borderRadius: RADIUS.pill,
      background: HALFTIME.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: HALFTIME.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(roundNo).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
        color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{phaseChip.text}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
        {lastDraw.balls.map((n, i) => (
          <span key={`${n}-${i}`} style={{
            width: isMobile ? 15 : 17, height: isMobile ? 15 : 17, borderRadius: '50%',
            background: n > 40 ? HALFTIME.under : HALFTIME.over, color: COLORS.white,
            fontSize: isMobile ? 7.5 : 8.5, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HALFTIME.sel, color: '#083a1b', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>SCORE {lastDraw.sum}</span>
    </div>
  )

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  const ROAD_COLS = 20
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(h => beadFor(roadTab, h.sum, h.half))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? HALFTIME.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : HALFTIME.dim,
            border: `1px solid ${roadTab === t ? HALFTIME.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 6.5 : 9, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${HALFTIME.bgCenter}, ${HALFTIME.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.htCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: HALFTIME.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>HALF TIME ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: HALFTIME.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${HALFTIME.gold}`, color: HALFTIME.gold,
            fontSize: 11, fontWeight: 900, letterSpacing: 2,
          }}>DEMO MODE</span>
        )}
        <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
          {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
        </span>
        <button type="button" onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          width: 30, height: 30, borderRadius: RADIUS.pill,
          background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
          color: bgmOn ? COLORS.white : COLORS.textMuted,
          border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><MusicNoteIcon on={bgmOn} /></button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          width: 30, height: 30, borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.3)', color: muted ? COLORS.textMuted : COLORS.white,
          border: '1px solid rgba(255,255,255,0.25)',
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><SpeakerIcon on={!muted} /></button>
      </div>

      {/* 轮次条 — desk 在骨架历史行（惯例 34px 行位），卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ---- 开奖舞台：DRAWING 展开表演，SETTLED 保持定格，回 BETTING 收起 ---- */}
      {gamePhase !== 'betting' && pendingRef.current && (
        <div style={{ flex: '0 0 auto', margin: isMobile ? '10px 12px 0' : '12px 18px 0', position: 'relative', zIndex: 1 }}>
          <DrawStage key={roundNo} round={pendingRef.current}
            height={isMobile ? 150 : 185}
            shakeRef={cardShakeRef} sfx={stageSfx}
            onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
        </div>
      )}

      {/* ---- middle zone: 盘区三行，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
      }}>
        <WinToast toasts={toasts} />
        {/* 行① Over/Under + Odd/Even + Parlay */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {ROW1.map(m => betCell(m))}
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {PARLAY.map(m => betCell(m, { compact: true }))}
          </div>
        </div>

        {/* 行② 球场五段 — 中场线贯穿，五格贴片 */}
        <div style={{
          position: 'relative', borderRadius: 12, padding: isMobile ? 6 : 8,
          background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: 6, bottom: 6, width: 1,
            background: 'rgba(255,255,255,0.18)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: isMobile ? 34 : 46, height: isMobile ? 34 : 46,
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', gap: isMobile ? 4 : 8, position: 'relative' }}>
            {ZONES.map(m => betCell(m))}
          </div>
        </div>

        {/* 行③ 1st Half / Draw / 2nd Half — 与上两行同左右边界，三等分撑满 */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, width: '100%' }}>
          {ROW3.map(m => betCell(m))}
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: HALFTIME.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          padding: '5px 18px', borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
          textAlign: 'center', lineHeight: 1.2,
          opacity: betting ? 1 : 0.6,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
          <input
            value={bet}
            disabled={!betting}
            onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
              color: COLORS.white, fontSize: 15, fontWeight: 900,
            }}
          />
        </div>
        {[10, 50, 100, 500].map(v => (
          <button key={v} type="button" disabled={!betting} onClick={() => setBet(v)} style={{
            minWidth: 38, padding: '0 10px', height: 30, borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
            background: bet === v ? HALFTIME.selTint : HALFTIME.band,
            border: `1px solid ${bet === v ? HALFTIME.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
          }}>{v}</button>
        ))}
        <button type="button" disabled={!confirmOk} onClick={confirmBets} style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: HALFTIME.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: confirmOk ? 'pointer' : 'not-allowed',
          opacity: confirmOk ? 1 : 0.55,
        }}>
          {betting
            ? `▷ CONFIRM${picks.size > 0 ? ` $${confirmTotal.toFixed(0)}` : ''}`
            : gamePhase === 'drawing' ? '开奖中…' : '本期已结算'}
        </button>
      </div>
    </Panel>
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Half Time</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 轮次条占骨架历史行位（同 Mines/Momentum 的 34px 行惯例） */}
            <div style={{ flex: '0 0 auto', minHeight: LAYOUT.historyH }}>
              {roundBar}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <div ref={cardShakeRef} style={{ height: '100%' }}>
                {gameCard}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout title="Half Time" color={HALFTIME.sel}>
      <div ref={cardShakeRef}>
        {gameCard}
      </div>
    </GameLayout>
  )
}
