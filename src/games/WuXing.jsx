import { useState, useRef, useEffect, useMemo } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import SeedFairness from '../components/shell/SeedFairness'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'

// 五行 WuXing — KENO 20 球快开五项皮（80 池无放回抽 20 比总和），第 19 卡。
// X2：结算引擎 + 轮次状态机 + 赔率定稿（官方原生赔率 14 键出带 → 单据逐档调价，
//     1e6 复验 19 键全数入 94-97.5% 带，见 ODDS 注释）。
// X3：drawing 相位开奖舞台（20 球乱序快闪依次亮 + 总和/上下累加 + 分界慢放 +
//     总和砸出 + 五行段预亮）+ SFX（落球 tick/亮灯短哨/终场哨）；引擎/结算零改动。
// 算钱路径：placeBets() 唯一扣注入口（确认/重复共用），settleRound() 唯一赔付点。
// push 项：无——大小按官方 ≥811/≤810 对 210-1410 无重叠无空隙；龙虎/上下为三向盘
// （和 = 独立定价键，龙/虎/上/下遇和判输，官方无退注条款）；和局概率单列：
// 龙虎和 p≈0.1001、上下和 p≈0.2033（1e7）。
// 规则源（help.sbobet.com Keno Betting Rules #4304 原文转录，2026-07-06 实查）：
//   大 = 总和 ≥811 @1.95 / 小 = ≤810 @1.95；单双 @1.95
//   龙 = 总和右起第 2 位数字 @1.95 / 虎 = 末位数字 @1.95 / 龙虎和（两位相等）@9.00
//   上 = 1-40 号计数 >10 @2.30 / 下 = 41-80 计数 >10 @2.30 / 上下和（10-10）@4.30
//   过关四组合 大单/大双/小单/小双 @3.70
//   五行 金[210-695]9.20 / 木[696-763]4.60 / 水[764-855]2.40 / 火[856-923]4.60 / 土[924-1410]9.20
// 布局照 Line Up 定案：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底（grid 4列×2行）。

// ---------- 引擎（纯函数区，禁副作用）----------
// 开奖：80 池部分 Fisher-Yates 无放回抽 20；rng 可注入
export function drawKeno(rng = Math.random) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  for (let k = 0; k < 20; k++) {
    const j = k + Math.floor(rng() * (80 - k))
    ;[pool[k], pool[j]] = [pool[j], pool[k]]
  }
  return pool.slice(0, 20)
}

// 派生：总和/上盘计数/龙（和值十位）/虎（和值个位）——结算判定只读这一份
export function deriveRound(balls) {
  const sum = balls.reduce((x, y) => x + y, 0)
  return {
    balls: [...balls].sort((a, b) => a - b),
    sum,
    up: balls.filter(n => n <= 40).length,
    dragon: Math.floor(sum / 10) % 10,
    tiger: sum % 10,
  }
}

// 赔率常量表 — 集中一处（单据定稿 2026-07-06；概率 = 1e7 大样本 scratchpad/wx-sim.mjs）：
//   大 .4979×1.95=97.09% / 小 .5021×1.92=96.41%（中心 810 归小侧，降档回带）
//   单双 ≈.5000×1.95=97.50% 带沿
//   龙/虎 .4499×2.13=95.83% / 龙虎和 .1001×9.55=95.61%（三向盘和局判输）
//   上/下 .3985×2.40=95.6% / 上下和 .2033×4.70=95.55%
//   过关四键 .248-.252×3.82=94.7-96.2%
//   五行 金 .1022×9.35=95.60% / 木 .2018×4.72=95.25% / 水 .3880×2.46=95.45% /
//        火 .2034×4.72=96.03% / 土 .1045×9.10=95.09% —— 19 键全数入 94-97.5% 带
export const ODDS = {
  main: 1.95, small: 1.92, dt: 2.13, dtTie: 9.55, ud: 2.4, udTie: 4.7, parlay: 3.82,
  wxGold: 9.35, wxMid: 4.72, wxWater: 2.46, wxEarth: 9.1,
}

// 盘区判定表 — 数据驱动生成（19 键）；hit = 赢，无 push 项（三向盘和局判输）
export const MARKETS = {
  big: { odds: ODDS.main, hit: r => r.sum >= 811 },
  small: { odds: ODDS.small, hit: r => r.sum <= 810 },
  odd: { odds: ODDS.main, hit: r => r.sum % 2 === 1 },
  even: { odds: ODDS.main, hit: r => r.sum % 2 === 0 },
  dragon: { odds: ODDS.dt, hit: r => r.dragon > r.tiger },
  'dt-tie': { odds: ODDS.dtTie, hit: r => r.dragon === r.tiger },
  tiger: { odds: ODDS.dt, hit: r => r.tiger > r.dragon },
  up: { odds: ODDS.ud, hit: r => r.up > 10 },
  'ud-tie': { odds: ODDS.udTie, hit: r => r.up === 10 },
  down: { odds: ODDS.ud, hit: r => r.up < 10 },
  'big-odd': { odds: ODDS.parlay, hit: r => r.sum >= 811 && r.sum % 2 === 1 },
  'small-odd': { odds: ODDS.parlay, hit: r => r.sum <= 810 && r.sum % 2 === 1 },
  'big-even': { odds: ODDS.parlay, hit: r => r.sum >= 811 && r.sum % 2 === 0 },
  'small-even': { odds: ODDS.parlay, hit: r => r.sum <= 810 && r.sum % 2 === 0 },
  'wx-gold': { odds: ODDS.wxGold, hit: r => r.sum <= 695 },
  'wx-wood': { odds: ODDS.wxMid, hit: r => r.sum >= 696 && r.sum <= 763 },
  'wx-water': { odds: ODDS.wxWater, hit: r => r.sum >= 764 && r.sum <= 855 },
  'wx-fire': { odds: ODDS.wxMid, hit: r => r.sum >= 856 && r.sum <= 923 },
  'wx-earth': { odds: ODDS.wxEarth, hit: r => r.sum >= 924 },
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账/RTP 模拟从浏览器直接调引擎；__WX_FORCE 注入固定局（20 球数组）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__WX = { drawKeno, deriveRound, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const DRAW_T = 9        // 4.5s 开奖舞台（时间轴 ~3.9s 收尾留余量）
const SETTLED_T = 8     // 4s
const ROAD_CAP = 120
// 舞台时间轴（rAF 内使用，毫秒）：乱序亮球 → 总和砸出 → 五行段预亮
const ANIM_T0 = 250        // 首球亮起
const ANIM_GAPS = 2850     // 19 段间隔预算总和（慢放重分配，总长恒定）
const ANIM_FLASH = 280     // 亮前 0-9 快闪滚数窗口（70ms/帧 ≈ 4 帧）
const ANIM_POP = 150       // 亮球轻弹
const ANIM_SLAM = 3300     // 总和放大砸出 + 终场哨
const ANIM_WX = 3600       // 五行段亮灯 + 短哨
const WX_BOUNDS = [695, 763, 855, 923]   // 五行段分界（±30 慢放判定）

// ---------- 静态种子数据（纯展示，零随机数）----------
const G = GAME_BY_ID['WuXing']
const ROUND_DATE = 'GP20260706'

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期从 1–80 号池中抽 20 个球，20 球号码相加得到总和（范围 210–1410）。各盘口按这个总和以及派生数值判定。开球前下注，开奖后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 大 / 小：以 810 为界，大[≥811]约 1.95 倍 / 小[≤810]约 1.92 倍。\n· 单 / 双：按总和判定，约 1.95 倍。\n· 龙 / 虎 / 和：比较总和的十位数与个位数。十位大押龙约 2.13 倍，个位大押虎约 9.55 倍，相等押和约 9.55 倍。\n· 上 / 下 / 和：数落在 1–40 区间的球有多少个，超过 10 个押上约 2.4 倍，少于 10 个押下约 2.4 倍，恰好 10 个押和约 4.7 倍。\n· 过关：大小和单双的组合（大单 / 小单 / 大双 / 小双），约 3.82 倍。\n· 五行：按总和落在五个区间分金木水火土 —— 金[≤695] / 木[696-763] / 水[764-855] / 火[856-923] / 土[≥924]，赔率约 2.46 至 9.35 倍不等，越窄的区间赔越高。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '20 球开出后计算总和及派生数值，命中的盘口立即结算，赔付直接入余额。龙虎、上下的胜负盘遇「和」按输处理（不退本金）。每期独立。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半；想搏大赔押龙虎和、五行金土。\n· 龙虎、上下的胜负盘遇「和」算输，若担心可加押「和」对冲。\n· 本游戏理论返还率约 95–96%，属娱乐性质，理性游戏。',
  },
]
// 种子上局 = 规则页官方示例局：总和 693 → 小/单/龙9虎3(龙)/上13下7(上)/小单/金
// （真开奖逐期顶掉）
const SEED_LAST = deriveRound([1, 4, 5, 10, 11, 13, 20, 27, 30, 32, 33, 36, 40, 47, 54, 59, 61, 64, 67, 79])

// 五行五段（格底统一普通盘键色 DERBY.grey，与大小/单双一致；五行字/赔率保留）
const WUXING = [
  { key: 'wx-gold', name: '金', range: '210-695', odds: '9.35' },
  { key: 'wx-wood', name: '木', range: '696-763', odds: '4.72' },
  { key: 'wx-water', name: '水', range: '764-855', odds: '2.46' },
  { key: 'wx-fire', name: '火', range: '856-923', odds: '4.72' },
  { key: 'wx-earth', name: '土', range: '924-1410', odds: '9.10' },
]

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动）
const SEED_ROAD = [
  '小', '大', '大', '小', '大', '小', '小', '大', '大', '小',
  '大', '小', '大', '大', '小', '大', '小', '大', '小', '小',
  '大', '小', '小', '大', '小', '大', '大', '小', '大', '大',
  '小', '大', '小', '大', '大', '小', '大', '小', '小', '大',
]

// ---------- 开奖舞台（drawing 相位；结果进相前已锁定，动画只读）----------
// 亮球乱序 + 慢放编排全部由已锁结果播种/推导（mulberry32，零额外随机数）：
// 慢放球 = 累加和落点逼近五行分界 ±30 的球 + 末 3 球，其余段等比压缩补偿，
// 19 段间隔总和恒 = ANIM_GAPS（时间轴总长零改动）
function buildPlan(round) {
  let a = 0x2f6e2b1
  round.balls.forEach((n, i) => { a = (Math.imul(a, 31) + n + i + 1) >>> 0 })
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: 20 }, (_, i) => i)
  for (let i = 19; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  // 慢放权重：分界逼近球 / 末 3 球 = 1.75，其余 1；间隔 = 预算 × 权重占比
  let cum = 0
  const weights = order.map((idx, k) => {
    cum += round.balls[idx]
    const nearBound = WX_BOUNDS.some(b => Math.abs(cum - b) <= 30)
    return (nearBound || k >= 17) ? 1.75 : 1
  })
  const wSum = weights.slice(1).reduce((x, y) => x + y, 0)   // 19 段（首球走 T0）
  const launches = [ANIM_T0]
  for (let k = 1; k < 20; k++) launches.push(launches[k - 1] + ANIM_GAPS * weights[k] / wSum)
  return { order, launches }
}

// t 时刻舞台视图（纯函数）：lit[i]/flash/popAge 按格位；总和/上下计数只算已亮球
function animViewAt(round, plan, t) {
  const lit = new Array(20).fill(false)
  const flash = new Map()
  const popAge = new Map()
  let sum = 0, up = 0
  plan.order.forEach((idx, k) => {
    const at = plan.launches[k]
    if (t >= at) {
      lit[idx] = true
      sum += round.balls[idx]
      if (round.balls[idx] <= 40) up++
      if (t - at < ANIM_POP) popAge.set(idx, t - at)
    } else if (t >= at - ANIM_FLASH) {
      const fr = Math.floor((t - (at - ANIM_FLASH)) / 70)
      flash.set(idx, ((round.balls[idx] * 7 + fr * 13 + idx * 3) % 80) + 1)   // 伪滚号，零随机数
    }
  })
  return { lit, flash, popAge, sum, up, litN: lit.filter(Boolean).length, slamAge: t >= ANIM_SLAM ? t - ANIM_SLAM : null }
}

// 单 rAF 循环驱动整条时间轴；key=期号重挂载；sfx 全部挂 rAF 帧内（防双发已验接法）；
// StrictMode 双挂载由 cleanup 兜底；prefers-reduced-motion 直出终态
function DrawStage({ round, sfx, onFinale, children }) {
  const [, setFrame] = useState(0)
  const tRef = useRef(0)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const plan = useMemo(() => buildPlan(round), [round])

  useEffect(() => {
    if (reduced) {
      if (import.meta.env.DEV) window.__WX_ANIM_LAST = String(round.sum)
      cbRef.current.onFinale?.()
      return
    }
    if (import.meta.env.DEV) window.__WX_RAF_ACTIVE = (window.__WX_RAF_ACTIVE || 0) + 1
    const landed = new Array(20).fill(false)
    let slammed = false, wxLit = false
    let raf = 0
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      tRef.current = t
      plan.order.forEach((idx, k) => {
        if (!landed[k] && t >= plan.launches[k]) {
          landed[k] = true
          cbRef.current.sfx.tick?.(k)
        }
      })
      if (t >= ANIM_SLAM && !slammed) {
        slammed = true
        cbRef.current.sfx.final?.()
        if (import.meta.env.DEV) window.__WX_ANIM_LAST = String(round.sum)
      }
      if (t >= ANIM_WX && !wxLit) {
        wxLit = true
        cbRef.current.sfx.wx?.()
        cbRef.current.onFinale?.()   // 五行段预亮（settled 相位交给既有 result.hits）
      }
      setFrame(f => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) window.__WX_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return children(animViewAt(round, plan, reduced ? ANIM_WX + 500 : tRef.current))
}

const genIdemKey = () => (crypto.randomUUID ? crypto.randomUUID() : `wuxing-${Date.now()}-${Math.random()}`)

export default function WuXing({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [fairOpen, setFairOpen] = useState(false)   // 可验证公平抽屉
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [hasLast, setHasLast] = useState(false)
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ---- 轮次状态机 ----
  // betting | drawing | settled
  const [gamePhase, setGamePhase] = useState('betting')
  const [countdown, setCountdown] = useState(BETTING_T)
  const [roundNo, setRoundNo] = useState(88)
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)           // 舞台尾五行段预亮
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const lastBetsRef = useRef(new Map())
  const betRef = useRef(bet)
  const balanceRef = useRef(serverBalance)
  const pendingRef = useRef(null)
  const pendingDataRef = useRef(null)   // 后端 /wuxing/play 返回（settleRound 消费）
  const transitioningRef = useRef(false)  // 开奖 POST 进行中，防 tick 重入
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { balanceRef.current = serverBalance }, [serverBalance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 已验配方，对齐 Line Up/Derby 有声版；muted 门控，
  // 触发全部挂 rAF 帧内防双发；全程短音无持续底噪，无掩蔽坑）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  const probe = name => {
    if (import.meta.env.DEV) console.debug(`[WX-SFX] ${name} fired ctx=${audioRef.current.ctx?.state ?? 'null'} muted=${audioRef.current.muted}`)
  }
  function sfxTick(k) {   // 落球 tick：短 blip，音高随落球序缓升（20 连发）
    const ctx = ensureAudio(); probe(`tick#${k}`); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    const f = 480 + k * 10
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.04)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
  }
  function sfxWx() {   // 五行段亮灯：短哨单响
    const ctx = ensureAudio(); probe('wx'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.setValueAtTime(2100, t); o.frequency.linearRampToValueAtTime(2350, t + 0.1)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.13)
  }
  function sfxFinal() {   // 总和砸出：终场哨两响（次响拉长）
    const ctx = ensureAudio(); probe('final'); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[[0, 0.14], [0.2, 0.3]].forEach(([off, len]) => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2050, t + off); o.frequency.linearRampToValueAtTime(2400, t + off + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.04, t + off + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + off + len)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + len + 0.02)
    })
  }
  const stageSfx = { tick: sfxTick, wx: sfxWx, final: sfxFinal }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 后端请求封装（余额只认后端 balanceAfter）
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
  const stagedTotal = () => [...betsRef.current.values()].reduce((a, b) => round2(a + b), 0)

  // 唯一赔付点：读后端 /wuxing/play 结算结果（命中/赔付/余额全认后端；无 push 项）
  function settleRound() {
    const r = pendingRef.current
    const data = pendingDataRef.current
    let hits, winTotal
    if (data) {
      // 后端结算：命中高亮 = outcome 非 lose（龙虎和局 dragon/tiger 为 lose，dt-tie hit）；余额只认 balanceAfter
      hits = new Set(Object.entries(data.perKeyOutcome || {}).filter(([, v]) => v.outcome !== 'lose').map(([k]) => k))
      winTotal = Number(data.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
      if (data.balanceAfter != null) setServerBalance(Number(data.balanceAfter))
    } else {
      // 无注/开奖失败：仅显示，不动钱
      hits = hitsOf(r); winTotal = 0
    }
    setLastRound(r)
    setRoad(h => [...h, r.sum >= 811 ? '大' : '小'].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // 单 interval 驱动整台状态机（500ms/tick）；StrictMode 双挂载由 cleanup 兜底
  useEffect(() => {
    const id = setInterval(async () => {
      if (transitioningRef.current) return   // 开奖 POST 进行中，别再 tick
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      const go = (next, ticks) => {
        phaseRef.current = next; setGamePhase(next)
        cdRef.current = ticks; setCountdown(ticks)
      }
      if (ph === 'betting') {
        // 结果此刻锁定 —— 有注则走后端开奖+结算，无注则本地开奖仅显示（不动钱）
        if (betsRef.current.size > 0) {
          transitioningRef.current = true
          try {
            const data = await apiPost('/round/wuxing/play', { bets: Object.fromEntries(betsRef.current), idempotencyKey: genIdemKey() })
            pendingDataRef.current = data
            pendingRef.current = deriveRound(data.drawResult.balls)   // ← 后端 20 球（龙虎/和值按后端球算，不本地 drawKeno）
          } catch (e) {
            setNetErr(e.message)
            pendingDataRef.current = null
            pendingRef.current = deriveRound(drawKeno())   // 失败：本地开奖仅显示，注单未扣（暂存不扣钱）
          }
          transitioningRef.current = false
        } else {
          pendingDataRef.current = null
          let balls = null
          if (import.meta.env.DEV && window.__WX_FORCE) {   // 对账注入口（一次性消费）
            balls = window.__WX_FORCE; window.__WX_FORCE = null
          }
          pendingRef.current = deriveRound(balls || drawKeno())
        }
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
        setPreHits(null)
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

  // 唯一暂存点：确认/重复两个入口都走这一条（暂存不扣钱，钱只在开奖 POST 那一刻走）
  function placeBets(entries) {
    if (phaseRef.current !== 'betting') return false
    let total = 0
    entries.forEach(x => { total = round2(total + x) })
    // 暂存不扣钱：已暂存总额 + 本次不能超过后端余额
    if (!entries.size || total <= 0 || (serverBalance != null && total > round2(serverBalance - stagedTotal()))) return false
    setNetErr(null)
    entries.forEach((x, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + x)))
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
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= round2(serverBalance - stagedTotal()))
  let lastTotal = 0
  lastBetsRef.current.forEach(x => { lastTotal = round2(lastTotal + x) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= round2(serverBalance - stagedTotal()))
  const cur = pendingRef.current
  const shown = gamePhase === 'settled' && cur ? cur : lastRound

  // ---- 样式件（选中=金框，同 Line Up 惯例）----
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，舞台尾五行段先预亮
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
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 单行键（名称左/区间中/赔率右，照 Line Up 定案行式）
  const rowCell = (key, name, range, odds, bg = DERBY.grey) => (
    <button key={key} type="button" className="wxCell" data-key={key} disabled={!betting} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{odds}</span>
      {stakeChip(key)}
    </button>
  )

  // ---- 顶栏（共享件）----
  const phaseChip = betting
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: DERBY.sel }
    : drawing
      ? { text: '开奖中…', c: DERBY.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName}
        roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
        phaseChip={phaseChipNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onFairness={() => setFairOpen(true)} />
      <SeedFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} playerToken={playerToken} game={G.backendId} />
      {netErr && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800,
        }} onClick={() => setNetErr(null)}>{netErr}</div>
      )}
    </>
  )

  // ---- ① 开奖区：20 球两行×10 + 龙虎/上下计数 + 总和大字 ----
  // drawing 相位挂舞台（乱序快闪依次亮 + 累加滚动）；静态与舞台共用 zoneBody
  const ball = isMobile ? 26 : isDesk ? 26 : 30
  const zBalls = drawing && cur ? cur.balls : shown.balls
  const staticView = { lit: null, flash: null, popAge: null, sum: shown.sum, up: shown.up, litN: 20, slamAge: null }
  const zoneBody = view => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>
          {drawing ? '开奖中…' : gamePhase === 'settled' ? '开奖 · 本局' : '开奖 · 上局'}
        </span>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>80 池 · 20 球</span>
      </div>
      {/* 两行 ×10 球：上盘 1-40 蓝 / 下盘 41-80 红；舞台三态 待亮/快闪滚号/已亮+轻弹 */}
      {[0, 1].map(r => (
        <div key={r} style={{ display: 'flex', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
          {zBalls.slice(r * 10, r * 10 + 10).map((n, ci) => {
            const i = r * 10 + ci
            const isLit = !view.lit || view.lit[i]
            const f = view.flash?.get(i)
            const pop = view.popAge?.get(i)
            const scale = pop != null ? 1.3 - 0.3 * (pop / ANIM_POP) : 1
            return (
              <span key={i} data-ball={n} data-lit={isLit ? 1 : 0} style={{
                width: ball, height: ball, borderRadius: '50%',
                background: isLit
                  ? (n <= 40 ? DERBY.home : DERBY.away)
                  : f != null ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(0,0,0,0.35)',
                boxShadow: isLit ? 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)' : 'none',
                color: isLit ? COLORS.white : 'rgba(255,255,255,0.7)',
                fontSize: ball * 0.42, fontWeight: 900,
                fontFamily: "'Space Grotesk', sans-serif",
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box', flex: '0 0 auto',
                transform: `scale(${scale})`,
              }}>{isLit ? String(n).padStart(2, '0') : f != null ? String(f).padStart(2, '0') : ''}</span>
            )
          })}
        </div>
      ))}
      {/* 统计带：龙/虎随累加和实时刷新 + TOTAL 砸出放大一拍 + 上/下计数 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
      }}>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          龙 {Math.floor(view.sum / 10) % 10} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 虎 {view.sum % 10}
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
          transform: `scale(${view.slamAge != null ? 1 + 0.3 * Math.sin(Math.min(1, view.slamAge / 350) * Math.PI) : 1})`,
        }}>TOTAL {view.sum}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          上 {view.up} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 下 {view.litN - view.up}
        </span>
      </div>
    </>
  )
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 5,
      boxSizing: 'border-box',
    }}>
      {drawing && cur
        ? <DrawStage key={`${roundNo}-draw`} round={cur} sfx={stageSfx}
            onFinale={() => setPreHits(new Set([...hitsOf(pendingRef.current)].filter(k => k.startsWith('wx-'))))}>
            {zoneBody}
          </DrawStage>
        : zoneBody(staticView)}
    </div>
  )

  // ---- ② 盘区：主盘 / 龙虎·上下 / 过关四组合 / 五行五段 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 总和</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '811-1410', '1.95')}
        {rowCell('small', '小', '210-810', '1.92')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('odd', '单', '总和单', '1.95')}
        {rowCell('even', '双', '总和双', '1.95')}
      </div>
    </div>
  )
  const dtudBoard = (
    <div style={secBox}>
      <div style={secHead}>龙虎（和值十位/末位）｜ 上下（1-40/41-80 计数）</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('dragon', '龙', '十位', '2.13')}
        {rowCell('dt-tie', '龙虎和', '', '9.55')}
        {rowCell('tiger', '虎', '末位', '2.13')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('up', '上', '≥11 个', '2.40')}
        {rowCell('ud-tie', '上下和', '10-10', '4.70')}
        {rowCell('down', '下', '≥11 个', '2.40')}
      </div>
    </div>
  )
  const parlayBoard = (
    <div style={secBox}>
      <div style={secHead}>过关四组合</div>
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {rowCell('big-odd', '大单', '', '3.82')}
        {rowCell('small-odd', '小单', '', '3.82')}
        {rowCell('big-even', '大双', '', '3.82')}
        {rowCell('small-even', '小双', '', '3.82')}
      </div>
    </div>
  )
  // 五行五段：双端横排 5 列 grid（金→土），格内竖排 字大/区间小/赔率；
  // 430 区间小字降到 8px 保全字（禁截断禁溢出）
  const wuxingBoard = (
    <div style={secBox}>
      <div style={secHead}>五行 · 总和五段</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {WUXING.map(w => (
          <button key={w.key} type="button" className="wxCell" data-key={w.key} disabled={!betting} onClick={() => toggleSel(w.key)}
            style={{ ...cellBase(w.key, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px' }}>
            <span style={{ ...cellName, fontSize: isMobile ? 14 : 16 }}>{w.name}</span>
            <span style={{ ...cellRange, fontSize: isMobile ? 8 : 9.5 }}>{w.range}</span>
            <span style={cellOdds}>{w.odds}</span>
            {stakeChip(w.key)}
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式抄 Line Up）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
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
            const t = road.slice(-ROAD_CAP)[i]
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
      <style>{`.wxCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（desk 主盘/龙虎上下并排、过关/五行并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{dtudBoard}</div>
        </div>
        {/* 过关一行；五行 desk 独占整行（并排时五键各 ~104px 键内溢出实测，全宽后 ~190px） */}
        {parlayBoard}
        {wuxingBoard}
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
            <button key={v} type="button" className="wxChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
            boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
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
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
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
    <GameLayout color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
