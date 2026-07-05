import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY, ROULETTE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import carSpritesImg from '../assets/speedgrid/car_sprites.png'

// Speed Grid — DD24 结构 F1 皮（1-24 均匀抽 1 开冠军车号），第 18 卡。
// X2：结算引擎 + 轮次状态机 + 赔率定稿（DD24 官方规则页截图转录，无待核）。
// X3：drawing 相位冲线舞台（6 赛道车群摆动互有领先 → 冠军末段脱出 → 冲线定格
//     → 冠军车号大牌弹出）+ SFX（引擎轰鸣渐强/冲线哨/胜队短号角）；引擎/结算零改动。
//     sprite 四车 = 蓝/红/金/绿涂装（资产无黑车，黑队用绿车 canvas 压暗滤镜代）。
// 算钱路径：placeBets() 唯一扣注入口（确认/重复共用），settleRound() 唯一赔付点。
// 无 push 项：大小/单双/红黑/三段/车队/直选各组划分对 1-24 无重叠无空隙
// （scratchpad/sg-exact.mjs 全空间枚举确认：每组命中概率和恰为 1）。

// ---------- 引擎（纯函数区，禁副作用）----------
// 红黑归类（DD24 官方规则页转录）：
//   红 = {1,3,6,8,9,11,14,16,17,19,22,24}（12 个）；黑 = 其余 12 个
export const RED = new Set([1, 3, 6, 8, 9, 11, 14, 16, 17, 19, 22, 24])

// 开奖：1-24 均匀抽 1（单随机数）；rng 可注入
export function drawCar(rng = Math.random) {
  return 1 + Math.floor(rng() * 24)
}

// 赔率常量表 — 集中一处（24 局全空间精确枚举，见 scratchpad/sg-exact.mjs）：
//   大小/单双/红黑：p = 12/24 = 0.5 → 1.95 × 0.5 = 97.50%（带上沿）
//   三段（第1/2/3个8）：p = 8/24 = 1/3 → 2.90 / 3 = 96.67%
//   车号直选：p = 1/24 → 22.85 / 24 = 95.21%
//   车队（每队 6 车）：p = 6/24 = 0.25 → 3.85 × 0.25 = 96.25%（同 DD12 四色盘定价）
export const ODDS = { main: 1.95, section: 2.9, pick: 22.85, team: 3.85 }

// 盘区判定表 — 数据驱动生成（13 盘口键 + 24 直选键）；hit = 赢，无 push 项
export const MARKETS = {
  big: { odds: ODDS.main, hit: n => n >= 13 },
  small: { odds: ODDS.main, hit: n => n <= 12 },
  odd: { odds: ODDS.main, hit: n => n % 2 === 1 },
  even: { odds: ODDS.main, hit: n => n % 2 === 0 },
  red: { odds: ODDS.main, hit: n => RED.has(n) },
  black: { odds: ODDS.main, hit: n => !RED.has(n) },
  'grid-front': { odds: ODDS.section, hit: n => n <= 8 },
  'grid-mid': { odds: ODDS.section, hit: n => n >= 9 && n <= 16 },
  'grid-rear': { odds: ODDS.section, hit: n => n >= 17 },
}
for (let t = 1; t <= 4; t++) {
  MARKETS[`team-${t}`] = { odds: ODDS.team, hit: n => Math.ceil(n / 6) === t }
}
for (let c = 1; c <= 24; c++) {
  MARKETS[`car-${c}`] = { odds: ODDS.pick, hit: n => n === c }
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = n => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(n)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账/RTP 模拟从浏览器直接调引擎；__SG_FORCE 注入固定局
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__SG = { drawCar, hitsOf, MARKETS, ODDS, RED }
}

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const DRAW_T = 9        // 4.5s 冲线舞台（时间轴 ~4.2s 收尾留余量）
const SETTLED_T = 8     // 4s
// 舞台时间轴（rAF 内使用，毫秒）
const RACE_T = 3300     // 冲线时刻（车群段 0-2300 摆动，2300 起冠军脱出）
const BREAK_T = 2300    // 冠军脱出起点
const FREEZE_T = 3400   // 定格 + 冠军大牌弹出
const VENUE = 'TOPAZ CIRCUIT'          // 架空赛道名（禁真实赛道名）
const ROUND_DATE = 'TC20260705'
const ROAD_CAP = 120
const SEED_CHAMP = 17                   // 种子上局冠军（真开奖逐期顶掉）

// 4 队涂装（色值全部 tokens 现组）：蓝=DERBY.home / 红=DERBY.away /
// 金=COLORS.amberDeep / 黑=ROULETTE.black；每队 6 车按号段分组
const TEAMS = [
  { name: '蓝队', range: '1-6', c: DERBY.home },
  { name: '红队', range: '7-12', c: DERBY.away },
  { name: '金队', range: '13-18', c: COLORS.amberDeep },
  { name: '黑队', range: '19-24', c: ROULETTE.black },
]
const teamOf = n => TEAMS[Math.floor((n - 1) / 6)]

// 40 期假珠盘（大小单轨，旧→新；真开奖逐期顶掉）
const SEED_ROAD = [
  '大', '小', '小', '大', '小', '大', '大', '小', '小', '大',
  '大', '小', '大', '大', '小', '大', '小', '小', '大', '大',
  '小', '大', '小', '小', '大', '小', '大', '大', '大', '小',
  '小', '大', '小', '大', '小', '小', '大', '小', '大', '小',
]

// ---------- 冲线舞台（drawing 相位；结果进相前已锁定，动画只读）----------
// sprite 切图坐标（PIL 包围盒实测，1024² 表）：车头朝左，绘制时水平镜像向右行进
const SPRITES = [
  [17, 596, 474, 119],   // 蓝队 BL
  [21, 286, 474, 119],   // 红队 TL
  [518, 288, 474, 119],  // 金队 TR
  [516, 597, 474, 119],  // 黑队（绿车 BR，压暗滤镜代黑涂装）
]

// 陪跑 5 车从冠军号播种伪随机取（mulberry32，零额外随机数消耗）
function pacersFrom(champ) {
  let a = (Math.imul(champ, 0x9e3779b1) + 0x2f6e2b1) >>> 0
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pool = []
  for (let n = 1; n <= 24; n++) if (n !== champ) pool.push(n)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  // 每车速度系数/摆动相位一并播种（纯装饰，冠军结果不受影响）
  return pool.slice(0, 5).map((n, i) => ({
    n, f: 0.88 + rng() * 0.08, ph: rng() * Math.PI * 2, lane: 0, idx: i,
  }))
}

// 单 rAF 循环驱动整条时间轴；key=期号重挂载；sfx 在结果已锁后触发；
// StrictMode 双挂载由 cleanup 兜底；prefers-reduced-motion 直出终态帧
function RaceStage({ champ, sfx }) {
  const canvasRef = useRef(null)
  const cbRef = useRef(sfx)
  cbRef.current = sfx
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)
    const sheet = new Image()
    sheet.src = carSpritesImg

    // 车列：冠军 + 5 陪跑，车道 = 固定映射（冠军道由号派生）
    const pacers = pacersFrom(champ)
    const champLane = (champ - 1) % 6
    const lanes = []
    let pi = 0
    for (let l = 0; l < 6; l++) {
      if (l === champLane) lanes.push({ n: champ, f: 1, ph: (champ % 7) / 7 * Math.PI * 2, isChamp: true })
      else lanes.push({ ...pacers[pi++], isChamp: false })
    }

    let whistled = false, cheered = false, horned = false, marked = false
    let raf = 0
    if (import.meta.env.DEV) window.__SG_CONF = null   // 彩带几何记录重置

    const frame = t => {
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)
      const laneH = H / 6
      const carH = laneH * 0.72
      const carW = carH * (474 / 119)
      const startX = 6 * dpr
      const finishX = W - 26 * dpr
      const span = finishX - startX - carW

      // —— 赛道纹理：车道分隔虚线 + 后掠速度线（随时间左移）——
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([6 * dpr, 8 * dpr])
      for (let l = 1; l < 6; l++) {
        ctx.beginPath(); ctx.moveTo(0, l * laneH); ctx.lineTo(W, l * laneH); ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      const dash = 26 * dpr
      const off = (t * 0.45 * dpr) % (dash * 2)
      for (let l = 0; l < 6; l++) {
        for (let x = -off; x < W; x += dash * 2) {
          ctx.fillRect(x, l * laneH + laneH * 0.5, dash * 0.6, 1.5 * dpr)
        }
      }
      // —— 冲线格挡旗（右缘双列棋盘格）——
      const cell = 5 * dpr
      for (let y = 0; y < H; y += cell) {
        for (let c = 0; c < 2; c++) {
          ctx.fillStyle = ((y / cell + c) % 2 < 1) ? COLORS.white : ROULETTE.black
          ctx.fillRect(finishX + carW * 0.5 + c * cell, y, cell, cell)
        }
      }

      // —— 位置计算（纯 t 函数；冠军全程不掉出前二：对第二名钳位）——
      const tc = Math.min(t, RACE_T)
      const sway = tc < BREAK_T ? 1 - (tc / BREAK_T) * 0.35 : 0.65 * (1 - Math.min(1, (tc - BREAK_T) / 700))
      const xs = lanes.map(c => {
        let x = startX + (tc / RACE_T) * span * c.f + Math.sin(tc / 260 + c.ph) * 9 * dpr * sway
        if (c.isChamp) {
          x = startX + (tc / RACE_T) * span + Math.sin(tc / 300 + c.ph) * 5 * dpr * sway
          if (tc > BREAK_T) x += ((tc - BREAK_T) / (RACE_T - BREAK_T)) * 30 * dpr   // 末段脱出
        }
        return x
      })
      const others = xs.filter((_, i) => !lanes[i].isChamp).sort((a, b) => b - a)
      const champI = lanes.findIndex(c => c.isChamp)
      xs[champI] = Math.max(xs[champI], others[1] + 2 * dpr)   // 前二钳位
      if (t >= RACE_T) xs[champI] = Math.max(xs[champI], finishX - carW)

      // —— 车（sprite 镜像向右；黑队压暗滤镜）——
      lanes.forEach((c, i) => {
        const team = Math.ceil(c.n / 6) - 1
        const [sx, sy, sw, sh] = SPRITES[team]
        const y = i * laneH + (laneH - carH) / 2
        if (sheet.complete && sheet.naturalWidth > 0) {
          ctx.save()
          ctx.translate(xs[i] + carW, y)
          ctx.scale(-1, 1)
          if (team === 3) ctx.filter = 'brightness(0.32) saturate(0.4)'
          ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, carW, carH)
          ctx.restore()
          ctx.filter = 'none'
        }
        // 车号小签
        ctx.fillStyle = c.isChamp ? DERBY.gold : 'rgba(255,255,255,0.75)'
        ctx.font = `900 ${Math.round(laneH * 0.36)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(c.n), xs[i] + carW * 0.5, y + carH * 0.5 - laneH * 0.34)
      })

      // —— 冠军彩带（照 Derby D4/D5 已验代码搬）：定格后 ~70 粒 2s 洒落，
      //    落区 = 舞台全宽（单赛道无主客半区语义），粒色 = 冠军车队涂装色系，
      //    参数全由粒序黄金比散列派生（零随机数），并入本 rAF 单环 ——
      if (t >= FREEZE_T) {
        const tcf = t - FREEZE_T
        const teamI = Math.ceil(champ / 6) - 1
        const teamColor = [DERBY.home, DERBY.away, COLORS.amberDeep, ROULETTE.black][teamI]
        for (let i = 0; i < 70; i++) {
          const delay = (i % 20) * 28
          const ti = tcf - delay
          if (ti < 0 || ti > 1400) continue
          const p = ti / 1400
          let x = ((i * 0.618034 + 0.137) % 1) * W + Math.sin(ti / 260 + i) * 14 * dpr
          x = Math.max(0, Math.min(W, x))
          const y = -16 * dpr + p * (H + 32 * dpr)
          const sz = (2.6 + (i % 3) * 1.1) * dpr
          ctx.globalAlpha = (0.5 + (i % 4) * 0.15) * (p > 0.82 ? (1 - p) / 0.18 : 1)
          ctx.fillStyle = i % 6 === 0 ? DERBY.gold : i % 6 === 3 ? COLORS.white : teamColor
          ctx.save(); ctx.translate(x, y); ctx.rotate(ti / 180 + i)
          ctx.fillRect(-sz / 2, -sz, sz, sz * 2)
          ctx.restore()
          if (import.meta.env.DEV) {
            const rec = window.__SG_CONF || (window.__SG_CONF = { team: teamI, minX: Infinity, maxX: -Infinity, W: 0, n: 0 })
            rec.W = W; rec.minX = Math.min(rec.minX, x); rec.maxX = Math.max(rec.maxX, x); rec.n++
          }
        }
        ctx.globalAlpha = 1
      }

      // —— 冲线定格：冠军车号大牌弹簧弹出（画布中央）——
      if (t >= FREEZE_T) {
        const τ = t - FREEZE_T
        const base = Math.min(1, τ / 160)
        const spring = τ <= 160 ? 1.35 : 1 + 0.35 * Math.exp(-(τ - 160) / 240) * Math.cos((τ - 160) / 110)
        const s = base * spring
        ctx.save()
        ctx.translate(W / 2, H / 2)
        ctx.scale(s, s)
        const pw = 64 * dpr, ph2 = 78 * dpr
        const team = Math.ceil(champ / 6) - 1
        ctx.fillStyle = [DERBY.home, DERBY.away, COLORS.amberDeep, ROULETTE.black][team]
        ctx.strokeStyle = DERBY.gold
        ctx.lineWidth = 2.5 * dpr
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(-pw / 2, -ph2 / 2, pw, ph2, 10 * dpr); else ctx.rect(-pw / 2, -ph2 / 2, pw, ph2)
        ctx.fill(); ctx.stroke()
        ctx.fillStyle = COLORS.white
        ctx.font = `900 ${30 * dpr}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(champ), 0, 1 * dpr)
        ctx.restore()
      }
    }

    if (reduced) {   // 减动效：直出终态帧，不起 rAF 不发声
      const once = () => frame(FREEZE_T + 500)
      if (sheet.complete) once(); else sheet.onload = once
      if (import.meta.env.DEV) window.__SG_ANIM_LAST = String(champ)
      return () => window.removeEventListener('resize', fit)
    }

    if (import.meta.env.DEV) window.__SG_RAF_ACTIVE = (window.__SG_RAF_ACTIVE || 0) + 1
    let engined = false
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      // 引擎轰鸣挂 rAF 首帧（非 effect 体）：StrictMode 首挂载的 rAF 在首帧前被
      // cleanup 取消，天然防双发（探针实录曾抓到 effect 体触发双响）
      if (!engined) {
        engined = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger engine t=', Math.round(t))
        cbRef.current.engine?.()
      }
      if (t >= RACE_T && !whistled) {
        whistled = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger whistle t=', Math.round(t))
        cbRef.current.whistle?.()
      }
      // 庆祝套（定格后）：欢呼先起，车队号角压轴叠加
      if (t >= FREEZE_T && !cheered) {
        cheered = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger cheer t=', Math.round(t))
        cbRef.current.cheer?.()
      }
      if (t >= FREEZE_T + 500 && !horned) {
        horned = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger horn t=', Math.round(t))
        cbRef.current.horn?.(Math.ceil(champ / 6) - 1)
      }
      if (t >= FREEZE_T && !marked) {
        marked = true
        if (import.meta.env.DEV) window.__SG_ANIM_LAST = String(champ)
      }
      frame(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (import.meta.env.DEV) window.__SG_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} data-champ={champ} style={{ width: '100%', height: 128, display: 'block' }} aria-hidden />
}

export default function SpeedGrid({ balance, setBalance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [hasLast, setHasLast] = useState(false)
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ---- 轮次状态机 ----
  // betting | drawing | settled
  const [gamePhase, setGamePhase] = useState('betting')
  const [countdown, setCountdown] = useState(BETTING_T)
  const [roundNo, setRoundNo] = useState(88)
  const [lastChamp, setLastChamp] = useState(SEED_CHAMP)
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)             // { champ, hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const lastBetsRef = useRef(new Map())
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已锁后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    if (import.meta.env.DEV) console.debug('[SG-SFX] ctx-created state=', ctx.state)
    audioRef.current.ctx = ctx; return ctx
  }
  // DEV 探针：三音触发实录（触发了没响 vs 根本没触发，修法不同）
  const probe = (name, extra = '') => {
    if (import.meta.env.DEV) console.debug(`[SG-SFX] ${name} fired ctx=${audioRef.current.ctx?.state ?? 'null'} muted=${audioRef.current.muted} ${extra}`)
  }
  function sfxEngine() {   // 引擎轰鸣：满程底噪（快攻 0.25s → 渐强 → 平台撑到冲线 → 收尾接哨）
    const ctx = ensureAudio(); probe('engine'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    // 包络时刻对齐舞台时间轴：0.25s 攻至可闻 0.07 → 2.9s 渐强至 0.14 →
    // 平台撑到 3.3s（= RACE_T 冲线哨响起）→ 3.4s 硬切（100ms；给 3400ms 起的
    // 欢呼让出频谱——掩蔽终查根因，Derby 欢呼起时无持续底噪）
    const len = 3.5
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(260, t)
    f.frequency.linearRampToValueAtTime(520, t + 3.3)   // 提频到冲线
    const env = (g, atk, peak) => {
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(atk, t + 0.25)
      g.gain.exponentialRampToValueAtTime(peak, t + 2.9)
      g.gain.setValueAtTime(peak, t + 3.3)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)   // 冲线即刻硬切
    }
    const g = ctx.createGain(); env(g, 0.07, 0.14)
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + len)
    audioRef.current.engineGains = [g]   // 欢呼探针实测轰鸣残余增益用
    // 马达基音：低频锯齿随赛程升调（60→110Hz），同包络
    const o = ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(60, t); o.frequency.linearRampToValueAtTime(110, t + 3.3)
    const g2 = ctx.createGain(); env(g2, 0.035, 0.06)
    o.connect(g2); g2.connect(ctx.destination); o.start(t); o.stop(t + len)
    audioRef.current.engineGains.push(g2)
    if (import.meta.env.DEV) console.debug('[SG-SFX] engine env start=0 attack@250ms=0.07 peak@2900ms=0.14 hold→3300ms hardcut→3400ms stop=3500ms')
  }
  function sfxWhistle() {   // 冲线哨（短哨两响）
    const ctx = ensureAudio(); probe('whistle'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[0, 0.16].forEach(off => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2100, t + off); o.frequency.linearRampToValueAtTime(2350, t + off + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.035, t + off + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.13)
    })
  }
  function sfxHorn(teamIdx) {   // 胜出车队短号角：锯齿双音，音高随队别
    const ctx = ensureAudio(); probe('horn', `team=${teamIdx}`); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const f0 = 240 + teamIdx * 50
    ;[f0, f0 * 1.25].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
      const g = ctx.createGain()
      const s = t + i * 0.18
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.08, s + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26)
    })
  }
  function sfxCheer() {   // 观众欢呼声浪（照 Derby sfxCheer 已验配方：带通白噪 swell ~1.6s）
    const ctx = ensureAudio(); probe('cheer'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = 1.6
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + len)
    if (import.meta.env.DEV) {
      const eg = (audioRef.current.engineGains || []).map(x => +x.gain.value.toFixed(4))
      console.debug('[SG-SFX] cheer env swell@350ms=0.12 release→1600ms engineGainAtCheer=', JSON.stringify(eg))
    }
  }
  const stageSfx = { engine: sfxEngine, whistle: sfxWhistle, horn: sfxHorn, cheer: sfxCheer }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账（无 push 项）
  function settleRound() {
    const champ = pendingRef.current
    const hits = hitsOf(champ)
    let winTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
    })
    if (winTotal > 0) {
      setBalance(b => round2(b + winTotal))
      pushToast('本期命中', winTotal)
    }
    setLastChamp(champ)
    setRoad(h => [...h, champ >= 13 ? '大' : '小'].slice(-ROAD_CAP))
    setResult({ champ, hits, winTotal })
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
      const go = (next, ticks) => {
        phaseRef.current = next; setGamePhase(next)
        cdRef.current = ticks; setCountdown(ticks)
      }
      if (ph === 'betting') {
        // 结果此刻锁定 — drawing 相只读
        let champ = null
        if (import.meta.env.DEV && window.__SG_FORCE) {   // 对账注入口（一次性消费）
          champ = window.__SG_FORCE; window.__SG_FORCE = null
        }
        pendingRef.current = champ || drawCar()
        go('drawing', DRAW_T)
      } else if (ph === 'drawing') {
        settleRound()
        go('settled', SETTLED_T)
      } else {
        // 清盘前快照本局注单（空局不覆盖，重复钮指向最近一张有效注单）
        if (betsRef.current.size) {
          lastBetsRef.current = new Map(betsRef.current)
          setHasLast(true)
        }
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setFeedBets(makeFeedBots())
        setRoundNo(n => n + 1)
        go('betting', BETTING_T)
      }
    }, TICK_MS)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSel = key => {
    if (phaseRef.current !== 'betting') return
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点：确认/重复两个入口都走这一条
  function placeBets(entries) {
    if (phaseRef.current !== 'betting') return false
    let total = 0
    entries.forEach(s => { total = round2(total + s) })
    if (!entries.size || total <= 0 || total > balanceRef.current) return false
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
    entries.forEach((s, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + s)))
    setBetsPlaced(new Map(betsRef.current))
    return true
  }
  function confirmBets() {
    const amount = betRef.current
    if (amount < 1) return
    if (placeBets(new Map([...picksRef.current].map(k => [k, amount])))) {
      picksRef.current = new Set()
      setPicks(new Set())
    }
  }
  function repeatBets() {
    placeBets(new Map(lastBetsRef.current))
  }

  const betting = gamePhase === 'betting'
  const drawing = gamePhase === 'drawing'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && lastTotal <= balance
  const cur = pendingRef.current
  const shownChamp = gamePhase === 'settled' && cur ? cur : lastChamp

  // ---- 样式件（选中=金框；命中=绿框绿晕）----
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = result?.hits?.has(key)
    const staked = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0,
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || staked ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )
  // 单行键（名称左/区间中/赔率右，照 Line Up 定案行式）
  const rowCell = (key, name, range, odds, bg = DERBY.grey) => (
    <button key={key} type="button" className="sgCell" data-key={key} disabled={!betting} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span>
      <span style={cellOdds}>{odds}</span>
      {stakeChip(key)}
    </button>
  )

  // ---- 顶栏（共享件）----
  const phaseChip = betting
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: DERBY.sel }
    : drawing
      ? { text: '冲线中…', c: DERBY.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const topBar = (
    <GameTopBar gameName="SPEED GRID" venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：冠军大牌 + 24 车号小网格（4 队涂装分组）----
  const champTeam = teamOf(shownChamp)
  const zoneTitle = drawing ? '冲线中…' : gamePhase === 'settled' ? '本局冠军' : '上局冠军'
  const mini = isMobile ? 22 : isDesk ? 24 : 28
  // drawing+settled 挂冲线舞台（定格帧+彩带跨相位展示，照 Derby D4 先例；
  // 下一期 betting 换静态上局块时卸载归零）；betting 走静态块
  const drawZone = (drawing || gamePhase === 'settled') && cur ? (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '6px 8px' : '6px 12px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      boxSizing: 'border-box', overflow: 'hidden',
    }}>
      <RaceStage key={`${roundNo}-race`} champ={cur} sfx={stageSfx} />
    </div>
  ) : (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {/* 冠军大牌 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{zoneTitle}</span>
        <span data-champ={shownChamp} style={{
          width: isMobile ? 54 : 64, height: isMobile ? 66 : 78, borderRadius: 10,
          background: champTeam.c,
          border: `2px solid ${DERBY.gold}`,
          boxShadow: '0 0 14px rgba(255,213,79,0.45), inset 0 2px 3px rgba(255,255,255,0.25)',
          color: COLORS.white, fontSize: isMobile ? 26 : 32, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{drawing ? '?' : shownChamp}</span>
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900 }}>
          {drawing ? '— · —' : `${champTeam.name} · ${champTeam.range}`}
        </span>
      </div>
      {/* 24 车号小网格：4 行 = 4 队涂装（冠军格金圈） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 4, flex: '0 0 auto' }}>
        {TEAMS.map((t, ti) => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 3 : 4 }}>
            {Array.from({ length: 6 }, (_, i) => {
              const n = ti * 6 + i + 1
              const lit = !drawing && n === shownChamp
              return (
                <span key={n} data-mini={n} style={{
                  width: mini, height: mini, borderRadius: 6,
                  background: t.c,
                  border: lit ? `2px solid ${DERBY.gold}` : '1px solid rgba(0,0,0,0.35)',
                  boxShadow: lit ? '0 0 8px rgba(255,213,79,0.6)' : 'inset 0 1px 2px rgba(255,255,255,0.22)',
                  color: COLORS.white, fontSize: mini * 0.42, fontWeight: 900,
                  fontFamily: "'Space Grotesk', sans-serif",
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', opacity: lit ? 1 : 0.85,
                }}>{n}</span>
              )
            })}
            <span style={{ color: DERBY.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap', marginLeft: 2 }}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  )

  // ---- ② 盘区：主盘 6 键 + 三段 3 键 + 车队 4 键 + 24 直选 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 冠军车号</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '13-24', MARKETS.big.odds.toFixed(2))}
        {rowCell('small', '小', '1-12', MARKETS.small.odds.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('odd', '单', '车号单', MARKETS.odd.odds.toFixed(2))}
        {rowCell('even', '双', '车号双', MARKETS.even.odds.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('red', '红', '12 红号', MARKETS.red.odds.toFixed(2), DERBY.away)}
        {rowCell('black', '黑', '12 黑号', MARKETS.black.odds.toFixed(2), ROULETTE.black)}
      </div>
    </div>
  )
  const rowBoard = (
    <div style={secBox}>
      <div style={secHead}>发车三段 · 第1/2/3个8 ｜ 车队涂装</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('grid-front', '头排', '1-8', MARKETS['grid-front'].odds.toFixed(2))}
        {rowCell('grid-mid', '中段', '9-16', MARKETS['grid-mid'].odds.toFixed(2))}
        {rowCell('grid-rear', '尾排', '17-24', MARKETS['grid-rear'].odds.toFixed(2))}
      </div>
      {/* 车队行：430 宽一行四键装不下（team-3/4 键内溢出实测），移动改 2×2；桌面保持一行 */}
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {TEAMS.map((t, i) => rowCell(`team-${i + 1}`, t.name, t.range, MARKETS[`team-${i + 1}`].odds.toFixed(2), t.c))}
      </div>
    </div>
  )
  const pickBoard = (
    <div style={secBox}>
      <div style={secHead}>车号直选 · 4×6</div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
        gap: isMobile ? 4 : 6,
      }}>
        {Array.from({ length: 24 }, (_, i) => {
          const n = i + 1
          const t = teamOf(n)
          return (
            <button key={n} type="button" className="sgCell" data-key={`car-${n}`} disabled={!betting} onClick={() => toggleSel(`car-${n}`)}
              style={{ ...cellBase(`car-${n}`, t.c), padding: isMobile ? '4px 0' : '5px 0' }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : 14, fontFamily: "'Space Grotesk', sans-serif" }}>{n}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 8.5 : 9.5 }}>{MARKETS[`car-${n}`].odds.toFixed(2)}</span>
              {stakeChip(`car-${n}`)}
            </button>
          )
        })}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式抄 Line Up；真历史滚动，容量 120）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const beads = road.slice(-ROAD_CAP)
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill,
          background: DERBY.sel, color: '#083a1b',
          border: `1px solid ${DERBY.sel}`,
          fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>大小</span>
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = beads[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: t ? (t === '大' ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{t || ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.sgCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（desk 主盘/三段并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{rowBoard}</div>
        </div>
        {pickBoard}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路 */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)',
          gap: 6,
          maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="sgChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
              boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px',
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>USD</span>
            <input
              value={bet}
              disabled={!betting}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 14, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={!repeatOk} onClick={repeatBets} style={{
            gridColumn: 3, gridRow: 2,
            width: '100%', height: '100%', borderRadius: 8,
            fontSize: 11, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: repeatOk ? DERBY.text : DERBY.dim,
            background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : gamePhase === 'settled' ? '已结算' : '已锁盘'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets}
              disabled={!confirmOk}
              stretch
            />
          </div>
        </div>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Line Up ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Speed Grid</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
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
    <GameLayout title="Speed Grid" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
