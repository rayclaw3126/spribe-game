import { useState, useRef, useEffect, useMemo } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOLDENBOOT, MONO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import BetButton from '../components/shell/BetButton'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import HistoryDrawer from '../components/HistoryDrawer'
import CommitRevealFairness from '../components/CommitRevealFairness'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useRoundRoom } from '../hooks/useRoundRoom'
import GoldenBootStage from './stages/GoldenBootStage'
import GoldenBootMarkets, { CarImgBead } from './markets-ui/GoldenBootMarkets'   // #41 单14.4：盘口区切件（CarImgBead 随件，subRow 复用）
import GoldenBootPodium from './markets-ui/GoldenBootPodium'   // #41 单14.5：上局前三名信息条
import GoldenBootRoad from './markets-ui/GoldenBootRoad'       // #41 单14.5：珠盘路墙
import { RULES } from './markets-ui/goldenbootRules'           // #41 单14.5：玩法说明内容（共享）
import { CAR_SRC } from './markets-ui/carAssets'   // 舞台赛道渲染用（single source）
import trafficLightImg from '../assets/goldenboot/traffic_light.png'

// Golden Boot — 10 辆赛车冲刺排名彩（PK10 赛车皮）。
// 引擎：1–10 全排列（Fisher-Yates），index = 名次；冠亚和 3–19。
// 轮次：BETTING(24s) → RACING(3s 占位，单3 换冲刺动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// —— 引擎常量块已剪切到 ./markets/goldenboot（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { drawRace, deriveRace, ODDS, hitsOf, round2, MARKETS, SUM_N } from './markets/goldenboot'
export { drawRace, deriveRace, ODDS, MARKETS, hitsOf }

// ---------- 冲刺舞台时间轴（rAF 内使用，毫秒）：----------
// 冠军冲线 = START + BASE ≈ 5.3s，之后每名次 +160ms（第10名 ~6.74s），余下定格
// 开奖动画总时长（收到 drawn → 冲刺舞台演完 → 结算 + 回写余额）；须 < 服务器 goldenboot idle(9s)
const DRAW_ANIM_MS = 8000
const G = GAME_BY_ID['GoldenBoot']

const ROAD_CAP = 120

// 种子上期 + 种子历史（真开奖逐期顶掉）
const SEED_LAST = deriveRace([3, 7, 1, 9, 2, 10, 5, 8, 4, 6])
const SEED_WINNERS = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6, 2, 8, 1, 4, 10, 6, 3, 9, 7, 5, 1, 6, 4, 2, 9, 3, 10, 8, 5, 7]
const SEED_SUMS = [10, 9, 4, 13, 12, 16, 8, 14, 7, 11, 5, 15, 3, 9, 17, 10, 6, 12, 19, 8, 11, 7, 13, 5, 16, 9, 4, 18, 12, 10]
const SEED_HISTORY = SEED_WINNERS.map((w, i) => ({ winner: w, sum: SEED_SUMS[i] }))

// ROAD_TABS/ROAD_TAB_LABELS/beadFor 已随珠盘路切至 ./markets-ui/GoldenBootRoad（页签/判定单一出处）。

// 金靴球衣珠 — 迷你球衣轮廓 + 号码（金渐变，共享 gold/fire/goldDeep）

// CarImgBead 已随盘口区切至 ./markets-ui/GoldenBootMarkets（此处 import 回用于 subRow 名次串）。


export default function GoldenBoot({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 有右栏、中栏变窄 → 舞台/盘区/珠盘/下注条同 maxWidth 居中，下注条与盘口板左右沿对齐。门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  const RAIL_MAXW = 660
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
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('WINNER')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | racing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  // #42 两份「按期累积」状态按房存：两房开的是完全不同的局，共用即串流。
  //   · lastRace 上局名次 → 喂顶栏 subRow 的 GoldenBootPodium（串了最扎眼）
  //   · history  珠盘路 {winner,sum} → 喂 GoldenBootRoad
  const [lastRaceByRoom, setLastRaceByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_LAST])))
  const [historyByRoom, setHistoryByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_HISTORY])))
  const lastRace = lastRaceByRoom[selectedRoomKey] ?? SEED_LAST
  const history = historyByRoom[selectedRoomKey] ?? SEED_HISTORY
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null) // 冲刺动画收尾的命中预亮（结算前）
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)   // 是否有上局注单快照（重复钮亮灭）

  const picksRef = useRef(picks)
  // #42 注单暂存按房：{roomKey: Map<key, 累计注额>}。切走再切回【同一期】，已下的注还在 ——
  // 注是真金白银下进那一房的，切个 tab 就抹掉，玩家会以为注没了。只在该房自己换期时清（见 A0）。
  const betsByRoomRef = useRef(Object.fromEntries(ROOMS.map((r) => [r.key, new Map()])))
  const betsOf = (k) => betsByRoomRef.current[k] || new Map()
  const betsRef = { get current() { return betsOf(selectedRoomKey) }, set current(m) { betsByRoomRef.current[selectedRoomKey] = m } }
  const lastBetsRef = useRef(new Map())   // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画名次（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  // #42：「本期已处理」判定改 Set —— 两房各自出期号（GB- / GB15-，天然不撞），
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

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。无 push（hit/lose 两态）。
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
    setLastRaceByRoom(m => ({ ...m, [selectedRoomKey]: r }))
    setHistoryByRoom(m => ({ ...m, [selectedRoomKey]: [...(m[selectedRoomKey] || SEED_HISTORY), { winner: r.winner, sum: r.sprintSum }].slice(-ROAD_CAP) }))
    setResult({ hits, winTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
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
      setResult(null); setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.phase, room.roundNo])

  // A1. #42 切房：把 UI 拉到新房的当前态。舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  // preHits 是冲刺动画收尾的命中预亮，不清则上一房的预亮挂在新房盘口上（像是中了奖）。
  useEffect(() => {
    setBetsPlaced(new Map(betsOf(selectedRoomKey)))
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setPreHits(null); setNetErr(null)
    pendingRef.current = null          // 断开上一房的名次对象（舞台三元据它判分支）
    shownRoundRef.current = null       // 让 A 对新房当期重跑一遍（回 betting UI）
    animatedRoundRef.current = null
    setUiPhase('betting')
  }, [selectedRoomKey])

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
  // ⚠ PK10 的 drawResult 字段是 .ranking（母本号码王是 .num），派生走 deriveRace。
  const bgDrawRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgDrawRoundRef.current[r.key] === rm.roundNo) continue
      bgDrawRoundRef.current[r.key] = rm.roundNo
      const race = deriveRace(rm.drawResult.ranking)
      setLastRaceByRoom(m => ({ ...m, [r.key]: race }))
      setHistoryByRoom(m => ({ ...m, [r.key]: [...(m[r.key] || SEED_HISTORY), { winner: race.winner, sum: race.sprintSum }].slice(-ROAD_CAP) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

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
      // #42：带当期 roundId 作【房凭证】—— 后端据它在该款所有房里定位当期 betting 房。
      // 不传一律落标准房（房化前行为），快房的注会跑到 30s 房去。钱层逻辑本身零改动。
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries), roundId: room.roundId })   // 返 balanceAfter → 自动回写扣款
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
  // cellBtn/cellName/cellRange/cellOdds/stakeChip 已随盘口区切至 ./markets-ui/GoldenBootMarkets。

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
  const subRowNode = <GoldenBootPodium order={lastRace.order} isMobile={isMobile} />   // 上局前三名信息条（切件）
  // ---- #42 速度 tab 条（形态A）：顶栏下 44px 行，双端同构 ----
  // 每房显 label + 期号短号 + 【该房自己 hook 的】实时倒计时（未选中房也在连，秒数是真的）。
  // PK10 的 gameCard 被 PC/手机两端复用，故本行一处插入即两端生效；44px 从中滚区扣，舞台不动。
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
        const shortNo = rm.roundNo ? `#${String(rm.roundNo).split('-').pop()}` : '…'   // GB-20260722-1604 → #1604
        return (
          <button key={r.key} type="button" onClick={() => setSelectedRoomKey(r.key)} style={{
            flex: '1 1 0', minWidth: 0, height: 34, borderRadius: RADIUS.pill, cursor: 'pointer',
            background: on ? GOLDENBOOT.sel : GOLDENBOOT.strip,
            border: `1px solid ${on ? GOLDENBOOT.sel : 'rgba(255,255,255,0.16)'}`,
            color: on ? '#083a1b' : GOLDENBOOT.dim,
            fontSize: 12, fontWeight: 900, letterSpacing: 0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '0 8px', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            <span style={{ fontFamily: MONO, opacity: on ? 0.75 : 0.6, flex: '0 0 auto' }}>{shortNo}</span>
            <span style={{
              fontFamily: MONO, flex: '0 0 auto',
              color: on ? '#083a1b' : (timed ? GOLDENBOOT.sel : GOLDENBOOT.dim),
            }}>{timed ? `${sec}s` : '—'}</span>
          </button>
        )
      })}
    </div>
  )

  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={GOLDENBOOT.band} venue={G.venue ?? G.displayName}
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
      {!room.connected && room.roundNo && room.roomError !== 'invalid_room' && (
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

  // ---- 珠盘路（切件；真历史滚动，容量 6×20）----
  const beadRoad = (
    <GoldenBootRoad history={history} tab={roadTab} onTab={setRoadTab} isMobile={isMobile}
      style={{ margin: isMobile ? '0 12px 10px' : hasRail ? '0 auto 12px' : '0 18px 12px',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />
  )

  // ---- 开奖区（常驻顶部）：RACING/SETTLED 冲刺舞台 / BETTING 上期名次静态待命 ----
  const stageH = isMobile ? 150 : 178
  const stageZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0',
      ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', minHeight: stageH,
    }}>
      {(racing || settled) && pendingRef.current ? (
        <GoldenBootStage key={selectedRoomKey} phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ ranking: pendingRef.current.order }}
          height={stageH} muted={muted}
          shakeRef={cardShakeRef} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
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
      height: '100%', boxSizing: 'border-box',   // 手机三段锁死：撑满 100dvh 根（桌面本就 100%，渲染不变）
    }}>
      {/* .gbCell hover 样式已随盘口区切至 GoldenBootMarkets（组件内 <style> 挂） */}

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}

      {/* ---- ① 开奖区（常驻顶部）---- */}
      {stageZone}

      {/* ---- ② 下注区: 盘区三族，可滚 ---- */}
      <div style={{
        flex: isDesk ? '0 1 auto' : '1 1 0', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '8px 12px' : hasRail ? '8px 0' : '8px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处 */}
        <GoldenBootMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits ?? preHits} isMobile={isMobile} />

      </div>

      {isDesk && <div style={{ flex: '1 0 auto' }} />}

      {/* ---- ③ 珠盘路（常驻底部）---- */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（抄 LineUp/DominoDuel）---- */}
      <div style={{
        flex: '0 0 auto', padding: hasRail ? '6px 0' : '6px 12px', background: GOLDENBOOT.band,
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
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} game={G.backendId} drawResult={room.drawResult} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} room={selectedRoomKey} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
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

  // ---- 手机三段锁死（<1024）：100dvh 根锁死 + gameCard 撑满；shake 挂根 ----
  return (
    <>
      <style>{`.gbMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="gbMobileRoot" ref={cardShakeRef}>
        {gameCard}
      </div>
    </>
  )
}
