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
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useRoundRoom } from '../hooks/useRoundRoom'
import cardRedImg from '../assets/shared/card_red.png'
import cardYellowImg from '../assets/shared/card_yellow.png'

// Line Up — ATOM 5×5 数字彩（25 个 0-9 独立均匀随机数排成五行），第 17 卡。
// X2：结算引擎 + 轮次状态机 + 赔率参数化。开奖舞台动画走后续单（静态直出）。
// X3：投注盘 A/B 双视图（A 维度列表 / B 矩阵，42 键同源同 key，选中态互通）
//     + 注栏 grid 4列×2行 + 重复投注；MARKETS/结算零改动。
// X4：drawing 相位开奖舞台（25 格乱序砸落 + 滚数快闪 + 行和/TOTAL 累加滚动
//     + TOTAL 砸出）+ SFX（落格 tick/行满短哨/终场哨）；引擎/结算零改动。
// X6：开奖区红黄牌皮 —— Red(0,2,6,7,8)=红牌 / Black(1,3,4,5,9)=黄牌（共享
//     card_red/card_yellow 资产），主色/客色文案改黄牌/红牌；MARKETS key/结算零改动
//     （home-more/away-more 等键名沿用，仅显示层换皮）。
// 规则对照 /tmp/atom_ref/atom_rules.txt（help.sbobet.com Atom Betting Rules #4303）原文：
//   Red  = "drawn at 0, 2, 6, 7 and 8, which are classified as Red"   → 本作红牌
//   Black = "drawn at 1, 3, 4, 5 and 9, which are classified as Black" → 本作黄牌
//   High/Low = 5-9 / 0-4；全局判定 ≥13 计数、行式判定 ≥3 计数
//   段位 = Spring[0-95] 7.50 / Summer[96-112] 2.30 / Autumn[113-129] 2.30 / Winter[130-225] 7.50
//     （足球叙事换皮：降级区/中游/欧战区/夺冠）
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（本彩种无 push 项：
// 25/5 为奇数计数无平局，225/45 为奇数和值无中点格）。

// ---------- 引擎（纯函数区，禁副作用）----------
// 归类表（参考原文映射）：红牌 = Red(0,2,6,7,8)；黄牌 = Black(1,3,4,5,9)；高 = 5-9 / 低 = 0-4
// （键名沿用 away=红/home=黄 的 X1 命名，显示层 X6 起走红黄牌皮）
export const AWAY_DIGITS = new Set([0, 2, 6, 7, 8])
export const HIGH_DIGITS = new Set([5, 6, 7, 8, 9])

// 开奖：25 个独立均匀 0-9（可重复），rng 可注入
export function drawGrid(rng = Math.random) {
  return Array.from({ length: 25 }, () => Math.floor(rng() * 10))
}

// 派生：行切分/行和/总和/红黄牌计数/高低计数（全部结算判定只读这一份）
const sumOf = a => a.reduce((x, y) => x + y, 0)
export function deriveRound(cells) {
  const rows = [0, 1, 2, 3, 4].map(i => cells.slice(i * 5, i * 5 + 5))
  const rowSums = rows.map(sumOf)
  const rowAway = rows.map(r => r.filter(n => AWAY_DIGITS.has(n)).length)
  const total = sumOf(cells)
  const awayCount = cells.filter(n => AWAY_DIGITS.has(n)).length
  const highCount = cells.filter(n => HIGH_DIGITS.has(n)).length
  return {
    cells, rows, rowSums, rowAway, total,
    awayCount, homeCount: 25 - awayCount,
    highCount, lowCount: 25 - highCount,
  }
}

// 赔率常量表 — 集中一处（推导注释，BigInt 精确枚举对账 scratchpad/lineup-exact.mjs）：
//   二元盘（大小/单双/红黄牌/高低 + 行式全部）：真实概率精确 = 0.5 ——
//     和值分布关于 112.5（行 22.5）对称且 225/45 为奇数无中点质量；
//     计数盘每格恰好 5/5 数字二分、25/5 为奇数无平局 ⇒ 1.95 × 0.5 = 97.5%（带上沿）。
//   段位盘（单据定稿 2026-07-05）：精确概率 降级/夺冠 0.118991、中游/欧战 0.381009；
//     参考原版 7.50/2.30 → RTP 89.24%/87.63% 出带，按单调整为 8.00/2.50 →
//     RTP 95.19% / 95.25%，进 94-97.5% 带。
export const ODDS = { main: 1.95, edge: 8.0, mid: 2.5 }

// 盘区判定表 — 数据驱动生成（12 普通盘键 + 5×6 行式键）；hit = 赢，无 push 项
export const MARKETS = {
  big: { odds: ODDS.main, hit: r => r.total >= 113 },
  small: { odds: ODDS.main, hit: r => r.total <= 112 },
  odd: { odds: ODDS.main, hit: r => r.total % 2 === 1 },
  even: { odds: ODDS.main, hit: r => r.total % 2 === 0 },
  'home-more': { odds: ODDS.main, hit: r => r.homeCount >= 13 },
  'away-more': { odds: ODDS.main, hit: r => r.awayCount >= 13 },
  high: { odds: ODDS.main, hit: r => r.highCount >= 13 },
  low: { odds: ODDS.main, hit: r => r.lowCount >= 13 },
  'zone-releg': { odds: ODDS.edge, hit: r => r.total <= 95 },
  'zone-mid': { odds: ODDS.mid, hit: r => r.total >= 96 && r.total <= 112 },
  'zone-euro': { odds: ODDS.mid, hit: r => r.total >= 113 && r.total <= 129 },
  'zone-champ': { odds: ODDS.edge, hit: r => r.total >= 130 },
}
for (let i = 0; i < 5; i++) {
  MARKETS[`L${i + 1}-big`] = { odds: ODDS.main, hit: r => r.rowSums[i] >= 23 }
  MARKETS[`L${i + 1}-small`] = { odds: ODDS.main, hit: r => r.rowSums[i] <= 22 }
  MARKETS[`L${i + 1}-odd`] = { odds: ODDS.main, hit: r => r.rowSums[i] % 2 === 1 }
  MARKETS[`L${i + 1}-even`] = { odds: ODDS.main, hit: r => r.rowSums[i] % 2 === 0 }
  MARKETS[`L${i + 1}-home`] = { odds: ODDS.main, hit: r => r.rowAway[i] <= 2 }
  MARKETS[`L${i + 1}-away`] = { odds: ODDS.main, hit: r => r.rowAway[i] >= 3 }
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎；__LU_FORCE 注入固定局
// （下一期开奖直接用注入的 25 数，一次性消费；生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__LU = { drawGrid, deriveRound, hitsOf, MARKETS, ODDS }
}

// 舞台时间轴（rAF 内使用，毫秒）：乱序砸落 25 格 → TOTAL 放大砸出
const ANIM_T0 = 250       // 首格砸落时刻
const ANIM_GAP = 125      // 落格间隔（24×125+250 ≈ 3.25s 落完）
const ANIM_FLASH = 320    // 落定前 0-9 快闪滚数窗口（80ms/帧 ≈ 4 帧）
const ANIM_POP = 120      // 落格轻弹时长
const ANIM_SLAM = 3600    // TOTAL 放大砸出时刻
// 开奖动画总时长（收到 drawn → 开奖舞台演完 → 结算显示 + 回写余额）；须 < 服务器 lineup idle(5.5s)
const DRAW_ANIM_MS = 4500
const G = GAME_BY_ID['LineUp']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期开出 25 个数字（0–9），排成 5×5 的方格。每个数字既是一张牌（红牌或黄牌），也参与各行和总和的计算。你可以押总盘或单独某一行的盘口。开球前下注，开奖后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 大 / 小：25 格总和，以 112 为界，大[≥113] / 小[≤112]，约 1.95 倍。\n· 单 / 双：按总和判定，约 1.95 倍。\n· 红牌多 / 黄牌多：数字 0,2,6,7,8 为红牌、1,3,4,5,9 为黄牌，哪种多押哪边，约 1.95 倍。\n· 高 / 低：数字 5-9 为高、0-4 为低，哪种多押哪边，约 1.95 倍。\n· 段位：按总和落在四个区间 —— 降级区[≤95] / 中游[96-112] / 欧战区[113-129] / 夺冠[≥130]，两端约 8 倍、中间约 2.5 倍。\n· 行式盘：单独押某一行（L1 锋线到 L5 后卫）的大小/单双/红黄，约 1.95 倍。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '25 个数字开出后计算各行和总和，命中的盘口立即结算，赔付直接入余额。每期独立，上期不影响下期。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。切换「全局 / L1-L5」维度选行式盘。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双红黄，中奖率约一半；想搏大赔押段位两端（降级 / 夺冠）。\n· 行式盘让你聚焦单行走势，玩法更细。\n· 本游戏理论返还率约 95%，属娱乐性质，理性游戏。',
  },
]
const ROAD_CAP = 120
const ROW_LABELS = ['锋线', '前腰', '中场', '后腰', '后卫']   // L1-L5

// 种子上局（取自参考规则页 ATOM 25's 实拍局：行和 12/18/10/22/28，总和 90；
// 真开奖逐期顶掉）
const SEED_LAST = deriveRound([
  2, 6, 3, 1, 0,
  6, 0, 6, 1, 5,
  2, 0, 1, 7, 0,
  1, 6, 4, 9, 2,
  7, 4, 6, 6, 5,
])

// 40 期假珠盘（大小单轨，旧→新；真开奖逐期顶掉）
const SEED_ROAD = [
  '小', '大', '大', '小', '大', '小', '小', '大', '大', '大',
  '小', '大', '小', '小', '大', '小', '大', '大', '小', '小',
  '大', '小', '大', '大', '小', '大', '小', '小', '小', '大',
  '大', '小', '大', '小', '大', '大', '小', '大', '小', '大',
]

// 普通盘四区（足球叙事换皮，段位照参考原文；⚠ RTP 出带待定，见 ODDS 注释）
const ZONES = [
  { key: 'zone-releg', name: '降级区', range: '0–95' },
  { key: 'zone-mid', name: '中游', range: '96–112' },
  { key: 'zone-euro', name: '欧战区', range: '113–129' },
  { key: 'zone-champ', name: '夺冠', range: '130–225' },
]

// ---------- 开奖舞台（drawing 相位；结果进相前已全锁定，动画只读）----------
// 落格乱序从已锁结果派生（mulberry32 播种 + Fisher-Yates）——零额外随机数消耗，
// 引擎随机序列与动画解耦（已知坑：乱序若走 Math.random 会破坏引擎可复现性）
function orderFrom(cells) {
  let a = 0x2f6e2b1
  cells.forEach((d, i) => { a = (Math.imul(a, 31) + d * 7 + i + 1) >>> 0 })
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: 25 }, (_, i) => i)
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// t 时刻舞台视图（纯函数）：digits[i] = 已定格数字或 null；flash = 滚数快闪帧；
// popAge = 落格轻弹进度；slamAge = TOTAL 砸出进度；行和/计数只算已落格
function animViewAt(round, order, t) {
  const digits = new Array(25).fill(null)
  const flash = new Map()
  const popAge = new Map()
  order.forEach((cell, k) => {
    const landAt = ANIM_T0 + k * ANIM_GAP
    if (t >= landAt) {
      digits[cell] = round.cells[cell]
      if (t - landAt < ANIM_POP) popAge.set(cell, t - landAt)
    } else if (t >= landAt - ANIM_FLASH) {
      // 滚数帧 = 真值+格位派生的伪序列（零随机数）
      const fr = Math.floor((t - (landAt - ANIM_FLASH)) / 80)
      flash.set(cell, (round.cells[cell] * 3 + fr * 7 + cell) % 10)
    }
  })
  const rowSums = [0, 1, 2, 3, 4].map(ri =>
    digits.slice(ri * 5, ri * 5 + 5).reduce((x, y) => x + (y ?? 0), 0))
  let home = 0, away = 0, high = 0, low = 0
  digits.forEach(d => {
    if (d == null) return
    if (AWAY_DIGITS.has(d)) away++; else home++
    if (HIGH_DIGITS.has(d)) high++; else low++
  })
  return {
    digits, flash, popAge, rowSums,
    total: rowSums.reduce((x, y) => x + y, 0),
    homeCount: home, awayCount: away, highCount: high, lowCount: low,
    slamAge: t >= ANIM_SLAM ? t - ANIM_SLAM : null,
  }
}

// 单 rAF 循环驱动整条时间轴（禁 CSS transition 拼接）；key=期号保证重挂载；
// sfx 全部在结果已锁后触发；StrictMode 双挂载由 cleanup 兜底
function DrawStage({ round, sfx, children }) {
  const [, setFrame] = useState(0)
  const tRef = useRef(0)
  const cbRef = useRef(sfx)
  cbRef.current = sfx
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const order = useMemo(() => orderFrom(round.cells), [round])

  useEffect(() => {
    if (reduced) {   // 减动效：静态直出终态，不起 rAF 不发声
      if (import.meta.env.DEV) window.__LU_ANIM_LAST = round.cells.join(',')
      return
    }
    if (import.meta.env.DEV) window.__LU_RAF_ACTIVE = (window.__LU_RAF_ACTIVE || 0) + 1
    const landed = new Array(25).fill(false)
    const rowLand = new Array(5).fill(0)
    let slammed = false
    let raf = 0
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      tRef.current = t
      // —— 事件沿：落格 tick ×25 / 行满短哨 ×5 / TOTAL 终场哨 ——
      order.forEach((cell, k) => {
        if (landed[k] || t < ANIM_T0 + k * ANIM_GAP) return
        landed[k] = true
        cbRef.current.tick(k)
        const ri = Math.floor(cell / 5)
        if (++rowLand[ri] === 5) cbRef.current.row()
      })
      if (t >= ANIM_SLAM && !slammed) {
        slammed = true
        cbRef.current.final()
        if (import.meta.env.DEV) window.__LU_ANIM_LAST = round.cells.join(',')
      }
      setFrame(f => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) window.__LU_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return children(animViewAt(round, order, reduced ? Infinity : tRef.current))
}

export default function LineUp({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  const room = useRoundRoom(playerToken, G.backendId)

  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [view, setView] = useState('A')       // 投注盘视图：A 列表 / B 矩阵
  const [dim, setDim] = useState(0)           // A 视图维度：0 全局，1-5 行 L1-L5
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [animRound, setAnimRound] = useState(null)       // 当前开奖动画的派生局（deriveRound 结果）
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)            // 珠盘路（旧→新）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}（stake chip/重复/余额校验）
  const lastBetsRef = useRef(new Map())          // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生局（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取

  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，照 Derby 配方；muted 门控，全部在结果已锁后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxTick(k) {   // 落格 tick：短 blip，音高随落格序缓升（25 连发）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    const f = 460 + k * 9
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.04)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
  }
  function sfxRow() {   // 行满：短哨单响
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.setValueAtTime(2100, t); o.frequency.linearRampToValueAtTime(2350, t + 0.1)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.13)
  }
  function sfxFinal() {   // TOTAL 砸出：终场哨两响（次响拉长）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[[0, 0.14], [0.2, 0.3]].forEach(([off, len]) => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2050, t + off); o.frequency.linearRampToValueAtTime(2400, t + off + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.04, t + off + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + off + len)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + len + 0.02)
    })
  }
  const stageSfx = { tick: sfxTick, row: sfxRow, final: sfxFinal }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费；无 push 项）。
  function finishRound(rnd) {
    const r = pendingRef.current
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 余额回写（每期一次）：有注用后端 settleInfo.balanceAfter；无注不动钱。
    if (hadBet && si.balanceAfter != null && settledRoundRef.current !== rnd) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundRef.current = rnd
    // 视觉结算仅当本期仍是当前展示期（若下一期 betting 已抢先，跳过不覆盖新期 UI）
    if (shownRoundRef.current !== rnd) return
    let hits, winTotal
    if (hadBet) {
      hits = new Set((si.yourResult || []).filter(o => o.outcome !== 'lose').map(o => o.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(r); winTotal = 0
    }
    setLastRound(r)
    setRoad(h => [...h, r.total >= 113 ? '大' : '小'].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setUiPhase('settled')
  }

  // ---- 相位驱动 effects（全部只读 room，本地不产相位）----
  // A. 新一期 betting：换期 reset（快照上期注单供「重复」→ 清盘 → 回 betting）
  useEffect(() => {
    if (room.phase === 'betting' && room.roundNo && room.roundNo !== shownRoundRef.current) {
      shownRoundRef.current = room.roundNo
      if (betsRef.current.size) { lastBetsRef.current = new Map(betsRef.current); setHasLast(true) }
      betsRef.current = new Map(); setBetsPlaced(new Map())
      picksRef.current = new Set(); setPicks(new Set())
      setResult(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动开奖舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      const derived = deriveRound(room.drawResult.grid)   // ← 后端 25 位（行和/总和/段位按后端算，不本地 drawGrid）
      pendingRef.current = derived
      setAnimRound(derived)
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  const betting = room.phase === 'betting'
  const drawing = uiPhase === 'drawing'
  const settled = uiPhase === 'settled'

  const toggleSel = key => {
    if (!betting) return   // 非 betting 全盘锁死
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一下注入口：betting 相位内即时 POST（后端挂当期共享局）；apiPlay 默认回写扣款后余额。
  async function placeAndPost(entries) {
    if (room.phase !== 'betting') { pushToast('本期已封盘', 0); return false }
    let total = 0
    entries.forEach(s => { total = round2(total + s) })
    if (!entries.size || total <= 0) return false
    // 即时扣款模型：不能超过当前余额（服务端另有权威风控/余额校验兜底）
    if (serverBalance != null && total > serverBalance) { setNetErr('余额不足'); return false }
    setNetErr(null)
    try {
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries) })   // 返 balanceAfter → 自动回写扣款
      entries.forEach((s, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + s)))
      setBetsPlaced(new Map(betsRef.current))
      return true
    } catch (e) {
      if (e?.data?.error === 'round_locked') {
        pushToast('本期已封盘', 0)
        setUiPhase(p => (p === 'betting' ? 'locked' : p))
      } else {
        setNetErr(e.message)
      }
      return false
    }
  }
  async function confirmBets() {
    const amount = betRef.current
    if (amount < 1 || !picksRef.current.size) return
    const entries = new Map([...picksRef.current].map(k => [k, amount]))
    const ok = await placeAndPost(entries)
    if (ok) { picksRef.current = new Set(); setPicks(new Set()) }
  }
  // 重复投注 = 复用上局注单快照原额重下
  function repeatBets() {
    placeAndPost(new Map(lastBetsRef.current))
  }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  const cur = animRound
  const shown = settled && cur ? cur : lastRound   // 开奖区当前展示局

  // ---- 样式件（选中=金框；命中=绿框绿晕，同 Derby 惯例）----
  // settled 相位三档：命中+有注 = 绿框绿晕+注码chip；命中+无注 = 绿框亮灯弱一档
  // （无晕）；未命中压暗（有注留金框认输）。A/B 双视图同走这一份，key 同源天然同步；
  // betting/drawing（无 result）恢复常态不残留
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hits = result?.hits ?? null            // 仅 settled 相位非空
    const isHit = hits?.has(key)
    const staked = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${isHit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: isHit && staked
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: hits
        ? (isHit ? 1 : staked ? 0.6 : 0.45)
        : betting || staked ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.2s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: 4,
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

  // ---- 相位 chip（原样式传入 GameTopBar；场馆行并入顶栏）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: DERBY.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: DERBY.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: DERBY.orange }
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
      <GameTopBar balance={serverBalance ?? 0}
        venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode}
        onBack={onBack}
        onHowTo={() => setRulesOpen(true)}
      />
      {/* 断线重连提示（hook 自动指数退避重连；恢复后 sync 补相位） */}
      {!room.connected && room.roundNo && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${DERBY.orange}`, borderRadius: 10,
          padding: '8px 16px', color: DERBY.orange, fontSize: 13, fontWeight: 800,
        }}>连接断开，正在重连…</div>
      )}
      {netErr && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800,
        }} onClick={() => setNetErr(null)}>{netErr}</div>
      )}
    </>
  )

  // ---- ① 开奖区：5×5 号码牌（行标 + 行和）+ 统计带（主客计数/TOTAL/高低）----
  // drawing 相位挂开奖舞台（乱序砸落+滚数快闪+行和/TOTAL 累加）；settled 直出本局，
  // 其余回显上局。静态与舞台视图同构，网格渲染共用 gridBody
  // 裁判牌尺寸（竖矩形 ≈26×34，desk 收档给盘区留高）
  const cardW = isMobile ? 24 : isDesk ? 22 : 26
  const cardH = isMobile ? 31 : isDesk ? 28 : 34
  const zoneTitle = drawing ? '首发阵容 · 开奖中' : settled ? '首发阵容 · 本局' : '首发阵容 · 上局'
  const staticView = {
    digits: shown.cells, flash: null, popAge: null,
    rowSums: shown.rowSums, total: shown.total,
    homeCount: shown.homeCount, awayCount: shown.awayCount,
    highCount: shown.highCount, lowCount: shown.lowCount,
    slamAge: null,
  }
  const gridBody = view => (
    <>
      {/* desk 头行并入底部统计带省一行 */}
      {!isDesk && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{zoneTitle}</span>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>25 数 · 0-9</span>
        </div>
      )}
      {[0, 1, 2, 3, 4].map(ri => (
        <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
          {/* 行标：L 号圈 + 位置名 */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', width: isMobile ? 58 : 72 }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              background: DERBY.home, color: COLORS.white,
              fontSize: 9, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box',
            }}>L{ri + 1}</span>
            <span style={{ color: DERBY.text, fontSize: isMobile ? 10 : 11, fontWeight: 900, whiteSpace: 'nowrap' }}>{ROW_LABELS[ri]}</span>
          </span>
          {/* 5 张裁判牌：红牌 = Red(0,2,6,7,8) / 黄牌 = Black(1,3,4,5,9)，交替 ±4° 歪斜；
              舞台三态：待落=淡牌位 / 快闪=灰牌滚数 / 已定格=红黄牌图+轻弹（形变换皮，时间轴不动） */}
          {[0, 1, 2, 3, 4].map(ci => {
            const i = ri * 5 + ci
            const d = view.digits[i]
            const f = view.flash?.get(i)
            const pop = view.popAge?.get(i)
            const scale = pop != null ? 1.35 - 0.35 * (pop / ANIM_POP) : 1
            const tilt = i % 2 === 0 ? -4 : 4
            const isRed = d != null && AWAY_DIGITS.has(d)
            return (
              <span key={ci} data-cell={i} data-landed={d != null ? 1 : 0}
                data-final={drawing && cur ? cur.cells[i] : d ?? ''}
                style={{
                  position: 'relative',
                  width: cardW, height: cardH, borderRadius: 4,
                  background: d != null
                    ? 'none'
                    : f != null ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                  border: d != null ? 'none' : '1px solid rgba(0,0,0,0.35)',
                  color: d != null ? (isRed ? COLORS.white : '#3a2c00') : 'rgba(255,255,255,0.7)',
                  fontSize: cardH * 0.45, fontWeight: 900,
                  fontFamily: "'Space Grotesk', sans-serif",
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', flex: '0 0 auto',
                  transform: `rotate(${tilt}deg) scale(${scale})`,
                }}>
                {d != null && (
                  // 资产 1024² 含透明边（实牌约占 56%×76%，偏移 21%/11%）——
                  // 按包围盒放大补偿，让实牌恰好铺满 26×34 牌位
                  <img src={isRed ? cardRedImg : cardYellowImg} alt="" draggable={false} style={{
                    position: 'absolute', width: '178%', height: '131%',
                    left: '-38%', top: '-15%', maxWidth: 'none',
                    pointerEvents: 'none',
                    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.35))',
                  }} />
                )}
                <span style={{ position: 'relative' }}>{d ?? (f != null ? f : '')}</span>
              </span>
            )
          })}
          {/* 行尾行和（舞台期随落格累加滚动） */}
          <span style={{
            flex: '0 0 auto', minWidth: isMobile ? 26 : 32, textAlign: 'center',
            padding: '2px 6px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.2)',
            color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900,
          }}>{view.rowSums[ri]}</span>
        </div>
      ))}
      {/* 统计带：主/客计数 + TOTAL 大字（砸出放大一拍）+ 高/低 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isDesk && (
            <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginRight: 8 }}>{zoneTitle}</span>
          )}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block' }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>红牌 {view.awayCount}</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.gold, display: 'inline-block', marginLeft: 6 }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>黄牌 {view.homeCount}</span>
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
          transform: `scale(${view.slamAge != null ? 1 + 0.3 * Math.sin(Math.min(1, view.slamAge / 350) * Math.PI) : 1})`,
        }}>TOTAL {view.total}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          高 {view.highCount} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 低 {view.lowCount}
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
      display: 'flex', flexDirection: 'column', gap: isMobile || isDesk ? 3 : 4,
      boxSizing: 'border-box',
    }}>
      {drawing && cur
        ? <DrawStage key={room.roundNo} round={cur} sfx={stageSfx}>{gridBody}</DrawStage>
        : gridBody(staticView)}
    </div>
  )

  // ---- ② 盘区：A 列表 / B 矩阵 双视图（42 键与 MARKETS 同源同 key，选中态互通）----
  // 维度→键名映射：0 全局走普通盘键，1-5 走行式键；引擎无「行高低/行段位」键，禁造键
  const keyOf = (d, slot) => d === 0
    ? { home: 'home-more', away: 'away-more', big: 'big', small: 'small', odd: 'odd', even: 'even' }[slot]
    : `L${d}-${slot}`
  const DIM_CHIPS = ['全局', ...ROW_LABELS.map((l, i) => `L${i + 1}${l}`)]
  // 键格两款：row = 单行（名称左/区间中/赔率右，照参考 Common Bets 行式）；
  // col = 竖排三行（段位 4 键窄格用）
  const marketCell = (key, name, range, bg, layout = 'row') => (
    <button key={key} type="button" className="luCell" data-key={key} disabled={!betting} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        ...(layout === 'row' ? {
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
        } : { padding: isMobile ? '4px 2px' : '4px' }),
      }}>
      <span style={cellName}>{name}</span>
      <span style={layout === 'row' ? { ...cellRange, flex: 1, textAlign: 'center' } : cellRange}>{range}</span>
      <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
      {stakeChip(key)}
    </button>
  )
  // 高低对 + 段位排（A 全局尾部 / B 矩阵下方共用同一份）
  const hiLoPair = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
      {marketCell('high', '高', '5-9 ≥13', DERBY.grey)}
      {marketCell('low', '低', '0-4 ≥13', DERBY.grey)}
    </div>
  )
  const zonesRow = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
      {ZONES.map(z => marketCell(z.key, z.name, z.range, DERBY.grey, isMobile ? 'col' : 'row'))}
    </div>
  )
  // A 视图：维度 chip + 成对两列（行序固定 主客 → 大小 → 单双 → 高低）
  const pairRows = d => [
    [
      // 键名沿用 home/away（data-key 不动），显示层红黄牌皮；黄键底 = 共享 amberDeep
      { slot: 'home', name: '黄牌多', range: d === 0 ? '黄牌 ≥13' : '黄牌 ≥3', bg: COLORS.amberDeep },
      { slot: 'away', name: '红牌多', range: d === 0 ? '红牌 ≥13' : '红牌 ≥3', bg: DERBY.away },
    ],
    [
      { slot: 'big', name: '大', range: d === 0 ? '113–225' : '23–45', bg: DERBY.grey },
      { slot: 'small', name: '小', range: d === 0 ? '0–112' : '0–22', bg: DERBY.grey },
    ],
    [
      { slot: 'odd', name: '单', range: d === 0 ? '和值单' : '行和单', bg: DERBY.grey },
      { slot: 'even', name: '双', range: d === 0 ? '和值双' : '行和双', bg: DERBY.grey },
    ],
  ]
  const viewA = (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap' }}>
        {DIM_CHIPS.map((label, i) => (
          <button key={i} type="button" onClick={() => setDim(i)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: dim === i ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: dim === i ? '#083a1b' : DERBY.dim,
            border: `1px solid ${dim === i ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>
      {pairRows(dim).map((pair, i) => (
        <div key={i} style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
          {pair.map(m => marketCell(keyOf(dim, m.slot), m.name, m.range, m.bg))}
        </div>
      ))}
      {/* 高低 + 段位仅全局维度（行式引擎无此键） */}
      {dim === 0 && hiLoPair}
      {dim === 0 && zonesRow}
    </>
  )
  // B 视图：6×6 矩阵（列=主客大小单双，行=全局/L1-L5，格内只赔率）+ 高低/段位排底
  const MATRIX_COLS = [
    { slot: 'home', name: '黄', bg: COLORS.amberDeep },
    { slot: 'away', name: '红', bg: DERBY.away },
    { slot: 'big', name: '大', bg: DERBY.grey },
    { slot: 'small', name: '小', bg: DERBY.grey },
    { slot: 'odd', name: '单', bg: DERBY.grey },
    { slot: 'even', name: '双', bg: DERBY.grey },
  ]
  const viewB = (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: `${isMobile ? 50 : 64}px repeat(6, 1fr)`,
        gap: 3, marginBottom: isMobile ? 5 : 6,
      }}>
        <span />
        {MATRIX_COLS.map(c => (
          <span key={c.slot} style={{
            textAlign: 'center', fontSize: isMobile ? 10 : 11, fontWeight: 900,
            color: c.slot === 'home' ? DERBY.gold : c.slot === 'away' ? '#f0938a' : DERBY.dim,
          }}>{c.name}</span>
        ))}
        {[0, 1, 2, 3, 4, 5].map(d => (
          [
            <span key={`r${d}`} style={{
              display: 'inline-flex', alignItems: 'center',
              color: DERBY.text, fontSize: isMobile ? 9.5 : 10.5, fontWeight: 900, whiteSpace: 'nowrap',
            }}>{d === 0 ? '全局' : `L${d} ${ROW_LABELS[d - 1]}`}</span>,
            ...MATRIX_COLS.map(c => {
              const key = keyOf(d, c.slot)
              return (
                <button key={key} type="button" className="luCell" data-key={key} disabled={!betting}
                  onClick={() => toggleSel(key)}
                  style={{ ...cellBase(key, c.bg), padding: '2px 0' }}>
                  <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
                  {stakeChip(key)}
                </button>
              )
            }),
          ]
        ))}
      </div>
      {hiLoPair}
      {zonesRow}
    </>
  )
  const marketSection = (
    <div style={secBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={secHead}>投注盘 · {view === 'A' ? DIM_CHIPS[dim] : '总览矩阵'}</div>
        {/* A/B 小切换钮（右上角，选中态两视图互通） */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
          {['A', 'B'].map(v => (
            <button key={v} type="button" onClick={() => setView(v)} style={{
              padding: '2px 8px', borderRadius: RADIUS.pill,
              background: view === v ? DERBY.sel : 'rgba(0,0,0,0.35)',
              color: view === v ? '#083a1b' : DERBY.dim,
              border: `1px solid ${view === v ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
              fontSize: 9, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{v === 'A' ? 'A 列表' : 'B 矩阵'}</button>
          ))}
        </div>
      </div>
      {view === 'A' ? viewA : viewB}
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式同 Half Time；真历史滚动，容量 120）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14   // 移动端珠子大一档（可辨），桌面压一档保总高（同 Derby）
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
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件：名 pill 下拉 + 场馆/期号/相位 + ?/音频钮）---- */}
      {topBar}

      {/* ① 开奖区（顶部）：5×5 号码牌 + 统计带 */}
      {drawZone}

      {/* ② 盘区（中部，单一盘区 A/B 双视图；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {marketSection}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，大小单轨） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行：
           列1-2 面额四格（10/100 上、50/500 下）｜列3 Bet USD 上/重复钮下｜列4 下注大方钮跨两行 ---- */}
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
            <button key={v} type="button" className="luChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              label={betting ? `下注 ${picks.size} 格` : settled ? '已结算' : '已锁盘'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Derby Day ----
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
            {/* 场馆行已并入 GameTopBar，骨架历史行位撤除 */}
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
