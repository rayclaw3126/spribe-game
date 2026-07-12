import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOLDENBOOT } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import BetButton from '../components/shell/BetButton'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useRoundRoom } from '../hooks/useRoundRoom'
import car01 from '../assets/goldenboot/car_01.png'
import car02 from '../assets/goldenboot/car_02.png'
import car03 from '../assets/goldenboot/car_03.png'
import car04 from '../assets/goldenboot/car_04.png'
import car05 from '../assets/goldenboot/car_05.png'
import car06 from '../assets/goldenboot/car_06.png'
import car07 from '../assets/goldenboot/car_07.png'
import car08 from '../assets/goldenboot/car_08.png'
import car09 from '../assets/goldenboot/car_09.png'
import car10 from '../assets/goldenboot/car_10.png'
import trafficLightImg from '../assets/goldenboot/traffic_light.png'

// 赛车图按号索引（car_0X = 车号 X）
const CAR_SRC = { 1: car01, 2: car02, 3: car03, 4: car04, 5: car05, 6: car06, 7: car07, 8: car08, 9: car09, 10: car10 }

// Golden Boot — 10 辆赛车冲刺排名彩（PK10 赛车皮）。
// 引擎：1–10 全排列（Fisher-Yates），index = 名次；冠亚和 3–19。
// 轮次：BETTING(24s) → RACING(3s 占位，单3 换冲刺动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// ---------- 引擎（纯函数区，禁副作用）----------
// Fisher-Yates 全洗 1–10，返回按名次排的球员号（order[0] = 冠军）；rng 可注入
export function drawRace(rng = Math.random) {
  const order = Array.from({ length: 10 }, (_, i) => i + 1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// 派生：冠军 / 亚军 / 冠亚和 / 名次映射
export function deriveRace(order) {
  const winner = order[0]
  const runnerUp = order[1]
  const sprintSum = winner + runnerUp
  const rank = {}
  order.forEach((n, i) => { rank[n] = i + 1 })
  return { order, winner, runnerUp, sprintSum, rank }
}

// 赔率配置表（推导注记；1e6 模拟实测见单3 报告，出带列只报不改）：
//   WINNER：P = 1/10 精确 → 9.60 × 0.1 = 96.0%
//   SUM 直选：90 个有序 (冠,亚) 对等概率；和值 s 的无序对数 n(s)：
//     3,4,18,19→1 · 5,6,16,17→2 · 7,8,14,15→3 · 9,10,12,13→4 · 11→5
//     P(s) = n(s)/45；赔率 = 0.955 × 45 / n(s)（构造性 RTP≈95.5%）
//   BIG 12–19：n 合计 20/45 → 2.15 × .4444 = 95.6%；SMALL 3–11：25/45 → 1.72 × .5556 = 95.6%
//   ODD 和为单（一奇一偶 50/90 = 25/45）→ 1.72 → 95.6%；EVEN 20/45 → 2.15 → 95.6%
const SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 }
const sumOdds = s => Math.round((0.955 * 45 / SUM_N[s]) * 100) / 100   // 42.98/21.49/14.33/10.74/8.60
export const ODDS = {
  winner: 9.6,
  sum: Object.fromEntries(Object.keys(SUM_N).map(s => [s, sumOdds(+s)])),
  big: 2.15, small: 1.72, odd: 1.72, even: 2.15,
}

// 盘区判定表 — 数据驱动生成（settle/珠盘路/RTP 模拟共用），零散落 if
export const MARKETS = (() => {
  const m = {}
  for (let n = 1; n <= 10; n++) m[`w-${n}`] = { odds: ODDS.winner, hit: r => r.winner === n }
  for (const s of Object.keys(SUM_N).map(Number)) m[`sum-${s}`] = { odds: ODDS.sum[s], hit: r => r.sprintSum === s }
  m['s-big']   = { odds: ODDS.big,   hit: r => r.sprintSum >= 12 }
  m['s-small'] = { odds: ODDS.small, hit: r => r.sprintSum <= 11 }
  m['s-odd']   = { odds: ODDS.odd,   hit: r => r.sprintSum % 2 === 1 }
  m['s-even']  = { odds: ODDS.even,  hit: r => r.sprintSum % 2 === 0 }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__GB = { drawRace, deriveRace, hitsOf, MARKETS, ODDS }
}

// ---------- 冲刺舞台时间轴（rAF 内使用，毫秒）：----------
// 冠军冲线 = START + BASE ≈ 5.3s，之后每名次 +160ms（第10名 ~6.74s），余下定格
const RACE_START = 500
const SPRINT_BASE = 4800
const RANK_GAP = 160
// 开奖动画总时长（收到 drawn → 冲刺舞台演完 → 结算 + 回写余额）；须 < 服务器 goldenboot idle(9s)
const DRAW_ANIM_MS = 8000
const G = GAME_BY_ID['GoldenBoot']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期 10 辆车冲刺赛跑，决出 1–10 名。你可以押冠军是哪辆车、冠亚军点数之和、以及和值的大小单双。开赛前下注，冲线后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 冠军直选：押中冠军是哪辆车（1–10 号），约 9.60 倍。\n· 冠亚和：押冠军与亚军的车号之和（3–19），赔率随难度约 8.6 倍到 42.98 倍不等，越极端的和值赔越高。\n· 大 / 小：冠亚和以 11/12 为界，大[12-19] 约 2.15 倍 / 小[3-11] 约 1.72 倍。\n· 单 / 双：按冠亚和判定，单约 1.72 倍 / 双约 2.15 倍。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '10 辆车冲线决出名次，取冠军和冠亚军之和结算，命中的盘口立即结算，赔付直接入余额。每期独立，上期不影响下期。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半；想搏大赔押冠军直选或冠亚和两端。\n· 冠亚和押中间值（10、11、12）比押两端（3、19）容易得多。\n· 本游戏理论返还率约 95.5–96%，属娱乐性质，理性游戏。',
  },
]
const ROAD_CAP = 120

// 种子上期 + 种子历史（真开奖逐期顶掉）
const SEED_LAST = deriveRace([3, 7, 1, 9, 2, 10, 5, 8, 4, 6])
const SEED_WINNERS = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6, 2, 8, 1, 4, 10, 6, 3, 9, 7, 5, 1, 6, 4, 2, 9, 3, 10, 8, 5, 7]
const SEED_SUMS = [10, 9, 4, 13, 12, 16, 8, 14, 7, 11, 5, 15, 3, 9, 17, 10, 6, 12, 19, 8, 11, 7, 13, 5, 16, 9, 4, 18, 12, 10]
const SEED_HISTORY = SEED_WINNERS.map((w, i) => ({ winner: w, sum: SEED_SUMS[i] }))

const ROAD_TABS = ['WINNER', 'SUM']
// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照先例分离）
const ROAD_TAB_LABELS = { WINNER: '冠军', SUM: '冠亚和' }
function beadFor(tab, h) {
  if (tab === 'WINNER') return { t: String(h.winner), c: h.winner <= 5 ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
  return h.sum >= 12 ? { t: 'B', c: GOLDENBOOT.dragon } : { t: 'S', c: GOLDENBOOT.tiger }
}

// 金靴球衣珠 — 迷你球衣轮廓 + 号码（金渐变，共享 gold/fire/goldDeep）

// 冠军直选盘口图标：Codex 真车图（car_0X，跟舞台同款）+ 左上角号码 badge
function CarImgBead({ num, size = 30 }) {
  return (
    <div style={{ position: 'relative', width: size * 1.7, height: size }}>
      <img src={CAR_SRC[num]} alt={`car ${num}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      <span style={{
        position: 'absolute', top: -2, left: -2,
        width: size * 0.52, height: size * 0.52, borderRadius: '50%',
        background: 'rgba(0,0,0,0.75)', border: `1px solid ${GOLDENBOOT.gold}`,
        color: GOLDENBOOT.gold, fontSize: size * 0.32, fontWeight: 900, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Space Grotesk', sans-serif", boxSizing: 'border-box',
      }}>{num}</span>
    </div>
  )
}

// ---------- 冲刺舞台：单一 rAF 循环驱动全部物理（禁 CSS transition 拼接）----------
// 10 泳道横向冲刺；每人速度曲线按注入名次反推（基线到达时刻=名次序，叠加
// base·(1-base) 包络的正弦摆动 → 中途超车交错、冲线时刻不变，结局恒等于注入名次）。
// 撞线金闪 + 名次侧栏依次落位 + 整卡轻震；prefers-reduced-motion 静态示名次表。
function RaceStage({ race, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { cbRef.current.onFinale?.(); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__GB_RAF_ACTIVE = (window.__GB_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    // 预载赛车 + 红绿灯图（未 load 完用色块占位防闪白）
    const carImgs = {}
    for (let n = 1; n <= 10; n++) { const im = new Image(); im.src = CAR_SRC[n]; carImgs[n] = im }
    const trafficImg = new Image(); trafficImg.src = trafficLightImg
    // 装饰性随机（结果早已定，只抖中段轨迹，不碰确定性随机数流的位置）
    const runners = race.order.map((num, i) => ({
      num, rank: i + 1,
      fin: RACE_START + SPRINT_BASE + i * RANK_GAP,
      phase: Math.random() * Math.PI * 2,
      wobA: 0.05 + Math.random() * 0.05,
      p: 0, finished: false, trail: [],
    }))
    const byLane = [...runners].sort((a, b) => a.num - b.num)   // 泳道固定按号码
    const lastFin = RACE_START + SPRINT_BASE + 9 * RANK_GAP
    const finishedList = []
    let raf = 0, whistled = false, finaleFired = false
    let lastStep = 0, shakeUntil = 0, flashUntil = 0
    let prevLeadP = 0, engFreq = 70   // 引擎快慢感：领跑车速度 → 频率
    const t0 = performance.now()

    // 赛车 sprite（drawImage 按号选车、朝右、保宽高比；尾焰=左侧渐变三角；小号码徽标）
    const drawCar = (x, y, s, num, opts = {}) => {
      const { big = false, flame = false, noBadge = false } = opts
      if (flame) {
        const fw = s * 1.0
        const g = ctx.createLinearGradient(x - s * 0.75 - fw, y, x - s * 0.75, y)
        g.addColorStop(0, 'rgba(255,110,20,0)')
        g.addColorStop(1, 'rgba(255,185,50,0.6)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(x - s * 0.75, y - s * 0.2); ctx.lineTo(x - s * 0.75 - fw, y); ctx.lineTo(x - s * 0.75, y + s * 0.2)
        ctx.closePath(); ctx.fill()
      }
      const img = carImgs[num]
      if (img && img.complete && img.naturalWidth > 0) {
        const asp = img.naturalWidth / img.naturalHeight
        const h = s * (big ? 1.35 : 1.1), w = h * asp
        ctx.drawImage(img, x - w / 2, y - h / 2, w, h)
      } else {   // 占位色块（防闪白）
        ctx.fillStyle = big ? GOLDENBOOT.gold : GOLDENBOOT.fire
        ctx.beginPath(); ctx.roundRect(x - s * 0.75, y - s * 0.42, s * 1.5, s * 0.84, s * 0.16); ctx.fill()
      }
      if (!big && !noBadge) {   // 号码小徽标（保识别）
        const bs = s * 0.44
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.beginPath(); ctx.arc(x, y - s * 0.6, bs * 0.62, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = GOLDENBOOT.gold
        ctx.font = `900 ${Math.round(bs * 0.72)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(num), x, y - s * 0.58)
      }
    }

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      const x0 = W * 0.06, x1 = W * 0.84
      const laneH = H / 10
      const bead = Math.min(laneH * 0.92, 22 * dpr)

      // —— 时序/物理 ——
      if (!whistled && t >= RACE_START) { whistled = true; cbRef.current.sfx.whistle(); cbRef.current.sfx.engineStart?.() }
      if (whistled && finishedList.length < 10 && now - lastStep > 170) {
        lastStep = now
        cbRef.current.sfx.step()
      }
      for (const r of runners) {
        if (t < RACE_START) { r.p = 0; continue }
        const base = Math.min(1, (t - RACE_START) / (r.fin - RACE_START))
        const wob = r.wobA * Math.sin(t / 420 + r.phase) * 4 * base * (1 - base)
        r.p = Math.max(0, Math.min(1, base + wob))
        if (!r.finished && base >= 1) {
          r.finished = true
          finishedList.push(r)
          if (r.rank === 1) {
            cbRef.current.sfx.cheer()
            shakeUntil = now + 100
            flashUntil = now + 450
          }
        }
      }
      if (!finaleFired && t >= lastFin + 120) {
        finaleFired = true
        cbRef.current.sfx.engineStop?.()
        cbRef.current.sfx.chime()
        cbRef.current.onFinale?.()
        if (import.meta.env.DEV) window.__GB_ANIM_LAST = race.order.join(',')
      }
      if (shakeRef.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * 2}px, ${Math.cos(now / 5) * 1.5}px)`
          : ''
      }

      // —— 绘制 ——
      ctx.clearRect(0, 0, W, H)
      // 赛道皮肤：深灰沥青渐变
      const track = ctx.createLinearGradient(0, 0, 0, H)
      track.addColorStop(0, '#252932'); track.addColorStop(1, '#15181f')
      ctx.fillStyle = track; ctx.fillRect(0, 0, W, H)
      // 泳道分隔线（白虚线）+ 起点/终点线
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([10 * dpr, 8 * dpr])
      for (let i = 1; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * laneH); ctx.lineTo(W * 0.88, i * laneH); ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'
      ctx.lineWidth = 2 * dpr
      ctx.beginPath(); ctx.moveTo(x0 - bead, 0); ctx.lineTo(x0 - bead, H); ctx.stroke()
      // 终点双线
      ctx.beginPath(); ctx.moveTo(x1 + bead * 0.7, 0); ctx.lineTo(x1 + bead * 0.7, H); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath(); ctx.moveTo(x1 + bead * 0.7 + 4 * dpr, 0); ctx.lineTo(x1 + bead * 0.7 + 4 * dpr, H); ctx.stroke()
      // 撞线金闪
      if (now < flashUntil) {
        const k = (flashUntil - now) / 450
        ctx.fillStyle = `rgba(255,213,79,${0.35 * k})`
        ctx.fillRect(x1 - 30 * dpr, 0, bead * 2 + 60 * dpr, H)
      }
      // 领先者拖影（2 帧）
      let leader = null
      for (const r of runners) if (!leader || r.p > leader.p) leader = r
      // 引擎快慢感：领跑车帧间 Δp → 归一速度 → 平滑映射频率（70 慢 ~210 快）
      if (whistled && !finaleFired && leader) {
        const inst = Math.max(0, leader.p - prevLeadP)
        prevLeadP = leader.p
        const spd = Math.min(1, inst / 0.004)   // 稳态 Δp≈0.002-0.004（含 wobble 起伏）
        engFreq += (70 + spd * 140 - engFreq) * 0.12
        cbRef.current.sfx.engineRev?.(engFreq)
      }
      // 选手
      byLane.forEach((r, i) => {
        const y = i * laneH + laneH / 2
        const x = x0 + r.p * (x1 - x0)
        if (r === leader && whistled && !r.finished) {
          r.trail.push(x)
          if (r.trail.length > 2) r.trail.shift()
          r.trail.forEach((tx, ti) => {
            ctx.globalAlpha = [0.12, 0.25][ti] ?? 0.1
            drawCar(tx - bead * 0.5, y, bead, r.num)
          })
          ctx.globalAlpha = 1
        } else {
          r.trail.length = 0
        }
        drawCar(x, y, bead, r.num, { flame: whistled && !r.finished })
      })
      // 起跑红绿灯：红(0-200)→黄(200-350)→绿(350-500) 状态色辉 + 绿灯 GO!
      if (t < RACE_START + 250) {
        const lit = t < 200 ? [255, 60, 40] : t < 350 ? [255, 200, 40] : [60, 220, 90]
        if (trafficImg.complete && trafficImg.naturalWidth > 0) {
          const lh = H * 0.62, lw = lh * (trafficImg.naturalWidth / trafficImg.naturalHeight)
          ctx.drawImage(trafficImg, W / 2 - lw / 2, H * 0.16, lw, lh)
        }
        const gg = ctx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, W * 0.42)
        gg.addColorStop(0, `rgba(${lit[0]},${lit[1]},${lit[2]},0.3)`)
        gg.addColorStop(1, 'transparent')
        ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H)
      }
      if (t >= 350 && t < 900) {   // 绿灯 GO! 金字（渐隐，不改物理）
        const k = t < 520 ? 1 : Math.max(0, 1 - (t - 520) / 380)
        ctx.fillStyle = `rgba(255,213,79,${k})`
        ctx.font = `900 ${Math.round(H * 0.34)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * dpr
        ctx.fillText('出发！', W / 2, H / 2)
        ctx.shadowBlur = 0
      }
      // 名次侧栏 — 撞线依次落位
      const slotH = H / 10
      ctx.textAlign = 'left'
      finishedList.forEach((r, idx) => {
        const sy = idx * slotH + slotH / 2
        const sx = W * 0.93
        ctx.fillStyle = idx === 0 ? GOLDENBOOT.gold : 'rgba(255,255,255,0.55)'
        ctx.font = `900 ${Math.round(9 * dpr)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText(String(idx + 1), sx - Math.min(slotH * 0.78, 13 * dpr) * 0.78, sy + 3 * dpr)
        drawCar(sx, sy, Math.min(slotH * 0.78, 13 * dpr), r.num, { noBadge: true })
      })
      // 收尾：冠亚军金框定格（上下两格，车图与文字分列不重叠）
      if (finaleFired) {
        const cx = (x0 + x1) / 2, cy = H / 2
        const s = Math.min(H * 0.36, 42 * dpr)
        const bh = Math.min(s * 1.85, H * 0.6)   // ≤60% 高，上下各留 ~20% 边距
        const bw = s * 2.8
        const bx = cx - bw / 2, by = cy - bh / 2
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, bh, 12 * dpr)
        ctx.fill()
        ctx.strokeStyle = GOLDENBOOT.gold
        ctx.lineWidth = 2 * dpr
        ctx.shadowColor = GOLDENBOOT.gold
        ctx.shadowBlur = 14 * dpr
        ctx.stroke()
        ctx.shadowBlur = 0
        // 中缝分隔线
        ctx.strokeStyle = 'rgba(255,213,79,0.35)'
        ctx.lineWidth = 1 * dpr
        ctx.beginPath(); ctx.moveTo(bx + bw * 0.1, cy); ctx.lineTo(bx + bw * 0.9, cy); ctx.stroke()
        const carS = bh * 0.27   // 约格高 54%，四周留白
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ;[
          { label: '冠军', num: race.winner, ry: by + bh * 0.29, c: GOLDENBOOT.gold },
          { label: '亚军', num: race.runnerUp, ry: by + bh * 0.71, c: 'rgba(255,255,255,0.9)' },
        ].forEach(row => {
          drawCar(bx + bw * 0.27, row.ry, carS, row.num, { noBadge: true })
          ctx.fillStyle = row.c
          ctx.font = `900 ${Math.round(carS * 0.6)}px 'Space Grotesk', sans-serif`
          ctx.fillText(`${row.label}  #${row.num}`, bx + bw * 0.47, row.ry)
        })
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      cbRef.current.sfx.engineStop?.()   // 卸载停引擎轰鸣（防泄漏/跨局残响）
      if (shakeRef.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__GB_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；race 由 key 换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, flexWrap: 'wrap', padding: '0 12px',
        background: GOLDENBOOT.strip, borderRadius: 12,
      }}>
        {race.order.map((n, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, opacity: i > 2 ? 0.6 : 1 }}>
            <span style={{ color: GOLDENBOOT.dim, fontSize: 10, fontWeight: 900 }}>{i + 1}.</span>
            <img src={CAR_SRC[n]} alt={`car ${n}`} style={{ height: 22, width: 'auto', display: 'block' }} />
          </span>
        ))}
        <span style={{ color: GOLDENBOOT.gold, fontSize: 14, fontWeight: 900, marginLeft: 8 }}>冠军 #{race.winner} · 亚军 #{race.runnerUp}</span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

export default function GoldenBoot({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  const room = useRoundRoom(playerToken, G.backendId)

  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('WINNER')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | racing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [lastRace, setLastRace] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null) // 冲刺动画收尾的命中预亮（结算前）
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)   // 是否有上局注单快照（重复钮亮灭）

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}
  const lastBetsRef = useRef(new Map())   // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画名次（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取
  const audioRef = useRef({ ctx: null, muted: false })
  const engineRef = useRef(null)   // 冲刺持续引擎轰鸣（whistle 起、finale/卸载停）
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
  function sfxWhistle() {   // 发车音：引擎猛轰上扬 rev
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.28)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(1200, t + 0.28)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
  }
  function sfxStep() {   // 引擎加速脉冲（rAF 每 ~170ms 触发成节奏簇 = 排气声）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.05)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
  }
  // 冲刺持续引擎轰鸣：低频锯齿 + rumble LFO 调频（起跑起、finale/卸载停；muted 门控）
  function sfxEngineStart() {
    sfxEngineStop()
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 72
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 24
    const lfoG = ctx.createGain(); lfoG.gain.value = 16
    lfo.connect(lfoG); lfoG.connect(osc.frequency)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.4)
    osc.connect(lp); lp.connect(g); g.connect(ctx.destination)
    osc.start(t); lfo.start(t)
    engineRef.current = { osc, lfo, g }
  }
  // 引擎快慢感：按冲刺速度平滑更新振荡频率（70Hz 慢 → 210Hz 快）
  function sfxEngineRev(freq) {
    const e = engineRef.current; if (!e) return
    const ctx = audioRef.current.ctx; if (!ctx) return
    try { e.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05) } catch { /* 已停 */ }
  }
  function sfxEngineStop() {
    const e = engineRef.current; if (!e) return
    engineRef.current = null
    const ctx = audioRef.current.ctx; if (!ctx) return
    const t = ctx.currentTime
    try {
      e.g.gain.cancelScheduledValues(t)
      e.g.gain.setValueAtTime(Math.max(0.0001, e.g.gain.value), t)
      e.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
      e.osc.stop(t + 0.3); e.lfo.stop(t + 0.3)
    } catch { /* 已停 */ }
  }
  function sfxCheer() {   // 冲线：轮胎 screech + 观众欢呼浪涌
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    // 轮胎尖啸（高频窄带噪声速降）
    const sb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate)
    const sd = sb.getChannelData(0); for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1)
    const ss = ctx.createBufferSource(); ss.buffer = sb
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.Q.value = 6
    sbp.frequency.setValueAtTime(2600, t); sbp.frequency.exponentialRampToValueAtTime(1200, t + 0.28)
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.06, t + 0.02); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    ss.connect(sbp); sbp.connect(sg); sg.connect(ctx.destination); ss.start(t); ss.stop(t + 0.3)
    // 观众欢呼浪涌
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
    bp.frequency.setValueAtTime(420, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t + 0.1); g.gain.exponentialRampToValueAtTime(0.1, t + 0.28); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.88)
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t + 0.1); ns.stop(t + 0.9)
  }
  function sfxChime() {   // 收尾定格：上扬三连音
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1170].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  const stageSfx = { whistle: sfxWhistle, step: sfxStep, cheer: sfxCheer, chime: sfxChime, engineStart: sfxEngineStart, engineStop: sfxEngineStop, engineRev: sfxEngineRev }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。无 push（hit/lose 两态）。
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
      hits = new Set((si.yourResult || []).filter(v => v.outcome !== 'lose').map(v => v.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(r); winTotal = 0
    }
    setLastRace(r)
    setHistory(h => [...h, { winner: r.winner, sum: r.sprintSum }].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
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
      setResult(null); setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 racing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动冲刺舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const race = deriveRace(room.drawResult.ranking)   // ← 后端名次（不本地 drawRace）
      const rnd = room.roundNo
      pendingRef.current = race
      setUiPhase('racing')
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  const betting = room.phase === 'betting'
  const racing = uiPhase === 'racing'
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
  function repeatBets() { placeAndPost(new Map(lastBetsRef.current)) }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? GOLDENBOOT.selTint : GOLDENBOOT.grey,
      border: `1px solid ${hit ? GOLDENBOOT.sel : sel ? GOLDENBOOT.gold : placed ? GOLDENBOOT.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${GOLDENBOOT.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box',
      position: 'relative',
    }
  }
  const cellName = { color: GOLDENBOOT.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: GOLDENBOOT.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: GOLDENBOOT.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: GOLDENBOOT.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: GOLDENBOOT.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: GOLDENBOOT.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: GOLDENBOOT.orange }
        : racing
          ? { text: '冲刺中…', c: GOLDENBOOT.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: GOLDENBOOT.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const subRowNode = (
    <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
      {/* 上期名次串 — 只显前 3 名（冠/亚/季），删 WINNER 标后放大占满整行 */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flex: 1, minWidth: 0, gap: isMobile ? 6 : 12 }}>
        {lastRace.order.slice(0, 3).map((n, i) => (
          <span key={`${n}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`第${i + 1}名`}>
            <span style={{
              color: ['#ffd54f', '#cfd6de', '#d9873f'][i], fontSize: isMobile ? 10 : 12, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
            }}>{['冠', '亚', '季'][i]}</span>
            <CarImgBead num={n} size={isMobile ? 38 : 48} />
          </span>
        ))}
      </span>
    </span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={GOLDENBOOT.band} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} />
      {!room.connected && room.roundNo && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${GOLDENBOOT.orange}`, borderRadius: 10,
          padding: '8px 16px', color: GOLDENBOOT.orange, fontSize: 13, fontWeight: 800,
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
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(h => beadFor(roadTab, h))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? GOLDENBOOT.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : GOLDENBOOT.dim,
            border: `1px solid ${roadTab === t ? GOLDENBOOT.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 7 : 9, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ---- 开奖区（常驻顶部）：RACING/SETTLED 冲刺舞台 / BETTING 上期名次静态待命 ----
  const stageH = isMobile ? 150 : 178
  const stageZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', minHeight: stageH,
    }}>
      {(racing || settled) && pendingRef.current ? (
        <RaceStage key={room.roundNo} race={pendingRef.current}
          height={stageH}
          shakeRef={cardShakeRef} sfx={stageSfx}
          onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
      ) : (
        // BETTING 待命：赛车停起跑线（与冲刺舞台同套赛车视觉）+ 红绿灯红灯待发
        <div style={{
          height: stageH, position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, #252932, #15181f)',
        }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <div key={n} style={{
              position: 'absolute', left: 0, right: 0, top: `${(n - 1) * 10}%`, height: '10%',
              borderBottom: n < 10 ? '1px dashed rgba(255,255,255,0.15)' : 'none',
              display: 'flex', alignItems: 'center', gap: 5, paddingLeft: isMobile ? 8 : 14,
            }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 900, width: 9, textAlign: 'right' }}>{n}</span>
              <img src={CAR_SRC[n]} alt={`car ${n}`} style={{ height: `${stageH / 10 * 0.82}px`, width: 'auto', display: 'block' }} />
            </div>
          ))}
          {/* 起跑线 */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: isMobile ? 30 : 40, width: 2, background: 'rgba(255,255,255,0.45)' }} />
          {/* 红绿灯（红灯待发，居中）*/}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'none',
          }}>
            <img src={trafficLightImg} alt="traffic light" style={{
              height: stageH * 0.58, width: 'auto', display: 'block',
              filter: 'drop-shadow(0 0 10px rgba(255,60,40,0.75))',
            }} />
            <span style={{ color: GOLDENBOOT.dim, fontSize: 9, fontWeight: 900, letterSpacing: 1 }}>起跑线待命</span>
          </div>
        </div>
      )}
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${GOLDENBOOT.bgCenter}, ${GOLDENBOOT.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.gbCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}

      {/* ---- ① 开奖区（常驻顶部）---- */}
      {stageZone}

      {/* ---- ② 下注区: 盘区三族，可滚 ---- */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '8px 12px' : '8px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {/* 族① WINNER 冠军直选 1–10 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>冠军直选</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`w-${n}`)}
                style={{ ...cellBtn(`w-${n}`), flexBasis: isMobile ? '17%' : 0 }}>
                <CarImgBead num={n} size={isMobile ? 24 : 30} />
                <span style={cellOdds}>{ODDS.winner.toFixed(2)}</span>
                {stakeChip(`w-${n}`)}
              </button>
            ))}
          </div>
        </div>

        {/* 族② SPRINT SUM 冠亚和 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>冠亚和</div>
          <div style={{ display: 'flex', gap: isMobile ? 4 : 5, flexWrap: 'wrap', marginBottom: isMobile ? 6 : 8 }}>
            {Object.keys(SUM_N).map(s => (
              <button key={s} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`sum-${s}`)}
                style={{ ...cellBtn(`sum-${s}`, { compact: true }), flexBasis: isMobile ? '14%' : 0, minWidth: isMobile ? 0 : 42 }}>
                <span style={{ ...cellName, fontSize: isMobile ? 11 : 12.5 }}>{s}</span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9 : 10.5 }}>{ODDS.sum[s].toFixed(2)}</span>
                {stakeChip(`sum-${s}`)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {[
              { key: 's-big',   name: '大', range: '12–19', odds: ODDS.big },
              { key: 's-small', name: '小', range: '3–11',  odds: ODDS.small },
              { key: 's-odd',   name: '单', range: '和为单', odds: ODDS.odd },
              { key: 's-even',  name: '双', range: '和为双', odds: ODDS.even },
            ].map(m => (
              <button key={m.key} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key)}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span style={cellOdds}>{m.odds.toFixed(2)}</span>
                {stakeChip(m.key)}
              </button>
            ))}
          </div>
        </div>

      </div>

      <div style={{ flex: '1 0 auto' }} />

      {/* ---- ③ 珠盘路（常驻底部）---- */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（抄 LineUp/DominoDuel）---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: GOLDENBOOT.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="gbChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? GOLDENBOOT.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? GOLDENBOOT.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6, boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
            <input value={bet} disabled={!betting} onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: COLORS.white, fontSize: 14, fontWeight: 900 }} />
          </div>
          <button type="button" disabled={!repeatOk} onClick={repeatBets} style={{
            gridColumn: 3, gridRow: 2, width: '100%', height: '100%', borderRadius: 8,
            fontSize: 11, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: repeatOk ? COLORS.white : GOLDENBOOT.dim, background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : racing ? '冲刺中…' : '本期已结算'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Half Time ----
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
    <GameLayout color={GOLDENBOOT.gold}>
      <div ref={cardShakeRef}>
        {gameCard}
      </div>
    </GameLayout>
  )
}
