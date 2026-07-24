import { useState, useRef, useEffect } from 'react'
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
import { useSpeedRooms } from '../hooks/useSpeedRooms'
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
import { roadWindow, roundSeqNo, roadSeedTarget } from './markets-ui/roadWindow'   // #47：列对齐滑动窗口（共用）
export { drawRace, deriveRace, ODDS, MARKETS, hitsOf }

// ---------- 冲刺舞台时间轴（rAF 内使用，毫秒）：----------
// 冠军冲线 = START + BASE ≈ 5.3s，之后每名次 +160ms（第10名 ~6.74s），余下定格
// 开奖动画总时长（收到 drawn → 冲刺舞台演完 → 结算 + 回写余额）；须 < 服务器 goldenboot idle(9s)
const DRAW_ANIM_MS = 8000
const G = GAME_BY_ID['GoldenBoot']

// #47 定案（全端规则）：路珠【列对齐滑动窗口】，右端恒留 2 空列。
// 可用容量 = (30−2)×6 = 168；显示长度 L ≡ N (mod 6) 且 L ≤ 168，取最大 → 163–168 浮动。
const ROAD_CAP = 168

// #47 桌面路珠网格（模块级：进组件内会每渲染重建，带进 effect deps 会让首灌反复跑）
const DESK_ROAD = { cols: 30, rows: 6 }

// ⚠ 本款【无 mobileCard，整张 gameCard 桌手共用】—— 桌面容量改动绝不能漏到手机。
//   手机路珠走件内默认 20×6，容量由 cols×rows 决定，不吃本常量；此处仍留独立常量作显式边界。
const MOBILE_ROAD_CAP = 120

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
  // #B3 刀2·裁定：subRow 插槽在 1280 档是 GameTopBar 物理宽（实测 75px，铁律不破/不换行/不缩噪点车图）。
  //   窄档(1280–1439)走 inline 形态（多桌验过的现成货）：冠亚必显、季军放不下则 ellipsis 隐没
  //   —— 同「场馆名窄档护钮隐没=预期」7-17 判例（顶栏是速览位，前三全貌开奖区本有）。
  //   ≥1440 中栏够宽 → default 大车（主力档视觉品质优先，窄了隐没季军=B3 判例），不误伤；<1280(无右栏/手机)中栏宽也走 default。
  const narrowSubRow = useMediaQuery('(min-width: 1280px) and (max-width: 1439px)')
  // #47 三批·对表硬指标：660→800。四区的 maxWidth 全在 hasRail 分支内，手机(390)永不进 → 天然零感。
  const RAIL_MAXW = 800
  // desk mode narrows the card by the 340px feed — below 1200px viewport the
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- #42 速度房骨架（单5 抽件）：双订阅 / 选中房 / per-room 注单 / A0 / D / tab 条 ----
  // 逐款不同的部分仍在本文件：上局名次/路珠 两份 xxxByRoom、E 段追两份、A 段换期清盘、切房演出态清理（见下方 handleRoomSwitch）、舞台 key 挂点。
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
  // #47 动效：仅 WS 真新珠时记新珠索引，【按房存】（单值会被后台快房覆盖）。
  const [freshByRoom, setFreshByRoom] = useState({})
  // #47 首帧闪变治理：播种未到货前手机珠墙只渲染骨架（本地珠/WS珠不先画），到货一次成墙。
  //   ⚠ 仅手机档门闩，桌面 history 恒 road【零碰已收】。语义含「播种流程终结（成功/失败兜底皆置 true）」。
  const [roadSeeded, setRoadSeeded] = useState(false)
  const EMPTY_ROAD = []
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

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  // #47 新增：珠盘路整局记账去重（按期号）。接了历史播种后必须显式去重
  //   （玩家正好在开奖动画中进页时 history 已含该期，动画结束会再追一次 = 重复上珠）。
  const roadRecordedRef = useRef(null)
  const roadPhaseRef = useRef({})   // #Ray 手机路珠相位·按房自持（首灌锚真实序号，live +1，跨零点连续）
  const pendingRef = useRef(null)          // 只读表演：当前动画名次（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const cardShakeRef = useRef(null)

  useEffect(() => { betRef.current = bet }, [bet])
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
    // 坑1 修正语义（add 收在 hadBet 内）已收进抽件的 commitSettle，此处只调用，勿再自行 add。
    commitSettle(rnd, si, hadBet)
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
    // #47：按期号去重（防与历史播种重复上珠）+ 列对齐窗口 + 新珠弹入
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      roadPhaseRef.current[selectedRoomKey] = (roadPhaseRef.current[selectedRoomKey] ?? ((roundSeqNo(rnd) ?? 1) - 1)) + 1   // #Ray 相位自持 +1
      setHistoryByRoom(m => {
        const next = roadWindow([...(m[selectedRoomKey] || SEED_HISTORY), { winner: r.winner, sum: r.sprintSum }], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [selectedRoomKey]: next.length - 1 }))
        return { ...m, [selectedRoomKey]: next }
      })
    }
    setResult({ hits, winTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setUiPhase('settled')
  }

  // ---- 相位驱动 effects（全部只读 room，本地不产相位）----
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

  // A1. #42 切房：把 UI 拉到新房的当前态（注单显该房暂存、清掉上一房的开奖结果与动画）。
  // ⚠ 位置必须保持在 A 之后 —— 抽件不代管本 effect，正是为了保住这个顺序（见 hook 内注释）。
  // 舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  useEffect(() => {
    resetRoomView()   // 抽件：注单与该房暂存对齐 + shownRound/animatedRound 置空
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setPreHits(null); setNetErr(null)
    pendingRef.current = null          // 断开上一房的名次对象（舞台三元据它判分支）
    setUiPhase('betting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setHistoryByRoom(m => {
        const next = roadWindow([...(m[r.key] || SEED_HISTORY), { winner: race.winner, sum: race.sprintSum }], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [r.key]: next.length - 1 }))
        return { ...m, [r.key]: next }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

  // F. #47 三批 路珠真历史播种（双流版：本款 registry rooms 两枚，有 15s 快房）。
  //   · 两房各拉各的（?room=15s 现成分流参）；后端 limit 夹在 50 → 走现成 cursor 分页。
  //   · 珠子存 {winner, sum}，派生走 deriveRace(ranking)，与 finishRound / E 段同口径。
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
      const rows = acc.slice(0, SEED_TARGET).reverse()
        .map((it) => (Array.isArray(it?.drawResult?.ranking)
          ? (() => { const d = deriveRace(it.drawResult.ranking); return { winner: d.winner, sum: d.sprintSum } })() : null))
        .filter(Boolean)
      if (!rows.length) return
      setHistoryByRoom((m) => ({ ...m, [r.key]: roadWindow(rows, DESK_ROAD) }))
      setFreshByRoom((f) => ({ ...f, [r.key]: -1 }))
      roadPhaseRef.current[r.key] = roundSeqNo(acc[0]?.roundNo)   // #Ray 相位锚：首灌对齐真实当日序号
      if (r.key === selectedRoomKey) roadRecordedRef.current = acc[0]?.roundNo
      else bgDrawRoundRef.current[r.key] = acc[0]?.roundNo
    }
    Promise.all(ROOMS.map((r) => seedRoom(r).catch(() => { /* 静默：保留种子珠 */ })))
      .then(() => { if (!cancelled) setRoadSeeded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey, hasRail])

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
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{phaseChip.text}</span>
  )
  const subRowNode = <GoldenBootPodium order={lastRace.order} isMobile={isMobile} inline={narrowSubRow} />   // 上局前三名信息条（切件）
  // #42 速度 tab 条（形态A，抽件渲染）：色值传本款 tokens，件内零硬编码主题色。
  const roomTabs = renderRoomTabs({ tokens: { sel: GOLDENBOOT.sel, strip: GOLDENBOOT.strip, dim: GOLDENBOOT.dim }, isMobile })

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
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800 }}>该房不存在，请切回其它房</div>
      )}
      {!room.connected && room.roundNo && room.roomError !== 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${GOLDENBOOT.orange}`, borderRadius: 10,
          padding: '8px 16px', color: GOLDENBOOT.orange, fontSize: 13, fontWeight: 800 }}>连接断开，正在重连…</div>
      )}
      {netErr && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,10,14,0.95)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: 10,
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800 }} onClick={() => setNetErr(null)}>{netErr}</div>
      )}
    </>
  )

  // ---- 珠盘路（切件；真历史滚动，容量 6×20）----
  const beadRoad = (
    <GoldenBootRoad history={roadSeeded ? history : EMPTY_ROAD} tab={roadTab} onTab={setRoadTab} isMobile={isMobile} fitWidth={isMobile} phaseN={isMobile ? roadPhaseRef.current[selectedRoomKey] : undefined}
      /* #47 ⚠ 本款 gameCard 桌手共用 → 路珠三个尺寸参数必须 hasRail 门控；
         手机不传（undefined）走件内默认 20×6/珠18，与基线逐字节相同。 */
      /* #47 A 案：手机也吃 30×6（与桌面同标），仅珠径按档 24/18 */
      cols={DESK_ROAD.cols} rows={DESK_ROAD.rows}
      bead={hasRail ? 24 : 18}
      /* #47 专单：本款 gameCard 桌手共用 —— slide 只给非 hasRail 面（手机/窄桌面），
         ≥1280 桌面面维持已收状态零碰（页面侧已窗口化，件内再开窗虽幂等，仍按铁律不传）。 */
      slide={!hasRail}
      freshIndex={hasRail ? (freshByRoom[selectedRoomKey] ?? -1) : -1}
      style={{ margin: isMobile ? '0 12px 10px' : hasRail ? '0 auto 12px' : '0 18px 12px',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />
  )

  // ---- 开奖区（常驻顶部）：RACING/SETTLED 冲刺舞台 / BETTING 上期名次静态待命 ----
  // #47 放大 ×1.2：桌面开奖台 178→214。⚠ 本款 stageZone 在【桌手共用的 gameCard】里，
  //   必须 hasRail 门控（不用 isDesk：1024–1280 无右栏档也不该跟着放）。
  const stageH = isMobile ? 150 : hasRail ? 214 : 178
  const stageZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0',
      ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', minHeight: stageH }}>
      {(racing || settled) && pendingRef.current ? (
        <GoldenBootStage key={selectedRoomKey} phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ ranking: pendingRef.current.order }}
          height={stageH} muted={muted}
          shakeRef={cardShakeRef} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
      ) : (
        // BETTING 待命：赛车停起跑线（与冲刺舞台同套赛车视觉）+ 红绿灯红灯待发
        <div style={{
          height: stageH, position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, #252932, #15181f)' }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <div key={n} style={{
              position: 'absolute', left: 0, right: 0, top: `${(n - 1) * 10}%`, height: '10%',
              borderBottom: n < 10 ? '1px dashed rgba(255,255,255,0.15)' : 'none',
              display: 'flex', alignItems: 'center', gap: 5, paddingLeft: isMobile ? 8 : 14 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: 900, width: 9, textAlign: 'right' }}>{n}</span>
              <img src={CAR_SRC[n]} alt={`car ${n}`} style={{ height: `${stageH / 10 * 0.82}px`, width: 'auto', display: 'block' }} />
            </div>
          ))}
          {/* 起跑线 */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: isMobile ? 30 : 40, width: 2, background: 'rgba(255,255,255,0.45)' }} />
          {/* 红绿灯（红灯待发，居中）*/}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, pointerEvents: 'none' }}>
            <img src={trafficLightImg} alt="traffic light" style={{
              height: stageH * 0.58, width: 'auto', display: 'block',
              filter: 'drop-shadow(0 0 10px rgba(255,60,40,0.75))' }} />
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
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处 */}
        {/* #47 ⚠ 桌手共用 → big 只在 hasRail 档给，手机与窄桌面不传 */}
        <GoldenBootMarkets big={hasRail} onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits ?? preHits} isMobile={isMobile} />

      </div>

      {isDesk && <div style={{ flex: '1 0 auto' }} />}

      {/* ---- ③ 珠盘路（常驻底部）---- */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（抄 LineUp/DominoDuel）---- */}
      <div style={{
        flex: '0 0 auto', padding: hasRail ? '6px 0' : '6px 12px', background: GOLDENBOOT.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
        <div style={{
          /* #47 ⚠ 桌手共用 → 行高与钮列宽必须 hasRail 门控，手机保持 28px/92px 逐字节不变 */
          display: 'grid', gridTemplateColumns: `minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) ${hasRail ? 110 : 92}px`,
          gridTemplateRows: `repeat(2, ${hasRail ? 34 : 28}px)`, gap: 6, maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto' }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="gbChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? GOLDENBOOT.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? GOLDENBOOT.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6, boxSizing: 'border-box' }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0 }}>
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
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis' }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : racing ? '冲刺中…' : '本期已结算'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Half Time ----
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
