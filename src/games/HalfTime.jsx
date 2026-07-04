import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HALFTIME } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Half Time — 快乐8和值盘（足球皮）。
// 引擎：1–80 无重复抽 20 球（保留开出顺序），和值 210–1410。
// 轮次：BETTING(24s) → DRAWING(3s 占位，单3 换开奖动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// ---------- 引擎（纯函数区，禁副作用）----------
// Fisher-Yates 洗满池取前 20，保留开出顺序；rng 可注入（对账/模拟用）
export function drawRound(rng = Math.random) {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 20)
}

// 派生：总和 + 半场计数。半场盘语义 = 20 球中落在 1–40 区间的个数：
// >10 → 1ST HALF，<10 → 2ND HALF，=10 → DRAW。
// （旧版「前10和 vs 后10和」派生已废弃删除 — 开出顺序仅保留在 balls 展示）
export function deriveRound(balls) {
  const sum = balls.reduce((a, b) => a + b, 0)
  const lowCount = balls.filter(n => n <= 40).length
  return { balls, sum, lowCount }
}

export const halfOf = r => (r.lowCount > 10 ? 'F' : r.lowCount < 10 ? 'S' : 'D')

// 赔率配置表（1e6 期模拟标定，目标带 94–97.5%，实测见修正单 RTP 报告）。
// 推导注记：和值分布对称于 810（x↔81−x 双射），σ≈51.4；
//   over  1.95 × P≈.4979 → 97.1%（≥811）
//   under 1.90 × P≈.5021 → 95.4%（810 中点质量归 under，故比 over 低一档）
//   odd/even 1.95 × P=.500 精确 → 97.5% 压线
//   parlay 3.80 × P≈.25（大小×奇偶近独立）→ ≈95%
//   zone：og/gl 9.25 × P≈.103 → ≈95/96；df/at 4.70 × P≈.202 → ≈95；
//         mf 2.46 × P≈.388 → ≈95.5
//   half：X = 20 球中 1–40 区个数 ~ 超几何(N=80,K=40,n=20)，
//         精确 P(X=10)=0.20324（众数）、P(X>10)=P(X<10)=0.39838；
//         h1/h2 2.40 × .3984 → 95.6%，draw 4.70 × .2032 → 95.5%
export const ODDS = {
  over: 1.95, under: 1.90,
  odd: 1.95, even: 1.95,
  'p-oo': 3.8, 'p-oe': 3.8, 'p-uo': 3.8, 'p-ue': 3.8,
  og: 9.25, df: 4.7, mf: 2.46, at: 4.7, gl: 9.25,
  h1: 2.4, draw: 4.7, h2: 2.4,
}

// 盘区判定表 — 数据驱动，settle/珠盘路/RTP 模拟共用这一份
export const MARKETS = {
  over:  { odds: ODDS.over,   hit: r => r.sum >= 811 },
  under: { odds: ODDS.under,  hit: r => r.sum <= 810 },
  odd:   { odds: ODDS.odd,    hit: r => r.sum % 2 === 1 },
  even:  { odds: ODDS.even,   hit: r => r.sum % 2 === 0 },
  'p-oo': { odds: ODDS['p-oo'], hit: r => r.sum >= 811 && r.sum % 2 === 1 },
  'p-oe': { odds: ODDS['p-oe'], hit: r => r.sum >= 811 && r.sum % 2 === 0 },
  'p-uo': { odds: ODDS['p-uo'], hit: r => r.sum <= 810 && r.sum % 2 === 1 },
  'p-ue': { odds: ODDS['p-ue'], hit: r => r.sum <= 810 && r.sum % 2 === 0 },
  og: { odds: ODDS.og, hit: r => r.sum <= 695 },
  df: { odds: ODDS.df, hit: r => r.sum >= 696 && r.sum <= 763 },
  mf: { odds: ODDS.mf, hit: r => r.sum >= 764 && r.sum <= 855 },
  at: { odds: ODDS.at, hit: r => r.sum >= 856 && r.sum <= 923 },
  gl: { odds: ODDS.gl, hit: r => r.sum >= 924 },
  h1:   { odds: ODDS.h1,   hit: r => r.lowCount > 10 },    // 1–40 区多
  draw: { odds: ODDS.draw, hit: r => r.lowCount === 10 },  // 恰 10 / 10
  h2:   { odds: ODDS.h2,   hit: r => r.lowCount < 10 },    // 41–80 区多
}
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器里直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__HT = { drawRound, deriveRound, halfOf, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量 ----------
const BETTING_S = 24
const DRAWING_S = 3    // 单3 换开奖动画时长
const SETTLED_S = 3
const ROUND_DATE = '20260705'
const ROAD_CAP = 120   // 珠盘路 6×20 滚动容量

// 种子上期 + 种子历史（真开奖会逐期顶掉）
const SEED_LAST = deriveRound([3, 7, 12, 18, 22, 25, 31, 36, 40, 44, 47, 52, 55, 59, 63, 66, 70, 74, 77, 80])
const SEED_SUMS = [
  881, 742, 655, 930, 803, 812, 776, 948, 701, 860,
  795, 688, 917, 834, 758, 902, 641, 823, 787, 955,
  810, 869, 733, 891, 762, 926, 705, 848, 779, 812,
]
const SEED_HALF = 'FSFDSFFSDSFSFFSDFSSFDFSFSFDSSF'.split('')
const SEED_HISTORY = SEED_SUMS.map((sum, i) => ({ sum, half: SEED_HALF[i] }))

const zoneOf = s => (s <= 695 ? 'OG' : s <= 763 ? 'DF' : s <= 855 ? 'MF' : s <= 923 ? 'AT' : 'GL')
const ZONE_COLOR = { OG: HALFTIME.over, DF: HALFTIME.draw, MF: HALFTIME.sel, AT: HALFTIME.draw, GL: HALFTIME.over }

// ---- 盘面（名称/区间展示；赔率一律读 ODDS）----
const ROW1 = [
  { key: 'over',  name: 'OVER',  range: '811–1410' },
  { key: 'under', name: 'UNDER', range: '210–810' },
  { key: 'odd',   name: 'ODD',   range: '和值为单' },
  { key: 'even',  name: 'EVEN',  range: '和值为双' },
]
const PARLAY = [
  { key: 'p-oo', name: 'O + ODD' },
  { key: 'p-oe', name: 'O + EVEN' },
  { key: 'p-uo', name: 'U + ODD' },
  { key: 'p-ue', name: 'U + EVEN' },
]
const ZONES = [
  { key: 'og', name: 'OWN GOAL', range: '210–695' },
  { key: 'df', name: 'DEFENSE',  range: '696–763' },
  { key: 'mf', name: 'MIDFIELD', range: '764–855' },
  { key: 'at', name: 'ATTACK',   range: '856–923' },
  { key: 'gl', name: 'GOAL',     range: '924–1410' },
]
const ROW3 = [
  { key: 'h1',   name: '1ST HALF', range: 'MORE 1–40' },
  { key: 'draw', name: 'DRAW',     range: '10 / 10' },
  { key: 'h2',   name: '2ND HALF', range: 'MORE 41–80' },
]

const ROAD_TABS = ['O/U', 'ODD/EVEN', 'PARLAY', 'ZONE', 'HALF']
function beadFor(tab, sum, half) {
  const over = sum > 810
  const odd = sum % 2 === 1
  if (tab === 'O/U') return { t: over ? 'O' : 'U', c: over ? HALFTIME.over : HALFTIME.under }
  if (tab === 'ODD/EVEN') return { t: odd ? 'O' : 'E', c: odd ? HALFTIME.over : HALFTIME.under }
  if (tab === 'PARLAY') return { t: (over ? 'O' : 'U') + (odd ? 'O' : 'E'), c: over === odd ? HALFTIME.sel : HALFTIME.draw }
  if (tab === 'ZONE') { const z = zoneOf(sum); return { t: z, c: ZONE_COLOR[z] } }
  return { t: half, c: half === 'F' ? HALFTIME.over : half === 'S' ? HALFTIME.under : HALFTIME.draw }
}

export default function HalfTime({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)   // 纯视觉态 — 本游戏暂无 SFX（单3 一并接）
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())        // 待确认选格
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())   // key → 已下注额
  const [roadTab, setRoadTab] = useState('O/U')
  const [feedBets] = useState(() => makeFeedBots())   // 展示用假注单

  // ---- 轮次状态机 ----
  const [gamePhase, setGamePhase] = useState('betting')   // betting | drawing | settled
  const [countdown, setCountdown] = useState(BETTING_S)
  const [roundNo, setRoundNo] = useState(89)
  const [lastDraw, setLastDraw] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_S)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  function pushToast(win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label: '本期命中', win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账
  function settleRound() {
    const r = pendingRef.current
    const hits = hitsOf(r)
    let winTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
    })
    if (winTotal > 0) {
      setBalance(b => round2(b + winTotal))
      pushToast(winTotal)
    }
    setLastDraw(r)
    setHistory(h => [...h, { sum: r.sum, half: halfOf(r) }].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
  }

  // 单 interval 驱动整台状态机；StrictMode 双挂载由 cleanup 兜底
  // （首次挂载的 interval 先被清掉，引擎永远只有一个心跳在跑）
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      if (ph === 'betting') {
        // 开奖结果此刻先定 — DRAWING 段（单3 动画）只读它，不再碰随机数
        pendingRef.current = deriveRound(drawRound())
        phaseRef.current = 'drawing'; setGamePhase('drawing')
        cdRef.current = DRAWING_S; setCountdown(DRAWING_S)
      } else if (ph === 'drawing') {
        settleRound()
        phaseRef.current = 'settled'; setGamePhase('settled')
        cdRef.current = SETTLED_S; setCountdown(SETTLED_S)
      } else {
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setRoundNo(n => n + 1)
        phaseRef.current = 'betting'; setGamePhase('betting')
        cdRef.current = BETTING_S; setCountdown(BETTING_S)
      }
    }, 1000)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSel = key => {
    if (phaseRef.current !== 'betting') return   // DRAWING/SETTLED 锁盘
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点：注额 × 选格数，一次性扣款后入 betsRef，清空待选
  function confirmBets() {
    if (phaseRef.current !== 'betting') return
    const keys = [...picksRef.current]
    const amount = betRef.current
    const total = round2(amount * keys.length)
    if (!keys.length || amount < 1 || total > balanceRef.current) return
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
    keys.forEach(k => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + amount)))
    setBetsPlaced(new Map(betsRef.current))
    picksRef.current = new Set()
    setPicks(new Set())
  }

  const betting = gamePhase === 'betting'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance

  // ---- 样式件 ----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = result?.hits?.has(key)
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '7px 2px' : '9px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel
        ? HALFTIME.selTint
        : `linear-gradient(180deg, ${HALFTIME.cellTop}, ${HALFTIME.cellBot})`,
      border: `1px solid ${hit ? HALFTIME.gold : sel || placed ? HALFTIME.sel : HALFTIME.cellBorder}`,
      boxShadow: hit
        ? `0 0 12px ${HALFTIME.gold}`
        : sel ? `0 0 10px ${HALFTIME.selTint}` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      position: 'relative',
    }
  }
  const cellName = { color: HALFTIME.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HALFTIME.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HALFTIME.odds, fontSize: isMobile ? 11 : 13, fontWeight: 900 }

  const betCell = (m, opts) => (
    <button key={m.key} type="button" className="htCell" disabled={!betting}
      onClick={() => toggleSel(m.key)} style={cellBtn(m.key, opts)}>
      <span style={cellName}>{m.name}</span>
      {m.range && <span style={cellRange}>{m.range}</span>}
      <span style={cellOdds}>{MARKETS[m.key].odds.toFixed(2)}</span>
      {betsPlaced.has(m.key) && (
        <span style={{
          position: 'absolute', top: 3, right: 4,
          padding: '1px 6px', borderRadius: RADIUS.pill,
          background: HALFTIME.sel, color: '#083a1b',
          fontSize: 8.5, fontWeight: 900,
        }}>${betsPlaced.get(m.key)}</span>
      )}
    </button>
  )

  // ---- 轮次条 ----
  const phaseChip = gamePhase === 'betting'
    ? { text: `⏱ 00:${String(countdown).padStart(2, '0')}`, c: HALFTIME.sel }
    : gamePhase === 'drawing'
      ? { text: '开奖中…', c: HALFTIME.draw }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: HALFTIME.gold }
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '6px 10px', borderRadius: RADIUS.pill,
      background: HALFTIME.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: HALFTIME.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(roundNo).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
        color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{phaseChip.text}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
        {lastDraw.balls.map((n, i) => (
          <span key={`${n}-${i}`} style={{
            width: isMobile ? 15 : 17, height: isMobile ? 15 : 17, borderRadius: '50%',
            background: n > 40 ? HALFTIME.under : HALFTIME.over, color: COLORS.white,
            fontSize: isMobile ? 7.5 : 8.5, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HALFTIME.sel, color: '#083a1b', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>和值 {lastDraw.sum}</span>
    </div>
  )

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  const ROAD_COLS = 20
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(h => beadFor(roadTab, h.sum, h.half))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? HALFTIME.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : HALFTIME.dim,
            border: `1px solid ${roadTab === t ? HALFTIME.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 6.5 : 9, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${HALFTIME.bgCenter}, ${HALFTIME.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.htCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: HALFTIME.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>HALF TIME ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: HALFTIME.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${HALFTIME.gold}`, color: HALFTIME.gold,
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

      {roundBar}

      {/* ---- middle zone: 盘区三行，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
      }}>
        <WinToast toasts={toasts} />
        {/* 行① Over/Under + Odd/Even + Parlay */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {ROW1.map(m => betCell(m))}
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {PARLAY.map(m => betCell(m, { compact: true }))}
          </div>
        </div>

        {/* 行② 球场五段 — 中场线贯穿，五格贴片 */}
        <div style={{
          position: 'relative', borderRadius: 12, padding: isMobile ? 6 : 8,
          background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: 6, bottom: 6, width: 1,
            background: 'rgba(255,255,255,0.18)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: isMobile ? 34 : 46, height: isMobile ? 34 : 46,
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', gap: isMobile ? 4 : 8, position: 'relative' }}>
            {ZONES.map(m => betCell(m))}
          </div>
        </div>

        {/* 行③ 1st Half / Draw / 2nd Half — 与上两行同左右边界，三等分撑满 */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, width: '100%' }}>
          {ROW3.map(m => betCell(m))}
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: HALFTIME.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          padding: '5px 18px', borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
          textAlign: 'center', lineHeight: 1.2,
          opacity: betting ? 1 : 0.6,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
          <input
            value={bet}
            disabled={!betting}
            onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
              color: COLORS.white, fontSize: 15, fontWeight: 900,
            }}
          />
        </div>
        {[10, 50, 100, 500].map(v => (
          <button key={v} type="button" disabled={!betting} onClick={() => setBet(v)} style={{
            minWidth: 38, padding: '0 10px', height: 30, borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
            background: bet === v ? HALFTIME.selTint : HALFTIME.band,
            border: `1px solid ${bet === v ? HALFTIME.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
          }}>{v}</button>
        ))}
        <button type="button" disabled={!confirmOk} onClick={confirmBets} style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: HALFTIME.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: confirmOk ? 'pointer' : 'not-allowed',
          opacity: confirmOk ? 1 : 0.55,
        }}>
          {betting
            ? `▷ CONFIRM${picks.size > 0 ? ` $${confirmTotal.toFixed(0)}` : ''}`
            : gamePhase === 'drawing' ? '开奖中…' : '本期已结算'}
        </button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Dribble ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Half Time</strong>
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
    <GameLayout title="Half Time" color={HALFTIME.sel}>
      {gameCard}
    </GameLayout>
  )
}
