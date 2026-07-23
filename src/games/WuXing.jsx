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
import WuXingStage from './stages/WuXingStage'
import WuXingMarkets from './markets-ui/WuXingMarkets'   // #41 单16：盘口区切件（视觉原样）
import WuXingRoad from './markets-ui/WuXingRoad'
import { roadWindow, roadWindowAt, roadSeedTarget, roundSeq , freshFor, roadAnchorLeft, ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT} from './markets-ui/roadWindow'   // #47：列对齐滑动窗口（三款共用）         // #41 单16：珠盘路墙（判定走引擎）
import { RULES } from './markets-ui/wuxingRules'         // #41 单16：玩法说明内容（共享）
import { WUXING, ROAD_VIEWS } from './markets-ui/wuxingShared'   // #41 单16：五行五段/珠盘视角（原页 mobile 段 + 切件同源）

// 五行 WuXing — KENO 20 球快开五项皮（80 池无放回抽 20 比总和），第 19 卡。
// X2：结算引擎 + 轮次状态机 + 赔率定稿（官方原生赔率 14 键出带 → 单据逐档调价，
//     1e6 复验 19 键全数入 94-97.5% 带，见 ODDS 注释）。
// X3：drawing 相位开奖舞台（20 球乱序快闪依次亮 + 总和/上下累加 + 分界慢放 +
//     总和砸出 + 五行段预亮）+ SFX（落球 tick/亮灯短哨/终场哨）；引擎/结算零改动。
// 算钱路径（#43 接排期器）：placeAndPost() 唯一扣注入口（betting 内即时 POST 挂当期），
//   finishRound() 唯一赔付点（读服务器 settleInfo；余额落定才跳）。相位/期号/倒计时全走 useRoundRoom。
// push 项：无——大小按官方 ≥811/≤810 对 210-1410 无重叠无空隙；龙虎/上下为三向盘
// （和 = 独立定价键，龙/虎/上/下遇和判输，官方无退注条款）；和局概率单列：
// 龙虎和 p≈0.1001、上下和 p≈0.2033（1e7）。
// 规则源（help.sbobet.com Keno Betting Rules #4304 原文转录，2026-07-06 实查）：
//   大 = 总和 ≥811 @1.95 / 小 = ≤810 @1.95；单双 @1.95
//   龙 = 总和右起第 2 位数字 @1.95 / 虎 = 末位数字 @1.95 / 龙虎和（两位相等）@9.00
//   上 = 1-40 号计数 >10 @2.30 / 下 = 41-80 计数 >10 @2.30 / 上下和（10-10）@4.30
//   过关四组合 大单/大双/小单/小双 @3.70
//   五行 金[210-695]9.20 / 木[696-763]4.60 / 水[764-855]2.40 / 火[856-923]4.60 / 土[924-1410]9.20
// 布局照 Line Up 定案：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底（grid 4列×2行）。

// —— 引擎常量块已剪切到 ./markets/wuxing（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { drawKeno, deriveRound, hitsOf, round2, ODDS, MARKETS } from './markets/wuxing'
export { drawKeno, deriveRound, ODDS, MARKETS, hitsOf }

// ---------- 轮次常量 ----------
// 相位/期号/倒计时全走服务器排期器（useRoundRoom）；本地只保留开奖舞台动画时长。
const EMPTY_ROAD = []   // #47 桌面门闩：播种未到货时喂它 → 桌面珠墙也渲骨架（模块级稳定引用）
const DRAW_ANIM_MS = 4500   // 收到 drawn → 开奖舞台演完 → 结算回写；须 < 服务器 wuxing idle(5500ms)
// #47 定案（全端规则）：【路珠不填满，右端恒留空最后两列】。
// 数据上限 = (列数 − 2) × 行数 —— 桌面 30 列 × 6 行 → (30−2)×6 = 168 颗。
// 网格仍渲染 30×6=180 格，只喂 168 颗；珠按列优先填充，故恒定占满第 1–28 列、
// 第 29–30 列常空，新珠永远落在空区左缘。⚠ 改列数/行数时必须同步改本值。
// 本常量各款私有（另 6 款各有自己的一份同名常量、互不引用），改这里只影响本款。
const ROAD_CAP = 168

// #47 桌面路珠网格（模块级常量：进组件内会每渲染重建，带进 effect deps 会让首灌反复跑）
const DESK_ROAD = { cols: 30, rows: 6 }

// ⚠ 手机段专用容量：桌面 ROAD_CAP 改动【不得】影响手机。手机内联珠格是从切片【头部】
//   取 ROAD_COLS*2 颗（slice(-CAP)[i], i<40），故 CAP 一变手机显示的珠子整体前移。
//   #46/#47 把桌面 CAP 从 120 抬到 168 时曾无意改动手机显示，此常量将手机钉回原值 120。
const MOBILE_ROAD_CAP = 120

// ---------- 静态种子数据（纯展示，零随机数）----------
const G = GAME_BY_ID['WuXing']

// 玩法说明文案(RULES)已切至 ./markets-ui/wuxingRules（原页/多桌共享）。
// 种子上局 = 规则页官方示例局：总和 693 → 小/单/龙9虎3(龙)/上13下7(上)/小单/金
// （真开奖逐期顶掉）
const SEED_LAST = deriveRound([1, 4, 5, 10, 11, 13, 20, 27, 30, 32, 33, 36, 40, 47, 54, 59, 61, 64, 67, 79])

// 五行五段(WUXING) 与珠盘路 3 视角(ROAD_VIEWS) 已切至 ./markets-ui/wuxingShared
// （原页 mobile 段 + 切件 WuXingMarkets/WuXingRoad 单一出处；段判定走引擎 WX_BOUNDS + WUXING，禁二份表）。

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动）
// 珠盘路种子：整局总和 sum 形态（210-1410，跨五行五段/大小/单双分布，首屏各视角有料）。
const SEED_ROAD = [
  693, 812, 905, 740, 1050, 660, 858, 799, 924, 705,
  833, 617, 951, 786, 690, 877, 810, 763, 1120, 845,
  702, 889, 811, 758,
]

// ---------- 开奖舞台（drawing 相位；结果进相前已锁定，动画只读）----------
// 亮球乱序 + 慢放编排全部由已锁结果播种/推导（mulberry32，零额外随机数）：
// 慢放球 = 累加和落点逼近五行分界 ±30 的球 + 末 3 球，其余段等比压缩补偿，



export default function WuXing({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // 单S5：≥1280 有右栏、中栏变窄 → 开奖区/盘区/珠盘/下注条同 maxWidth 居中，下注条与盘口板左右沿对齐。门控 ≥1280，<1280 逐位不变。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  // #46 单11 三栏配平试点（中大）：670→800。仅五行试点，其余 20 款 RAIL_MAXW 本单不碰。
  // ⚠ 封顶只在 ≥1415 视口才生效：中栏内容宽 = min(视口 − 250 − 341 − 24, RAIL_MAXW)，
  //   1280 档实得 665px（未封顶），1440 及以上才吃满 800。
  const RAIL_MAXW = 800
  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  // ---- #42 速度房骨架（单6 原生接入）：双订阅 / 选中房 / per-room 注单 / A0 / D / tab 条 ----
  // 逐款不同的部分仍在本文件：上局派生局 lastRound / 珠盘路 road（存 r.sum）两份 xxxByRoom、E 段追两份、A 段换期清盘、切房演出态清理（见 A1）、舞台 key。
  const {
    ROOMS, selectedRoomKey, roomsByKey, room, roomA, roomB,
    betsRef, betsOf, betsPlaced, setBetsPlaced, hasLast, lastBetsRef,
    shownRoundRef, animatedRoundRef, settleInfoRef,
    commitSettle, resetRoomView, renderRoomTabs,
  } = useSpeedRooms({ G, playerToken, setServerBalance, pushToast })

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
  const [animRound, setAnimRound] = useState(null)       // 当前开奖动画的派生局（deriveRound 结果）
  // #42 两份「按期累积」状态按房存：两房开的是完全不同的局，共用即串流。
  //   · lastRound 上局派生局 → 喂舞台的 lastRound prop（betting 期待命展示）
  //   · road      珠盘路 → 喂路珠墙
  const [lastRoundByRoom, setLastRoundByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_LAST])))
  const [roadByRoom, setRoadByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_ROAD])))
  const lastRound = lastRoundByRoom[selectedRoomKey] ?? SEED_LAST
  const road = roadByRoom[selectedRoomKey] ?? SEED_ROAD
  // #47 动效：仅 WS 真新珠时记新珠索引。⚠ 必须【按房存】—— 单值会被后台快房追珠覆盖，
  //   导致选中房刚亮起的高亮被瞬间清掉（实测 2.2s 内即消失）。首灌/切房一律清该房 → 不弹入。
  // #47 首帧闪变治理：播种未到货前不渲染珠墙（骨架占位，几何不变），到货后一次成型。
  //   实测根因：先渲染 SEED_ROAD 假种子珠(24/30颗=4~5列)，~450ms 后播种到货跳到 70+颗(12~13列)，
  //   视觉即「闪一下、几列变多列」。网格行列/珠径全程未变(6×30×18 恒定)，非重排、非锚定跳。
  //   ⚠ 语义是「播种流程已结束（含被门控跳过）」——否则不播种的场景会永远卡骨架。
  const [roadSeeded, setRoadSeeded] = useState(false)
  const [freshByRoom, setFreshByRoom] = useState({})
  const [roadView, setRoadView] = useState('bs')   // 手机路珠视角（默认大小）；纯显示
  const [userAcc, setUserAcc] = useState({ main: true, dtud: true, parlay: true, wuxing: true })   // 4 盘区手风琴（默认全展开）；纯 UI
  const roadRecordedRef = useRef(null)   // 珠盘路整局记账去重（按 rnd，防 StrictMode 双调用重复入）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)           // 舞台尾五行段预亮
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生局（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])

  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])


  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示 +（有注则）回写余额。无 push 项——龙/虎/上/下遇和局判【输】不退本金，
  // 命中高亮 = outcome 非 lose（和局 dt-tie/ud-tie 命中即 hit；dragon/tiger 遇和为 lose）。余额落定才跳。
  function finishRound(r, rnd) {
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 坑1 修正语义（add 收在 hadBet 内）在抽件的 commitSettle 里，此处只调用，勿再自行 add。
    commitSettle(rnd, si, hadBet)
    if (shownRoundRef.current !== rnd) return   // 下一期已抢先，跳过不覆盖新期 UI
    let hits, winTotal
    if (hadBet) {
      hits = new Set((si.yourResult || []).filter(v => v.outcome !== 'lose').map(v => v.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(r); winTotal = 0
    }
    // #42：两份累积写进【选中房】自己的槽（动画演完才写，保悬念）
    setLastRoundByRoom(m => ({ ...m, [selectedRoomKey]: r }))
    // 珠盘路改存整局 sum（3 视角从 sum 派生）；按 rnd 去重，一局恰记一次（StrictMode 防重）
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setRoadByRoom(m => {
        const next = roadWindow([...(m[selectedRoomKey] || SEED_ROAD), r.sum], DESK_ROAD)
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
      setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.phase, room.roundNo])

  // A1. #42 切房：把 UI 拉到新房的当前态。
  // ⚠ 位置必须在 A 之后 —— 抽件不代管本 effect，正是为了保住这个顺序（见 useSpeedRooms 注释）。
  // 舞台另有 key={selectedRoomKey} 强制重挂，这里只管数据面。
  // 切房时本款要清的：picks / 结算结果 / 舞台尾五行段预亮 preHits / 当前动画派生局 animRound /
  // 错误条 / 上一房的派生局对象（舞台常驻但读 pendingRef 取展示值）/ 回 betting UI。
  useEffect(() => {
    resetRoomView()   // 抽件：注单与该房暂存对齐 + shownRound/animatedRound 置空
    picksRef.current = new Set(); setPicks(new Set())
    setResult(null); setPreHits(null); setNetErr(null)
    setFreshByRoom({})   // #47：切房不弹入
    setAnimRound(null)
    pendingRef.current = null
    setUiPhase('betting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 派生局 → 启动开奖舞台动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const r = deriveRound(room.drawResult.balls)   // ← 后端 20 球（不本地 drawKeno）
      const rnd = room.roundNo
      pendingRef.current = r
      setAnimRound(r)
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(r, rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // E. #42 未选中房的两份累积：drawResult 一到就追（无动画可等）。选中房在 finishRound 里追。
  // ⚠ 本款 drawResult 字段是 .balls，派生走 deriveRound；珠子取 r.sum。
  const bgDrawRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgDrawRoundRef.current[r.key] === rm.roundNo) continue
      bgDrawRoundRef.current[r.key] = rm.roundNo
      const d = deriveRound(rm.drawResult.balls)
      setLastRoundByRoom(m => ({ ...m, [r.key]: d }))
      setRoadByRoom(m => {
        const next = roadWindow([...(m[r.key] || SEED_ROAD), d.sum], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [r.key]: next.length - 1 }))   // WS 真新珠 → 弹入（切回该房时可见）
        return { ...m, [r.key]: next }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

  // F. #46 单12 路珠历史播种：进页 / 切房时按房拉 /round/history 灌满，替代只有 24 颗的假种子。
  //   · 两房各拉各的：?room=15s 走单1 就有的现成分流参（不传 = 标准房），与右栏「近期开奖」同端点同 apiGet。
  //   · 派生复用 deriveRound(balls).sum —— 与 finishRound / E 段 / 多桌 roadItem 同一函数，禁二份表。
  //   · 方向：接口返回新→旧，road 存旧→新，故 reverse 后灌。
  //   · 与 WS 增量珠去重：灌完把该房【最新期号】写进已有的两个去重 ref（选中房 roadRecordedRef、
  //     未选中房 bgDrawRoundRef[key]），后续 WS 追同一期自然跳过 —— WS 那侧一行不改。
  //     之所以走 ref 而非按期号比对：road 只存裸 sum、不带期号，按期号去重要改存储形状并在传参处 map。
  //   · 失败静默保留 SEED_ROAD：路珠是装饰，拉不到不该打断游戏，也不弹错误条。
  //   · 只读，钱层零碰（apiGet 不经手 setServerBalance）。
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })
  useEffect(() => {
    let cancelled = false
    // #47 手机播种解禁：「手机无播种」是批铺时代的旧铁律，随本单废止 —— 手机升 20×6 高墙后
    //   108 格靠本地攒太空，进页即拉真历史灌窗口（与桌面同一条 /round/history 链路、按当前房）。
    //   ⚠ 桌面行为不变：原门控只是「非 hasRail 不跑」，去掉后桌面照跑，多出来的是手机/窄桌面也跑。
    // ⚠ 后端把 limit 夹死在 50（round.js 的 Math.min(50, ...)），单请求拿不满 180 格，
    //   故走该端点现成的 cursor 分页续拉，最多 PAGES 页（180/50 → 4 页封顶，防翻页失控）。
    const PAGE = 50
    const SEED_TARGET = roadSeedTarget(DESK_ROAD)   // #47：比 usable 多一整列，保证当前列半满
    const PAGES = Math.ceil(SEED_TARGET / PAGE)
    const seedRoom = async (r) => {
      const qs = r.key === '15s' ? '&room=15s' : ''
      const acc = []                      // 新→旧累积
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
      const sums = acc.slice(0, SEED_TARGET).reverse()   // 素材（新→旧转旧→新）   // 接口新→旧，road 存旧→新
        .map((it) => (Array.isArray(it?.drawResult?.balls) ? deriveRound(it.drawResult.balls).sum : null))
        .filter((n) => n != null)
      if (!sums.length) return
      // #47：首灌【不预截】到 usable —— 直接把拉回的完整条数过窗口，当前列才天然半满；
      //   且首灌不是「真新珠」，freshRoad 置空，避免一次灌 160+ 颗整屏爆闪。
      setRoadByRoom((m) => ({ ...m, [r.key]: roadWindowAt(sums, roundSeq(acc[0]?.roundNo), DESK_ROAD) }))
      setFreshByRoom(f => ({ ...f, [r.key]: -1 }))
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
    entries.forEach(x => { total = round2(total + x) })
    if (!entries.size || total <= 0) return false
    if (serverBalance != null && total > serverBalance) { setNetErr('余额不足'); return false }
    setNetErr(null)
    try {
      // #42：带当期 roundId 作【房凭证】—— 后端据它在该款所有房里定位当期 betting 房。
      // 不传一律落标准房（房化前行为），快房的注会跑到 30s 房去。钱层逻辑本身零改动。
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries), roundId: room.roundId })   // 返 balanceAfter → 自动回写扣款
      entries.forEach((x, k) => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + x)))
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
  lastBetsRef.current.forEach(x => { lastTotal = round2(lastTotal + x) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  const cur = animRound
  const shown = settled && cur ? cur : lastRound

  // ---- 样式件（选中=金框，同 Line Up 惯例）----
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，舞台尾五行段先预亮
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
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b',
      fontSize: 9, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  // secHead 已随桌面盘口区切至 WuXingMarkets（组头折叠钮内建）；mobile 段用手风琴自带标题。
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 单行键（名称左/区间中/赔率右，照 Line Up 定案行式）
  const rowCell = (key, name, range, odds, bg = DERBY.grey) => (
    <button key={key} type="button" className="wxCell" data-key={key} disabled={!betting} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{odds}</span>
      {stakeChip(key)}
    </button>
  )

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
          ? { text: '开奖中…', c: DERBY.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  // #42 速度 tab 条（形态A，抽件渲染）：色值传本款 tokens（两款共用 DERBY，同 SpeedGrid）。
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
          padding: '8px 16px', color: '#ff8a9a', fontSize: 13, fontWeight: 800,
        }}>该房不存在，请切回其它房</div>
      )}
      {!room.connected && room.roundNo && room.roomError !== 'invalid_room' && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 210,
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${DERBY.orange}`, borderRadius: 10,
          padding: '8px 16px', color: DERBY.orange, fontSize: 13, fontWeight: 800,
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

  // ---- ① 开奖区：20 球两行×10 + 龙虎/上下计数 + 总和大字 ----
  const drawZone = (
    <WuXingStage key={selectedRoomKey} phase={drawing ? 'drawn' : settled ? 'settled' : 'betting'} roundNo={room.roundNo}
      drawResult={cur ? { balls: cur.balls } : null} lastRound={shown} muted={muted}
      ball={isDesk ? 32 : undefined} height={isDesk ? 140 : 128}
      /* #46 单12 追加 中度放大档：球 26→32（球面字号 ball*0.42 自动跟随）。
         ⚠ 必须按 isDesk 门控，不能写死：drawZone 这个变量【被手机分支 mobileCard 复用】
         （gameCard:481 与 mobileCard:669 两处都渲染它），写死等于连手机一起改了。
         ⚠ height 必须与 ball 一并抬（128→140）：舞台根是 fixed height + overflow:hidden，
         两行球各 +6px 共 +12px，不抬就顶破被裁（实测裁 3px）。height 是组件现成 prop。
         非桌面档传 undefined/128 → 走组件原默认，逐字节零感。 */
      onFinale={() => setPreHits(new Set([...hitsOf(pendingRef.current)].filter(k => k.startsWith('wx-'))))}
      style={{ flex: '0 0 auto', zIndex: 1, margin: isMobile ? '8px 12px 0' : hasRail ? '6px 0 0' : '6px 18px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />
  )

  // ---- ② 盘区（主盘/龙虎上下/过关/五行）：已切至 ./markets-ui/WuXingMarkets（键区单一出处），下方 JSX 直接组装。----
  // ---- ③ 珠盘路：桌面切件 ./markets-ui/WuXingRoad（页签/判定单一出处，history=road 整值派生）；mobile 段 2 行走自身内联（ROAD_VIEWS 复用）。----
  // #47 双端一致：手机路珠列数升到与桌面同标 30（6 行已同）→ 与桌面吃同一段窗口，逐颗对得上
  const ROAD_COLS = 30
  // #47 专单：手机内联珠格改吃列滑窗口（按手机自己的 20×2 开窗 → 可用 (20−2)×2 = 36 珠）。
  //   ⚠ 几何零碰：珠径 15 / 格数 40 / 盒尺寸一字未动，只改「填几颗」。
  const mobileBeads = roadWindow(road, { cols: ROAD_COLS, rows: 6 })
  // A 案锚定右端：新珠落格后把横滚条推到最右，保证「最新珠 + 右侧两空列」恒在视口
  const roadScrollRef = useRef(null)
  useEffect(() => { roadAnchorLeft(roadScrollRef.current, mobileBeads.length, 18 + 2) }, [mobileBeads.length])
  // #47 专单：动效手机也上 —— 桌面 fresh 索引按各自窗口长度换算到手机面（禁直接复用，长度不同会落错格）
  const mobFresh = freshFor(freshByRoom[selectedRoomKey] ?? -1, road.length, mobileBeads.length)
  const curView = ROAD_VIEWS.find(v => v.key === roadView) || ROAD_VIEWS[0]   // 路珠视角（手机/桌面共用 roadView，切了两端一致）

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.wxCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（desk 主盘/龙虎上下并排、过关/五行并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : hasRail ? '4px 0' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),
      }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处 */}
        {/* #46 单12 追加 中度放大档：big 只在桌面 gameCard 传；手机段与多桌不传，逐字节零感 */}
        <WuXingMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits ?? preHits} isMobile={isMobile} isDesk={isDesk} big stacked />
      </div>

      {/* ③ 珠盘路（切件）：history=road 整值 → 组件内 roadView 派生 大小/单双/五行段（判定走引擎）
          #46 单12 空腔治理：本件从「垫片之后」上提到「垫片之前」——目标序 开奖区→盘口→路珠→空白→注栏。
          桌面传 cols 30 / bead 24（30×24+29×2=778 ≤ 内容可用宽 786，吃满 800 中栏）；
          rows 保持 6 → 30×6=180 格恰好 = ROAD_CAP，零死格。多桌与手机不传这两个 prop，行为不变。 */}
      {/* 弹性垫片：吸收剩余高度，把珠盘路推向底部贴注栏。
          #46 单12追2 定案：路珠【回贴底】——垫片移回路珠之前（撤销单12 的上提调序），
          顺序恢复 开奖→盘口→垫片→路珠→注栏；路珠保持 30×6 大珠满珠贴筹码条。 */}
      <div style={{ flex: '1 0 auto' }} />

      <WuXingRoad history={roadSeeded ? road : EMPTY_ROAD} tab={roadView} onTab={setRoadView} isMobile={isMobile}
        cols={DESK_ROAD.cols} rows={DESK_ROAD.rows} bead={24}
      freshIndex={freshByRoom[selectedRoomKey] ?? -1}
        style={{ margin: isMobile ? '0 12px 8px' : hasRail ? '0 auto 8px' : '0 18px 8px',
          ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}) }} />

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: hasRail ? '6px 0' : '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid',
          /* #46 单12 追加 中度放大档：行高 28→34、下注钮列 92→110（本条是五行私有内联，直改） */
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 110px',
          gridTemplateRows: 'repeat(2, 34px)',
          gap: 6,
          maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="wxChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%', borderRadius: 8,
              fontSize: 13, fontWeight: 900, lineHeight: 1, color: COLORS.white,   /* #46 单12 追加：11→13 同比例 */
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
            boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>投注额</span>
            <input
              value={bet}
              disabled={!betting}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 48, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 17, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={!repeatOk} onClick={repeatBets} style={{
            gridColumn: 3, gridRow: 2,
            width: '100%', height: '100%', borderRadius: 8,
            fontSize: 13, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: repeatOk ? DERBY.text : DERBY.dim,
            background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : settled ? '已结算' : '已锁盘'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets}
              disabled={!confirmOk}
              stretch
              size={1.2}   /* #46 单12 追加：与筹码键同比例放大；另 11 处引用方不传，零感 */
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

  // ============ 手机三段式（<1024，照德比模板）：锁顶(顶栏+舞台) / 中滚(四盘区手风琴全开) / 锁底(路珠3视角+注栏) ============
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开四盘区看 hit 高亮，betting 恢复玩家手动态。
  const SEC_KEYS = {
    main: new Set(['big', 'small', 'odd', 'even']),
    dtud: new Set(['dragon', 'dt-tie', 'tiger', 'up', 'ud-tie', 'down']),
    parlay: new Set(['big-odd', 'small-odd', 'big-even', 'small-even']),
    wuxing: new Set(WUXING.map(w => w.key)),
  }
  const selCount = (sec) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => { if (SEC_KEYS[sec].has(k)) n++ })
    return n
  }
  const effAcc = settled ? { main: true, dtud: true, parlay: true, wuxing: true } : userAcc
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
            <span style={{ color: DERBY.gold, fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {cnt > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', color: DERBY.sel, fontSize: 10, fontWeight: 900 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: DERBY.sel, display: 'inline-block' }} />{cnt}
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
  const mainBody = (
    <>
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>{rowCell('big', '大', '811-1410', '1.95')}{rowCell('small', '小', '210-810', '1.92')}</div>
      <div style={{ display: 'flex', gap: 5 }}>{rowCell('odd', '单', '总和单', '1.95')}{rowCell('even', '双', '总和双', '1.95')}</div>
    </>
  )
  const dtudBody = (
    <>
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>{rowCell('dragon', '龙', '十位', '2.13')}{rowCell('dt-tie', '龙虎和', '', '9.55')}{rowCell('tiger', '虎', '末位', '2.13')}</div>
      <div style={{ display: 'flex', gap: 5 }}>{rowCell('up', '上', '≥11 个', '2.40')}{rowCell('ud-tie', '上下和', '10-10', '4.70')}{rowCell('down', '下', '≥11 个', '2.40')}</div>
    </>
  )
  const parlayBody = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
      {rowCell('big-odd', '大单', '', '3.82')}{rowCell('small-odd', '小单', '', '3.82')}{rowCell('big-even', '大双', '', '3.82')}{rowCell('small-even', '小双', '', '3.82')}
    </div>
  )
  const wuxingBody = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
      {WUXING.map(w => (
        <button key={w.key} type="button" className="wxCell" data-key={w.key} disabled={!betting} onClick={() => toggleSel(w.key)}
          style={{ ...cellBase(w.key, DERBY.grey), padding: '5px 2px' }}>
          <span style={{ ...cellName, fontSize: 14 }}>{w.name}</span>
          <span style={{ ...cellRange, fontSize: 8 }}>{w.range}</span>
          <span style={cellOdds}>{w.odds}</span>
          {stakeChip(w.key)}
        </button>
      ))}
    </div>
  )
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`.wxCell:hover { filter: brightness(1.2); }`}</style>

      {/* ① 锁顶：GameTopBar + 舞台 drawZone（非弹性自成块，canvas 常驻不折叠不卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {drawZone}
      </div>

      {/* ② 中滚：四盘区手风琴（主盘 / 龙虎上下 / 过关 / 五行段，默认全开；结算全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('main', '主盘 · 总和', mainBody)}
        {accSection('dtud', '龙虎 · 上下', dtudBody)}
        {accSection('parlay', '过关四组合', parlayBody)}
        {accSection('wuxing', '五行 · 总和五段', wuxingBody)}
      </div>

      {/* ③ 锁底：路珠(3视角 pill 大小/单双/五行段 + 珠压 2 行,从 sum 派生) + 注栏 */}
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
                  fontSize: 10, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
                }}>{v.label}</button>
              )
            })}
          </div>
          {/* #47 A 案：30×6 珠18（与桌面同标），598 > 390 → 横滑，右端锚定最新珠 */}
          <div ref={roadScrollRef} style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <style>{ROAD_FX_CSS}</style>{/* #47 专单：手机动效同一份 CSS */}
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
                // #47 首帧闪变：播种未到货 → 珠位留空（骨架），几何不变，到货后一次成型
                const n = roadSeeded ? mobileBeads[i] : undefined
                // #47 专单：手机也上弹入/游标动效（同一份 CSS）
                // #47 骨架期纯静态：播种未到货一律无游标/弹入（roadSeeded 前置）
                const cls = !roadSeeded ? undefined : i === mobFresh ? ROAD_FX_FRESH : (n == null && i === mobileBeads.length ? ROAD_FX_NEXT : undefined)
                const d = n != null ? curView.judge(n) : null
                return (
                  <span key={i} className={cls} style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: d ? d.c : 'rgba(255,255,255,0.05)',
                    border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: 9, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  }}>{d ? d.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 12px', background: DERBY.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
            gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
          }}>
            {[
              { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
              { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
            ].map(({ v, col, row }) => (
              <button key={v} type="button" className="wxChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              boxSizing: 'border-box', minWidth: 0,
            }}>
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
              boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Line Up ----
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
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
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
      <style>{`.wxMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="wxMobileRoot">{mobileCard}</div>
    </>
  )
}
