import { useState, useRef, useEffect, useMemo } from 'react'
import { usePlayerApi } from '../lib/playerApi'
import { Panel } from '../components/GameLayout'
import { GAME_BY_ID } from '../gameRegistry'
import { COLORS, RADIUS, LAYOUT, HALFTIME, MONO } from '../components/shell/tokens'
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
import { useRoundRoom } from '../hooks/useRoundRoom'
import HalfTimeStage from './stages/HalfTimeStage'
import HalfTimeMarkets from './markets-ui/HalfTimeMarkets'                  // #41 单15：盘口区切件
import { SEC_KEYS } from './markets-ui/halftimeMarketsData'                // #41 单15：段位 key 集（手机手风琴 selCount 用，单一出处）
import HalfTimeRoad from './markets-ui/HalfTimeRoad'                        // #41 单15：珠盘路墙
import HalfTimePodium from './markets-ui/HalfTimePodium'                    // #41 单15：上局信息条（20 球+和值）
import { RULES } from './markets-ui/halftimeRules'                          // #41 单15：玩法说明内容（共享）

// Half Time — 快乐8和值盘（足球皮）。
// 引擎：1–80 无重复抽 20 球（保留开出顺序），和值 210–1410。
// 轮次：BETTING(24s) → DRAWING(10s rAF 开奖舞台) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// —— 引擎常量块已剪切到 ./markets/halftime（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { deriveRound, halfOf, ODDS, MARKETS, hitsOf, round2, drawRound } from './markets/halftime'
export { drawRound, deriveRound, halfOf, ODDS, MARKETS, hitsOf }

// ---------- 开奖舞台时间轴（rAF 内使用，毫秒）----------
// 单球飞行 530ms（较初版 +40% 可跟球），间隔压到 400ms 补偿总节奏
const FINALE_HOLD = 1000
// 开奖动画总时长（收 drawn → 20 球连发+SCORE 定格演完 → 结算+回写余额）；须 < 服务器 halftime idle(11s)
const DRAW_ANIM_MS = 10000
const G = GAME_BY_ID['HalfTime']

// 玩法说明文案已切至 ./markets-ui/halftimeRules（RULES 单一出处，原名 import 回用）。
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

// 盘面数组(ROW1/PARLAY/ZONES/ROW3) 已切至 ./markets-ui/HalfTimeMarkets；
// 珠盘 ROAD_TABS/ROAD_TAB_LABELS/beadFor/zoneOf/ZONE_COLOR 已切至 ./markets-ui/HalfTimeRoad（判定单一出处）。

export default function HalfTime({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 才有右栏（App 层 marginRight:200 让位），中栏变窄。此regime收一条统一宽度线：
  // 舞台/盘区/珠盘/下注条同 maxWidth 居中（压缩收留白），下注条与盘口板左右沿对齐。严格门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  const RAIL_MAXW = 680
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- #42 双订阅：两房各一条 WS（未选中的房也连——tab 上要显它的实时期号/倒计时）----
  // ⚠ Rules of Hooks：显式调两次而非 G.rooms.map(...)。房数由 registry 编译期定死，
  //   map 出来的 hook 数量看着可变，既触 eslint 也误导后来者以为能动态增减房。照母本写法。
  const ROOMS = G.rooms                                    // [{key:'30s',label},{key:'15s',label}]
  const [selectedRoomKey, setSelectedRoomKey] = useState(ROOMS[0].key)
  const roomA = useRoundRoom(playerToken, G.backendId, ROOMS[0].key)
  const roomB = useRoundRoom(playerToken, G.backendId, ROOMS[1].key)
  const roomsByKey = useMemo(() => ({ [ROOMS[0].key]: roomA, [ROOMS[1].key]: roomB }), [ROOMS, roomA, roomB])
  // 选中房 = 舞台/盘口/注栏/公平抽屉的唯一真相来源（下方所有 room.* 读的都是它）
  const room = roomsByKey[selectedRoomKey]

  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [fairOpen, setFairOpen] = useState(false)   // 本期可验证公平抽屉（共享局 commit-reveal）
  const [historyOpen, setHistoryOpen] = useState(false)   // 开奖历史抽屉
  const [rulesOpen, setRulesOpen] = useState(false)          // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())        // 待确认选格
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())   // key → 已下注额
  const [roadTab, setRoadTab] = useState('O/U')
  const [userAcc, setUserAcc] = useState({ m1: true, m2: true, m3: true })   // 手机手风琴玩家手动折叠态（默认三盘区全展开）；纯 UI，不动下注 state
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  // #42 两份「按期累积」状态按房存：两房开的是完全不同的局，共用即串流。
  //   · lastDraw 上局开奖 → 喂顶栏 subRow 的 HalfTimePodium（串了最扎眼）
  //   · history  珠盘路 {sum,half} → 喂 HalfTimeRoad
  const [lastDrawByRoom, setLastDrawByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_LAST])))
  const [historyByRoom, setHistoryByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_HISTORY])))
  const lastDraw = lastDrawByRoom[selectedRoomKey] ?? SEED_LAST
  const history = historyByRoom[selectedRoomKey] ?? SEED_HISTORY
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)   // 是否有上局注单快照（重复钮亮灭）

  const [preHits, setPreHits] = useState(null)   // 开奖动画收尾的命中预亮（结算前）
  const picksRef = useRef(picks)
  // #42 注单暂存按房：{roomKey: Map<key, 累计注额>}。切走再切回【同一期】，已下的注还在 ——
  // 注是真金白银下进那一房的，切个 tab 就抹掉，玩家会以为注没了。只在该房自己换期时清（见 A0）。
  const betsByRoomRef = useRef(Object.fromEntries(ROOMS.map((r) => [r.key, new Map()])))
  const betsOf = (k) => betsByRoomRef.current[k] || new Map()
  const betsRef = { get current() { return betsOf(selectedRoomKey) }, set current(m) { betsByRoomRef.current[selectedRoomKey] = m } }
  const lastBetsRef = useRef(new Map())   // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生结果（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  // #42：「本期已处理」判定改 Set —— 两房各自出期号（HF- / HF15-，天然不撞），
  // 选中房走 finishRound、未选中房走 D 段，两条路共用这一个 Set 防重。
  const settledRoundsRef = useRef(new Set())
  const settleInfoRef = useRef(null)       // 镜像【选中房】settleInfo，供动画结束时读取
  const betsResetRoundRef = useRef({})     // #42：{roomKey: 已清过注单的期号}
  const cardShakeRef = useRef(null)

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])


  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 +（有注则）回写余额。无 push（draw 是独立 hit/lose 市场，判输不退）。
  function finishRound(rnd) {
    const r = pendingRef.current
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 余额回写（每期一次）：有注用后端 settleInfo.balanceAfter；无注不动钱。
    // ⚠ add 必须收在 hadBet 内：切房时旧房的动画定时器仍会到点跑到这里，那时 settleInfoRef
    //   已换成新房的 → hadBet=false → 本函数没消费这期；若仍 add，就把期号钉成「已处理」，
    //   D 段便会跳过它 → 该期余额回写与 toast 双双丢失。不 add 才能让 D 接住。
    if (hadBet) {
      if (si.balanceAfter != null && !settledRoundsRef.current.has(rnd)) {
        setServerBalance(Number(si.balanceAfter))
      }
      settledRoundsRef.current.add(rnd)
    }
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
    // #42：两份累积写进【选中房】自己的槽（动画演完才写，保悬念）
    setLastDrawByRoom(m => ({ ...m, [selectedRoomKey]: r }))
    setHistoryByRoom(m => ({ ...m, [selectedRoomKey]: [...(m[selectedRoomKey] || SEED_HISTORY), { sum: r.sum, half: halfOf(r) }].slice(-ROAD_CAP) }))
    setResult({ hits, winTotal })
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setUiPhase('settled')
  }

  // ---- 相位驱动 effects（全部只读 room，本地不产相位）----
  // A0. #42 各房换期清各房注单 —— 【两房都跑】，与当前选中哪个 tab 无关。
  // 未选中的房也在自转，它换期时它的注单就作废了；若只在选中房跑，切回去会看到上一期
  // （甚至几期前）的注单挂在新期上——比不显示更糟（假注单）。
  useEffect(() => {
    for (const r of ROOMS) {
      const rm = roomsByKey[r.key]
      if (rm.phase !== 'betting' || !rm.roundNo) continue
      if (betsResetRoundRef.current[r.key] === rm.roundNo) continue
      betsResetRoundRef.current[r.key] = rm.roundNo
      const m = betsOf(r.key)
      if (m.size) {
        if (r.key === selectedRoomKey) { lastBetsRef.current = new Map(m); setHasLast(true) }   // 「重复上期」只服务选中房
        betsByRoomRef.current[r.key] = new Map()
        if (r.key === selectedRoomKey) setBetsPlaced(new Map())
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.phase, roomA.roundNo, roomB.phase, roomB.roundNo, selectedRoomKey])

  // A. 新一期 betting（【仅选中房】）：UI 清盘 → 回 betting。注单清理已由 A0 按房处理。
  useEffect(() => {
    if (room.phase === 'betting' && room.roundNo && room.roundNo !== shownRoundRef.current) {
      shownRoundRef.current = room.roundNo
      picksRef.current = new Set(); setPicks(new Set())
      setBetsPlaced(new Map(betsOf(selectedRoomKey)))   // 与该房的暂存对齐（切房回来时也走这条）
      setResult(null)
      setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.phase, room.roundNo])

  // A1. #42 切房：把 UI 拉到新房的当前态。舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  // preHits 是开奖动画收尾的命中预亮，不清则上一房的预亮挂在新房盘口上（像是中了奖）。
  useEffect(() => {
    setBetsPlaced(new Map(betsOf(selectedRoomKey)))
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setPreHits(null); setNetErr(null)
    pendingRef.current = null          // 断开上一房的开奖派生对象（舞台条件挂载据它判）
    shownRoundRef.current = null       // 让 A 对新房当期重跑一遍（回 betting UI）
    animatedRoundRef.current = null
    setUiPhase('betting')
  }, [selectedRoomKey])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动 20 球开奖舞台（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const derived = deriveRound(room.drawResult.balls)   // 后端 20 球（和值/低区按后端球算）
      const rnd = room.roundNo
      pendingRef.current = derived
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // D. #42 未选中房的后台结算：余额 + WinToast，立即应用。
  //   · 不等动画：你没在看那一房，没有动画可等 —— settleInfo 一到就是终局。
  //   · 余额必须写：钱是真扣真派的，不能因为玩家切走了 tab 就不回写（切回来发现余额对不上
  //     会被当成吞钱）。服务端 balanceAfter 是权威快照；两房近同时结算 last-write 可接受，
  //     下一次任一房结算/刷新即自纠。
  //   · toast 文案带房名，否则玩家不知道是哪一房中的。
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue          // 选中房走 finishRound（动画演完才回写）
      const rm = roomsByKey[r.key]
      const si = rm.settleInfo
      if (!si || !si.roundNo || settledRoundsRef.current.has(si.roundNo)) continue
      settledRoundsRef.current.add(si.roundNo)
      if (si.balanceAfter != null) setServerBalance(Number(si.balanceAfter))
      const win = Number(si.totalPayout || 0)
      if (win > 0) pushToast(`${r.label} 命中`, win)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.settleInfo, roomB.settleInfo, selectedRoomKey])

  // E. #42 未选中房的两份累积：drawResult 一到就追（无动画可等）。选中房在 finishRound 里追。
  // ⚠ 中场的 drawResult 字段是 .balls（20 球），派生走 deriveRound；珠子取 {sum, half}。
  const bgDrawRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgDrawRoundRef.current[r.key] === rm.roundNo) continue
      bgDrawRoundRef.current[r.key] = rm.roundNo
      const d = deriveRound(rm.drawResult.balls)
      setLastDrawByRoom(m => ({ ...m, [r.key]: d }))
      setHistoryByRoom(m => ({ ...m, [r.key]: [...(m[r.key] || SEED_HISTORY), { sum: d.sum, half: halfOf(d) }].slice(-ROAD_CAP) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

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
      // #42：带当期 roundId 作【房凭证】—— 后端据它在该款所有房里定位当期 betting 房。
      // 不传一律落标准房（房化前行为），快房的注会跑到 30s 房去。钱层逻辑本身零改动。
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries), roundId: room.roundId })   // 返 balanceAfter → 自动回写扣款
      entries.forEach((s, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + s)))
      setBetsPlaced(new Map(betsRef.current))
      return true
    } catch (e) {
      if (e?.data?.error === 'round_locked') {
        pushToast('本期已封盘', 0)   // 封盘提示
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

  // cellBtn/cellName/cellRange/cellOdds/betCell 已随盘口区切至 ./markets-ui/HalfTimeMarkets（键区单一出处）。

  // 盘口区切件（视觉原样）：desktop 中区一整块（无 section），mobile 手风琴逐段（section='mX'）。
  const marketsProps = { onPick: toggleSel, stakes: betsPlaced, disabled: !betting, selected: picks, hits: result?.hits ?? preHits, isMobile }

  // ---- 轮次条 ----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: HALFTIME.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: HALFTIME.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: HALFTIME.draw }
        : drawing
          ? { text: '开奖中…', c: HALFTIME.draw }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: HALFTIME.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const subRowNode = <HalfTimePodium lastDraw={lastDraw} isMobile={isMobile} compact={hasRail} />   // 上局信息条（切件）；单S6：≥1280 右栏压窄启紧凑档防裁
  // ---- #42 速度 tab 条（形态A）：顶栏下 44px 行，双端同构 ----
  // 每房显 label + 期号短号 + 【该房自己 hook 的】实时倒计时（未选中房也在连，秒数是真的）。
  // topBar 被 gameCard / mobileCard 两分支共用，故一处插入两端生效；44px 从中滚区扣，舞台不动。
  const roomTabs = ROOMS.length > 1 && (
    <div style={{
      flex: '0 0 auto', display: 'flex', gap: 6, height: 44, alignItems: 'center',
      padding: isMobile ? '0 12px' : '0 18px', boxSizing: 'border-box',
    }}>
      {ROOMS.map((r) => {
        const rm = roomsByKey[r.key]
        const on = r.key === selectedRoomKey
        const sec = Math.max(0, Math.ceil((rm.countdownMs || 0) / 1000))
        const timed = rm.phase === 'betting' || rm.phase === 'locked' || rm.phase === 'idle'
        const shortNo = rm.roundNo ? `#${String(rm.roundNo).split('-').pop()}` : '…'   // HF-20260722-1604 → #1604
        return (
          <button key={r.key} type="button" onClick={() => setSelectedRoomKey(r.key)} style={{
            flex: '1 1 0', minWidth: 0, height: 34, borderRadius: RADIUS.pill, cursor: 'pointer',
            background: on ? HALFTIME.sel : HALFTIME.strip,
            border: `1px solid ${on ? HALFTIME.sel : 'rgba(255,255,255,0.16)'}`,
            color: on ? '#083a1b' : HALFTIME.dim,
            fontSize: 12, fontWeight: 900, letterSpacing: 0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '0 8px', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            <span style={{ fontFamily: MONO, opacity: on ? 0.75 : 0.6, flex: '0 0 auto' }}>{shortNo}</span>
            <span style={{
              fontFamily: MONO, flex: '0 0 auto',
              color: on ? '#083a1b' : (timed ? HALFTIME.sel : HALFTIME.dim),
            }}>{timed ? `${sec}s` : '—'}</span>
          </button>
        )
      })}
    </div>
  )

  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={HALFTIME.band} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} />
      {roomTabs}
      {/* #42：服务端 1008 拒房（?room= 认不出）——hook 已停重连，这里给出口，否则页面白等 */}
      {room.roomError === 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800,
        }}>该房不存在，请切回其它房</div>
      )}
      {/* 断线重连提示（hook 自动指数退避重连；恢复后 sync 补相位） */}
      {!room.connected && room.roundNo && room.roomError !== 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${HALFTIME.gold}`, borderRadius: 10,
          padding: '8px 16px', color: HALFTIME.gold, fontSize: 13, fontWeight: 800,
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

  // ---- 珠盘路（真历史滚动，容量 6×20）——切件（判定/页签单一出处）----
  const beadRoad = (
    <HalfTimeRoad history={history.slice(-ROAD_CAP)} tab={roadTab} onTab={setRoadTab}
      style={{ margin: isMobile ? '0 12px 10px' : hasRail ? '0 auto 12px' : '0 18px 12px',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${HALFTIME.bgCenter}, ${HALFTIME.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      {/* .htCell hover / .htimeWin 脉冲样式已随盘口区切至 HalfTimeMarkets（组件内 <style> 挂） */}

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}


      {/* ---- 开奖舞台：DRAWING 展开表演，SETTLED 保持定格，回 BETTING 收起 ---- */}
      {(drawing || settled) && pendingRef.current && (
        <div style={{ flex: '0 0 auto', margin: isMobile ? '10px 12px 0' : hasRail ? '12px 0 0' : '12px 18px 0', position: 'relative', zIndex: 1,
          ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }}>
          <HalfTimeStage key={selectedRoomKey} phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ balls: pendingRef.current.balls }}
            height={isMobile ? 150 : 185} muted={muted}
            shakeRef={cardShakeRef} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
        </div>
      )}

      {/* ---- middle zone: 盘区三行，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : hasRail ? '12px 0' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（行①②③ 视觉原样）：点击/态由本页 state 传入，键区单一出处 */}
        <HalfTimeMarkets {...marketsProps} />
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto', padding: hasRail ? '6px 0' : '6px 12px', background: HALFTIME.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="htChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? HALFTIME.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? HALFTIME.sel : 'rgba(255,255,255,0.35)'}`,
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
            color: repeatOk ? COLORS.white : HALFTIME.dim, background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : drawing ? '开奖中…' : '本期已结算'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets}
              disabled={!confirmOk}
              stretch
            />
          </div>
        </div>
      </div>
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} game={G.backendId} drawResult={room.drawResult} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} room={selectedRoomKey} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
    </Panel>
  )

  // ============ 手机三段式（<1024，照德比模板）：锁顶(顶栏+单舞台) / 中滚(三盘区手风琴) / 锁底(路珠+注栏) ============
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开三盘区看 hit/lose 高亮，betting 恢复玩家手动态。
  // SEC_KEYS（段位 key 集）已切至 ./markets-ui/halftimeMarketsData（import 回用，单一出处）。
  const selCount = (sec) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => { if (SEC_KEYS[sec].has(k)) n++ })
    return n
  }
  const effAcc = settled ? { m1: true, m2: true, m3: true } : userAcc
  const accSection = (key, title, body) => {
    const open = effAcc[key]
    const cnt = selCount(key)
    return (
      <div style={{ borderRadius: 12, background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 6 }}>
        <button type="button" onClick={() => setUserAcc(a => ({ ...a, [key]: !a[key] }))} style={{
          width: '100%', height: 36, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '0 10px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: HALFTIME.gold, fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {cnt > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', color: HALFTIME.sel, fontSize: 10, fontWeight: 900 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: HALFTIME.sel, display: 'inline-block' }} />{cnt}
              </span>
            )}
          </span>
          <span style={{ color: COLORS.white, fontSize: 12, fontWeight: 900, flex: '0 0 auto' }}>{open ? '˄' : '˅'}</span>
        </button>
        <div style={{ maxHeight: open ? 1400 : 0, overflow: 'hidden', transition: 'max-height 0.2s ease' }}>
          <div style={{ padding: '0 6px 6px' }}>{body}</div>
        </div>
      </div>
    )
  }
  // 手风琴三段 body（切件逐段：section='mX' 渲染该段紧凑 body，视觉原样）
  const body1 = <HalfTimeMarkets {...marketsProps} section="m1" />
  const body2 = <HalfTimeMarkets {...marketsProps} section="m2" />
  const body3 = <HalfTimeMarkets {...marketsProps} section="m3" />
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${HALFTIME.bgCenter}, ${HALFTIME.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      {/* .htCell hover / .htimeWin 脉冲样式随盘口区切件内建（各 section body 挂 <style>） */}

      {/* ① 锁顶：GameTopBar + 单舞台（drawing/settled 才出，canvas 常驻锁顶不折叠不卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {(drawing || settled) && pendingRef.current && (
          <div style={{ flex: '0 0 auto', margin: '10px 12px 0', position: 'relative', zIndex: 1 }}>
            <HalfTimeStage key={selectedRoomKey} phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ balls: pendingRef.current.balls }}
              height={150} muted={muted} shakeRef={cardShakeRef} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
          </div>
        )}
      </div>

      {/* ② 中滚：三盘区手风琴（大小单双过关 / 球场五段 / 半场，默认全开；结算全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('m1', '大小 · 单双 · 过关', body1)}
        {accSection('m2', '球场五段', body2)}
        {accSection('m3', '半场', body3)}
      </div>

      {/* ③ 锁底：路珠(5视角 pill 原样 + 珠压 2 行) + 注栏 */}
      <div style={{ flex: '0 0 auto' }}>
        {/* 珠盘路切件（紧凑变体：页签横滚 + 2 行 15px 珠矩阵，视觉原样） */}
        <HalfTimeRoad history={history.slice(-ROAD_CAP)} tab={roadTab} onTab={setRoadTab} compact
          style={{ padding: '4px 12px 0' }} />
        <div style={{ padding: '6px 12px', background: HALFTIME.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
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
                background: bet === v ? HALFTIME.selTint : 'rgba(0,0,0,0.35)',
                border: `1px solid ${bet === v ? HALFTIME.sel : 'rgba(255,255,255,0.35)'}`,
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
              color: repeatOk ? COLORS.white : HALFTIME.dim, background: 'rgba(0,0,0,0.35)',
              border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
              cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
              boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
            <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
              <BetButton
                state="bet"
                label={betting ? `下注 ${picks.size} 格` : drawing ? '开奖中…' : '本期已结算'}
                sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
                onClick={confirmBets}
                disabled={!confirmOk}
                stretch
              />
            </div>
          </div>
        </div>
      </div>

      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} game={G.backendId} drawResult={room.drawResult} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} room={selectedRoomKey} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
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

  // ---- 手机三段锁死（<1024）----
  return (
    <>
      <style>{`.htMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="htMobileRoot" ref={cardShakeRef}>{mobileCard}</div>
    </>
  )
}
