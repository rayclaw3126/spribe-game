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

// Line Up — ATOM 5×5 数字彩（25 个 0-9 独立均匀随机数排成五行），第 17 卡。
// X2：结算引擎 + 轮次状态机 + 赔率参数化。开奖舞台动画走后续单（静态直出）。
// X3：投注盘 A/B 双视图（A 维度列表 / B 矩阵，42 键同源同 key，选中态互通）
//     + 注栏两行压一行；MARKETS/结算零改动。
// 规则对照 /tmp/atom_ref/atom_rules.txt（help.sbobet.com Atom Betting Rules #4303）原文：
//   Red  = "drawn at 0, 2, 6, 7 and 8, which are classified as Red"   → 本作客红
//   Black = "drawn at 1, 3, 4, 5 and 9, which are classified as Black" → 本作主蓝
//   High/Low = 5-9 / 0-4；全局判定 ≥13 计数、行式判定 ≥3 计数
//   段位 = Spring[0-95] 7.50 / Summer[96-112] 2.30 / Autumn[113-129] 2.30 / Winter[130-225] 7.50
//     （足球叙事换皮：降级区/中游/欧战区/夺冠）
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（本彩种无 push 项：
// 25/5 为奇数计数无平局，225/45 为奇数和值无中点格）。

// ---------- 引擎（纯函数区，禁副作用）----------
// 归类表（参考原文映射）：客红 = Red(0,2,6,7,8)；主蓝 = Black(1,3,4,5,9)；高 = 5-9 / 低 = 0-4
export const AWAY_DIGITS = new Set([0, 2, 6, 7, 8])
export const HIGH_DIGITS = new Set([5, 6, 7, 8, 9])

// 开奖：25 个独立均匀 0-9（可重复），rng 可注入
export function drawGrid(rng = Math.random) {
  return Array.from({ length: 25 }, () => Math.floor(rng() * 10))
}

// 派生：行切分/行和/总和/主客色计数/高低计数（全部结算判定只读这一份）
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
//   二元盘（大小/单双/主客色/高低 + 行式全部）：真实概率精确 = 0.5 ——
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

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const DRAW_T = 6        // 3s 静态占位（开奖舞台动画后续单换）
const SETTLED_T = 8     // 4s
const VENUE = 'SAPPHIRE PARK'          // 架空场馆名（禁真实球场名）
const ROUND_DATE = 'SP20260705'
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

export default function LineUp({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [view, setView] = useState('A')       // 投注盘视图：A 列表 / B 矩阵
  const [dim, setDim] = useState(0)           // A 视图维度：0 全局，1-5 行 L1-L5
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  // betting | drawing | settled
  const [gamePhase, setGamePhase] = useState('betting')
  const [countdown, setCountdown] = useState(BETTING_T)
  const [roundNo, setRoundNo] = useState(88)
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)            // 珠盘路（旧→新）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const lastBetsRef = useRef(new Map())          // 上局注单快照（重复投注用）
  const [hasLast, setHasLast] = useState(false)
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账（无 push 项）
  function settleRound() {
    const r = pendingRef.current
    const hits = hitsOf(r)
    let winTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
    })
    if (winTotal > 0) {
      setBalance(b => round2(b + winTotal))
      pushToast('本期命中', winTotal)
    }
    setLastRound(r)
    setRoad(h => [...h, r.total >= 113 ? '大' : '小'].slice(-ROAD_CAP))
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
      const go = (next, ticks) => {
        phaseRef.current = next; setGamePhase(next)
        cdRef.current = ticks; setCountdown(ticks)
      }
      if (ph === 'betting') {
        // 结果此刻全定 — drawing 相（后续舞台动画）只读，不再碰随机数
        let cells = null
        if (import.meta.env.DEV && window.__LU_FORCE) {   // 对账注入口（一次性消费）
          cells = window.__LU_FORCE; window.__LU_FORCE = null
        }
        pendingRef.current = deriveRound(cells || drawGrid())
        go('drawing', DRAW_T)
      } else if (ph === 'drawing') {
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

  // 唯一扣注点：确认/重复两个入口都走这一条（一次性扣款后入 betsRef）
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
  // 重复投注 = 复用上局注单快照原额重下
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
  const shown = gamePhase === 'settled' && cur ? cur : lastRound   // 开奖区当前展示局

  // ---- 样式件（选中=金框；命中=绿框绿晕，同 Derby 惯例）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = result?.hits?.has(key) && betsPlaced.has(key)
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : sel || placed ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || placed ? 1 : 0.75,
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

  // ---- 场馆头行（desk 走骨架 34px 历史行位）----
  const phaseChip = betting
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: DERBY.sel }
    : gamePhase === 'drawing'
      ? { text: '开奖中…', c: DERBY.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
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

  // ---- ① 开奖区：5×5 号码牌（行标 + 行和）+ 统计带（主客计数/总和/高低）----
  // drawing 相静态压暗占位（开奖舞台动画后续单换）；settled 直出本局，其余回显上局
  const tile = isMobile ? 30 : isDesk ? 26 : 36   // desk 收档给盘区留高
  const drawing = gamePhase === 'drawing'
  const zoneTitle = drawing ? '首发阵容 · 开奖中' : gamePhase === 'settled' ? '首发阵容 · 本局' : '首发阵容 · 上局'
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 4,
      boxSizing: 'border-box',
      opacity: drawing ? 0.55 : 1,
      transition: 'opacity 0.3s',
    }}>
      {/* desk 头行并入底部统计带省一行 */}
      {!isDesk && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{zoneTitle}</span>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>25 数 · 0-9</span>
        </div>
      )}
      {shown.rows.map((row, ri) => (
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
          {/* 5 号码牌：主蓝 = Black(1,3,4,5,9) / 客红 = Red(0,2,6,7,8) */}
          {row.map((n, ci) => (
            <span key={ci} style={{
              width: tile, height: tile, borderRadius: 8,
              background: AWAY_DIGITS.has(n) ? DERBY.away : DERBY.home,
              border: '1px solid rgba(0,0,0,0.35)',
              boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.25), 0 1px 3px rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: tile * 0.5, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box', flex: '0 0 auto',
            }}>{n}</span>
          ))}
          {/* 行尾行和 */}
          <span style={{
            flex: '0 0 auto', minWidth: isMobile ? 26 : 32, textAlign: 'center',
            padding: '2px 6px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.2)',
            color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900,
          }}>{shown.rowSums[ri]}</span>
        </div>
      ))}
      {/* 统计带：主/客计数 + 总和大字 + 高/低 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: 2, flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {isDesk && (
            <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginRight: 8 }}>{zoneTitle}</span>
          )}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.home, display: 'inline-block' }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>主 {shown.homeCount}</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block', marginLeft: 6 }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>客 {shown.awayCount}</span>
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
        }}>SUM {shown.total}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          高 {shown.highCount} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 低 {shown.lowCount}
        </span>
      </div>
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
      { slot: 'home', name: '主色多', range: d === 0 ? '主蓝 ≥13' : '主蓝 ≥3', bg: DERBY.home },
      { slot: 'away', name: '客色多', range: d === 0 ? '客红 ≥13' : '客红 ≥3', bg: DERBY.away },
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
    { slot: 'home', name: '主', bg: DERBY.home },
    { slot: 'away', name: '客', bg: DERBY.away },
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
            color: c.slot === 'home' ? '#7fa8e8' : c.slot === 'away' ? '#f0938a' : DERBY.dim,
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

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: DERBY.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>LINE UP ▾</span>
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Derby Day ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Line Up</strong>
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
    <GameLayout title="Line Up" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
