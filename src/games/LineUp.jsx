import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
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
import LineUpStage from './stages/LineUpStage'
import LineUpMarkets from './markets-ui/LineUpMarkets'   // #41 单16：盘口区切件（视觉原样，A/B 视图内建）
import LineUpRoad from './markets-ui/LineUpRoad'         // #41 单16：珠盘路墙（判定走引擎 ROAD_VIEWS）
import { RULES } from './markets-ui/lineupRules'         // #41 单16：玩法说明（单一出处）
import { ROAD_VIEWS } from './markets-ui/lineupRoadViews'   // #41 单16：珠盘 3 视角判定（桌面墙件/手机内联共用）

// Line Up — ATOM 5×5 数字彩（25 个 0-9 独立均匀随机数排成五行），第 17 卡。
// X2：结算引擎 + 轮次状态机 + 赔率参数化。开奖舞台动画走后续单（静态直出）。
// X3：投注盘 A/B 双视图（A 维度列表 / B 矩阵，42 键同源同 key，选中态互通）
//     + 注栏 grid 4列×2行 + 重复投注；MARKETS/结算零改动。
// X4：drawing 相位开奖舞台（25 格乱序砸落 + 滚数快闪 + 行和/TOTAL 累加滚动
//     + TOTAL 砸出）+ SFX（落格 tick/行满短哨/终场哨）；引擎/结算零改动。
// X6：开奖区红黄牌皮 —— Red(0,2,6,7,8)=红牌 / Black(1,3,4,5,9)=黄牌（共享
//     card_red/card_yellow 资产），主色/客色文案改黄牌/红牌；MARKETS key/结算零改动
//     （home-more/away-more 等键名沿用，仅显示层换皮）。
// 规则对照 /tmp/atom_ref/atom_rules.txt（help.sbobet.com Atom Betting Rules #4303）原文：
//   Red  = "drawn at 0, 2, 6, 7 and 8, which are classified as Red"   → 本作红牌
//   Black = "drawn at 1, 3, 4, 5 and 9, which are classified as Black" → 本作黄牌
//   High/Low = 5-9 / 0-4；全局判定 ≥13 计数、行式判定 ≥3 计数
//   段位 = Spring[0-95] 7.50 / Summer[96-112] 2.30 / Autumn[113-129] 2.30 / Winter[130-225] 7.50
//     （足球叙事换皮：降级区/中游/欧战区/夺冠）
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（本彩种无 push 项：
// 25/5 为奇数计数无平局，225/45 为奇数和值无中点格）。

// —— 引擎常量块已剪切到 ./markets/lineup（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { AWAY_DIGITS, HIGH_DIGITS, drawGrid, deriveRound, ODDS, MARKETS, hitsOf, round2 } from './markets/lineup'
import { roadWindow, roadSeedTarget, freshFor, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT, roadAnchorLeft} from './markets-ui/roadWindow'   // #47：列对齐滑动窗口（共用）
export { AWAY_DIGITS, HIGH_DIGITS, drawGrid, deriveRound, ODDS, MARKETS, hitsOf }

// 舞台时间轴（rAF 内使用，毫秒）：乱序砸落 25 格 → TOTAL 放大砸出
// 开奖动画总时长（收到 drawn → 开奖舞台演完 → 结算显示 + 回写余额）；须 < 服务器 lineup idle(5.5s)
const EMPTY_ROAD = []   // #47 桌面门闩：播种未到货时喂它 → 桌面珠墙也渲骨架（模块级稳定引用）
const DRAW_ANIM_MS = 4500
const G = GAME_BY_ID['LineUp']

// 玩法说明文案(RULES) 已切至 ./markets-ui/lineupRules（原页 HowToPlay 与多桌卡共用，单一出处）。
// #47 定案（全端规则）：路珠【列对齐滑动窗口】，右端恒留 2 空列。
// 可用容量 = (30−2)×6 = 168；显示长度 L ≡ N (mod 6) 且 L ≤ 168，取最大 → 163–168 浮动。
const ROAD_CAP = 168

// #47 桌面路珠网格（模块级：进组件内会每渲染重建，带进 effect deps 会让首灌反复跑）
const DESK_ROAD = { cols: 30, rows: 6 }

// ⚠ 手机段专用容量：桌面 CAP 改动不得影响手机 —— 本款手机内联珠格走 road.slice(-CAP)，
//   从切片【头部】取格，CAP 一变手机显示的珠子整体前移。钉回原值 120。
const MOBILE_ROAD_CAP = 120

// 种子上局（取自参考规则页 ATOM 25's 实拍局：行和 12/18/10/22/28，总和 90；
// 真开奖逐期顶掉）
const SEED_LAST = deriveRound([
  2, 6, 3, 1, 0,
  6, 0, 6, 1, 5,
  2, 0, 1, 7, 0,
  1, 6, 4, 9, 2,
  7, 4, 6, 6, 5,
])

// 40 期假珠盘（大小单轨，旧→新；真开奖逐期顶掉）
// 珠盘路种子：整局总和 total 形态（0-225，跨段位/大小/单双分布，首屏各视角有料）。
const SEED_ROAD = [
  90, 118, 135, 105, 88, 122, 100, 145, 92, 115,
  108, 130, 96, 125, 85, 112, 140, 99, 113, 128,
  94, 120, 106, 132,
]

// 珠盘路 3 视角(ROAD_VIEWS，road 现存整局 total 派生；段位复用 MARKETS zone-* 实值 hit，禁二份表)
// 已切至 ./markets-ui/lineupRoadViews（桌面墙件 LineUpRoad 与手机内联路珠共用，单一出处）。
// 普通盘四区(ZONES) 已随盘口区切至 ./markets-ui/LineUpMarkets。

// ---------- 开奖舞台（drawing 相位；结果进相前已全锁定，动画只读）----------
// 落格乱序从已锁结果派生（mulberry32 播种 + Fisher-Yates）——零额外随机数消耗，


export default function LineUp({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 有右栏、中栏变窄 → 开奖区/盘区/珠盘/下注条同 maxWidth 居中，下注条与盘口板左右沿对齐。门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  // #47 终批·四区对表硬指标：670→800。四区 maxWidth 全在 hasRail 分支内，手机永不进 → 天然零感。
  const RAIL_MAXW = 800
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  // ---- #42 速度房骨架（单6 原生接入）：双订阅 / 选中房 / per-room 注单 / A0 / D / tab 条 ----
  // 逐款不同的部分仍在本文件：上局派生局 lastRound / 珠盘路 road（存 r.total）两份 xxxByRoom、E 段追两份、A 段换期清盘、切房演出态清理（见 A1）、舞台 key。
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
  // 投注盘 A/B 视图 + 维度 dim 态已随盘口区切至 LineUpMarkets（组件内部 UI 态）
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [animRound, setAnimRound] = useState(null)       // 当前开奖动画的派生局（deriveRound 结果）
  // #42 两份「按期累积」状态按房存：两房开的是完全不同的局，共用即串流。
  //   · lastRound 上局派生局 → 喂舞台的 lastRound prop（betting 期待命展示）
  //   · road      珠盘路 → 喂路珠墙
  const [lastRoundByRoom, setLastRoundByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_LAST])))
  const [roadByRoom, setRoadByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_ROAD])))
  const lastRound = lastRoundByRoom[selectedRoomKey] ?? SEED_LAST
  const road = roadByRoom[selectedRoomKey] ?? SEED_ROAD
  // #47 动效：仅 WS 真新珠时记新珠索引，【按房存】—— 单值会被后台快房的追珠覆盖。
  // #47 首帧闪变治理：播种未到货前不渲染珠墙（骨架占位，几何不变），到货后一次成型。
  //   实测根因：先渲染 SEED_ROAD 假种子珠(24/30颗=4~5列)，~450ms 后播种到货跳到 70+颗(12~13列)，
  //   视觉即「闪一下、几列变多列」。网格行列/珠径全程未变(6×30×18 恒定)，非重排、非锚定跳。
  //   ⚠ 语义是「播种流程已结束（含被门控跳过）」——否则不播种的场景会永远卡骨架。
  const [roadSeeded, setRoadSeeded] = useState(false)
  const [freshByRoom, setFreshByRoom] = useState({})
  const [roadView, setRoadView] = useState('bs')         // 手机/桌面共用路珠视角（默认大小）
  const roadRecordedRef = useRef(null)                   // 珠盘路整局记账去重（按 rnd，防 StrictMode 双调用）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生局（铁律不变）
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

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费；无 push 项）。
  function finishRound(rnd) {
    const r = pendingRef.current
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 余额回写（每期一次）：有注用后端 settleInfo.balanceAfter；无注不动钱。
    // 坑1 修正语义（add 收在 hadBet 内）在抽件的 commitSettle 里，此处只调用，勿再自行 add。
    commitSettle(rnd, si, hadBet)
    // 视觉结算仅当本期仍是当前展示期（若下一期 betting 已抢先，跳过不覆盖新期 UI）
    if (shownRoundRef.current !== rnd) return
    let hits, winTotal
    if (hadBet) {
      hits = new Set((si.yourResult || []).filter(o => o.outcome !== 'lose').map(o => o.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(r); winTotal = 0
    }
    // #42：两份累积写进【选中房】自己的槽（动画演完才写，保悬念）
    setLastRoundByRoom(m => ({ ...m, [selectedRoomKey]: r }))
    // 珠盘路改存整局 total（3 视角从 total 派生）；按 rnd 去重，一局恰记一次（StrictMode 防重）
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setRoadByRoom(m => {
        const next = roadWindow([...(m[selectedRoomKey] || SEED_ROAD), r.total], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [selectedRoomKey]: next.length - 1 }))   // WS 真新珠 → 弹入
        return { ...m, [selectedRoomKey]: next }
      })
    }
    setResult({ hits, winTotal })
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

  // A1. #42 切房：把 UI 拉到新房的当前态。
  // ⚠ 位置必须在 A 之后 —— 抽件不代管本 effect，正是为了保住这个顺序（见 useSpeedRooms 注释）。
  // 舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  // 切房时本款要清的：picks / 结算结果 / 当前动画派生局 animRound / 错误条 /
  // 上一房的派生局对象 / 回 betting UI。（本款无 preHits——该状态五行才有。）
  useEffect(() => {
    resetRoomView()   // 抽件：注单与该房暂存对齐 + shownRound/animatedRound 置空
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setNetErr(null)
    setAnimRound(null)
    pendingRef.current = null
    setUiPhase('betting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动开奖舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      const derived = deriveRound(room.drawResult.grid)   // ← 后端 25 位（行和/总和/段位按后端算，不本地 drawGrid）
      pendingRef.current = derived
      setAnimRound(derived)
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // E. #42 未选中房的两份累积：drawResult 一到就追（无动画可等）。选中房在 finishRound 里追。
  // ⚠ 本款 drawResult 字段是 .grid，派生走 deriveRound；珠子取 r.total。
  const bgDrawRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgDrawRoundRef.current[r.key] === rm.roundNo) continue
      bgDrawRoundRef.current[r.key] = rm.roundNo
      const d = deriveRound(rm.drawResult.grid)
      setLastRoundByRoom(m => ({ ...m, [r.key]: d }))
      setRoadByRoom(m => {
        const next = roadWindow([...(m[r.key] || SEED_ROAD), d.total], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [r.key]: next.length - 1 }))
        return { ...m, [r.key]: next }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

  // F. #47 终批 路珠真历史播种（双流版：本款 registry rooms 两枚，有 15s 快房）。
  //   · 两房各拉各的：?room=15s 是现成分流参（不传=标准房），与右栏「近期开奖」同端点同 apiGet。
  //   · 后端 limit 夹在 50（round.js 的 Math.min(50,...)），单请求拿不满 174 → 走现成 cursor 分页，4 页封顶。
  //   · 派生复用 deriveRound(grid).total，与 finishRound / E 段同一函数，禁二份表；接口新→旧、路珠旧→新故 reverse。
  //   · 与 WS 增量珠去重：灌完把该房最新期号写进已有的两个去重 ref（选中房 roadRecordedRef、
  //     未选中房 bgDrawRoundRef[key]），后续 WS 追同一期自然跳过，WS 那侧一行不改。
  //   · 失败静默保留种子珠；只读，钱层零碰。
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })
  useEffect(() => {
    let cancelled = false
    // #47 手机播种解禁：「手机无播种」是批铺时代的旧铁律，随本单废止 —— 手机升 20×6 高墙后
    //   108 格靠本地攒太空，进页即拉真历史灌窗口（与桌面同一条 /round/history 链路、按当前房）。
    //   ⚠ 桌面行为不变：原门控只是「非 hasRail 不跑」，去掉后桌面照跑，多出来的是手机/窄桌面也跑。
    const PAGE = 50
    const SEED_TARGET = roadSeedTarget(DESK_ROAD)   // #47：比 usable 多一整列，保证当前列半满
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
      const totals = acc.slice(0, SEED_TARGET).reverse()   // 素材（新→旧转旧→新）
        .map((it) => (it?.drawResult?.grid ? deriveRound(it.drawResult.grid).total : null))
        .filter((n) => Number.isFinite(n))
      if (!totals.length) return
      // #47：首灌【不预截】—— 直接把拉回的完整条数过窗口，当前列才天然半满；
      //   且首灌不是「真新珠」，freshIndex 置 -1，避免一次灌 160+ 颗整屏爆闪。
      setRoadByRoom((m) => ({ ...m, [r.key]: roadWindow(totals, DESK_ROAD) }))
      setFreshByRoom((f) => ({ ...f, [r.key]: -1 }))
      const latest = acc[0]?.roundNo
      if (latest) {
        if (r.key === selectedRoomKey) roadRecordedRef.current = latest
        else bgDrawRoundRef.current[r.key] = latest
      }
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
    if (!betting) return   // 非 betting 全盘锁死
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
  function repeatBets() {
    placeAndPost(new Map(lastBetsRef.current))
  }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  const cur = animRound
  const shown = settled && cur ? cur : lastRound   // 开奖区当前展示局

  // ---- 盘口样式件(cellBase/cellName/…/stakeChip) 已随盘口区切至 LineUpMarkets（键区单一出处）----

  // ---- 相位 chip（原样式传入 GameTopBar；场馆行并入顶栏）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: DERBY.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: DERBY.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: DERBY.orange }
        : drawing
          ? { text: '开奖中…', c: DERBY.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto' }}>{phaseChip.text}</span>
  )
  // #42 速度 tab 条（形态A，抽件渲染）：色值传本款 tokens（两款共用 DERBY，同 SpeedGrid）。
  const roomTabs = renderRoomTabs({ tokens: { sel: DERBY.sel, strip: DERBY.strip, dim: DERBY.dim, tabBorder: COLORS.borderLight, onSel: '#0d2016' }, isMobile })

  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0}
        venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode}
        onBack={onBack}
        onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)}
      />
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

  const drawZone = (
    <LineUpStage key={selectedRoomKey} phase={drawing ? 'drawn' : settled ? 'settled' : 'betting'} roundNo={room.roundNo}
      drawResult={cur ? { grid: cur.cells } : null} lastRound={shown} muted={muted}
      style={{ flex: '0 0 auto', zIndex: 1, margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />
  )

  // ---- ② 盘区：A 列表 / B 矩阵 双视图 —— 已切至 ./markets-ui/LineUpMarkets（键区单一出处，A/B 视图+维度内建）。
  // 组装 <LineUpMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting} selected={picks} hits={result?.hits} isMobile />

  // ---- ③ 珠盘路（大小单轨）：桌面墙件已切至 ./markets-ui/LineUpRoad（判定走 ROAD_VIEWS，禁二份表）；
  // 手机三段锁死的内联 2 行路珠仍留在下方 mobileCard（分毫不变，同读 ROAD_VIEWS/curView）。----
  // #47 双端一致·A 案：手机路珠列数升到与桌面同标 30（6 行已同）→ 与桌面吃同一段窗口，逐颗对得上
  const ROAD_COLS = 30
  // #47 专单：手机内联珠格改吃列对齐滑动窗口（按手机自己的 20×2 开窗，可用 (20−2)×2 = 36 珠）。
  //   ⚠ 几何零碰：珠径/格数/盒尺寸一字未动，只改「填几颗」；有珠数落 35–36 浮动区即达标。
  const beads = roadWindow(road, { cols: ROAD_COLS, rows: 6 })
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, beads.length, 18 + 2) }, [beads.length])
  // #47 专单：动效手机也上（fresh 索引按各面窗口长度换算）
  const mobFresh = freshFor(freshByRoom[selectedRoomKey] ?? -1, road.length, beads.length)
  const curView = ROAD_VIEWS.find(v => v.key === roadView) || ROAD_VIEWS[0]   // 路珠视角（手机/桌面共用 roadView，切了两端一致）

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}) }}>
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件：名 pill 下拉 + 场馆/期号/相位 + ?/音频钮）---- */}
      {topBar}

      {/* ① 开奖区（顶部）：5×5 号码牌 + 统计带 */}
      {drawZone}

      {/* ② 盘区（中部，单一盘区 A/B 双视图；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : hasRail ? '4px 0' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }}>
        <WinToast toasts={toasts} />
        {/* #47 ⚠ A 豁免：A/B 双视图布局一字不动，big 只放大键内字号/内距 */}
        <LineUpMarkets big={hasRail} onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits} isMobile={isMobile} />
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，大小单轨）：切件 history=road 整值 total → 组件内 ROAD_VIEWS 派生 */}
      <LineUpRoad history={roadSeeded ? road : EMPTY_ROAD} tab={roadView} onTab={setRoadView} isMobile={isMobile}
        cols={DESK_ROAD.cols} rows={DESK_ROAD.rows} bead={24}
        freshIndex={freshByRoom[selectedRoomKey] ?? -1}
        style={{ margin: isMobile ? '0 12px 8px' : hasRail ? '0 auto 8px' : '0 18px 8px',
          ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行：
           列1-2 面额四格（10/100 上、50/500 下）｜列3 Bet USD 上/重复钮下｜列4 下注大方钮跨两行 ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: hasRail ? '6px 0' : '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1 }}>
        <div style={{
          display: 'grid',
          /* #47 ⚠ 本款 gameCard/mobileCard 分挂，此段在 gameCard 内；仍按 hasRail 门控保稳 */
          gridTemplateColumns: `minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) ${hasRail ? 110 : 92}px`,
          gridTemplateRows: `repeat(2, ${hasRail ? 34 : 28}px)`,
          gap: 6,
          maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto' }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="luChip" disabled={!betting} onClick={() => setBet(v)} style={{
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

  // ============ 手机三段式（<1024，照德比模板）：锁顶(顶栏+舞台) / 中滚(单板整块不折叠) / 锁底(路珠3视角+注栏) ============
  // LineUp 盘区是单一 marketSection（内置 A/B 视图），无多段可分 → 不套手风琴，单板整块进中滚。钱路零改。
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ① 锁顶：GameTopBar + 舞台 drawZone（非弹性自成块，canvas 常驻不折叠不卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {drawZone}
      </div>

      {/* ② 中滚：单板 marketSection 整块（含 A/B 视图，不折叠） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        <LineUpMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits} isMobile={isMobile} />
      </div>

      {/* ③ 锁底：路珠(3视角 pill 大小/单双/段位 + 珠压 2 行,从 total 派生) + 注栏 */}
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ padding: '4px 12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }}>
            {ROAD_VIEWS.map(v => {
              const on = roadView === v.key
              return (
                <button key={v.key} type="button" onClick={() => setRoadView(v.key)} style={{
                  flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 10px', borderRadius: RADIUS.pill,
                  background: on ? DERBY.sel : 'rgba(0,0,0,0.35)', color: on ? '#083a1b' : DERBY.dim,
                  border: `1px solid ${on ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
                  fontSize: 10, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer' }}>{v.label}</button>
              )
            })}
          </div>
          {/* #47 A 案：30×6 珠18，598 > 390 → 横滑，右端锚定最新珠 */}
          <div ref={roadScrollRef} style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <style>{ROAD_FX_CSS}</style>{/* #47 专单：手机动效同一份 CSS */}
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
                // #47 首帧闪变：播种未到货 → 珠位留空（骨架），几何不变，到货后一次成型
                const n = roadSeeded ? beads[i] : undefined
                const d = n != null ? curView.judge(n) : null
                // #47 专单：手机也上弹入/游标动效（同一份 CSS）
                // #47 骨架期纯静态：播种未到货一律无游标/弹入（roadSeeded 前置）
                const cls = !roadSeeded ? undefined : i === mobFresh ? ROAD_FX_FRESH : (n == null && i === beads.length ? ROAD_FX_NEXT : undefined)
                return (
                  <span key={i} className={cls} style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: d ? d.c : 'rgba(255,255,255,0.05)',
                    border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: 9, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{d ? d.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 12px', background: DERBY.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
            gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto' }}>
            {[
              { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
              { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
            ].map(({ v, col, row }) => (
              <button key={v} type="button" className="luChip" disabled={!betting} onClick={() => setBet(v)} style={{
                gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
                fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
                background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
                border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
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
              color: repeatOk ? DERBY.text : DERBY.dim, background: 'rgba(0,0,0,0.35)',
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Derby Day ----
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
            {/* 场馆行已并入 GameTopBar，骨架历史行位撤除 */}
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- 手机三段锁死（<1024）----
  return (
    <>
      <style>{`.luMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="luMobileRoot">{mobileCard}</div>
    </>
  )
}
