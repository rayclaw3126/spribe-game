import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import GameTopBar from '../components/shell/GameTopBar'

// Domino Duel — 骨牌版主客对决（闲庄→主蓝客红），第 21 卡。
// X2：真引擎 + 真赔率 + 真算钱（抄 Derby Day 结构）。翻牌动画留 X3。
// 规则：标准 28 张多米诺(0-0..6-6) 无放回抽 4 → 主 2 张 / 客 2 张；
//   得分 = 该队 4 端点和 mod 10（0-9）。主要盘比大小，平局时主胜/客胜盘 push 退本金。
//   全场进球 = 主分+客分合计(0-18，非 mod)。主/客总分各 0-9。波胆仅 9 个热门比分开盘。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（含 push 退注：
//   主胜/客胜盘平局退回本金，不算赢不算输，WinToast 用「平局退注」区分文案）。

const round2 = x => Math.round(x * 100) / 100

// ---------- 引擎（纯函数区，禁副作用）----------
// 标准 28 张多米诺（0-0 到 6-6）
const DOMINOES = (() => { const t = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]); return t })()

// 无放回抽 4：前 2 张主队、后 2 张客队；rng 可注入
export function rollTiles(rng = Math.random) {
  const p = DOMINOES.slice()
  for (let k = 0; k < 4; k++) { const j = k + Math.floor(rng() * (p.length - k));[p[k], p[j]] = [p[j], p[k]] }
  return [p[0], p[1], p[2], p[3]]
}
// 结算派生：主客各 2 张 → 得分(和 mod10) + 合计进球
export function deriveRound(tiles) {
  const s = t => t[0] + t[1]
  const hs = (s(tiles[0]) + s(tiles[1])) % 10
  const as = (s(tiles[2]) + s(tiles[3])) % 10
  return { tiles, homeTiles: [tiles[0], tiles[1]], awayTiles: [tiles[2], tiles[3]], hs, as, gTotal: hs + as }
}

// ---------- 赔率（1e6 模拟 + 122850 等概枚举双验，anchor 0.955，全键 94-97.5%）----------
// 普通盘 odds = round2(0.955 / P)；push 盘（主胜/客胜）odds = round2((0.955 − P_push) / P_win)。
//   P 来源（精确枚举 C(28,2)×C(26,2)=122850 等概分派）：
//   主胜/客胜 P_win=0.44908 P_push(平)=0.10185 → (0.955-0.10185)/0.44908 = 1.90（EV 95.51%）
//   平局 P=0.10185 → 9.38；全场大 P=0.54737→1.74 / 小 0.45263→2.11 / 单 0.50012→1.91 / 双 0.49988→1.91
//   主客总分 大 0.49735→1.92 / 小 0.50265→1.90 / 单 0.50794→1.88 / 双 0.49206→1.94
//   波胆 P：1-0/0-1=0.01009→94.69, 2-1/1-2=0.01035→92.23, 3-1/1-3=0.01057→90.32,
//          0-0=0.00975→97.93, 1-1=0.01084→88.08, 2-2=0.01031→92.67
export const ODDS = {
  main: 1.90, draw: 9.38,
  gBig: 1.74, gSmall: 2.11, gOdd: 1.91, gEven: 1.91,
  tBig: 1.92, tSmall: 1.90, tOdd: 1.88, tEven: 1.94,
}
const CS_ODDS = { '1-0': 94.69, '2-1': 92.23, '3-1': 90.32, '0-0': 97.93, '1-1': 88.08, '2-2': 92.67, '0-1': 94.69, '1-2': 92.23, '1-3': 90.32 }

// 盘区判定表 — 数据驱动（hit = 赢；push = 退注，仅主胜/客胜盘平局）
export const MARKETS = {
  'home-win': { odds: ODDS.main, hit: r => r.hs > r.as, push: r => r.hs === r.as },
  'away-win': { odds: ODDS.main, hit: r => r.as > r.hs, push: r => r.hs === r.as },
  'draw':     { odds: ODDS.draw, hit: r => r.hs === r.as },
  'g-big':    { odds: ODDS.gBig,   hit: r => r.gTotal >= 9 },
  'g-small':  { odds: ODDS.gSmall, hit: r => r.gTotal <= 8 },
  'g-odd':    { odds: ODDS.gOdd,   hit: r => r.gTotal % 2 === 1 },
  'g-even':   { odds: ODDS.gEven,  hit: r => r.gTotal % 2 === 0 },
  'h-big':    { odds: ODDS.tBig,   hit: r => r.hs >= 5 },
  'h-small':  { odds: ODDS.tSmall, hit: r => r.hs <= 4 },
  'h-odd':    { odds: ODDS.tOdd,   hit: r => r.hs % 2 === 1 },
  'h-even':   { odds: ODDS.tEven,  hit: r => r.hs % 2 === 0 },
  'a-big':    { odds: ODDS.tBig,   hit: r => r.as >= 5 },
  'a-small':  { odds: ODDS.tSmall, hit: r => r.as <= 4 },
  'a-odd':    { odds: ODDS.tOdd,   hit: r => r.as % 2 === 1 },
  'a-even':   { odds: ODDS.tEven,  hit: r => r.as % 2 === 0 },
}
// 波胆 9 键：cs-H-A hit if hs===H && as===A
Object.entries(CS_ODDS).forEach(([sc, o]) => {
  const [H, A] = sc.split('-').map(Number)
  MARKETS[`cs-${sc}`] = { odds: o, hit: r => r.hs === H && r.as === A }
})
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))
export const pushesOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].push?.(r)))

// dev 钩子：RTP 模拟/对账从浏览器直接调（__DD 已被 Derby Day 占用 → 本卡用 __DOM）；
// __DOM_FORCE 注入固定 4 张骨牌（一次性消费）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__DOM = { rollTiles, deriveRound, hitsOf, pushesOf, MARKETS, ODDS, DOMINOES }
}

// ---------- 轮次常量（心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 24   // 12s 押注
const DRAW_T = 4       // 2s 开牌（静态占位，翻牌动画走 X3）
const SETTLED_T = 8    // 4s 结算展示
const ROAD_CAP = 120

const VENUE = 'ONYX ARENA'
const ROUND_DATE = 'OA20260706'
const SEED_LAST = deriveRound([[3, 2], [1, 1], [2, 1], [0, 1]])   // 上局回顾种子（真开奖逐期顶掉）
const SEED_ROAD = [
  '主', '客', '主', '平', '客', '主', '客', '主', '主', '客',
  '平', '主', '客', '主', '客', '主', '主', '客', '平', '主',
  '客', '主', '客', '主', '主', '客', '主', '平', '客', '主',
  '主', '客', '主', '客', '主', '平', '客', '主', '主', '客',
]

// 多米诺点位（0-6，3×3 宫格索引；照 DieFace 先例）
const DOMPIPS = {
  0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

// 盘面玩法元数据（名/区间/底色；赔率运行时从 MARKETS 取）
const MAIN = [
  { slot: 'home-win', name: '主队胜', bg: DERBY.home },
  { slot: 'draw', name: '平局', bg: DERBY.grey },
  { slot: 'away-win', name: '客队胜', bg: DERBY.away },
]
const totalRow = side => [
  { slot: `${side}-big`, name: '大', range: '5-9' },
  { slot: `${side}-small`, name: '小', range: '0-4' },
  { slot: `${side}-odd`, name: '单', range: '' },
  { slot: `${side}-even`, name: '双', range: '' },
]
const GOALS = [
  { slot: 'g-big', name: '大', range: '9-18' },
  { slot: 'g-small', name: '小', range: '0-8' },
  { slot: 'g-odd', name: '单', range: '' },
  { slot: 'g-even', name: '双', range: '' },
]
// 正确比分 · 波胆 3列×3行（列=主胜/平/客胜，行序填充）
const CORRECT = [
  { slot: 'cs-1-0', score: '1:0' }, { slot: 'cs-0-0', score: '0:0' }, { slot: 'cs-0-1', score: '0:1' },
  { slot: 'cs-2-1', score: '2:1' }, { slot: 'cs-1-1', score: '1:1' }, { slot: 'cs-1-2', score: '1:2' },
  { slot: 'cs-3-1', score: '3:1' }, { slot: 'cs-2-2', score: '2:2' }, { slot: 'cs-1-3', score: '1:3' },
]

// 单张多米诺（竖向：上半 / 分隔线 / 下半，各半画 pip 点）
function DominoTile({ a, b, size = 34 }) {
  const half = (v, key) => (
    <div key={key} style={{
      width: size, height: size, position: 'relative',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, boxSizing: 'border-box',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {DOMPIPS[v].includes(i) && (
            <span style={{ width: size * 0.16, height: size * 0.16, borderRadius: '50%', background: '#10131a' }} />
          )}
        </span>
      ))}
    </div>
  )
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#f4f6fb', borderRadius: size * 0.16,
      border: '1px solid rgba(0,0,0,0.35)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      overflow: 'hidden',
    }}>
      {half(a, 'a')}
      <div style={{ height: 2, background: 'rgba(0,0,0,0.35)' }} />
      {half(b, 'b')}
    </div>
  )
}

export default function DominoDuel({ balance, setBalance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())
  const [gamePhase, setGamePhase] = useState('betting')   // betting | drawing | settled
  const [countdown, setCountdown] = useState(BETTING_T)
  const [roundNo, setRoundNo] = useState(42)
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)
  const [result, setResult] = useState(null)              // { hits:Set, pushes:Set, winTotal, refundTotal }
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)

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
    setLastRound(r)
    const outcome = r.hs > r.as ? '主' : r.as > r.hs ? '客' : '平'
    setRoad(rd => [...rd, outcome].slice(-ROAD_CAP))
    setResult({ hits, pushes, winTotal, refundTotal })
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
      const go = (next, ticks) => { phaseRef.current = next; setGamePhase(next); cdRef.current = ticks; setCountdown(ticks) }
      if (ph === 'betting') {
        let forced = null
        if (import.meta.env.DEV && window.__DOM_FORCE) { forced = window.__DOM_FORCE; window.__DOM_FORCE = null }
        pendingRef.current = deriveRound(forced || rollTiles())
        if (import.meta.env.DEV) window.__DOM_ANIM_LAST = pendingRef.current.tiles.map(t => t.join('|')).join(',')
        go('drawing', DRAW_T)
      } else if (ph === 'drawing') {
        settleRound()
        go('settled', SETTLED_T)
      } else {
        if (betsRef.current.size) { lastBetsRef.current = new Map(betsRef.current); setHasLast(true) }
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

  // 唯一扣注点：确认/重复共用（一次性扣款后入 betsRef，照 Derby Day）
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
    const priced = [...picksRef.current].filter(k => MARKETS[k])
    if (placeBets(new Map(priced.map(k => [k, amount])))) {
      picksRef.current = new Set()
      setPicks(new Set())
    }
  }
  function repeatBets() { placeBets(new Map(lastBetsRef.current)) }

  const betting = gamePhase === 'betting'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && lastTotal <= balance
  const oddsStr = slot => MARKETS[slot].odds.toFixed(2)
  // 对决区当前展示局：betting 显上局回顾；drawing/settled 显本局开牌
  const shown = gamePhase !== 'betting' && pendingRef.current ? pendingRef.current : lastRound

  // ---- 样式件（选中=金框；命中=绿框；push 退注=橙框）----
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 4 : 5,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
  }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = result?.hits?.has(key)
    const push = result?.pushes?.has(key)
    const staked = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed', background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : push ? DERBY.orange : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit ? '0 0 12px rgba(53,208,127,0.6)' : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || push || staked ? 1 : 0.7,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3, padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b', fontSize: 8, fontWeight: 900, zIndex: 2,
    }}>${betsPlaced.get(key)}</span>
  )
  const rowCell = (slot, name, range, bg = DERBY.grey) => (
    <button key={slot} type="button" className="ddCell" data-key={slot} disabled={!betting} onClick={() => toggleSel(slot)}
      style={{
        ...cellBase(slot, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '6px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{oddsStr(slot)}</span>
      {stakeChip(slot)}
    </button>
  )
  // 紧凑竖排（名 / 范围小字 / 赔率，各行 nowrap；总分 + 全场进球用，防挤爆）
  const colCell = (slot, name, range, bg = DERBY.grey) => (
    <button key={slot} type="button" className="ddCell" data-key={slot} disabled={!betting} onClick={() => toggleSel(slot)}
      style={{ ...cellBase(slot, bg), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={cellRange}>{range}</span> : null}
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{oddsStr(slot)}</span>
      {stakeChip(slot)}
    </button>
  )
  const scoreCell = m => (
    <button key={m.slot} type="button" className="ddCell" data-key={m.slot} disabled={!betting} onClick={() => toggleSel(m.slot)}
      style={{ ...cellBase(m.slot, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={{ ...cellName, fontFamily: "'Space Grotesk', sans-serif" }}>{m.score}</span>
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{oddsStr(m.slot)}</span>
      {stakeChip(m.slot)}
    </button>
  )

  // ---- 顶栏 ----
  const secs = String(Math.ceil(countdown / 2)).padStart(2, '0')
  const phaseInfo = betting
    ? { text: '⏱ 押注 00:', c: DERBY.sel, cd: true }
    : gamePhase === 'drawing'
      ? { text: '开牌中…', c: DERBY.orange }
      : { text: result && result.winTotal > 0 ? `已开 +$${result.winTotal.toFixed(2)}` : '已开牌', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseInfo.c}`,
      color: phaseInfo.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseInfo.text}{phaseInfo.cd && <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{secs}</span>}</span>
  )
  const topBar = (
    <GameTopBar gameName="DOMINO DUEL" venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 对决区：主(蓝) VS 客(红)，各两张骨牌 + 比分 ----
  const tileSz = isMobile ? 28 : 32
  const teamBlock = (name, tiles, score, color) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
      <span style={{
        padding: '2px 12px', borderRadius: RADIUS.pill, background: color,
        color: COLORS.white, fontSize: isMobile ? 11 : 12, fontWeight: 900, letterSpacing: 0.5,
      }}>{name}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {tiles.map((t, i) => <DominoTile key={i} a={t[0]} b={t[1]} size={tileSz} />)}
      </div>
      <span style={{
        color: COLORS.white, fontSize: isMobile ? 22 : 26, fontWeight: 900,
        fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 10px ${color}`,
      }}>{score}</span>
    </div>
  )
  const outcomeTag = gamePhase !== 'betting' && shown
    ? (shown.hs > shown.as ? { t: '主队胜', c: DERBY.home } : shown.as > shown.hs ? { t: '客队胜', c: DERBY.away } : { t: '平局', c: DERBY.gold })
    : null
  const duelZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '10px 8px' : '10px 18px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 14 : 30, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {teamBlock('主队', shown.homeTiles, shown.hs, DERBY.home)}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.gold, fontSize: isMobile ? 16 : 20, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif" }}>VS</span>
        {outcomeTag && (
          <span style={{
            padding: '1px 8px', borderRadius: RADIUS.pill, background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${outcomeTag.c}`, color: outcomeTag.c, fontSize: 9, fontWeight: 900, whiteSpace: 'nowrap',
          }}>{outcomeTag.t}</span>
        )}
      </div>
      {teamBlock('客队', shown.awayTiles, shown.as, DERBY.away)}
    </div>
  )

  // ---- ② 盘区 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主要盘 · 主胜 / 平 / 客胜</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {MAIN.map(m => rowCell(m.slot, m.name, '', m.bg))}
      </div>
    </div>
  )
  const totalBoard = (side, label) => (
    <div style={secBox}>
      <div style={secHead}>{label} · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {totalRow(side).map(m => colCell(m.slot, m.name, m.range))}
      </div>
    </div>
  )
  const goalsBoard = (
    <div style={secBox}>
      <div style={secHead}>全场总进球 · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {GOALS.map(m => colCell(m.slot, m.name, m.range))}
      </div>
    </div>
  )
  const correctBoard = (
    <div style={secBox}>
      <div style={secHead}>正确比分 · 波胆</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 5 : 8 }}>
        {CORRECT.map(scoreCell)}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（主/平/客，按真开奖逐期顶入）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const beads = road.slice(-ROAD_CAP)
  const beadRoad = (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, margin: isMobile ? '0 12px 8px' : '0 18px 8px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill, background: DERBY.sel, color: '#083a1b',
          border: `1px solid ${DERBY.sel}`, fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>主客走势</span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: 10, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6 }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = beads[i]
            const c = t === '主' ? DERBY.home : t === '客' ? DERBY.away : DERBY.grey
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: t ? c : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
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
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.ddCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>
      {topBar}
      {duelZone}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box', gap: 5, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {mainBoard}
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 5, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('h', '主队总分')}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('a', '客队总分')}</div>
        </div>
        {goalsBoard}
        {correctBoard}
      </div>
      <div style={{ flex: '1 0 auto' }} />
      {beadRoad}

      {/* ---- 底部下注栏 grid 4×2 ---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: DERBY.band,
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
            <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6, boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>USD</span>
            <input value={bet} disabled={!betting} onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: COLORS.white, fontSize: 14, fontWeight: 900 }} />
          </div>
          <button type="button" disabled={!repeatOk} onClick={repeatBets} style={{
            gridColumn: 3, gridRow: 2, width: '100%', height: '100%', borderRadius: 8,
            fontSize: 11, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: repeatOk ? COLORS.white : DERBY.dim, background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : gamePhase === 'drawing' ? '开牌中…' : '本局已结'}
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

  // ---- Spribe-parity desktop skeleton (≥1024) ----
  if (isDesk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640, background: COLORS.bg }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Domino Duel</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ flex: 1, minHeight: 0 }}>{gameCard}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <GameLayout title="Domino Duel" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
