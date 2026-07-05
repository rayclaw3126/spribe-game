import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HATTRICK } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Hat Trick — 快3三骰彩（三骰和值 + 豹子 + 对子），第 15 卡。
// 引擎：三骰各 1–6 独立均匀；和值/豹子/对子/大小单双全部由骰面派生。
// 轮次：BETTING(24s) → ROLLING(3s 占位，单3 换三骰动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。
// 通杀规则：开出豹子时 BIG/SMALL/ODD/EVEN 四侧全输（hit 判定含 !isTriple）；
// 和值盘只开 4–17，开出 3/18（必为豹子）自然无格可中。

// ---------- 引擎（纯函数区，禁副作用）----------
// 三骰各 1–6 独立均匀；rng 可注入（对账/模拟用），三次调用顺序固定 d1→d2→d3
export function rollDice(rng = Math.random) {
  const d1 = 1 + Math.floor(rng() * 6)
  const d2 = 1 + Math.floor(rng() * 6)
  const d3 = 1 + Math.floor(rng() * 6)
  return [d1, d2, d3]
}

// 派生：和值(3–18) / 豹子 / 豹子面 / 对子面集合 / 大小(11–17 / 4–10) / 单双
// doubles 口径（行业惯例）：某面出现 ≥2 次即算该面对子——豹子含在指定对子内
export function deriveRoll(dice) {
  const total = dice[0] + dice[1] + dice[2]
  const isTriple = dice[0] === dice[1] && dice[1] === dice[2]
  const doubles = new Set()
  for (let v = 1; v <= 6; v++) {
    if ((dice[0] === v) + (dice[1] === v) + (dice[2] === v) >= 2) doubles.add(v)
  }
  return {
    dice, total, isTriple,
    tripleFace: isTriple ? dice[0] : null,
    doubles,
    big: total >= 11 && total <= 17,
    small: total >= 4 && total <= 10,
    odd: total % 2 === 1,
    even: total % 2 === 0,
  }
}

// 赔率配置表 — 216 全排列可数，逐格精确推导（目标带 94–97.5%，锚 95.5%）：
//   和值 s 的排列数 n(s)：4/17→3, 5/16→6, 6/15→10, 7/14→15, 8/13→21, 9/12→25, 10/11→27
//   和值直选 odds = 0.955×216/n(s)（round2）：
//     n=3→68.76 精确 95.50% | n=6→34.38 精确 95.50% | n=10→20.63 → 95.51%
//     n=15→13.75 → 95.49%  | n=21→9.82 → 95.46%    | n=25→8.25 → 95.49%
//     n=27→7.64 精确 95.50%
//   BIG/SMALL：和值 11–17（4–10）共 107 排列，扣本区豹子 2 个（12,15 / 6,9）
//     → P=105/216；ODD/EVEN 同理（单 108−3 豹 / 双 108−3 豹）→ P=105/216
//     odds = 0.955×216/105 = 1.9646 → 1.96 → RTP 1.96×105/216 = 95.28%
//   ANY TRIPLE：P=6/216 → 0.955×216/6 = 34.38 精确 → 95.50%
//   指定豹子：P=1/216 → 0.955×216 = 206.28 精确 → 95.50%
//   指定对子：≥2 个该面 = C(3,2)×5×3/3!·…直接数 15 排列 + 豹子 1 = 16/216
//     （口径：指定对子含该面豹子）→ 0.955×216/16 = 12.8925 → 12.89 → 95.48%
export const ODDS = {
  total: {
    4: 68.76, 5: 34.38, 6: 20.63, 7: 13.75, 8: 9.82, 9: 8.25, 10: 7.64,
    11: 7.64, 12: 8.25, 13: 9.82, 14: 13.75, 15: 20.63, 16: 34.38, 17: 68.76,
  },
  side: 1.96,        // BIG/SMALL/ODD/EVEN（豹子通杀）
  anyTriple: 34.38,
  triple: 206.28,    // 指定三同
  double: 12.89,     // 指定对子（含该面豹子）
}

// 盘区判定表 — 数据驱动生成（31 键：14 和值 + 4 侧注 + 1 任意豹子 + 6 指定豹子
// + 6 指定对子），settle/珠盘路/RTP 模拟共用，零散落 if
export const MARKETS = (() => {
  const m = {}
  for (let s = 4; s <= 17; s++) m[`t-${s}`] = { odds: ODDS.total[s], hit: r => r.total === s }
  m['s-big']   = { odds: ODDS.side, hit: r => r.big && !r.isTriple }
  m['s-small'] = { odds: ODDS.side, hit: r => r.small && !r.isTriple }
  m['s-odd']   = { odds: ODDS.side, hit: r => r.odd && !r.isTriple }
  m['s-even']  = { odds: ODDS.side, hit: r => r.even && !r.isTriple }
  m['tr-any']  = { odds: ODDS.anyTriple, hit: r => r.isTriple }
  for (let v = 1; v <= 6; v++) {
    m[`tr-${v}`] = { odds: ODDS.triple, hit: r => r.tripleFace === v }
    m[`d-${v}`]  = { odds: ODDS.double, hit: r => r.doubles.has(v) }
  }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100
const sumOf = d => d[0] + d[1] + d[2]

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__HAT = { rollDice, deriveRoll, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量（照 Number Up，心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const ROLLING_T = 14    // 7s = 三骰错峰弹入滚动 ~4.5s + TOTAL 定格金闪 ~2s
const SETTLED_T = 6     // 3s
// 三骰舞台时间轴（rAF 内使用，毫秒）：三骰错峰定格制造悬念
const DIE_START = [0, 250, 500]       // 各骰抛入时刻
const DIE_LOCK = [2600, 3500, 4500]   // 各骰定格时刻（第1骰 2.6s / 第2骰 3.5s / 第3骰 4.5s）
const FALL_DUR = 500                  // 抛物线下坠段
const TOTAL_LOCK = 5100               // TOTAL 大字滚动累加后定格金闪
const ROUND_DATE = '20260705'
const ROAD_CAP = 120

// 种子历史（新→旧；真开奖逐期顶掉。含 2 期豹子：[2,2,2]、[6,6,6]）
const SEED_ROUNDS = [
  [5, 2, 5], [3, 1, 6], [4, 4, 2], [6, 5, 4], [2, 2, 2], [1, 3, 4], [5, 5, 3], [6, 1, 2], [4, 3, 3], [2, 5, 6],
  [1, 1, 4], [3, 6, 6], [2, 4, 5], [6, 6, 6], [1, 2, 3], [5, 4, 2], [3, 3, 5], [4, 6, 1], [2, 3, 3], [5, 6, 6],
  [1, 4, 4], [2, 6, 3], [4, 5, 5], [3, 2, 1], [6, 4, 3], [1, 5, 2], [6, 2, 4], [3, 5, 4], [2, 1, 1], [4, 2, 6],
]
const SEED_LAST = deriveRoll(SEED_ROUNDS[0])
const SEED_RECENT = SEED_ROUNDS.slice(0, 5).map(sumOf)
const SEED_HISTORY = [...SEED_ROUNDS].reverse()   // 珠盘路旧→新

const SIDES = [
  { key: 's-big',   name: 'BIG',   range: '11–17' },
  { key: 's-small', name: 'SMALL', range: '4–10' },
  { key: 's-odd',   name: 'ODD',   range: '和值单' },
  { key: 's-even',  name: 'EVEN',  range: '和值双' },
]

// ---------- 骰面（CSS 点阵，size 参数化；禁 emoji 禁图）----------
// 3×3 宫格索引：0 1 2 / 3 4 5 / 6 7 8
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
function DieFace({ v, size = 18 }) {
  const dot = Math.max(2.5, size * 0.17)
  return (
    <span aria-label={`骰面 ${v}`} style={{
      width: size, height: size, borderRadius: Math.max(3, size * 0.2),
      background: HATTRICK.face, border: '1px solid rgba(0,0,0,0.3)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      display: 'inline-grid',
      gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: Math.max(2, size * 0.14), boxSizing: 'border-box', flex: '0 0 auto',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{
          alignSelf: 'center', justifySelf: 'center',
          width: dot, height: dot, borderRadius: '50%',
          background: PIPS[v].includes(i) ? HATTRICK.pip : 'transparent',
        }} />
      ))}
    </span>
  )
}

// ---------- 珠盘路 ----------
const ROAD_TABS = ['TOTAL', 'B-S', 'TRIPLE']
function beadFor(tab, dice) {
  const s = sumOf(dice)
  const triple = dice[0] === dice[1] && dice[1] === dice[2]
  if (tab === 'TOTAL') return { t: String(s), c: s >= 11 ? HATTRICK.big : HATTRICK.small }
  if (tab === 'B-S') {
    if (triple) return { t: 'T', c: HATTRICK.gold, dark: true }   // 豹子通杀期
    return s >= 11 ? { t: 'B', c: HATTRICK.big } : { t: 'S', c: HATTRICK.small }
  }
  // TRIPLE 页：豹子期金珠，其余灰珠
  return triple
    ? { t: String(dice[0]), c: HATTRICK.gold, dark: true }
    : { t: '', c: 'rgba(255,255,255,0.14)' }
}

// ---------- 三骰舞台：单一 rAF 循环驱动（禁 CSS transition 拼接）----------
// 三骰从上方错峰抛入草皮台面：抛物线下坠 + 落地弹跳衰减（指数衰减 |sin|）+
// 旋转翻面（滚动中骰面快速轮换制造模糊感），各自定格到 pendingRef 骰面
// （亮金描边一闪 + 2px/100ms 轻震）；三骰全定后 TOTAL 金色滚动累加定格，
// 豹子期额外金光爆闪一次，onFinale 预亮命中盘区。骰面结果进场前已锁定，动画只读。
function DiceStage({ roll, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) {
      cbRef.current.onFinale?.()
      if (import.meta.env.DEV) window.__HAT_ANIM_LAST = roll.dice.join(',')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__HAT_RAF_ACTIVE = (window.__HAT_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    const BOUNCES = 2.5                    // 落地后 2-3 次衰减弹跳
    const locked = [false, false, false]
    const flashAt = [0, 0, 0]
    const knocksFired = [0, 0, 0]
    let whooshed = false, finaleFired = false, finaleAt = 0, shakeUntil = 0
    let raf = 0
    const t0 = performance.now()
    const easeOut = p => 1 - Math.pow(1 - p, 3)

    // 每骰触地时刻表（landing + 弹跳过零点，knock 音量随之衰减）
    const knockTimes = DIE_START.map((st, i) => {
      const land = st + FALL_DUR
      const bDur = DIE_LOCK[i] - land
      return [land, land + (1 / BOUNCES) * bDur, land + (2 / BOUNCES) * bDur]
    })

    // canvas 重画骰面：复用 DieFace 的 3×3 宫格点位表，白面近黑点
    const drawDie = (x, y, size, face, angle, flashA, blur) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      const h = size / 2
      ctx.fillStyle = HATTRICK.face
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.roundRect(-h, -h, size, size, size * 0.2)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = blur ? 'rgba(16,25,35,0.6)' : HATTRICK.pip
      for (const idx of PIPS[face]) {
        const col = idx % 3, row = Math.floor(idx / 3)
        ctx.beginPath()
        ctx.arc((col - 1) * size * 0.27, (row - 1) * size * 0.27, size * 0.09, 0, Math.PI * 2)
        ctx.fill()
      }
      if (flashA > 0) {   // 定格亮金描边一闪（300ms 渐隐）
        ctx.strokeStyle = `rgba(255,213,79,${flashA})`
        ctx.lineWidth = 3 * dpr
        ctx.beginPath()
        ctx.roundRect(-h, -h, size, size, size * 0.2)
        ctx.stroke()
      }
      ctx.restore()
    }

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      if (!whooshed) { whooshed = true; cbRef.current.sfx.whoosh() }

      ctx.clearRect(0, 0, W, H)
      const size = Math.min(H * 0.34, W * 0.13)
      const floorY = H * 0.46
      const xs = [W * 0.32, W * 0.5, W * 0.68]

      for (let i = 0; i < 3; i++) {
        const ti = t - DIE_START[i]
        if (ti < 0) continue   // 未抛入
        const x = xs[i]
        if (!locked[i] && t >= DIE_LOCK[i]) {
          locked[i] = true; flashAt[i] = now; shakeUntil = now + 100
          cbRef.current.sfx.snap()
        }
        while (knocksFired[i] < 3 && t >= knockTimes[i][knocksFired[i]]) {
          cbRef.current.sfx.knock([0.11, 0.055, 0.028][knocksFired[i]])
          knocksFired[i] += 1
        }

        let y, angle, face, blur = false
        // 旋转全程一条减速曲线，总转角 = 整数圈 → 定格时自然回正
        const spins = (3 + i) * Math.PI * 2
        if (locked[i]) {
          y = floorY; angle = 0; face = roll.dice[i]
        } else {
          angle = spins * easeOut(Math.min(1, ti / (DIE_LOCK[i] - DIE_START[i])))
          face = ((Math.floor(ti / 85) + i * 2) % 6) + 1   // 滚动中骰面快速轮换
          blur = true
          if (ti < FALL_DUR) {
            const p = ti / FALL_DUR
            y = floorY - (1 - p * p) * H * 0.9   // 抛物线加速下坠
          } else {
            const u = (ti - FALL_DUR) / (DIE_LOCK[i] - DIE_START[i] - FALL_DUR)
            y = floorY - Math.exp(-3 * u) * Math.abs(Math.sin(u * BOUNCES * Math.PI)) * H * 0.4
          }
        }
        // 草皮阴影（随高度缩放变淡）
        const hgt = Math.max(0, (floorY - y) / (H * 0.9))
        ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - hgt * 0.8)})`
        ctx.beginPath()
        ctx.ellipse(x, floorY + size * 0.62, size * (0.55 - hgt * 0.25), size * 0.12, 0, 0, Math.PI * 2)
        ctx.fill()
        const flashA = flashAt[i] && now - flashAt[i] < 300 ? 0.9 * (1 - (now - flashAt[i]) / 300) : 0
        drawDie(x, y, size, face, angle, flashA, blur)
      }

      // TOTAL 滚动累加 → 定格金闪；豹子期额外径向金光爆闪一次
      if (t >= DIE_LOCK[2]) {
        const shown = Math.round(roll.total * easeOut(Math.min(1, (t - DIE_LOCK[2]) / 500)))
        const isLockT = t >= TOTAL_LOCK
        if (!finaleFired && isLockT) {
          finaleFired = true; finaleAt = now
          cbRef.current.sfx.chime(roll.isTriple)
          cbRef.current.onFinale?.()
          if (import.meta.env.DEV) window.__HAT_ANIM_LAST = roll.dice.join(',')
        }
        if (finaleFired && roll.isTriple && now - finaleAt < 500) {
          const a = Math.sin(((now - finaleAt) / 500) * Math.PI) * 0.35
          const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.5)
          g.addColorStop(0, `rgba(255,213,79,${a})`)
          g.addColorStop(1, 'rgba(255,213,79,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        if (finaleFired) {   // 金光呼吸一次（~900ms 正弦）
          const k = Math.min(1, (now - finaleAt) / 900)
          ctx.shadowColor = HATTRICK.gold
          ctx.shadowBlur = Math.sin(k * Math.PI) * 22 * dpr
        }
        ctx.fillStyle = isLockT ? HATTRICK.gold : 'rgba(255,255,255,0.85)'
        ctx.font = `900 ${Math.round(H * 0.2)}px 'Space Grotesk', sans-serif`
        ctx.fillText(roll.isTriple && isLockT ? `TRIPLE ${roll.tripleFace}` : `TOTAL ${shown}`, W / 2, H * 0.85)
        ctx.shadowBlur = 0
      }

      if (shakeRef.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * 2}px, ${Math.cos(now / 5) * 1.5}px)`
          : ''
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__HAT_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；roll 由 key=期号换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 绝对定位铺满舞台槽：内容不参与 flex 高度分配，槽高各相位一致（由 min/max 定）
  if (reduced) {   // 减动效：静态直出三骰 + TOTAL
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {roll.dice.map((v, i) => <DieFace key={i} v={v} size={34} />)}
        <span style={{ color: HATTRICK.gold, fontSize: 18, fontWeight: 900 }}>
          {roll.isTriple ? `TRIPLE ${roll.tripleFace}` : `TOTAL ${roll.total}`}
        </span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden />
}

export default function HatTrick({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('TOTAL')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  const [gamePhase, setGamePhase] = useState('betting')   // betting | rolling | settled
  const [countdown, setCountdown] = useState(BETTING_T)   // tick(500ms)
  const [roundNo, setRoundNo] = useState(2)
  const [lastRoll, setLastRoll] = useState(SEED_LAST)
  const [recent, setRecent] = useState(SEED_RECENT)       // 近 5 期和值（新→旧）
  const [history, setHistory] = useState(SEED_HISTORY)    // 珠盘路（旧→新）
  const [result, setResult] = useState(null)              // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)            // 掷骰动画收尾的命中预亮
  const [toasts, setToasts] = useState([])

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
  function sfxWhoosh() {   // 抛骰：噪声上扫
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2000, t + 0.35)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.4)
  }
  function sfxKnock(vol) {   // 落地/弹跳：低频闷敲 + 木感 click（音量随弹跳衰减）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
    const len = Math.floor(ctx.sampleRate * 0.02)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource(); src.buffer = buf
    const g2 = ctx.createGain(); g2.gain.value = vol * 0.6
    src.connect(g2); g2.connect(ctx.destination); src.start(t); src.stop(t + 0.02)
  }
  function sfxSnap() {   // 每骰定格：短促咔 + 低敲
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.03)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.035)
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 190
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + 0.07)
  }
  function sfxChime(strong) {   // TOTAL 定格：上扬三连音；豹子期加一阶强化
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const notes = strong ? [660, 880, 1170, 1560] : [660, 880, 1170]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(strong ? 0.13 : 0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  const stageSfx = { whoosh: sfxWhoosh, knock: sfxKnock, snap: sfxSnap, chime: sfxChime }

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
    setLastRoll(r)
    setRecent(list => [r.total, ...list].slice(0, 5))
    setHistory(h => [...h, r.dice].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // 单 interval 驱动整台状态机（500ms/tick）；StrictMode 双挂载由 cleanup 兜底
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      if (ph === 'betting') {
        // 骰面此刻先定 — ROLLING 段（单3 动画）只读它，不再碰确定性随机数
        pendingRef.current = deriveRoll(rollDice())
        phaseRef.current = 'rolling'; setGamePhase('rolling')
        cdRef.current = ROLLING_T; setCountdown(ROLLING_T)
      } else if (ph === 'rolling') {
        settleRound()
        phaseRef.current = 'settled'; setGamePhase('settled')
        cdRef.current = SETTLED_T; setCountdown(SETTLED_T)
      } else {
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setPreHits(null)
        setFeedBets(makeFeedBots())
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
    if (phaseRef.current !== 'betting') return   // ROLLING/SETTLED 锁盘
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

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '4px 2px' : '7px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel
        ? HATTRICK.selTint
        : `linear-gradient(180deg, ${HATTRICK.ctrl}, ${HATTRICK.band})`,
      border: `1px solid ${hit ? HATTRICK.sel : sel || placed ? HATTRICK.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${HATTRICK.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: HATTRICK.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HATTRICK.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HATTRICK.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const secHead = { color: HATTRICK.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: 5,
    background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: HATTRICK.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )

  // TOTAL 4–17 小格（desk 14 连排 / mobile 7×2 折行不挤爆）
  const totalCell = s => {
    const key = `t-${s}`
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)
    const placed = betsPlaced.has(key)
    return (
      <button key={key} type="button" className="htCell" disabled={!betting} onClick={() => toggleSel(key)} style={{
        minWidth: 0, padding: '3px 0',
        borderRadius: 8, cursor: betting ? 'pointer' : 'not-allowed',
        background: hit ? HATTRICK.sel : sel ? HATTRICK.selTint : `linear-gradient(180deg, ${HATTRICK.ctrl}, ${HATTRICK.band})`,
        border: `1px solid ${hit ? HATTRICK.sel : sel || placed ? HATTRICK.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: hit ? '0 0 10px rgba(53,208,127,0.7)' : sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        opacity: betting || hit || placed ? 1 : 0.75,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        boxSizing: 'border-box', transition: 'background 0.1s, box-shadow 0.1s',
        position: 'relative',
      }}>
        <span style={{
          color: hit ? '#083a1b' : HATTRICK.text, fontSize: isMobile ? 12 : 13, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{s}</span>
        <span style={{ color: hit ? '#083a1b' : HATTRICK.gold, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800 }}>{ODDS.total[s]}</span>
        {stakeChip(key)}
      </button>
    )
  }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const phaseChip = gamePhase === 'betting'
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: HATTRICK.sel }
    : gamePhase === 'rolling'
      ? { text: '掷骰中…', c: HATTRICK.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: HATTRICK.gold }
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '4px 10px', borderRadius: RADIUS.pill,
      background: HATTRICK.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: HATTRICK.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(roundNo).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
        color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{phaseChip.text}</span>
      {/* 上期三骰迷你面（CSS 点阵） */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {lastRoll.dice.map((v, i) => <DieFace key={i} v={v} size={isMobile ? 16 : 18} />)}
      </span>
      {/* 近 5 期和值小串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {recent.map((s, i) => (
          <span key={`${s}-${i}`} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: s >= 11 ? HATTRICK.big : HATTRICK.small, color: COLORS.white,
            fontSize: 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
          }}>{s}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HATTRICK.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{lastRoll.isTriple ? `TRIPLE ${lastRoll.tripleFace}` : `TOTAL ${lastRoll.total}`}</span>
    </div>
  )

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  const ROAD_COLS = 20
  const beads = history.slice(-ROAD_CAP).map(d => beadFor(roadTab, d))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? HATTRICK.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : HATTRICK.dim,
            border: `1px solid ${roadTab === t ? HATTRICK.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(6, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: 15, height: 15, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: b?.dark ? '#3a2c00' : COLORS.white,
                fontSize: b && b.t.length > 1 ? 6.5 : 8.5, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${HATTRICK.bgCenter}, ${HATTRICK.bgOuter})`,
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
        background: HATTRICK.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>HAT TRICK ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: HATTRICK.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${HATTRICK.gold}`, color: HATTRICK.gold,
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

      {/* 轮次条 — desk 在骨架历史行，卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ① 开奖舞台槽（顶部，吃弹性空间 ≤260）：BETTING 静态回显上期三骰+TOTAL，
          ROLLING/SETTLED 换舞台动画（key=期号等高替换机制不变） */}
      <div style={{
        flex: '1 1 auto', minHeight: isMobile ? 150 : 140, maxHeight: 260,
        position: 'relative', zIndex: 1,
        margin: isMobile ? '8px 12px 0' : '8px 18px 0',
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box',
      }}>
        {gamePhase !== 'betting' && pendingRef.current ? (
          <DiceStage key={roundNo} roll={pendingRef.current}
            height="100%"
            shakeRef={cardShakeRef} sfx={stageSfx}
            onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{ color: HATTRICK.dim, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>上期</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {lastRoll.dice.map((v, i) => <DieFace key={i} v={v} size={isMobile ? 30 : 36} />)}
            </span>
            <span style={{
              color: HATTRICK.gold, fontSize: isMobile ? 16 : 20, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
            }}>{lastRoll.isTriple ? `TRIPLE ${lastRoll.tripleFace}` : `TOTAL ${lastRoll.total}`}</span>
          </div>
        )}
      </div>

      {/* ② 投注盘区三行（中部；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '6px 18px', boxSizing: 'border-box',
        gap: 5, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {/* 行① TOTAL：4–17 十四小格 + 大小单双四大格（豹子通杀） */}
        <div style={secBox}>
          <div style={secHead}>TOTAL · 和值 4–17</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(7, 1fr)' : 'repeat(14, 1fr)',
            gap: isMobile ? 3 : 4, marginBottom: 6,
          }}>
            {Array.from({ length: 14 }, (_, i) => totalCell(i + 4))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {SIDES.map(m => (
              <button key={m.key} type="button" className="htCell" disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5 }}>{ODDS.side.toFixed(2)}</span>
                <span style={{ color: HATTRICK.dim, fontSize: isMobile ? 7.5 : 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Triple loses</span>
                {stakeChip(m.key)}
              </button>
            ))}
          </div>
        </div>

        {/* 行② HAT TRICK：任意豹子 + 指定三同六格 */}
        <div style={secBox}>
          <div style={secHead}>HAT TRICK · 豹子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <button type="button" className="htCell" disabled={!betting} onClick={() => toggleSel('tr-any')}
              style={{ ...cellBtn('tr-any'), ...(isMobile ? { flex: '1 1 100%' } : { flex: 1.6 }) }}>
              <span style={cellName}>ANY TRIPLE</span>
              <span style={cellRange}>任意豹子</span>
              <span style={cellOdds}>{ODDS.anyTriple.toFixed(2)}</span>
              {stakeChip('tr-any')}
            </button>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className="htCell" disabled={!betting} onClick={() => toggleSel(`tr-${v}`)}
                style={{ ...cellBtn(`tr-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 13 : 15} />)}
                </span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11 }}>{ODDS.triple.toFixed(2)}</span>
                {stakeChip(`tr-${v}`)}
              </button>
            ))}
          </div>
        </div>

        {/* 行③ DOUBLE：指定对子六格（含该面豹子） */}
        <div style={secBox}>
          <div style={secHead}>DOUBLE · 对子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className="htCell" disabled={!betting} onClick={() => toggleSel(`d-${v}`)}
                style={{ ...cellBtn(`d-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 14 : 16} />)}
                </span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11 }}>{ODDS.double.toFixed(2)}</span>
                {stakeChip(`d-${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ③ 珠盘路（底部，三页签） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: HATTRICK.band,
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
            background: bet === v ? HATTRICK.selTint : HATTRICK.band,
            border: `1px solid ${bet === v ? HATTRICK.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
          }}>{v}</button>
        ))}
        <button type="button" disabled={!confirmOk} onClick={confirmBets} style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: HATTRICK.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: confirmOk ? 'pointer' : 'not-allowed',
          opacity: confirmOk ? 1 : 0.55,
        }}>
          {betting
            ? `▷ CONFIRM${picks.size > 0 ? ` $${confirmTotal.toFixed(0)}` : ''}`
            : gamePhase === 'rolling' ? '掷骰中…' : '本期已结算'}
        </button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Number Up ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Hat Trick</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 轮次条占骨架历史行位（34px 行惯例） */}
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
    <GameLayout title="Hat Trick" color={HATTRICK.sel}>
      <div ref={cardShakeRef}>
        {gameCard}
      </div>
    </GameLayout>
  )
}
