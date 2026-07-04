import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOLDENBOOT } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Golden Boot — 10 球员冲刺排名彩（足球皮）。
// 引擎：1–10 全排列（Fisher-Yates），index = 名次；冠亚和 3–19；龙虎五对。
// 轮次：BETTING(24s) → RACING(3s 占位，单3 换冲刺动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// ---------- 引擎（纯函数区，禁副作用）----------
const DUEL_DEFS = [
  { key: 'd1', label: '1 v 10', d: 1, t: 10 },
  { key: 'd2', label: '2 v 9',  d: 2, t: 9 },
  { key: 'd3', label: '3 v 8',  d: 3, t: 8 },
  { key: 'd4', label: '4 v 7',  d: 4, t: 7 },
  { key: 'd5', label: '5 v 6',  d: 5, t: 6 },
]

// Fisher-Yates 全洗 1–10，返回按名次排的球员号（order[0] = 冠军）；rng 可注入
export function drawRace(rng = Math.random) {
  const order = Array.from({ length: 10 }, (_, i) => i + 1)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// 派生：冠军 / 亚军 / 冠亚和 / 名次映射 / 龙虎五对（低号名次靠前 = DRAGON）
export function deriveRace(order) {
  const winner = order[0]
  const runnerUp = order[1]
  const sprintSum = winner + runnerUp
  const rank = {}
  order.forEach((n, i) => { rank[n] = i + 1 })
  const duels = DUEL_DEFS.map(p => (rank[p.d] < rank[p.t] ? 'D' : 'T'))
  return { order, winner, runnerUp, sprintSum, rank, duels }
}

// 赔率配置表（推导注记；1e6 模拟实测见单3 报告，出带列只报不改）：
//   WINNER：P = 1/10 精确 → 9.60 × 0.1 = 96.0%
//   SUM 直选：90 个有序 (冠,亚) 对等概率；和值 s 的无序对数 n(s)：
//     3,4,18,19→1 · 5,6,16,17→2 · 7,8,14,15→3 · 9,10,12,13→4 · 11→5
//     P(s) = n(s)/45；赔率 = 0.955 × 45 / n(s)（构造性 RTP≈95.5%）
//   BIG 12–19：n 合计 20/45 → 2.15 × .4444 = 95.6%；SMALL 3–11：25/45 → 1.72 × .5556 = 95.6%
//   ODD 和为单（一奇一偶 50/90 = 25/45）→ 1.72 → 95.6%；EVEN 20/45 → 2.15 → 95.6%
//   DUELS：对称 P = 1/2 精确 → 1.95 → 97.5% 压线
const SUM_N = { 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4, 11: 5, 12: 4, 13: 4, 14: 3, 15: 3, 16: 2, 17: 2, 18: 1, 19: 1 }
const sumOdds = s => Math.round((0.955 * 45 / SUM_N[s]) * 100) / 100   // 42.98/21.49/14.33/10.74/8.60
export const ODDS = {
  winner: 9.6,
  sum: Object.fromEntries(Object.keys(SUM_N).map(s => [s, sumOdds(+s)])),
  big: 2.15, small: 1.72, odd: 1.72, even: 2.15,
  duel: 1.95,
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
  DUEL_DEFS.forEach((p, i) => {
    m[`${p.key}-d`] = { odds: ODDS.duel, hit: r => r.duels[i] === 'D' }
    m[`${p.key}-t`] = { odds: ODDS.duel, hit: r => r.duels[i] === 'T' }
  })
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__GB = { drawRace, deriveRace, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量（照 Half Time，心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const RACING_T = 6      // 3s 占位 — 单3 换冲刺动画
const SETTLED_T = 6     // 3s
const ROUND_DATE = '20260705'
const ROAD_CAP = 120

// 种子上期 + 种子历史（真开奖逐期顶掉）
const SEED_LAST = deriveRace([3, 7, 1, 9, 2, 10, 5, 8, 4, 6])
const SEED_WINNERS = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6, 2, 8, 1, 4, 10, 6, 3, 9, 7, 5, 1, 6, 4, 2, 9, 3, 10, 8, 5, 7]
const SEED_SUMS = [10, 9, 4, 13, 12, 16, 8, 14, 7, 11, 5, 15, 3, 9, 17, 10, 6, 12, 19, 8, 11, 7, 13, 5, 16, 9, 4, 18, 12, 10]
const SEED_DUEL = 'DTDDTTDTDTDDTTDTDDTTDDTTDDTTDT'.split('')
const SEED_HISTORY = SEED_WINNERS.map((w, i) => ({ winner: w, sum: SEED_SUMS[i], duel: SEED_DUEL[i] }))

const ROAD_TABS = ['WINNER', 'SUM', 'DUELS']
function beadFor(tab, h) {
  if (tab === 'WINNER') return { t: String(h.winner), c: h.winner <= 5 ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
  if (tab === 'SUM') return h.sum >= 12 ? { t: 'B', c: GOLDENBOOT.dragon } : { t: 'S', c: GOLDENBOOT.tiger }
  return { t: h.duel, c: h.duel === 'D' ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
}

// 金靴球衣珠 — 迷你球衣轮廓 + 号码（金渐变，共享 gold/fire/goldDeep）
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function JerseyBead({ num, size = 16, dim = false }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 100 90" style={{ display: 'block', opacity: dim ? 0.75 : 1 }} aria-hidden="true">
      <defs>
        <linearGradient id="gbJersey" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GOLDENBOOT.gold} />
          <stop offset="55%" stopColor={GOLDENBOOT.fire} />
          <stop offset="100%" stopColor={GOLDENBOOT.goldDeep} />
        </linearGradient>
      </defs>
      <path d={JERSEY_PATH} fill="url(#gbJersey)" stroke="rgba(0,0,0,0.35)" strokeWidth="2" strokeLinejoin="round" />
      {num != null && (
        <text x="50" y="64" textAnchor="middle" fontSize="38" fontWeight="900"
          fill="#3a2c00" fontFamily="'Space Grotesk', sans-serif">{num}</text>
      )}
    </svg>
  )
}

export default function GoldenBoot({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)   // 纯视觉态 — SFX 单3 一并接
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('WINNER')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  const [gamePhase, setGamePhase] = useState('betting')   // betting | racing | settled
  const [countdown, setCountdown] = useState(BETTING_T)   // tick(500ms)
  const [roundNo, setRoundNo] = useState(2)
  const [lastRace, setLastRace] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
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
    setLastRace(r)
    setHistory(h => [...h, { winner: r.winner, sum: r.sprintSum, duel: r.duels[0] }].slice(-ROAD_CAP))
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
      if (ph === 'betting') {
        // 名次此刻先定 — RACING 段（单3 动画）只读它，不再碰确定性随机数
        pendingRef.current = deriveRace(drawRace())
        phaseRef.current = 'racing'; setGamePhase('racing')
        cdRef.current = RACING_T; setCountdown(RACING_T)
      } else if (ph === 'racing') {
        settleRound()
        phaseRef.current = 'settled'; setGamePhase('settled')
        cdRef.current = SETTLED_T; setCountdown(SETTLED_T)
      } else {
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setFeedBets(makeFeedBots())
        setRoundNo(n => n + 1)
        phaseRef.current = 'betting'; setGamePhase('betting')
        cdRef.current = BETTING_T; setCountdown(BETTING_T)
      }
    }, TICK_MS)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSel = key => {
    if (phaseRef.current !== 'betting') return   // RACING/SETTLED 锁盘
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

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
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
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel
        ? GOLDENBOOT.selTint
        : `linear-gradient(180deg, ${GOLDENBOOT.ctrl}, ${GOLDENBOOT.band})`,
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
  const phaseChip = gamePhase === 'betting'
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: GOLDENBOOT.sel }
    : gamePhase === 'racing'
      ? { text: '冲刺中…', c: GOLDENBOOT.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: GOLDENBOOT.gold }
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '6px 10px', borderRadius: RADIUS.pill,
      background: GOLDENBOOT.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: GOLDENBOOT.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(roundNo).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
        color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>{phaseChip.text}</span>
      {/* 上期名次串 — 名次序（冠军最左），珠上是球员号 */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
        {lastRace.order.map((n, i) => (
          <span key={`${n}-${i}`} style={{ display: 'inline-flex', alignItems: 'center' }} title={`第${i + 1}名`}>
            <JerseyBead num={n} size={isMobile ? 15 : 18} dim={i > 2} />
          </span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 12px 2px 6px', borderRadius: RADIUS.pill,
        background: GOLDENBOOT.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>
        <JerseyBead num={lastRace.winner} size={20} />
        WINNER #{lastRace.winner}
      </span>
    </div>
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
          }}>{t}</button>
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

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${GOLDENBOOT.bgCenter}, ${GOLDENBOOT.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.gbCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: GOLDENBOOT.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>GOLDEN BOOT ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: GOLDENBOOT.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${GOLDENBOOT.gold}`, color: GOLDENBOOT.gold,
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

      {/* 轮次条 — desk 在骨架历史行，卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ---- middle zone: 盘区三族，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
      }}>
        <WinToast toasts={toasts} />
        {/* 族① WINNER 冠军直选 1–10 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>WINNER · 冠军直选</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`w-${n}`)}
                style={{ ...cellBtn(`w-${n}`), flexBasis: isMobile ? '17%' : 0 }}>
                <JerseyBead num={n} size={isMobile ? 20 : 26} />
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
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>SPRINT SUM · 冠亚和</div>
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
              { key: 's-big',   name: 'BIG',   range: '12–19', odds: ODDS.big },
              { key: 's-small', name: 'SMALL', range: '3–11',  odds: ODDS.small },
              { key: 's-odd',   name: 'ODD',   range: '和为单', odds: ODDS.odd },
              { key: 's-even',  name: 'EVEN',  range: '和为双', odds: ODDS.even },
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

        {/* 族③ DUELS 龙虎五对 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>DUELS · 龙虎对决</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {DUEL_DEFS.map(p => (
              <div key={p.key} style={{
                flex: 1, minWidth: isMobile ? '30%' : 0,
                display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
              }}>
                <span style={{ textAlign: 'center', color: GOLDENBOOT.dim, fontSize: 9.5, fontWeight: 800 }}>{p.label}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`${p.key}-d`)}
                    style={{ ...cellBtn(`${p.key}-d`, { compact: true }) }}>
                    <span style={{ ...cellName, color: GOLDENBOOT.dragon, fontSize: 9.5 }}>DRAGON</span>
                    <span style={cellRange}>#{p.d}</span>
                    <span style={{ ...cellOdds, fontSize: 10.5 }}>{ODDS.duel.toFixed(2)}</span>
                    {stakeChip(`${p.key}-d`)}
                  </button>
                  <button type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`${p.key}-t`)}
                    style={{ ...cellBtn(`${p.key}-t`, { compact: true }) }}>
                    <span style={{ ...cellName, color: GOLDENBOOT.tiger, fontSize: 9.5 }}>TIGER</span>
                    <span style={cellRange}>#{p.t}</span>
                    <span style={{ ...cellOdds, fontSize: 10.5 }}>{ODDS.duel.toFixed(2)}</span>
                    {stakeChip(`${p.key}-t`)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: GOLDENBOOT.band,
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
            background: bet === v ? GOLDENBOOT.selTint : GOLDENBOOT.band,
            border: `1px solid ${bet === v ? GOLDENBOOT.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
          }}>{v}</button>
        ))}
        <button type="button" disabled={!confirmOk} onClick={confirmBets} style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: GOLDENBOOT.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: confirmOk ? 'pointer' : 'not-allowed',
          opacity: confirmOk ? 1 : 0.55,
        }}>
          {betting
            ? `▷ CONFIRM${picks.size > 0 ? ` $${confirmTotal.toFixed(0)}` : ''}`
            : gamePhase === 'racing' ? '冲刺中…' : '本期已结算'}
        </button>
      </div>
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
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Golden Boot</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 轮次条占骨架历史行位（34px 行惯例） */}
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
    <GameLayout title="Golden Boot" color={GOLDENBOOT.gold}>
      {gameCard}
    </GameLayout>
  )
}
