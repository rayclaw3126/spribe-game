import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import GameTopBar from '../components/shell/GameTopBar'

// 五行 WuXing — KENO 20 球快开五项皮（80 池无放回抽 20 比总和），第 19 卡。
// X2：结算引擎 + 轮次状态机 + 赔率定稿（官方原生赔率 14 键出带 → 单据逐档调价，
//     1e6 复验 19 键全数入 94-97.5% 带，见 ODDS 注释）。开奖舞台动画走后续单。
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
const DRAW_T = 6        // 3s 静态占位（开奖舞台动画后续单换）
const SETTLED_T = 8     // 4s
const ROAD_CAP = 120

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'GARNET PAVILION'        // 架空馆名（对齐 AMBER DOME 系，禁真实场馆名）
const ROUND_DATE = 'GP20260706'
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

export default function WuXing({ balance, setBalance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
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
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
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
    setRoad(h => [...h, r.sum >= 811 ? '大' : '小'].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
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
        let balls = null
        if (import.meta.env.DEV && window.__WX_FORCE) {   // 对账注入口（一次性消费）
          balls = window.__WX_FORCE; window.__WX_FORCE = null
        }
        pendingRef.current = deriveRound(balls || drawKeno())
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
    entries.forEach(x => { total = round2(total + x) })
    if (!entries.size || total <= 0 || total > balanceRef.current) return false
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
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
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance
  let lastTotal = 0
  lastBetsRef.current.forEach(x => { lastTotal = round2(lastTotal + x) })
  const repeatOk = betting && hasLast && lastTotal > 0 && lastTotal <= balance
  const cur = pendingRef.current
  const shown = gamePhase === 'settled' && cur ? cur : lastRound

  // ---- 样式件（选中=金框，同 Line Up 惯例）----
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
    <GameTopBar gameName="WU XING" venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：20 球两行×10（照规则页截图布局）+ 龙虎/上下计数 + 总和大字 ----
  const ball = isMobile ? 26 : isDesk ? 26 : 30
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 5,
      boxSizing: 'border-box',
      opacity: drawing ? 0.55 : 1, transition: 'opacity 0.3s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>
          {drawing ? '开奖中…' : gamePhase === 'settled' ? '开奖 · 本局' : '开奖 · 上局'}
        </span>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>80 池 · 20 球</span>
      </div>
      {/* 两行 ×10 球：上盘 1-40 蓝 / 下盘 41-80 红 */}
      {[0, 1].map(r => (
        <div key={r} style={{ display: 'flex', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
          {shown.balls.slice(r * 10, r * 10 + 10).map(n => (
            <span key={n} data-ball={n} style={{
              width: ball, height: ball, borderRadius: '50%',
              background: n <= 40 ? DERBY.home : DERBY.away,
              border: '1px solid rgba(0,0,0,0.35)',
              boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: ball * 0.42, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box', flex: '0 0 auto',
            }}>{String(n).padStart(2, '0')}</span>
          ))}
        </div>
      ))}
      {/* 统计带：龙/虎（和值十位/末位）+ TOTAL 大字 + 上/下计数 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
      }}>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          龙 {shown.dragon} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 虎 {shown.tiger}
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
        }}>TOTAL {shown.sum}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          上 {shown.up} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 下 {20 - shown.up}
        </span>
      </div>
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Wu Xing</strong>
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
    <GameLayout title="Wu Xing" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
