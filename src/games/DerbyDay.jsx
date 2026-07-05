import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'
import trophyImg from '../assets/shared/trophy.png'

// Derby Day — 主客对抗 Keno（主队 10 珠 vs 客队 10 珠比和值），第 16 卡。
// 引擎：主客各自独立 80 池 Fisher-Yates 抽 20 无重复（前 10 = 半场，全 20 = 全场累计）。
// 轮次（一期一场两阶段，多场馆/浮动赔率二期）：
//   BETTING(24s) → HT_DRAW(3s 占位，单3 换动画) → HT_SHOWN(6s 半场块亮真珠，仅展示，
//   全部盘 BETTING 截止后已锁死) → FT_DRAW(3s 占位) → SETTLED(4s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（含 push 退注：
// H/A 盘平局退回本金，不算赢不算输，WinToast 用「平局退注」区分文案）。

// ---------- 引擎（纯函数区，禁副作用）----------
// 主客各自独立 80 池抽 20（部分 Fisher-Yates）；rng 可注入，抽取顺序固定 home 先 away 后
export function drawMatch(rng = Math.random) {
  const draw20 = () => {
    const pool = Array.from({ length: 80 }, (_, i) => i + 1)
    for (let k = 0; k < 20; k++) {
      const j = k + Math.floor(rng() * (80 - k))
      ;[pool[k], pool[j]] = [pool[j], pool[k]]
    }
    return pool.slice(0, 20)
  }
  const home20 = draw20()
  const away20 = draw20()
  return { home20, away20 }
}

// 派生：半场 = 前 10 和；全场 = 20 累计和；大小单双按各盘和值派生
const sumOf = a => a.reduce((x, y) => x + y, 0)
export function deriveMatch({ home20, away20 }) {
  const htHome = sumOf(home20.slice(0, 10))
  const htAway = sumOf(away20.slice(0, 10))
  const ftHome = sumOf(home20)
  const ftAway = sumOf(away20)
  return {
    home20, away20,
    htHome, htAway, htTotal: htHome + htAway,
    ftHome, ftAway, ftTotal: ftHome + ftAway,
  }
}

// 赔率配置表 — 全 1.95 起步（推导注释）：
//   两队 iid 对称 ⇒ 单队 10 抽和值均值 405（分布关于 405 对称：x↔81−x 映射），
//   两队合计均值 810（全场 1620）。
//   大小（中点归属推导）：分布关于均值 810（全场 1620）对称，且中点值本身有
//     质量 P(=810)≈0.006 —— 阈值 BIG ≥811/SMALL ≤810 把中点整格划给 SMALL，
//     故 P(SMALL) = 0.5 + P(=中点)/2 ≈ 0.503、P(BIG) = 0.5 − P(=中点)/2 ≈ 0.497。
//     1.95 下 SMALL 结构性超带（1e6 实测 98.1%），故 SMALL 两键单独降 1.92：
//     EV ≈ 1.92×0.503 = 96.6%（带内）；BIG 维持 1.95 ≈ 96.9%（带内）。
//   单双：合计和值奇偶 ≈ 0.5/0.5（97.5% 压线量级，实测 97.4–97.6%，维持 1.95）。
//   H/A：和值比大小，平局 PUSH 退注 ⇒ EV = 1.95×P(win) + 1×P(tie)，
//     P(tie) = Σ P(s)²（离散巧合，HT≈0.004/FT≈0.003），由 1e6 模拟单列回报。
export const ODDS = { main: 1.95, side: 1.95, small: 1.92 }
const HT_BIG = 811, FT_BIG = 1621

// 盘区判定表 — 数据驱动生成（12 键）：hit = 赢；push = 退注（仅 H/A 盘平局）
export const MARKETS = {
  'ht-home':  { odds: ODDS.main, hit: r => r.htHome > r.htAway, push: r => r.htHome === r.htAway },
  'ht-away':  { odds: ODDS.main, hit: r => r.htAway > r.htHome, push: r => r.htHome === r.htAway },
  'ft-home':  { odds: ODDS.main, hit: r => r.ftHome > r.ftAway, push: r => r.ftHome === r.ftAway },
  'ft-away':  { odds: ODDS.main, hit: r => r.ftAway > r.ftHome, push: r => r.ftHome === r.ftAway },
  'ht-big':   { odds: ODDS.side, hit: r => r.htTotal >= HT_BIG },
  'ht-small': { odds: ODDS.small, hit: r => r.htTotal < HT_BIG },
  'ht-odd':   { odds: ODDS.side, hit: r => r.htTotal % 2 === 1 },
  'ht-even':  { odds: ODDS.side, hit: r => r.htTotal % 2 === 0 },
  'ft-big':   { odds: ODDS.side, hit: r => r.ftTotal >= FT_BIG },
  'ft-small': { odds: ODDS.small, hit: r => r.ftTotal < FT_BIG },
  'ft-odd':   { odds: ODDS.side, hit: r => r.ftTotal % 2 === 1 },
  'ft-even':  { odds: ODDS.side, hit: r => r.ftTotal % 2 === 0 },
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))
export const pushesOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].push?.(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__DD = { drawMatch, deriveMatch, hitsOf, pushesOf, MARKETS, ODDS }
}

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const HT_DRAW_T = 16    // 8s = 20 珠交替出珠 ~6.5s + 和值对比定格 1.5s
const HT_SHOWN_T = 12   // 6s 半场定格展示（不动）
const FT_DRAW_T = 16    // 8s（同构）
const SETTLED_T = 8     // 4s
// 出球舞台时间轴（rAF 内使用，毫秒）：主客交替 主1客1主2客2…
const BALL_T0 = 400      // 首珠弹出时刻
const BALL_GAP = 300     // 出珠间隔（20 珠 ~6.4s 出完）
const BALL_FLIGHT = 280  // 单珠飞行时长（短抛物线）
const STAGE_FREEZE = 6600   // 和值对比定格（放大一拍 + 领先方 trophy 闪现）
const VENUE = 'EMERALD ARENA'   // 架空场馆名（禁真实球场名）
const ROUND_DATE = 'EA20260705'
const ROAD_CAP = 120

// 种子上局（确定性脚本预生成后硬编码；真开奖逐期顶掉）
const SEED_LAST = deriveMatch({
  home20: [22, 13, 2, 57, 44, 64, 49, 70, 54, 62, 46, 65, 78, 27, 75, 11, 51, 14, 39, 5],
  away20: [8, 24, 25, 71, 66, 7, 44, 60, 52, 62, 40, 3, 17, 58, 23, 73, 64, 12, 53, 33],
})   // htHome 437 / htAway 419 / ftHome 848 / ftAway 795 / ftTotal 1643

// 30 期假历史 [htHome, htAway, ftHome, ftAway]（旧→新；真开奖逐期顶掉）
const SEED_ROUNDS = [
  [428, 376, 853, 856], [432, 431, 788, 894], [436, 454, 877, 834], [449, 359, 866, 724], [361, 448, 822, 905], [346, 401, 786, 786],
  [372, 385, 840, 846], [393, 394, 846, 750], [353, 377, 739, 783], [476, 400, 919, 764], [395, 461, 848, 837], [410, 457, 845, 803],
  [418, 343, 852, 733], [435, 368, 822, 758], [393, 472, 788, 805], [368, 350, 798, 680], [373, 372, 766, 734], [451, 402, 862, 860],
  [422, 435, 755, 848], [397, 407, 827, 781], [403, 474, 763, 882], [466, 422, 798, 848], [427, 390, 878, 823], [372, 449, 852, 853],
  [358, 415, 789, 875], [416, 434, 759, 905], [343, 366, 741, 817], [376, 459, 741, 910], [391, 394, 722, 772], [436, 454, 885, 934],
]

// ---------- 珠盘路（六页签）----------
const ROAD_TABS = ['HT-H/A', 'HT-O/U', 'HT-O/E', 'FT-H/A', 'FT-O/U', 'FT-O/E']
function beadFor(tab, r) {
  const [hh, ha, fh, fa] = r
  const half = tab.startsWith('HT')
  const home = half ? hh : fh
  const away = half ? ha : fa
  const total = home + away
  if (tab.endsWith('H/A')) {
    if (home === away) return { t: 'D', c: 'rgba(255,255,255,0.3)' }
    return home > away ? { t: 'H', c: DERBY.home } : { t: 'A', c: DERBY.away }
  }
  if (tab.endsWith('O/U')) {
    return total >= (half ? HT_BIG : FT_BIG) ? { t: 'O', c: DERBY.away } : { t: 'U', c: DERBY.home }
  }
  return total % 2 ? { t: 'O', c: DERBY.away } : { t: 'E', c: DERBY.home }   // O/E 单双
}

// 号码珠（主蓝/客红/灰 0 态）
function NumBead({ n, color, size = 24, blank = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: blank ? 'rgba(255,255,255,0.1)' : color,
      border: '1px solid rgba(0,0,0,0.35)',
      boxShadow: blank ? 'none' : 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)',
      color: COLORS.white, fontSize: size * 0.42, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box', flex: '0 0 auto',
    }}>{blank ? '' : n}</span>
  )
}

// ---------- 出球舞台：单一 rAF 循环驱动（禁 CSS transition 拼接）----------
// 开奖区双块原位表演（不另开槽）：主客交替出珠，每珠从块中央 TOTAL 位短抛物线
// 飞入自己阵列格位（落位轻弹 + 1 帧拖影）；两侧和值随出珠滚动累加、领先方亮色；
// 阶段定格 = 和值对比放大一拍 + 领先方 trophy 闪现（平局不亮）。
// HT 段出前 10 珠（和值从 0 起滚）；FT 段出后 10 珠（和值从半场基数累计滚）。
// 结果进 HT_DRAW 前已全锁定，动画只读。
function DrawStage({ stage, roll, beadSize, isMobile, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const half = stage === 'ht'
  const homeBalls = half ? roll.home20.slice(0, 10) : roll.home20.slice(10)
  const awayBalls = half ? roll.away20.slice(0, 10) : roll.away20.slice(10)
  const baseHome = half ? 0 : roll.htHome
  const baseAway = half ? 0 : roll.htAway
  const finalHome = half ? roll.htHome : roll.ftHome
  const finalAway = half ? roll.htAway : roll.ftAway
  const isTie = finalHome === finalAway
  const title = half ? '半场' : '全场'
  const innerH = beadSize * 2 + (isMobile ? 3 : 4) + 24   // 两行阵列 + 底部比分行

  useEffect(() => {
    const markKey = half ? '__DD_ANIM_HT' : '__DD_ANIM_FT'
    if (reduced) {   // 减动效：直接标记 + 收尾
      if (import.meta.env.DEV) window[markKey] = `${finalHome},${finalAway}`
      cbRef.current.onFinale?.()
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__DD_RAF_ACTIVE = (window.__DD_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    const trophy = new Image()
    trophy.src = trophyImg

    const landed = new Array(20).fill(false)
    const lastPos = new Array(20).fill(null)   // 1 帧拖影
    let whistled = false, finaled = false
    let raf = 0
    const t0 = performance.now()

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const bs = beadSize * dpr
      const gap = (isMobile ? 3 : 4) * dpr
      const pad = (isMobile ? 8 : 14) * dpr
      const gridW = 5 * bs + 4 * gap
      const gridH = 2 * bs + gap
      const centerW = (isMobile ? 92 : 120) * dpr
      const x0 = (W - (gridW * 2 + centerW + pad * 2)) / 2
      const xa = x0 + gridW + pad * 2 + centerW
      const slot = (team, idx) => ({
        x: (team ? xa : x0) + (idx % 5) * (bs + gap) + bs / 2,
        y: Math.floor(idx / 5) * (bs + gap) + bs / 2,
      })
      const center = { x: W / 2, y: gridH / 2 }

      // —— 出珠推进 + 和值累加 ——
      let curHome = baseHome, curAway = baseAway
      const frozen = t >= STAGE_FREEZE
      for (let k = 0; k < 20; k++) {
        const team = k % 2                 // 0 主 1 客（主1客1主2客2…交替）
        const idx = Math.floor(k / 2)
        const launch = BALL_T0 + k * BALL_GAP
        const v = team ? awayBalls[idx] : homeBalls[idx]
        if (t >= launch + BALL_FLIGHT || frozen) {
          if (!landed[k]) { landed[k] = true; cbRef.current.sfx.pop(team) }
          if (team) curAway += v; else curHome += v
        }
      }

      // —— 定格事件 ——
      if (frozen && !whistled) { whistled = true; cbRef.current.sfx.whistle() }
      if (frozen && !finaled && t >= STAGE_FREEZE + 250) {
        finaled = true
        if (!half) cbRef.current.sfx.chime(isTie)
        if (import.meta.env.DEV) window[half ? '__DD_ANIM_HT' : '__DD_ANIM_FT'] = `${finalHome},${finalAway}`
        cbRef.current.onFinale?.()
      }

      // —— 珠位绘制（空位淡圈 / 已落珠 / 飞行珠 + 拖影）——
      const drawBead = (x, y, r, color, v, alpha = 1) => {
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1 * dpr
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.font = `900 ${Math.round(r * 0.85)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(v), x, y + 0.5 * dpr)
        ctx.globalAlpha = 1
      }
      for (let k = 0; k < 20; k++) {
        const team = k % 2, idx = Math.floor(k / 2)
        const s = slot(team, idx)
        const color = team ? DERBY.away : DERBY.home
        const v = team ? awayBalls[idx] : homeBalls[idx]
        const launch = BALL_T0 + k * BALL_GAP
        if (landed[k]) {
          // 落位轻弹（120ms 半径回落）
          const since = t - (launch + BALL_FLIGHT)
          const r = (bs / 2) * (since < 120 && !frozen ? 1 + 0.22 * (1 - since / 120) : 1)
          drawBead(s.x, s.y, r, color, v)
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.beginPath(); ctx.arc(s.x, s.y, bs / 2, 0, Math.PI * 2); ctx.fill()
          if (t >= launch && t < launch + BALL_FLIGHT) {
            const p = (t - launch) / BALL_FLIGHT
            const x = center.x + (s.x - center.x) * p
            const y = center.y + (s.y - center.y) * p - Math.sin(p * Math.PI) * 18 * dpr
            if (lastPos[k]) drawBead(lastPos[k].x, lastPos[k].y, bs / 2, color, v, 0.25)   // 1 帧拖影
            drawBead(x, y, bs / 2, color, v)
            lastPos[k] = { x, y }
          }
        }
      }

      // —— 中央标题 + TOTAL 滚动 ——
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `900 ${9 * dpr}px sans-serif`
      ctx.fillText(title, W / 2, center.y - 10 * dpr)
      ctx.fillStyle = frozen ? DERBY.gold : 'rgba(255,255,255,0.9)'
      ctx.font = `900 ${13 * dpr}px 'Space Grotesk', sans-serif`
      ctx.fillText(`TOTAL ${curHome + curAway}`, W / 2, center.y + 7 * dpr)

      // —— 底部比分行：领先方亮色；定格放大一拍 + trophy 闪现 ——
      const by = gridH + 13 * dpr
      const scale = frozen ? 1 + 0.25 * Math.sin(Math.min(1, (t - STAGE_FREEZE) / 400) * Math.PI) : 1
      const homeLead = curHome > curAway, awayLead = curAway > curHome
      ctx.textBaseline = 'middle'
      ctx.font = `900 ${Math.round(12 * dpr * scale)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillStyle = DERBY.home
      ctx.beginPath(); ctx.arc(x0 + 4 * dpr, by, 4 * dpr, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = homeLead ? '#ffffff' : 'rgba(255,255,255,0.6)'
      ctx.fillText(`主队：${curHome}`, x0 + 12 * dpr, by)
      ctx.textAlign = 'right'
      ctx.fillStyle = DERBY.away
      ctx.beginPath(); ctx.arc(xa + gridW - 4 * dpr, by, 4 * dpr, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = awayLead ? '#ffffff' : 'rgba(255,255,255,0.6)'
      ctx.fillText(`客队：${curAway}`, xa + gridW - 12 * dpr, by)
      // trophy 闪现（定格后领先方一侧，平局不亮）
      if (frozen && !isTie && trophy.complete) {
        const a = Math.min(1, (t - STAGE_FREEZE) / 300)
        ctx.globalAlpha = a
        const tw = 14 * dpr
        if (homeLead) ctx.drawImage(trophy, x0 + 12 * dpr + ctx.measureText(`主队：${curHome}`).width + 4 * dpr, by - tw / 2, tw, tw)
        else ctx.drawImage(trophy, xa + gridW - 12 * dpr - ctx.measureText(`客队：${curAway}`).width - tw - 4 * dpr, by - tw / 2, tw, tw)
        ctx.globalAlpha = 1
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (import.meta.env.DEV) window.__DD_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；key=期号+阶段保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {   // 减动效：静态直出真珠 + 和值
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 8 : 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`, gap: isMobile ? 3 : 4 }}>
            {homeBalls.map((n, i) => <NumBead key={i} n={n} color={DERBY.home} size={beadSize} />)}
          </div>
          <span style={{ color: DERBY.gold, fontSize: 12, fontWeight: 900 }}>{title} TOTAL {finalHome + finalAway}</span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`, gap: isMobile ? 3 : 4 }}>
            {awayBalls.map((n, i) => <NumBead key={i} n={n} color={DERBY.away} size={beadSize} />)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: DERBY.text, fontSize: 12, fontWeight: 900 }}>
          <span>主队：{finalHome}</span><span>客队：{finalAway}</span>
        </div>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height: innerH, display: 'block' }} aria-hidden />
}

export default function DerbyDay({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('FT-H/A')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  // betting | ht_draw | ht_shown | ft_draw | settled
  const [gamePhase, setGamePhase] = useState('betting')
  const [countdown, setCountdown] = useState(BETTING_T)
  const [roundNo, setRoundNo] = useState(88)
  const [lastMatch, setLastMatch] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_ROUNDS)   // 珠盘路 + 占比条（旧→新）
  const [result, setResult] = useState(null)            // { hits:Set, pushes:Set, winTotal, refundTotal }
  const [preHits, setPreHits] = useState(null)          // FT 定格后的命中预亮
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const lastBetsRef = useRef(new Map())          // 上局注单快照（重复投注用，照 Line Up 接法）
  const [hasLast, setHasLast] = useState(false)
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

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxPop(team) {   // 出珠：交替双音高（主低客高微差）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    const f = team ? 640 : 520
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
  }
  function sfxWhistle() {   // 阶段定格：短哨两响
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[0, 0.16].forEach(off => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2100, t + off); o.frequency.linearRampToValueAtTime(2350, t + off + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.035, t + off + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.13)
    })
  }
  function sfxChime(tie) {   // FT 定格：上扬三连音；平局期换中性双音
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const notes = tie ? [620, 620] : [660, 880, 1170]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * (tie ? 0.14 : 0.08)
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  const stageSfx = { pop: sfxPop, whistle: sfxWhistle, chime: sfxChime }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账；push = 退回本金
  function settleRound() {
    const r = pendingRef.current
    const hits = hitsOf(r)
    const pushes = pushesOf(r)
    let winTotal = 0, refundTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
      else if (pushes.has(k)) refundTotal = round2(refundTotal + stake)
    })
    if (winTotal + refundTotal > 0) setBalance(b => round2(b + winTotal + refundTotal))
    if (winTotal > 0) pushToast('本期命中', winTotal)
    if (refundTotal > 0) pushToast('平局退注', refundTotal)   // push 区分文案
    setLastMatch(r)
    setHistory(h => [...h, [r.htHome, r.htAway, r.ftHome, r.ftAway]].slice(-ROAD_CAP))
    setResult({ hits, pushes, winTotal, refundTotal })
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
      const go = (next, ticks) => {
        phaseRef.current = next; setGamePhase(next)
        cdRef.current = ticks; setCountdown(ticks)
      }
      if (ph === 'betting') {
        // 双阶段结果此刻全定 — 后续各相（单3 动画）只读，不再碰确定性随机数
        pendingRef.current = deriveMatch(drawMatch())
        go('ht_draw', HT_DRAW_T)
      } else if (ph === 'ht_draw') {
        go('ht_shown', HT_SHOWN_T)
      } else if (ph === 'ht_shown') {
        go('ft_draw', FT_DRAW_T)
      } else if (ph === 'ft_draw') {
        settleRound()
        go('settled', SETTLED_T)
      } else {
        // 清盘前快照本局注单（空局不覆盖，重复钮始终指向最近一张有效注单）
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
    if (phaseRef.current !== 'betting') return   // BETTING 截止后全盘锁死
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点：确认/重复两个入口都走这一条（一次性扣款后入 betsRef，照 Line Up 接法）
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
  // 重复投注 = 复用上局注单快照原键原额重下（结算含 push 退注路径不碰）
  function repeatBets() {
    placeBets(new Map(lastBetsRef.current))
  }

  const betting = gamePhase === 'betting'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && lastTotal <= balance
  const cur = pendingRef.current
  const htVisible = cur && (gamePhase === 'ht_shown' || gamePhase === 'ft_draw' || gamePhase === 'settled')
  const ftVisible = cur && gamePhase === 'settled'

  // ---- 样式件（选中=金框；命中=绿框绿晕；push=灰金框）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，FT 定格先预亮
    const pushed = result?.pushes?.has(key) && betsPlaced.has(key)
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : isDesk ? '5px 4px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : pushed ? 'rgba(255,255,255,0.6)' : sel || placed ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || pushed || placed ? 1 : 0.75,
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

  // ---- 场馆头行（desk 走骨架 34px 历史行位）----
  const phaseChip = betting
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: DERBY.sel }
    : gamePhase === 'ht_draw'
      ? { text: '半场开奖中…', c: DERBY.orange }
      : gamePhase === 'ht_shown'
        ? { text: `半场已开 ${cur ? `${cur.htHome}–${cur.htAway}` : ''}`, c: DERBY.gold }
        : gamePhase === 'ft_draw'
          ? { text: '全场开奖中…', c: DERBY.orange }
          : { text: result && result.winTotal + result.refundTotal > 0 ? `+$${(result.winTotal + result.refundTotal).toFixed(2)}` : '已开奖', c: DERBY.gold }
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '4px 10px', borderRadius: RADIUS.pill,
      background: DERBY.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{
        color: DERBY.gold, fontSize: 12, fontWeight: 900, letterSpacing: 1.5,
        fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
      }}>{VENUE}</span>
      <span style={{ color: DERBY.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(roundNo).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
        color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{phaseChip.text}</span>
    </div>
  )

  // ---- ① 开奖区：半场块（前 10 珠）+ 全场块（后 10 珠 + 累计和值） ----
  const beadSize = isMobile ? 18 : 19
  const ballGrid = (balls, color, lit) => (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`,
      gridTemplateRows: `repeat(2, ${beadSize}px)`, gap: isMobile ? 3 : 4,
    }}>
      {Array.from({ length: 10 }, (_, i) => (
        <NumBead key={i} n={lit ? balls[i] : 0} color={color} size={beadSize} blank={!lit} />
      ))}
    </div>
  )
  // 半场块 = 两队前 10 珠 + 半场和值；全场块 = 两队后 10 珠 + 全场累计和值
  const drawBlock = ({ title, homeBalls, awayBalls, homeSum, awaySum, total, lit, dimmed }) => (
    <div style={{
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 6px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      opacity: lit ? 1 : dimmed ? 0.85 : 1,
      display: 'flex', flexDirection: 'column', gap: 4,
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: isMobile ? 8 : 14, flexWrap: 'nowrap',
      }}>
        {ballGrid(homeBalls, DERBY.home, lit)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{
            padding: '2px 12px', borderRadius: RADIUS.pill,
            background: lit ? DERBY.gold : 'rgba(255,255,255,0.14)',
            color: lit ? '#3a2c00' : DERBY.dim,
            fontSize: isMobile ? 11 : 12.5, fontWeight: 900, whiteSpace: 'nowrap',
          }}>TOTAL {lit ? total : '—'}</span>
        </div>
        {ballGrid(awayBalls, DERBY.away, lit)}
      </div>
      {/* 下缘比分行：主/客和值 + 胜方 trophy（平局双方都不亮） */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.home, display: 'inline-block' }} />
          主队：{lit ? homeSum : '—'}
          {lit && homeSum > awaySum && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          {lit && awaySum > homeSum && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
          客队：{lit ? awaySum : '—'}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block' }} />
        </span>
      </div>
    </div>
  )
  // 舞台块外壳（与静态块同款，出球舞台原位表演不另开槽）
  const stageShell = children => (
    <div style={{
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 6px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      boxSizing: 'border-box',
    }}>{children}</div>
  )
  // 半场块：HT_DRAW 原位舞台 → 本期 HT 先亮定格；全场块：FT_DRAW 原位舞台 → FT 后亮；
  // BETTING 期全场块回显上局
  const halfBlock = gamePhase === 'ht_draw' && cur
    ? stageShell(
        <DrawStage key={`${roundNo}-ht`} stage="ht" roll={cur}
          beadSize={beadSize} isMobile={isMobile} sfx={stageSfx} onFinale={() => {}} />
      )
    : drawBlock(htVisible
      ? { title: '半场', homeBalls: cur.home20.slice(0, 10), awayBalls: cur.away20.slice(0, 10), homeSum: cur.htHome, awaySum: cur.htAway, total: cur.htTotal, lit: true }
      : { title: '半场 · 下期', homeBalls: [], awayBalls: [], lit: false, dimmed: true })
  const fullBlock = gamePhase === 'ft_draw' && cur
    ? stageShell(
        <DrawStage key={`${roundNo}-ft`} stage="ft" roll={cur}
          beadSize={beadSize} isMobile={isMobile} sfx={stageSfx}
          onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
      )
    : drawBlock(ftVisible
      ? { title: '全场', homeBalls: cur.home20.slice(10), awayBalls: cur.away20.slice(10), homeSum: cur.ftHome, awaySum: cur.ftAway, total: cur.ftTotal, lit: true }
      : betting || !cur
        ? { title: '全场 · 上局', homeBalls: lastMatch.home20.slice(10), awayBalls: lastMatch.away20.slice(10), homeSum: lastMatch.ftHome, awaySum: lastMatch.ftAway, total: lastMatch.ftTotal, lit: true }
        : { title: '全场 · 待开', homeBalls: [], awayBalls: [], lit: false, dimmed: true })
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {fullBlock}
      {halfBlock}
    </div>
  )

  // ---- ② 盘区两组（队色语义格） ----
  const GROUPS = [
    { key: 'ht', label: '实况 · 半场', big: '811–960', small: '661–810' },
    { key: 'ft', label: '实况 · 全场', big: '1621–1920', small: '1322–1620' },
  ]
  const marketGroup = g => (
    <div key={g.key} style={secBox}>
      <div style={secHead}>{g.label}</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-home`)}
          style={cellBase(`${g.key}-home`, DERBY.home)}>
          <span style={cellName}>主队 HOME</span>
          <span style={cellOdds}>{ODDS.main.toFixed(2)}</span>
          {stakeChip(`${g.key}-home`)}
        </button>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-away`)}
          style={cellBase(`${g.key}-away`, DERBY.away)}>
          <span style={cellName}>客队 AWAY</span>
          <span style={cellOdds}>{ODDS.main.toFixed(2)}</span>
          {stakeChip(`${g.key}-away`)}
        </button>
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {[
          { k: 'big', name: '大', range: g.big },
          { k: 'small', name: '小', range: g.small },
          { k: 'odd', name: '单', range: '和值单' },
          { k: 'even', name: '双', range: '和值双' },
        ].map(m => (
          <button key={m.k} type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-${m.k}`)}
            style={cellBase(`${g.key}-${m.k}`, DERBY.grey)}>
            <span style={cellName}>{m.name}</span>
            <span style={cellRange}>{m.range}</span>
            <span style={cellOdds}>{MARKETS[`${g.key}-${m.k}`].odds.toFixed(2)}</span>
            {stakeChip(`${g.key}-${m.k}`)}
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（六页签 + 占比条按近 30 期重算 + 6×20 真历史） ----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 16 : 14   // 移动端珠子大一档（横滚可辨），桌面压一档保总高
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(r => beadFor(roadTab, r))
  // 占比条：近 30 期按当前页签所属盘（HT/FT）的 H/A 重算
  const ratioSrc = history.slice(-30)
  const ratioHalf = roadTab.startsWith('HT')
  let hw = 0, dw = 0, aw = 0
  ratioSrc.forEach(([hh, ha, fh, fa]) => {
    const home = ratioHalf ? hh : fh, away = ratioHalf ? ha : fa
    if (home > away) hw++; else if (home === away) dw++; else aw++
  })
  const pct = n => Math.round((n / Math.max(1, ratioSrc.length)) * 100)
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: roadTab === t ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${roadTab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t}</button>
        ))}
      </div>
      {/* 占比条：近 30 期 H/A 分布（随页签 HT/FT 切换重算） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: DERBY.home, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主队 {pct(hw)}%</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: `${pct(hw)}%`, background: DERBY.home }} />
          <span style={{ width: `${pct(dw)}%`, background: 'rgba(255,255,255,0.4)' }} />
          <span style={{ width: `${pct(aw)}%`, background: DERBY.away }} />
        </div>
        <span style={{ color: DERBY.dim, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>和 {pct(dw)}%</span>
        <span style={{ color: DERBY.away, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客队 {pct(aw)}%</span>
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: 8.5, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.ddCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: DERBY.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>DERBY DAY ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: DERBY.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${DERBY.gold}`, color: DERBY.gold,
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

      {/* 场馆头行 — desk 在骨架历史行，卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ① 开奖区（顶部）：全场块 + 半场块（按相位亮真珠） */}
      {drawZone}

      {/* ② 盘区两组（中部；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {GROUPS.map(marketGroup)}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，六页签 + 占比条） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案版式）：
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
            <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              label={betting ? '▷ CONFIRM' : gamePhase === 'settled' ? '本期已结算' : '已锁盘 · 开赛中'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Hat Trick ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Derby Day</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 场馆头行占骨架历史行位（34px 行惯例） */}
            <div style={{ flex: '0 0 auto', minHeight: LAYOUT.historyH }}>
              {roundBar}
            </div>
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
    <GameLayout title="Derby Day" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
