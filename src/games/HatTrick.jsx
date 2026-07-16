import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HATTRICK } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import HistoryDrawer from '../components/HistoryDrawer'
import CommitRevealFairness from '../components/CommitRevealFairness'
import BetButton from '../components/shell/BetButton'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useRoundRoom } from '../hooks/useRoundRoom'
import HatTrickStage from './stages/HatTrickStage'
import HatTrickMarkets, { DieFace } from './markets-ui/HatTrickMarkets'   // #41 单15：盘口区切件（DieFace 随件，舞台/mobile 回用）
import HatTrickRoad from './markets-ui/HatTrickRoad'                       // #41 单15：珠盘路墙
import HatTrickPodium from './markets-ui/HatTrickPodium'                   // #41 单15：上局信息条（subRow 槽）
import { RULES } from './markets-ui/hattrickRules'                         // #41 单15：玩法说明内容（共享）
import { SIDES, ROAD_TABS, ROAD_TAB_LABELS, beadFor } from './markets-ui/hattrickShared'   // #41 单15：SIDES/珠盘页签/beadFor（mobile 段回用）

// Hat Trick — 快3三骰彩（三骰和值 + 豹子 + 对子），第 15 卡。
// 引擎：三骰各 1–6 独立均匀；和值/豹子/对子/大小单双全部由骰面派生。
// 轮次：BETTING(24s) → ROLLING(3s 占位，单3 换三骰动画) → SETTLED(3s) → 下一期。
// #43 单3：轮次节奏改「服务器排期器统一开奖」——相位/期号/倒计时/开奖/结算全读 useRoundRoom（/ws/rounds）。
// 算钱路径：placeAndPost() betting 内即时扣注，finishRound() 动画演完唯一赔付点（余额落定才跳）。
// 通杀规则：开出豹子时 BIG/SMALL/ODD/EVEN 四侧全输（hit 判定含 !isTriple）；
// 和值盘只开 4–17，开出 3/18（必为豹子）自然无格可中。

// —— 引擎常量块已剪切到 ./markets/hattrick（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { rollDice, deriveRoll, ODDS, MARKETS, hitsOf, round2, sumOf } from './markets/hattrick'
export { rollDice, deriveRoll, ODDS, MARKETS, hitsOf }

// ---------- 三骰舞台时间轴（rAF 内使用，毫秒）：三骰错峰定格制造悬念 ----------
const DIE_LOCK = [2600, 3500, 4500]   // 各骰定格时刻（第1骰 2.6s / 第2骰 3.5s / 第3骰 4.5s）
// 开奖动画总时长（收到 drawn → 三骰舞台演完 → 结算显示 + 回写余额）；须 < 服务器 hattrick idle(8s)
const DRAW_ANIM_MS = 7000
const G = GAME_BY_ID['HatTrick']

// 玩法说明文案已切至 ./markets-ui/hattrickRules（RULES 共享）。
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

// SIDES / DieFace / ROAD_TABS·ROAD_TAB_LABELS·beadFor 已切至 ./markets-ui（hattrickShared + HatTrickMarkets），
// 原页 mobile 段 + 舞台回显从切件回用（单一出处，禁二份表）。

export default function HatTrick({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const isMobile = useIsMobile()
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 有右栏、中栏变窄 → 舞台/盘区/珠盘/下注条同 maxWidth 居中，下注条与盘口板左右沿对齐。门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  const RAIL_MAXW = 670
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [fairOpen, setFairOpen] = useState(false)   // 本期可验证公平抽屉（共享局 commit-reveal）
  const [historyOpen, setHistoryOpen] = useState(false)   // 开奖历史抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('TOTAL')
  const [userAcc, setUserAcc] = useState({ total: true, triple: true, double: true })   // 手机手风琴玩家手动折叠态（默认三盘区全展开）；纯 UI，不动下注 state
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
  // secHead 已随桌面盘口区切至 HatTrickMarkets（组头折叠钮内建）；mobile 段用手风琴自带标题。
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
  const subRowNode = <HatTrickPodium lastRoll={lastRoll} recent={recent} isMobile={isMobile} compact={hasRail} />   // 上局信息条（切件）；单S6：≥1280 右栏压窄启紧凑档防裁
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={HATTRICK.band} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} />
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

  // ---- 珠盘路（真历史滚动，容量 6×20）——桌面切件；mobile 段 2 行走自身内联（beads 复用）----
  const ROAD_COLS = 20
  const beads = history.slice(-ROAD_CAP).map(d => beadFor(roadTab, d))
  const beadRoad = (
    <HatTrickRoad history={history} tab={roadTab} onTab={setRoadTab} isMobile={isMobile} />
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
        margin: isMobile ? '8px 12px 0' : hasRail ? '8px 0 0' : '8px 18px 0',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box',
      }}>
        {(drawing || settled) && pendingRef.current ? (
          <HatTrickStage phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ dice: pendingRef.current.dice }}
            height="100%" muted={muted} shakeRef={cardShakeRef} onLastSuspense={onLastSuspense}
            winTotal={winOfRoll(pendingRef.current)} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
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
        padding: isMobile ? '6px 12px' : hasRail ? '6px 0' : '6px 18px', boxSizing: 'border-box',
        gap: 5, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处。
            富演出层(结算飞金/碎裂·就差1点·悬念脉冲)经 settleHits/settleFx/nearMiss/suspense 传入，原页分毫不变；
            richFx 抑制 GoldenBoot 口径的 .htWin 金脉冲（本页已有 htWinFly 接管，免重复）。 */}
        <HatTrickMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits ?? preHits}
          settleHits={result?.hits} settleFx={settleFx} nearMiss={nearMiss} suspense={suspense}
          isMobile={isMobile} richFx />
      </div>

      {/* ③ 珠盘路（底部，三页签） */}
      {hasRail ? <div style={{ alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW, boxSizing: 'border-box' }}>{beadRoad}</div> : beadRoad}

      {/* ---- ④ bottom bet band — pinned（抄 Line Up：grid 4×2 筹码 + USD + 重复 + BetButton）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: hasRail ? '6px 0' : '6px 12px',
        background: HATTRICK.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)',
          gap: 6,
          maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto',
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
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
    </Panel>
  )

  // ============ 手机三段式（<1024，照德比模板）：锁顶(顶栏+悬念/飞金叠层+固定舞台) / 中滚(三盘区手风琴) / 锁底(路珠+注栏) ============
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开三盘区看 hit 高亮，betting 恢复玩家手动态。
  const SEC_TEST = {
    total: k => k.startsWith('t-') || k.startsWith('s-'),
    triple: k => k.startsWith('tr-'),
    double: k => k.startsWith('d-'),
  }
  const selCount = (sec) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => { if (SEC_TEST[sec](k)) n++ })
    return n
  }
  const effAcc = settled ? { total: true, triple: true, double: true } : userAcc
  const accSection = (key, title, body) => {
    const open = effAcc[key]
    const cnt = selCount(key)
    return (
      <div style={{ ...secBox, padding: 0, overflow: 'hidden', marginBottom: 6 }}>
        <button type="button" onClick={() => setUserAcc(a => ({ ...a, [key]: !a[key] }))} style={{
          width: '100%', height: 36, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '0 10px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: HATTRICK.gold, fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {cnt > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', color: HATTRICK.sel, fontSize: 10, fontWeight: 900 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: HATTRICK.sel, display: 'inline-block' }} />{cnt}
              </span>
            )}
          </span>
          <span style={{ color: COLORS.white, fontSize: 12, fontWeight: 900, flex: '0 0 auto' }}>{open ? '˄' : '˅'}</span>
        </button>
        <div style={{ maxHeight: open ? 1600 : 0, overflow: 'hidden', transition: 'max-height 0.2s ease' }}>
          <div style={{ padding: '0 6px 6px' }}>{body}</div>
        </div>
      </div>
    )
  }
  const body1 = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 6 }}>
        {Array.from({ length: 14 }, (_, i) => totalCell(i + 4))}
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        {SIDES.map(m => (
          <button key={m.key} type="button" className={cellCls(m.key)} disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
            <span style={cellName}>{m.name}</span>
            <span style={cellRange}>{m.range}</span>
            <span className={fxCls(m.key)} style={{ ...cellOdds, fontSize: 10, whiteSpace: 'nowrap' }}>{betsPlaced.has(m.key) ? winTxt(m.key, MARKETS[m.key].odds) : ODDS.side.toFixed(2)}</span>
            <span style={{ color: HATTRICK.dim, fontSize: 7.5, fontWeight: 700, whiteSpace: 'nowrap' }}>豹子通杀</span>
            {stakeChip(m.key)}
            {nearBadge(m.key)}
          </button>
        ))}
      </div>
    </>
  )
  const body2 = (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      <button type="button" className={cellCls('tr-any')} disabled={!betting} onClick={() => toggleSel('tr-any')}
        style={{ ...cellBtn('tr-any'), flex: '1 1 100%' }}>
        <span style={cellName}>任意豹子</span>
        <span className={fxCls('tr-any')} style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{betsPlaced.has('tr-any') ? winTxt('tr-any', MARKETS['tr-any'].odds) : ODDS.anyTriple.toFixed(2)}</span>
        {stakeChip('tr-any')}
      </button>
      {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
        <button key={v} type="button" className={cellCls(`tr-${v}`)} disabled={!betting} onClick={() => toggleSel(`tr-${v}`)}
          style={{ ...cellBtn(`tr-${v}`, { compact: true }), flex: '1 1 30%' }}>
          <span style={{ display: 'flex', gap: 2 }}>{[v, v, v].map((d, i) => <DieFace key={i} v={d} size={13} />)}</span>
          <span className={fxCls(`tr-${v}`)} style={{ ...cellOdds, fontSize: 9.5, whiteSpace: 'nowrap' }}>{betsPlaced.has(`tr-${v}`) ? winTxt(`tr-${v}`, MARKETS[`tr-${v}`].odds) : ODDS.triple.toFixed(2)}</span>
          {stakeChip(`tr-${v}`)}
        </button>
      ))}
    </div>
  )
  const body3 = (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
        <button key={v} type="button" className={cellCls(`d-${v}`)} disabled={!betting} onClick={() => toggleSel(`d-${v}`)}
          style={{ ...cellBtn(`d-${v}`, { compact: true }), flex: '1 1 30%' }}>
          <span style={{ display: 'flex', gap: 2 }}>{[v, v].map((d, i) => <DieFace key={i} v={d} size={14} />)}</span>
          <span className={fxCls(`d-${v}`)} style={{ ...cellOdds, fontSize: 9.5, whiteSpace: 'nowrap' }}>{betsPlaced.has(`d-${v}`) ? winTxt(`d-${v}`, MARKETS[`d-${v}`].odds) : ODDS.double.toFixed(2)}</span>
          {stakeChip(`d-${v}`)}
        </button>
      ))}
    </div>
  )
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${HATTRICK.bgCenter}, ${HATTRICK.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`
        .htCell:hover:not(:disabled) { filter: brightness(1.3); }
        @keyframes htWinFly { 0% { transform: scale(1); opacity: 1; } 25% { transform: scale(1.65); opacity: 1; filter: drop-shadow(0 0 6px rgba(255,213,79,0.95)); } 100% { transform: translateY(-16px) scale(1.1); opacity: 0; } }
        .htWinFly { animation: htWinFly 1s ease-out forwards; transform-origin: right center; }
        @keyframes htLose { 0% { transform: scale(1); opacity: 1; filter: grayscale(0); } 100% { transform: scale(0.7); opacity: 0; filter: grayscale(1); } }
        .htLose { animation: htLose 0.7s ease-in forwards; transform-origin: right center; }
        @keyframes htFlyGold { 0% { transform: translateY(14px) scale(0.7); opacity: 0; } 18% { transform: translateY(0) scale(1.15); opacity: 1; } 100% { transform: translateY(-120px) scale(0.85); opacity: 0; } }
        .htFlyGold { animation: htFlyGold 1.25s ease-out forwards; }
        @keyframes htPulseRing { 0%,100% { box-shadow: 0 0 0 0 rgba(255,213,79,0); } 50% { box-shadow: 0 0 11px 2px rgba(255,213,79,0.9); } }
        .htSuspense { animation: htPulseRing 0.6s ease-in-out infinite; border-color: #ffd54f !important; }
        @keyframes htNearPop { 0% { transform: translate(-50%,-50%) scale(0.4); opacity: 0; } 45% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 1; } }
        @keyframes htNearGlow { from { box-shadow: 0 0 6px rgba(255,106,61,0.5); } to { box-shadow: 0 0 14px rgba(255,106,61,0.95); } }
        .htNear { animation: htNearPop 0.45s ease-out both, htNearGlow 0.85s ease-in-out 0.45s infinite alternate; }
        @keyframes htBannerPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        .htSuspenseBanner { animation: htBannerPulse 0.55s ease-in-out infinite; }
      `}</style>

      {/* ① 锁顶：topBar + 悬念横幅/结算飞金叠层（相对锁顶定位，不随滚动）+ 固定高舞台 160（去弹性） */}
      <div style={{ flex: '0 0 auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {suspense && (
          <div style={{ position: 'absolute', top: 116, left: 0, right: 0, zIndex: 7, textAlign: 'center', pointerEvents: 'none' }}>
            <span className="htSuspenseBanner" style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: RADIUS.pill,
              background: 'rgba(8,18,12,0.92)', border: '2px solid #ffd54f', color: '#ffd54f',
              fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', boxShadow: '0 0 18px rgba(255,213,79,0.7)',
            }}>❤ {suspense.msg}</span>
          </div>
        )}
        {settleFx && result?.winTotal > 0 && (
          <div className="htFlyGold" style={{
            position: 'absolute', top: '44%', left: 0, right: 0, zIndex: 6, textAlign: 'center', pointerEvents: 'none',
            color: HATTRICK.gold, fontSize: 26, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
            textShadow: '0 0 16px rgba(255,213,79,0.9)',
          }}>+${result.winTotal.toFixed(2)}</div>
        )}
        <div style={{
          flex: '0 0 auto', height: 160, position: 'relative', zIndex: 1,
          margin: '8px 12px 0', background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box',
        }}>
          {(drawing || settled) && pendingRef.current ? (
            <HatTrickStage phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ dice: pendingRef.current.dice }}
              height="100%" muted={muted} shakeRef={cardShakeRef} onLastSuspense={onLastSuspense}
              winTotal={winOfRoll(pendingRef.current)} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span style={{ color: HATTRICK.dim, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>上期</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{lastRoll.dice.map((v, i) => <DieFace key={i} v={v} size={30} />)}</span>
              <span style={{ color: HATTRICK.gold, fontSize: 16, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif" }}>{lastRoll.isTriple ? `豹子 ${lastRoll.tripleFace}` : `和值 ${lastRoll.total}`}</span>
            </div>
          )}
        </div>
      </div>

      {/* ② 中滚：三盘区手风琴（和值·大小单双 / 豹子 / 对子，默认全开；结算全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('total', '和值 · 大小单双', body1)}
        {accSection('triple', '豹子', body2)}
        {accSection('double', '对子', body3)}
      </div>

      {/* ③ 锁底：路珠(3视角 pill 原样 + 珠压 2 行) + 注栏 */}
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ padding: '4px 12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }}>
            {ROAD_TABS.map(t => (
              <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
                flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 10px', borderRadius: RADIUS.pill,
                background: roadTab === t ? HATTRICK.sel : 'rgba(0,0,0,0.35)', color: roadTab === t ? '#083a1b' : HATTRICK.dim,
                border: `1px solid ${roadTab === t ? HATTRICK.sel : 'rgba(255,255,255,0.2)'}`,
                fontSize: 10, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
              }}>{ROAD_TAB_LABELS[t]}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 8, background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 2 }).map((_, i) => {
                const b = beads[i]
                return (
                  <span key={i} style={{
                    width: 15, height: 15, borderRadius: '50%',
                    background: b ? b.c : 'rgba(255,255,255,0.05)',
                    border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: b?.dark ? '#3a2c00' : COLORS.white, fontSize: b && b.t.length > 1 ? 6 : 8, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  }}>{b ? b.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 12px', background: HATTRICK.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
            gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
          }}>
            {[
              { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
              { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
            ].map(({ v, col, row }) => (
              <button key={v} type="button" className="htChip" disabled={!betting} onClick={() => setBet(v)} style={{
                gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
                fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
                background: bet === v ? HATTRICK.selTint : 'rgba(0,0,0,0.35)',
                border: `1px solid ${bet === v ? HATTRICK.sel : 'rgba(255,255,255,0.35)'}`,
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
              color: repeatOk ? HATTRICK.text : HATTRICK.dim, background: 'rgba(0,0,0,0.35)',
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
      </div>

      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
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
  // ---- 手机三段锁死（<1024）----
  return (
    <>
      <style>{`.htMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="htMobileRoot" ref={cardShakeRef}>{mobileCard}</div>
    </>
  )
}
