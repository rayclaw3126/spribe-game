import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY, MONO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import HowToPlay from '../components/shell/HowToPlay'
import HistoryDrawer from '../components/HistoryDrawer'
import CommitRevealFairness from '../components/CommitRevealFairness'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import { useSpeedRooms } from '../hooks/useSpeedRooms'
import SpeedGridStage from './stages/SpeedGridStage'
import SpeedGridMarkets from './markets-ui/SpeedGridMarkets'   // #41 单15：盘口区切件（视觉原样）
import SpeedGridRoad from './markets-ui/SpeedGridRoad'         // #41 单15：珠盘路墙（判定走引擎）
import { RULES } from './markets-ui/speedgridRules'            // #41 单15：玩法说明内容（共享）
import { TEAMS, teamOf } from './markets-ui/speedgridTeams'    // #41 单15：4 队涂装（开奖区/盘口区同源）

// Speed Grid — DD24 结构 F1 皮（1-24 均匀抽 1 开冠军车号），第 18 卡。
// #43 单2：轮次节奏改「服务器排期器统一开奖」——相位/期号/倒计时/开奖/结算全读 useRoundRoom（/ws/rounds）。
//   本地不再有相位 setInterval / 本地 roundNo / 伪期号；下注 betting 相位内即时 POST 挂当期共享局，
//   收 drawn 消息 → drawResult 进冲线舞台动画（pendingRef 只读表演铁律不变）→ 演完若有注用
//   settleInfo.balanceAfter 回写余额，无注只翻新期。⚖ 公平走 CommitRevealFairness 抽屉（共享局
//   commit-reveal 形态，读 useRoundRoom.commit：betting 显承诺 hash，drawn reveal serverSeed 自动比对）。
// X3：drawing 相位冲线舞台（6 赛道车群摆动互有领先 → 冠军末段脱出 → 冲线定格
//     → 冠军车号大牌弹出）+ SFX（引擎轰鸣渐强/冲线哨/胜队短号角）；引擎/结算零改动。
//     sprite 四车 = 蓝/红/金/绿涂装（资产无黑车，黑队用绿车 canvas 压暗滤镜代）。
// 无 push 项：大小/单双/红黑/三段/车队/直选各组划分对 1-24 无重叠无空隙
// （scratchpad/sg-exact.mjs 全空间枚举确认：每组命中概率和恰为 1）。

// —— 引擎常量块已剪切到 ./markets/speedgrid（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { RED, MARKETS, hitsOf, round2, drawCar, ODDS } from './markets/speedgrid'
import { roadWindow, roadSeedTarget } from './markets-ui/roadWindow'   // #47：列对齐滑动窗口（共用）
export { RED, drawCar, ODDS, MARKETS, hitsOf }

// 开奖动画总时长（收到 drawn → 冲线舞台演完 → 结算显示 + 回写余额）；须 < 服务器 idle(5s)
const DRAW_ANIM_MS = 4600
const G = GAME_BY_ID['SpeedGrid']

// 玩法说明文案已切至 ./markets-ui/speedgridRules（RULES import 回用，原页/多桌共享）。
// #47 定案（全端规则）：路珠【列对齐滑动窗口】，右端恒留 2 空列。
// 可用容量 = (30−2)×6 = 168；显示长度 L ≡ N (mod 6) 且 L ≤ 168，取最大 → 163–168 浮动。
const ROAD_CAP = 168

// #47 桌面路珠网格（模块级：进组件内会每渲染重建，带进 effect deps 会让首灌反复跑）
const DESK_ROAD = { cols: 30, rows: 6 }
const SEED_CHAMP = 17                   // 种子上局冠军（真开奖逐期顶掉）

// 4 队涂装(TEAMS/teamOf) 已切至 ./markets-ui/speedgridTeams（开奖区/盘口区同源）。
// 珠盘路页签/判定(SG_ROAD_TABS/SG_ROAD_LABELS/sgBeadFor) 已随墙件切至 ./markets-ui/SpeedGridRoad。

// 40 期假珠盘：存整局冠军车号(1-24，旧→新；真开奖逐期顶掉)，多视角一律从整值派生
const SEED_ROAD = [
  17, 5, 9, 20, 3, 14, 22, 8, 11, 18,
  15, 6, 19, 13, 4, 16, 7, 10, 21, 24,
  2, 23, 12, 1, 17, 9, 14, 20, 15, 6,
  5, 18, 11, 22, 8, 3, 19, 10, 16, 7,
]


export default function SpeedGrid({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 有右栏、中栏变窄 → 开奖区/盘区/珠盘/下注条同 maxWidth 居中，下注条与盘口板左右沿对齐；
  // 车队四键竖排(forceStack)由 SpeedGridMarkets 内建（接 hasRail prop）。门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  // #47 三批·对表硬指标：670→800。四区 maxWidth 全在 hasRail 分支内，手机(390)永不进 → 天然零感。
  const RAIL_MAXW = 800
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- #42 速度房骨架（单5 抽件）：双订阅 / 选中房 / per-room 注单 / A0 / D / tab 条 ----
  // 逐款不同的部分仍在本文件：路珠 roadByRoom、E 段追珠、A 段换期清盘、切房演出态清理
  // （见下方 handleRoomSwitch）、舞台 key 挂点。
  const {
    ROOMS, selectedRoomKey, roomsByKey, room, roomA, roomB,
    betsRef, betsOf, betsPlaced, setBetsPlaced, hasLast, lastBetsRef,
    shownRoundRef, animatedRoundRef, settleInfoRef,
    commitSettle, resetRoomView, renderRoomTabs } = useSpeedRooms({ G, playerToken, setServerBalance, pushToast })


  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [fairOpen, setFairOpen] = useState(false)   // 本期可验证公平抽屉（共享局 commit-reveal）
  const [historyOpen, setHistoryOpen] = useState(false)   // 开奖历史抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [animChamp, setAnimChamp] = useState(null)     // 当前开奖动画的冠军车号
  const [lastChamp, setLastChamp] = useState(SEED_CHAMP)
  // #42 路珠按房存：两房开的是完全不同的局，共用一条路 = 混流（珠子对不上期号）。
  // 各房的珠子来自各自 hook 的 drawResult 流 —— 选中房在动画演完时追加（保悬念，见 finishRound），
  // 未选中房在 drawResult 一到就追加（没有动画可等）。
  const [roadByRoom, setRoadByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_ROAD])))
  const road = roadByRoom[selectedRoomKey] ?? SEED_ROAD
  // #47 动效：仅 WS 真新珠时记新珠索引，【按房存】（单值会被后台快房覆盖）。
  const [freshByRoom, setFreshByRoom] = useState({})
  // #47 首帧闪变治理：播种未到货前手机珠墙只渲染骨架（本地珠/WS珠不先画），到货一次成墙。
  //   ⚠ 仅手机档门闩，桌面 history 恒 road【零碰已收】。语义含「播种流程终结（成功/失败兜底皆置 true）」。
  const [roadSeeded, setRoadSeeded] = useState(false)
  const EMPTY_ROAD = []
  const [roadTab, setRoadTab] = useState('BS')   // 珠盘路视角（手机/桌面共用一个 state）
  const [result, setResult] = useState(null)           // { champ, hits:Set, winTotal, perKeyOutcome }
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  // #47 新增：珠盘路整局记账去重（按期号），防「正好在开奖动画中进页」与播种重复上珠。
  const roadRecordedRef = useRef(null)
  const pendingRef = useRef(null)          // 只读表演：当前动画冠军车号（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])


  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。
  function finishRound(champ, rnd) {
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 余额回写（每期一次）：有注用后端 settleInfo.balanceAfter；无注不动钱。
    // 坑1 修正语义（add 收在 hadBet 内）已收进抽件的 commitSettle，此处只调用，勿再自行 add。
    commitSettle(rnd, si, hadBet)
    // 视觉结算仅当本期仍是当前展示期（若下一期 betting 已抢先，跳过不覆盖新期 UI）
    if (shownRoundRef.current !== rnd) return
    let hits, winTotal, perKeyOutcome = null
    if (hadBet) {
      perKeyOutcome = {}
      hits = new Set()
      ;(si.yourResult || []).forEach(r => { perKeyOutcome[r.key] = { outcome: r.outcome, payout: r.payout }; if (r.outcome !== 'lose') hits.add(r.key) })
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(champ); winTotal = 0
    }
    setLastChamp(champ)
    // #42：追进【选中房】自己的路（动画演完才追，保悬念）。存整值 champ → 多视角派生（判定走引擎）
    // #47：按期号去重 + 列对齐窗口 + 新珠弹入
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setRoadByRoom(m => {
        const next = roadWindow([...(m[selectedRoomKey] || SEED_ROAD), champ], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [selectedRoomKey]: next.length - 1 }))
        return { ...m, [selectedRoomKey]: next }
      })
    }
    setResult({ champ, hits, winTotal, perKeyOutcome })
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setUiPhase('settled')
  }

  // ---- 相位驱动 effects（全部只读 room，本地不产相位）----

  // A. 新一期 betting（【仅选中房】）：UI 清盘 → 回 betting。注单清理由抽件的 A0 按房处理。
  useEffect(() => {
    if (room.phase === 'betting' && room.roundNo && room.roundNo !== shownRoundRef.current) {
      shownRoundRef.current = room.roundNo
      picksRef.current = new Set(); setPicks(new Set())
      setBetsPlaced(new Map(betsOf(selectedRoomKey)))   // 与该房的暂存对齐（切房回来时也走这条）
      setResult(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.phase, room.roundNo])

  // A1. #42 切房：把 UI 拉到新房的当前态（注单显该房暂存、清掉上一房的开奖结果与动画）。
  // ⚠ 位置必须保持在 A 之后 —— 抽件不代管本 effect，正是为了保住这个顺序（见 hook 内注释）。
  // 舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  useEffect(() => {
    resetRoomView()   // 抽件：注单与该房暂存对齐 + shownRound/animatedRound 置空
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setAnimChamp(null); setNetErr(null)
    setUiPhase('betting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动冲线舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const champ = room.drawResult.n
      const rnd = room.roundNo
      pendingRef.current = champ
      setAnimChamp(champ)
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(champ, rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // E. #42 未选中房的路珠：drawResult 一到就追（无动画可等）。选中房在 finishRound 里追（保悬念）。
  const bgRoadRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgRoadRoundRef.current[r.key] === rm.roundNo) continue
      bgRoadRoundRef.current[r.key] = rm.roundNo
      const champ = rm.drawResult.n
      setRoadByRoom(m => {
        const next = roadWindow([...(m[r.key] || SEED_ROAD), champ], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [r.key]: next.length - 1 }))
        return { ...m, [r.key]: next }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

  // F. #47 三批 路珠真历史播种（双流版：本款 rooms 两枚，有 15s 快房）。
  //   ⚠ 生死线：本款 gameCard 桌手共用、roadByRoom 也是共享 state —— 播种会把手机路珠从
  //     「~40 颗种子珠」灌成满格真历史，珠数变了即违反「手机逐字节同基线」。故只在 hasRail 档播种。
  //   · 珠子存整值 champ，派生直取 drawResult.n，与 finishRound / E 段同口径。
  //   · 首灌按最新期号序号定相位；不是真新珠故不弹入。失败静默保留种子珠；只读，钱层零碰。
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })
  useEffect(() => {
    // #47 手机播种解禁：删 hasRail 门控 → 手机也拉真历史（桌面 hasRail=true 本就通过，零碰）
    let cancelled = false
    const PAGE = 50
    const SEED_TARGET = roadSeedTarget(DESK_ROAD)
    const PAGES = Math.ceil(SEED_TARGET / PAGE)
    const seedRoom = async (r) => {
      const qs = r.key === '15s' ? '&room=15s' : ''
      const acc = []
      let cursor = null
      for (let pg = 0; pg < PAGES && acc.length < SEED_TARGET; pg++) {
        const cs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        const d = await apiRef.current.apiGet(`/round/history/${G.backendId}?limit=${PAGE}${qs}${cs}`)
        const items = d?.items || []
        if (!items.length) break
        acc.push(...items)
        cursor = d?.nextCursor
        if (!cursor) break
      }
      if (cancelled || !acc.length) return
      const champs = acc.slice(0, SEED_TARGET).reverse()
        .map((it) => (it?.drawResult?.n != null ? it.drawResult.n : null))
        .filter((n) => n != null)
      if (!champs.length) return
      setRoadByRoom((m) => ({ ...m, [r.key]: roadWindow(champs, DESK_ROAD) }))
      setFreshByRoom((f) => ({ ...f, [r.key]: -1 }))
      if (r.key === selectedRoomKey) roadRecordedRef.current = acc[0]?.roundNo
      else bgRoadRoundRef.current[r.key] = acc[0]?.roundNo
    }
    Promise.all(ROOMS.map((r) => seedRoom(r).catch(() => { /* 静默：保留种子珠 */ })))
      .then(() => { if (!cancelled) setRoadSeeded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey, hasRail])

  const betting = room.phase === 'betting'
  const drawing = uiPhase === 'drawing'
  const settled = uiPhase === 'settled'

  const toggleSel = key => {
    if (!betting) return
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
    // 即时扣款模型：不能超过当前余额（服务端另有权威风控/余额校验兜底）
    if (serverBalance != null && total > serverBalance) { setNetErr('余额不足'); return false }
    setNetErr(null)
    try {
      // #42：带上当期 roundId 作【房凭证】—— 后端据它在该款所有房里定位当期 betting 房。
      // 不传的话一律落标准房（房化前的行为），快房的注就跑到 30s 房去了。
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
  function repeatBets() {
    placeAndPost(new Map(lastBetsRef.current))
  }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  const cur = animChamp
  const shownChamp = settled && cur ? cur : lastChamp

  // 盘口样式件(cellBase/cellName/cellRange/cellOdds/secHead/secBox/stakeChip/rowCell)
  // 已随盘口区切至 ./markets-ui/SpeedGridMarkets（键区单一出处）。

  // ---- 顶栏（共享件）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: DERBY.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: DERBY.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: DERBY.orange }
        : drawing
          ? { text: '冲线中…', c: DERBY.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{phaseChip.text}</span>
  )
  // #42 速度 tab 条（形态A，抽件渲染）：色值传本款 tokens，件内零硬编码主题色。
  const roomTabs = renderRoomTabs({ tokens: { sel: DERBY.sel, strip: DERBY.strip, dim: DERBY.dim, tabBorder: COLORS.borderLight, onSel: '#0d2016' }, isMobile })

  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} />
      {roomTabs}
      {/* #42：服务端 1008 拒房（?room= 认不出）——hook 已停重连，这里给出口，否则页面白等 */}
      {room.roomError === 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800 }}>该房不存在，请切回其它房</div>
      )}
      {/* 断线重连提示（hook 自动指数退避重连；恢复后 sync 补相位） */}
      {!room.connected && room.roundNo && room.roomError !== 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${DERBY.orange}`, borderRadius: 10,
          padding: '8px 16px', color: DERBY.orange, fontSize: 13, fontWeight: 800 }}>连接断开，正在重连…</div>
      )}
      {netErr && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800 }} onClick={() => setNetErr(null)}>{netErr}</div>
      )}
    </>
  )

  // ---- ① 开奖区：冠军大牌 + 24 车号小网格（4 队涂装分组）----
  const champTeam = teamOf(shownChamp)
  const zoneTitle = drawing ? '冲线中…' : settled ? '本局冠军' : '上局冠军'
  // #47 放大 ×1.2：桌面车号 24→29。⚠ drawZone 在【桌手共用的 gameCard】里 → hasRail 门控。
  const mini = isMobile ? 22 : hasRail ? 29 : isDesk ? 24 : 28
  // drawing+settled 挂冲线舞台（定格帧+彩带跨相位展示，照 Derby D4 先例；
  // 下一期 betting 换静态上局块时卸载归零）；betting 走静态块
  const drawZone = (drawing || settled) && cur ? (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      // #47 三批：补 hasRail 档 —— 外层包裹层已 800 宽，本卡侧边距不归零就内缩 18px
      //   （实测 L383/R1147/W764，比盘口窄 36px）。手机走 isMobile 分支，逐字节不变。
      margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '6px 8px' : '6px 12px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      boxSizing: 'border-box', overflow: 'hidden',
      // 手机三段锁死：两相位舞台同高常驻(锁顶不跳)；桌面原样
      ...(isDesk ? {} : { height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }) }}>
      <SpeedGridStage key={selectedRoomKey} phase={uiPhase} roundNo={room.roundNo} drawResult={{ n: cur }} muted={muted} height={128} />
    </div>
  ) : (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      // #47 三批：补 hasRail 档 —— 外层包裹层已 800 宽，本卡侧边距不归零就内缩 18px
      //   （实测 L383/R1147/W764，比盘口窄 36px）。手机走 isMobile 分支，逐字节不变。
      margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
      ...(isDesk ? {} : { height: 150, overflow: 'hidden' }) }}>
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
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{drawing ? '?' : shownChamp}</span>
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
                  boxSizing: 'border-box', opacity: lit ? 1 : 0.85 }}>{n}</span>
              )
            })}
            <span style={{ color: DERBY.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap', marginLeft: 2 }}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  )

  // ---- ② 盘区（主盘/三段+车队/直选）：已切至 ./markets-ui/SpeedGridMarkets（键区单一出处），下方 JSX 直接组装。----
  // ---- ③ 珠盘路：已切至 ./markets-ui/SpeedGridRoad（页签/判定单一出处），history=road 整值派生。----

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      height: '100%', boxSizing: 'border-box',   // 手机三段锁死：撑满 100dvh 根（桌面本就 100%，渲染不变）
    }}>
      <style>{`.sgCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {hasRail ? <div style={{ alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW, boxSizing: 'border-box' }}>{drawZone}</div> : drawZone}

      {/* ② 盘区（desk 主盘/三段并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: isDesk ? '0 1 auto' : '1 1 0', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : hasRail ? '4px 0' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处。hasRail 下发→车队四键竖排防裁 */}
        {/* #47 ⚠ 桌手共用 → big/stacked 只在 hasRail 档给 */}
        <SpeedGridMarkets big={hasRail} stacked={hasRail} onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits} isMobile={isMobile} isDesk={isDesk} hasRail={hasRail} />
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏（桌面用；手机三段锁死删掉让中区真滚到底） */}
      {isDesk && <div style={{ flex: '1 0 auto' }} />}

      {/* ③ 珠盘路（切件）：history=road 整值 → 组件内 roadTab 派生 大小/单双/红黑（判定走引擎） */}
      {/* #47 ⚠ gameCard 桌手共用 → 路珠三参必须 hasRail 门控，手机不传走件内默认 20×6/珠18 */}
      <SpeedGridRoad history={roadSeeded ? road : EMPTY_ROAD} tab={roadTab} onTab={setRoadTab} isMobile={isMobile}
        /* #47 A 案：手机也吃 30×6（与桌面同标），仅珠径按档 24/18 */
      cols={DESK_ROAD.cols} rows={DESK_ROAD.rows}
        bead={hasRail ? 24 : 18}
        /* #47 专单：本款 gameCard 桌手共用 —— slide 只给非 hasRail 面（手机/窄桌面），
           ≥1280 桌面面维持已收状态零碰（页面侧已窗口化，件内再开窗虽幂等，仍按铁律不传）。 */
        slide={!hasRail}
        freshIndex={hasRail ? (freshByRoom[selectedRoomKey] ?? -1) : -1}
        style={{ margin: isMobile ? '0 12px 8px' : hasRail ? '0 auto 8px' : '0 18px 8px',
          ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: hasRail ? '6px 0' : '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1 }}>
        <div style={{
          display: 'grid',
          /* #47 ⚠ 桌手共用 → 行高与钮列宽必须 hasRail 门控，手机保持 28px/92px */
          gridTemplateColumns: `minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) ${hasRail ? 110 : 92}px`,
          gridTemplateRows: `repeat(2, ${hasRail ? 34 : 28}px)`,
          gap: 6,
          maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto' }}>
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
              boxSizing: 'border-box' }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px',
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
            <input
              value={bet}
              disabled={!betting}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 14, fontWeight: 900 }}
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
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis' }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : settled ? '已结算' : '已锁盘'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets}
              disabled={!confirmOk}
              stretch
              size={hasRail ? 1.2 : 1}   /* #47 ⚠ 桌手共用 → 只在 hasRail 档放大 */
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Line Up ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg }}>
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

  // ---- 手机三段锁死（<1024）：100dvh 根锁死 + gameCard 撑满 ----
  return (
    <>
      <style>{`.sgMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="sgMobileRoot">{gameCard}</div>
    </>
  )
}
