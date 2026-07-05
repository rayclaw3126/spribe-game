import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY, ROULETTE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import GameTopBar from '../components/shell/GameTopBar'

// Speed Grid — DD24 结构 F1 皮（1-24 均匀抽 1 开冠军车号），第 18 卡。
// X2：结算引擎 + 轮次状态机 + 赔率定稿（DD24 官方规则页截图转录，无待核）。
// 开奖舞台动画走后续单（本单静态直出）。
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
const DRAW_T = 6        // 3s 静态占位（开奖舞台动画后续单换）
const SETTLED_T = 8     // 4s
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

export default function SpeedGrid({ balance, setBalance, onBack }) {
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
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
      opacity: drawing ? 0.55 : 1, transition: 'opacity 0.3s',
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
