import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HATTRICK } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import BetButton from '../components/shell/BetButton'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useRoundRoom } from '../hooks/useRoundRoom'

// Hat Trick — 快3三骰彩（三骰和值 + 豹子 + 对子），第 15 卡。
// 引擎：三骰各 1–6 独立均匀；和值/豹子/对子/大小单双全部由骰面派生。
// 轮次：BETTING(24s) → ROLLING(3s 占位，单3 换三骰动画) → SETTLED(3s) → 下一期。
// #43 单3：轮次节奏改「服务器排期器统一开奖」——相位/期号/倒计时/开奖/结算全读 useRoundRoom（/ws/rounds）。
// 算钱路径：placeAndPost() betting 内即时扣注，finishRound() 动画演完唯一赔付点（余额落定才跳）。
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

// ---------- 三骰舞台时间轴（rAF 内使用，毫秒）：三骰错峰定格制造悬念 ----------
const DIE_START = [0, 250, 500]       // 各骰抛入时刻
const DIE_LOCK = [2600, 3500, 4500]   // 各骰定格时刻（第1骰 2.6s / 第2骰 3.5s / 第3骰 4.5s）
const FALL_DUR = 500                  // 抛物线下坠段
const TOTAL_LOCK = 5100               // TOTAL 大字滚动累加后定格金闪
// 开奖动画总时长（收到 drawn → 三骰舞台演完 → 结算显示 + 回写余额）；须 < 服务器 hattrick idle(8s)
const DRAW_ANIM_MS = 7000
const G = GAME_BY_ID['HatTrick']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期掷 3 颗骰子（各 1–6），根据点数和、豹子、对子等结果判定盘口。开球前下注，开奖后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 和值：押 3 颗骰子的点数总和（4–17），赔率随难度从约 7.6 倍到 68.76 倍不等，越极端的和值赔越高。\n· 大 / 小 / 单 / 双：大[11-17] / 小[4-10]，按总和判定，约 1.96 倍。注意开出豹子时这四个盘口全输。\n· 任意豹子：3 颗骰子点数全相同（不限哪个点），约 34.38 倍。\n· 指定豹子：押中开出的具体豹子点数（如三个 5），约 206.28 倍。\n· 指定对子：押的点数至少出现两次（含该点豹子），约 12.89 倍。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '3 颗骰子掷出后计算总和及豹子/对子，命中的盘口立即结算，赔付直接入余额。开豹子时大小单双四个盘口全输（豹子通杀）。每期独立。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半，但小心豹子通杀；想搏大赔押指定豹子。\n· 和值押中间值（10、11）比押两端（4、17）容易得多。\n· 本游戏理论返还率约 95.5%，属娱乐性质，理性游戏。',
  },
]
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
  { key: 's-big',   name: '大', range: '11–17' },
  { key: 's-small', name: '小', range: '4–10' },
  { key: 's-odd',   name: '单', range: '和值单' },
  { key: 's-even',  name: '双', range: '和值双' },
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
// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照 Derby/HalfTime 先例分离）
const ROAD_TAB_LABELS = { TOTAL: '和值', 'B-S': '大小', TRIPLE: '豹子' }
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
function DiceStage({ roll, shakeRef, sfx, onFinale, onLastSuspense, winTotal = 0 }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale, onLastSuspense, winTotal })
  cbRef.current = { sfx, onFinale, onLastSuspense, winTotal }
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
    let whooshed = false, finaleFired = false, finaleAt = 0, shakeUntil = 0, suspenseFired = false
    const netImpacts = []       // 球入网冲击点 { x, at }（每颗定格推一个）
    let confetti = null         // 豹子彩带粒子（finale 时初始化）
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

      // ---- 球门框 + 球网背景（骰子层之前画；网随入网冲击 + 豹子沸腾摆动）----
      const gL = W * 0.15, gR = W * 0.85, gTop = H * 0.05, gBot = H * 0.44
      const gW = gR - gL, gH = gBot - gTop
      const netWobble = (sx, vy) => {   // vy: 0(顶横梁)→1(网底)，越靠底摆越大
        let dx = 0
        for (const imp of netImpacts) {
          const age = now - imp.at
          if (age > 420) continue
          const sigma = gW * 0.16
          const dist = sx - imp.x
          dx += Math.sin(age / 18) * (6 * dpr) * Math.exp(-age / 110) * Math.exp(-(dist * dist) / (2 * sigma * sigma)) * vy
        }
        if (finaleFired && roll.isTriple && now - finaleAt < 700) {   // 全场沸腾：整张网狂摆
          dx += Math.sin(now / 16 + sx * 0.012) * (11 * dpr) * (1 - (now - finaleAt) / 700) * vy
        }
        return dx
      }
      const NET_COLS = 15, NET_ROWS = 9
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1 * dpr
      for (let c = 0; c <= NET_COLS; c++) {   // 竖网绳
        const sx = gL + (gW * c) / NET_COLS
        ctx.beginPath()
        for (let r = 0; r <= NET_ROWS; r++) {
          const vy = r / NET_ROWS
          const px = sx + netWobble(sx, vy), py = gTop + gH * vy
          r === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
      for (let r = 0; r <= NET_ROWS; r++) {   // 横网绳
        const vy = r / NET_ROWS, py = gTop + gH * vy
        ctx.beginPath()
        for (let c = 0; c <= NET_COLS; c++) {
          const sx = gL + (gW * c) / NET_COLS
          const px = sx + netWobble(sx, vy)
          c === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
      // 门框（柱 + 横梁，压在网边之上）
      const pt = Math.max(2, 3 * dpr)
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillRect(gL - pt, gTop - pt, pt, gH + pt)
      ctx.fillRect(gR, gTop - pt, pt, gH + pt)
      ctx.fillRect(gL - pt, gTop - pt, gW + 2 * pt, pt)

      for (let i = 0; i < 3; i++) {
        const ti = t - DIE_START[i]
        if (ti < 0) continue   // 未抛入
        const x = xs[i]
        if (!locked[i] && t >= DIE_LOCK[i]) {
          locked[i] = true; flashAt[i] = now; shakeUntil = now + 100
          netImpacts.push({ x, at: now })   // 球入网 → 该列网格抖动
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

      // 第二颗定格后、第三颗定格前的悬念窗：揪心钩子只触发一次
      if (!suspenseFired && t >= DIE_LOCK[1] && t < DIE_LOCK[2]) {
        suspenseFired = true
        cbRef.current.onLastSuspense?.()
      }

      // TOTAL 滚动累加 → 定格金闪；豹子期额外径向金光爆闪一次
      if (t >= DIE_LOCK[2]) {
        const shown = Math.round(roll.total * easeOut(Math.min(1, (t - DIE_LOCK[2]) / 500)))
        const isLockT = t >= TOTAL_LOCK
        if (!finaleFired && isLockT) {
          finaleFired = true; finaleAt = now
          cbRef.current.sfx.chime(roll.isTriple, cbRef.current.winTotal > 0)
          cbRef.current.onFinale?.()
          if (import.meta.env.DEV) window.__HAT_ANIM_LAST = roll.dice.join(',')
          if (roll.isTriple) {   // 帽子戏法：加强震屏 + 撒彩带
            shakeUntil = now + 650
            confetti = []
            const cols = [HATTRICK.gold, '#35d07f', '#ffffff', '#ff6a3d']
            for (let n = 0; n < 90; n++) confetti.push({
              x: Math.random() * W, y: -Math.random() * H * 0.4,
              vx: (Math.random() - 0.5) * 1.3 * dpr, vy: (1 + Math.random() * 2.2) * dpr,
              rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
              color: cols[n % cols.length], size: (3 + Math.random() * 4) * dpr,
            })
          }
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
        ctx.fillText(roll.isTriple && isLockT ? `豹子 ${roll.tripleFace}` : `和值 ${shown}`, W / 2, H * 0.85)
        ctx.shadowBlur = 0
      }

      // ---- 进球横幅（弹入放大）：普通局 GOAL! +$X / 豹子 HAT-TRICK! ----
      if (finaleFired) {
        const age = now - finaleAt
        const pop = Math.min(1, age / 280)
        const scale = 0.4 + 0.6 * (1 - Math.pow(1 - pop, 3)) + Math.sin(pop * Math.PI) * 0.14
        ctx.save()
        ctx.translate(W / 2, H * 0.60)
        ctx.scale(scale, scale)
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        if (roll.isTriple) {
          ctx.shadowColor = HATTRICK.gold; ctx.shadowBlur = 28 * dpr
          ctx.fillStyle = HATTRICK.gold
          ctx.font = `900 ${Math.round(H * 0.17)}px 'Space Grotesk', sans-serif`
          ctx.fillText('帽子戏法！', 0, 0)
        } else {
          ctx.shadowColor = '#35d07f'; ctx.shadowBlur = 18 * dpr
          ctx.fillStyle = '#fff'
          ctx.font = `900 ${Math.round(H * 0.13)}px 'Space Grotesk', sans-serif`
          const wt = cbRef.current.winTotal
          ctx.fillText(wt > 0 ? `进球！ +$${wt.toFixed(2)}` : '进球！', 0, 0)
        }
        ctx.shadowBlur = 0
        ctx.restore()
      }

      // ---- 彩带下落（豹子）----
      if (confetti) {
        for (const p of confetti) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.03 * dpr; p.rot += p.vr
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
          ctx.fillStyle = p.color
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5)
          ctx.restore()
        }
      }

      if (shakeRef.current) {
        const big = finaleFired && roll.isTriple && now - finaleAt < 650
        const ax = big ? 5 : 2, ay = big ? 4 : 1.5
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * ax}px, ${Math.cos(now / 5) * ay}px)`
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
          {roll.isTriple ? `豹子 ${roll.tripleFace}` : `和值 ${roll.total}`}
        </span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden />
}

export default function HatTrick({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('TOTAL')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  const room = useRoundRoom(playerToken, G.backendId)

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  const [uiPhase, setUiPhase] = useState('betting')       // betting | locked | drawing | settled
  const [lastRoll, setLastRoll] = useState(SEED_LAST)
  const [recent, setRecent] = useState(SEED_RECENT)       // 近 5 期和值（新→旧）
  const [history, setHistory] = useState(SEED_HISTORY)    // 珠盘路（旧→新）
  const [result, setResult] = useState(null)              // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)            // 掷骰动画收尾的命中预亮
  const [toasts, setToasts] = useState([])
  const [settleFx, setSettleFx] = useState(false)         // 结算演出开关（飞金 + 命中/未中标签动画）
  const [suspense, setSuspense] = useState(null)          // 块A：{ keys:Set, msg } 最后一颗揪心窗
  const [nearMiss, setNearMiss] = useState(() => new Set()) // 块B：就差1点的未中注 key 集合
  const [hasLast, setHasLast] = useState(false)           // 是否有上局注单快照（重复钮亮灭）

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())       // 本期已下注并落库的 {key: 累计注额}
  const lastBetsRef = useRef(new Map())   // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)         // 只读表演：当前动画骰面派生（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)      // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)   // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)    // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)      // 镜像 room.settleInfo，供动画结束时读取
  const audioRef = useRef({ ctx: null, muted: false })
  const cardShakeRef = useRef(null)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxWhoosh() {   // 射门砰：低频重击 + 破空短扫
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    ns.connect(bp); bp.connect(g2); g2.connect(ctx.destination); ns.start(t); ns.stop(t + 0.18)
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
  function sfxSnap() {   // 入网唰：软噪声刷过网绳（骰定格=球入网）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.16)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.16)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.16)
  }
  function sfxChime(strong, win) {   // 进球：命中→球迷欢呼；豹子→全场沸腾+进球哨
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    // 人声般欢呼：宽带噪声起伏（豹子更久更响）
    const dur = strong ? 1.6 : win ? 1.1 : 0.5
    const peak = strong ? 0.15 : win ? 0.09 : 0.04
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = strong ? 1100 : 900; bp.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + dur)
    // 亮音欢呼点缀
    if (win || strong) {
      const notes = strong ? [660, 880, 1170, 1560] : [660, 990]
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); const og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
        const s = t + i * 0.09
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(strong ? 0.09 : 0.06, s + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
        o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
      })
    }
    // 豹子：进球哨（三短高哨带颤音）
    if (strong) {
      [0, 0.16, 0.32].forEach((off, i) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2300 + i * 120
        const lfo = ctx.createOscillator(); lfo.frequency.value = 28
        const lg = ctx.createGain(); lg.gain.value = 60
        lfo.connect(lg); lg.connect(o.frequency)
        const og = ctx.createGain()
        const s = t + off
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.05, s + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, s + (i === 2 ? 0.22 : 0.12))
        o.connect(og); og.connect(ctx.destination)
        o.start(s); o.stop(s + 0.24); lfo.start(s); lfo.stop(s + 0.24)
      })
    }
  }
  function sfxHeartbeat() {   // 揪心心跳：低频 lub-dub 双击
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const thump = (start, freq, peak) => {
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(freq, start); o.frequency.exponentialRampToValueAtTime(freq * 0.55, start + 0.12)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(peak, start + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      o.connect(g); g.connect(ctx.destination); o.start(start); o.stop(start + 0.18)
    }
    thump(t, 90, 0.11)          // lub
    thump(t + 0.14, 68, 0.08)   // dub
  }
  // 悬念窗内以递减间隔调度加速心跳（约 1s 内 5 击）
  function startHeartbeat() {
    ;[0, 300, 550, 760, 930].forEach(ms => {
      timersRef.current.push(setTimeout(sfxHeartbeat, ms))
    })
  }
  const stageSfx = { whoosh: sfxWhoosh, knock: sfxKnock, snap: sfxSnap, chime: sfxChime }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。
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
      // 后端三态：命中高亮 = outcome 非 lose（豹子局大小单双为 lose，不高亮）；余额只认 balanceAfter
      hits = new Set((si.yourResult || []).filter(v => v.outcome !== 'lose').map(v => v.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      // 无注：仅显示，不动钱
      hits = hitsOf(r); winTotal = 0
    }
    setLastRoll(r)
    setRecent(list => [r.total, ...list].slice(0, 5))
    setHistory(h => [...h, r.dice].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    setSettleFx(true)   // 开结算演出：命中飞金 / 未中碎裂
    setSuspense(null)   // 悬念窗收束（保底：正常应已在第三颗定格时清）
    // 块B：就差1点 —— 大实开10 / 小实开11 / 和值N实开N±1 的未中注（仅大/小/和值直选）
    const nm = new Set()
    betsRef.current.forEach((_, k) => {
      if (hits.has(k)) return
      if (k === 's-big' && r.total === 10) nm.add(k)
      else if (k === 's-small' && r.total === 11) nm.add(k)
      else if (k.startsWith('t-')) {
        const N = parseInt(k.slice(2), 10)
        if (r.total === N - 1 || r.total === N + 1) nm.add(k)
      }
    })
    setNearMiss(nm)
    // 假注单本期落账（展示用，结果已定后的装饰随机）
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
      setResult(null); setPreHits(null); setSettleFx(false); setSuspense(null); setNearMiss(new Set())
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动三骰舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      const roll = deriveRoll(room.drawResult.dice)   // 后端 3 骰点数（不本地 rollDice）
      pendingRef.current = roll
      setUiPhase('drawing')   // 触发重渲染，drawZone 读 pendingRef.current 挂 DiceStage
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // 注区中文名（悬念文案用）
  function keyLabel(key) {
    if (key === 's-big') return '大'
    if (key === 's-small') return '小'
    if (key === 's-odd') return '单'
    if (key === 's-even') return '双'
    if (key === 'tr-any') return '任意豹子'
    if (key.startsWith('tr-')) return `豹子${key.slice(3)}`
    if (key.startsWith('d-')) return `对子${key.slice(2)}`
    if (key.startsWith('t-')) return `和值${key.slice(2)}`
    return key
  }

  // 块A：第二颗定格后的悬念窗 —— 找出「第三颗某点数就能中」的已下注注区
  function onLastSuspense() {
    const r = pendingRef.current
    if (!r) return
    const [d0, d1] = r.dice
    const suspended = []
    betsRef.current.forEach((_, key) => {
      const faces = []
      for (let v = 1; v <= 6; v++) {
        if (hitsOf(deriveRoll([d0, d1, v])).has(key)) faces.push(v)
      }
      // 揪心 = 第三颗能中但非必中（1..5 个点数能中；0=没戏、6=已锁定不揪心）
      if (faces.length >= 1 && faces.length <= 5) suspended.push({ key, faces })
    })
    if (!suspended.length) return
    const keys = new Set(suspended.map(s => s.key))
    const msg = suspended.length === 1
      ? `第三颗开 ${suspended[0].faces.join('/')}，你押的 ${keyLabel(suspended[0].key)} 就中！`
      : `就看最后一颗！${suspended.length} 注临门一脚`
    setSuspense({ keys, msg })
    startHeartbeat()   // 加速心跳
    // 第三颗定格（DIE_LOCK[2]）时清掉悬念提示，进正常结算
    timersRef.current.push(setTimeout(() => setSuspense(null), DIE_LOCK[2] - DIE_LOCK[1]))
  }

  const betting = room.phase === 'betting'
  const drawing = uiPhase === 'drawing'
  const settled = uiPhase === 'settled'

  const toggleSel = key => {
    if (!betting) return   // 非 betting 锁盘
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
    if (serverBalance != null && total > serverBalance) { setNetErr('余额不足'); return false }
    setNetErr(null)
    try {
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries) })   // 返 balanceAfter → 自动回写扣款
      entries.forEach((s, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + s)))
      setBetsPlaced(new Map(betsRef.current))
      return true
    } catch (e) {
      if (e?.data?.error === 'round_locked') { pushToast('本期已封盘', 0); setUiPhase(p => (p === 'betting' ? 'locked' : p)) }
      else setNetErr(e.message)
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
  // 只读推算本局应得赢额（供开奖舞台 GOAL! +$X 用；不入账、不碰 settleRound）
  const winOfRoll = r => {
    if (!r) return 0
    const hits = hitsOf(r)
    let w = 0
    betsRef.current.forEach((stake, k) => { if (hits.has(k)) w = round2(w + stake * MARKETS[k].odds) })
    return w
  }

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '4px 2px' : '7px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? HATTRICK.selTint : HATTRICK.grey,
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
  // 押额胶囊：只显 $押额（未中结算时碎裂；就差1点的不碎，让位橙红惋惜）
  const stakeChip = key => {
    if (!betsPlaced.has(key)) return null
    const lose = settleFx && !result?.hits?.has(key) && !nearMiss.has(key)
    return (
      <span className={lose ? 'htLose' : undefined} style={{
        position: 'absolute', top: 2, right: 3, zIndex: 2,
        padding: '1px 5px', borderRadius: RADIUS.pill,
        background: HATTRICK.sel, color: '#083a1b',
        fontSize: 8, fontWeight: 900, pointerEvents: 'none',
      }}>${betsPlaced.get(key)}</span>
    )
  }
  // 赔率位常显赢额（下注后替换赔率数字，不并列） + 结算演出 class
  const winTxt = (key, odds) => `赢 $${round2(betsPlaced.get(key) * odds)}`
  const fxCls = key => {
    if (!settleFx || !betsPlaced.has(key)) return undefined
    if (result?.hits?.has(key)) return 'htWinFly'
    if (nearMiss.has(key)) return undefined   // 就差1点：不灰碎，改橙红 badge
    return 'htLose'
  }
  // 悬念脉冲：块A 悬着的注区高亮
  const cellCls = key => 'htCell' + (suspense?.keys.has(key) ? ' htSuspense' : '')
  // 块B 就差1点橙红惋惜 badge（仅 totalCell + SIDES 用）
  const nearBadge = key => nearMiss.has(key) && (
    <span className="htNear" style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      zIndex: 4, padding: '2px 6px', borderRadius: RADIUS.pill,
      background: 'rgba(4,10,7,0.78)', color: '#ff6a3d', border: '1px solid #ff6a3d',
      fontSize: isMobile ? 8.5 : 9.5, fontWeight: 900, whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>就差1点！</span>
  )

  // TOTAL 4–17 小格（desk 14 连排 / mobile 7×2 折行不挤爆）
  const totalCell = s => {
    const key = `t-${s}`
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)
    const placed = betsPlaced.has(key)
    return (
      <button key={key} type="button" className={cellCls(key)} disabled={!betting} onClick={() => toggleSel(key)} style={{
        minWidth: 0, padding: '3px 0',
        borderRadius: 8, cursor: betting ? 'pointer' : 'not-allowed',
        background: hit ? HATTRICK.sel : sel ? HATTRICK.selTint : HATTRICK.grey,
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
        <span className={fxCls(key)} style={{ color: hit ? '#083a1b' : HATTRICK.gold, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{placed ? winTxt(key, ODDS.total[s]) : ODDS.total[s]}</span>
        {stakeChip(key)}
        {nearBadge(key)}
      </button>
    )
  }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: HATTRICK.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: HATTRICK.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: HATTRICK.orange }
        : drawing
          ? { text: '掷骰中…', c: HATTRICK.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: HATTRICK.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const subRowNode = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
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
      }}>{lastRoll.isTriple ? `豹子 ${lastRoll.tripleFace}` : `和值 ${lastRoll.total}`}</span>
    </span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={HATTRICK.band} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} />
      {!room.connected && room.roundNo && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${HATTRICK.orange}`, borderRadius: 10,
          padding: '8px 16px', color: HATTRICK.orange, fontSize: 13, fontWeight: 800,
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
          }}>{ROAD_TAB_LABELS[t]}</button>
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
      <style>{`
        .htCell:hover:not(:disabled) { filter: brightness(1.3); }
        @keyframes htWinFly {
          0%   { transform: scale(1); opacity: 1; }
          25%  { transform: scale(1.65); opacity: 1; filter: drop-shadow(0 0 6px rgba(255,213,79,0.95)); }
          100% { transform: translateY(-16px) scale(1.1); opacity: 0; }
        }
        .htWinFly { animation: htWinFly 1s ease-out forwards; transform-origin: right center; }
        @keyframes htLose {
          0%   { transform: scale(1); opacity: 1; filter: grayscale(0); }
          100% { transform: scale(0.7); opacity: 0; filter: grayscale(1); }
        }
        .htLose { animation: htLose 0.7s ease-in forwards; transform-origin: right center; }
        @keyframes htFlyGold {
          0%   { transform: translateY(14px) scale(0.7); opacity: 0; }
          18%  { transform: translateY(0) scale(1.15); opacity: 1; }
          100% { transform: translateY(-120px) scale(0.85); opacity: 0; }
        }
        .htFlyGold { animation: htFlyGold 1.25s ease-out forwards; }
        @keyframes htPulseRing {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0); }
          50%     { box-shadow: 0 0 11px 2px rgba(255,213,79,0.9); }
        }
        .htSuspense { animation: htPulseRing 0.6s ease-in-out infinite; border-color: #ffd54f !important; }
        @keyframes htNearPop {
          0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 0; }
          45%  { transform: translate(-50%,-50%) scale(1.15); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
        }
        @keyframes htNearGlow {
          from { box-shadow: 0 0 6px rgba(255,106,61,0.5); }
          to   { box-shadow: 0 0 14px rgba(255,106,61,0.95); }
        }
        .htNear { animation: htNearPop 0.45s ease-out both, htNearGlow 0.85s ease-in-out 0.45s infinite alternate; }
        @keyframes htBannerPulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.06); }
        }
        .htSuspenseBanner { animation: htBannerPulse 0.55s ease-in-out infinite; }
      `}</style>

      {/* 块A 悬念横幅：最后一颗揪心提示（第三颗定格即撤） */}
      {suspense && (
        <div style={{
          position: 'absolute', top: isMobile ? 116 : 92, left: 0, right: 0, zIndex: 7,
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <span className="htSuspenseBanner" style={{
            display: 'inline-block', padding: '6px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(8,18,12,0.92)', border: '2px solid #ffd54f', color: '#ffd54f',
            fontSize: isMobile ? 12 : 14, fontWeight: 900, whiteSpace: 'nowrap',
            boxShadow: '0 0 18px rgba(255,213,79,0.7)',
          }}>❤ {suspense.msg}</span>
        </div>
      )}

      {/* 结算飞金：命中总额从盘区飞向顶栏余额位淡出（不改 Header/App） */}
      {settleFx && result?.winTotal > 0 && (
        <div className="htFlyGold" style={{
          position: 'absolute', top: '44%', left: 0, right: 0, zIndex: 6,
          textAlign: 'center', pointerEvents: 'none',
          color: HATTRICK.gold, fontSize: isMobile ? 26 : 32, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          textShadow: '0 0 16px rgba(255,213,79,0.9)',
        }}>+${result.winTotal.toFixed(2)}</div>
      )}

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}


      {/* ① 开奖舞台槽（顶部，吃弹性空间 ≤260）：BETTING 静态回显上期三骰+TOTAL，
          ROLLING/SETTLED 换舞台动画（key=期号等高替换机制不变） */}
      <div style={{
        flex: '1 1 auto', minHeight: isMobile ? 150 : 140, maxHeight: 260,
        position: 'relative', zIndex: 1,
        margin: isMobile ? '8px 12px 0' : '8px 18px 0',
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box',
      }}>
        {(drawing || settled) && pendingRef.current ? (
          <DiceStage key={room.roundNo} roll={pendingRef.current}
            shakeRef={cardShakeRef} sfx={stageSfx}
            onLastSuspense={onLastSuspense}
            winTotal={winOfRoll(pendingRef.current)}
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
            }}>{lastRoll.isTriple ? `豹子 ${lastRoll.tripleFace}` : `和值 ${lastRoll.total}`}</span>
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
          <div style={secHead}>和值 4-17</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(7, 1fr)' : 'repeat(14, 1fr)',
            gap: isMobile ? 3 : 4, marginBottom: 6,
          }}>
            {Array.from({ length: 14 }, (_, i) => totalCell(i + 4))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {SIDES.map(m => (
              <button key={m.key} type="button" className={cellCls(m.key)} disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span className={fxCls(m.key)} style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5, whiteSpace: 'nowrap' }}>{betsPlaced.has(m.key) ? winTxt(m.key, MARKETS[m.key].odds) : ODDS.side.toFixed(2)}</span>
                <span style={{ color: HATTRICK.dim, fontSize: isMobile ? 7.5 : 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>豹子通杀</span>
                {stakeChip(m.key)}
                {nearBadge(m.key)}
              </button>
            ))}
          </div>
        </div>

        {/* 行② HAT TRICK：任意豹子 + 指定三同六格 */}
        <div style={secBox}>
          <div style={secHead}>豹子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <button type="button" className={cellCls('tr-any')} disabled={!betting} onClick={() => toggleSel('tr-any')}
              style={{ ...cellBtn('tr-any'), ...(isMobile ? { flex: '1 1 100%' } : { flex: 1.6 }) }}>
              <span style={cellName}>任意豹子</span>
              <span className={fxCls('tr-any')} style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{betsPlaced.has('tr-any') ? winTxt('tr-any', MARKETS['tr-any'].odds) : ODDS.anyTriple.toFixed(2)}</span>
              {stakeChip('tr-any')}
            </button>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className={cellCls(`tr-${v}`)} disabled={!betting} onClick={() => toggleSel(`tr-${v}`)}
                style={{ ...cellBtn(`tr-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 13 : 15} />)}
                </span>
                <span className={fxCls(`tr-${v}`)} style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11, whiteSpace: 'nowrap' }}>{betsPlaced.has(`tr-${v}`) ? winTxt(`tr-${v}`, MARKETS[`tr-${v}`].odds) : ODDS.triple.toFixed(2)}</span>
                {stakeChip(`tr-${v}`)}
              </button>
            ))}
          </div>
        </div>

        {/* 行③ DOUBLE：指定对子六格（含该面豹子） */}
        <div style={secBox}>
          <div style={secHead}>对子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className={cellCls(`d-${v}`)} disabled={!betting} onClick={() => toggleSel(`d-${v}`)}
                style={{ ...cellBtn(`d-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 14 : 16} />)}
                </span>
                <span className={fxCls(`d-${v}`)} style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11, whiteSpace: 'nowrap' }}>{betsPlaced.has(`d-${v}`) ? winTxt(`d-${v}`, MARKETS[`d-${v}`].odds) : ODDS.double.toFixed(2)}</span>
                {stakeChip(`d-${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ③ 珠盘路（底部，三页签） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned（抄 Line Up：grid 4×2 筹码 + USD + 重复 + BetButton）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '6px 12px',
        background: HATTRICK.band,
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
            <button key={v} type="button" className="htChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? HATTRICK.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? HATTRICK.sel : 'rgba(255,255,255,0.35)'}`,
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
            color: repeatOk ? HATTRICK.text : HATTRICK.dim,
            background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : drawing ? '掷骰中…' : '本期已结算'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Number Up ----
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
    <GameLayout color={HATTRICK.sel}>
      <div ref={cardShakeRef}>
        {gameCard}
      </div>
    </GameLayout>
  )
}
