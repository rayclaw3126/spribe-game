import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, NUMBERUP, MONO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'
import { useSpeedRooms } from '../hooks/useSpeedRooms'
import NumberUpStage from './stages/NumberUpStage'
import HowToPlay from '../components/shell/HowToPlay'
import HistoryDrawer from '../components/HistoryDrawer'
import CommitRevealFairness from '../components/CommitRevealFairness'
import BetButton from '../components/shell/BetButton'
import { GAME_BY_ID } from '../gameRegistry'
import { usePlayerApi } from '../lib/playerApi'
import NumberUpMarkets from './markets-ui/NumberUpMarkets'         // #41 单15：盘口区切件（桌面组装 + 多桌复用）
import NumberUpRoad from './markets-ui/NumberUpRoad'              // #41 单15：珠盘路墙（桌面组装 + 多桌复用）
import NumberUpPodium, { NumberCard } from './markets-ui/NumberUpPodium'   // #41 单15：上局信息条（NumberCard 随件，stageZone import 回用）
import { RULES } from './markets-ui/numberupRules'               // #41 单15：玩法说明内容（共享）

// Number Up — 两位数球衣号码彩（00–49）。
// 引擎：0–49 均匀抽一个；头位/尾位/大小单双全部由 num 派生。
// 轮次：BETTING(24s) → REVEAL(3s 占位，单3 换换人牌动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

// —— 引擎常量块已剪切到 ./markets/numberup（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { pad2, drawNumber, deriveNum, ODDS, hitsOf, round2, MARKETS } from './markets/numberup'
import { roadWindow, roadWindowAt, roadSeedTarget, roundSeq } from './markets-ui/roadWindow'   // #47：列对齐滑动窗口（共用）
export { drawNumber, deriveNum, ODDS, MARKETS, hitsOf }

// ---------- 换人牌舞台时间轴（rAF 内使用，毫秒）：十位先定、个位后定 ----------
// 开奖动画总时长（收到 drawn → 举牌 LED 翻数演完 → 结算 + 回写余额）；须 < 服务器 numberup idle(8s)
const DRAW_ANIM_MS = 6500
const G = GAME_BY_ID['NumberUp']

// 玩法说明文案已切至 ./markets-ui/numberupRules（RULES，原页 + 多桌卡共享，单一出处）。
// #47 定案（全端规则）：路珠【列对齐滑动窗口】，右端恒留 2 空列。
// 可用容量 = (30−2)×6 = 168；显示长度 L ≡ N (mod 6) 且 L ≤ 168，取最大 → 163–168 浮动。
const ROAD_CAP = 168

// #47 桌面路珠网格（模块级：进组件内会每渲染重建，带进 effect deps 会让首灌反复跑）
const DESK_ROAD = { cols: 30, rows: 6 }

// ⚠ 手机段专用容量与列数：桌面改动【不得】影响手机（首批学费）。本款 ROAD_COLS 原先【双端共用】，
//   同时喂桌面 beadRoad 与手机内联珠格；ROAD_CAP 同样双端共用且手机从切片头部取，
//   故两者都必须解耦、钉回原值。
const MOBILE_ROAD_CAP = 120
const MOBILE_ROAD_COLS = 20

// 种子上期 + 种子历史（值域 0–49，真开奖逐期顶掉）
const SEED_LAST = deriveNum(38)
const SEED_RECENT = [38, 7, 42, 15, 29]
const SEED_HISTORY = [
  38, 7, 42, 15, 29, 3, 20, 44, 8, 31,
  12, 49, 17, 26, 0, 45, 9, 33, 21, 6,
  40, 13, 25, 2, 48, 19, 36, 10, 47, 4,
]

const SIDES = [
  { key: 's-high', name: '大', range: '25–49' },
  { key: 's-low',  name: '小', range: '00–24' },
  { key: 's-odd',  name: '单', range: '尾数单' },
  { key: 's-even', name: '双', range: '尾数双' },
]

// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照 Derby/HalfTime 先例分离）
const ROAD_TABS = ['NUMBER', 'DIGIT', 'H-L']
const ROAD_TAB_LABELS = { NUMBER: '号码', DIGIT: '位数', 'H-L': '大小' }
function beadFor(tab, n) {
  if (tab === 'NUMBER') return { t: pad2(n), c: n >= 25 ? NUMBERUP.hi : NUMBERUP.lo }
  if (tab === 'DIGIT') { const d = n % 10; return { t: String(d), c: d % 2 ? NUMBERUP.hi : NUMBERUP.lo } }
  return n >= 25 ? { t: 'H', c: NUMBERUP.hi } : { t: 'L', c: NUMBERUP.lo }
}

// NumberCard（球衣号码小卡）已随上局信息条切至 ./markets-ui/NumberUpPodium；此处 import 回用于 stageZone 待命大卡。


export default function NumberUp({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // #47 二批：本款原先【没有 hasRail 居中骨架】（四区无 maxWidth，与其余八款不同族）。
  //   为对表「四区同一条 800 宽度线」，此处补上，用法与五行/中场/德比逐字一致。
  const hasRail = useMediaQuery('(min-width: 1280px)')
  const RAIL_MAXW = 800
  // desk mode narrows the card by the 340px feed — below 1200px viewport the
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  // ---- #42 速度房骨架（单5 抽件）：双订阅 / 选中房 / per-room 注单 / A0 / D / tab 条 ----
  // 逐款不同的部分仍在本文件：路珠/近5期/上局大卡 三份 xxxByRoom、E 段追三份、A 段换期清盘、切房演出态清理（见下方 handleRoomSwitch）、舞台 key 挂点。
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
  // #47 动效：仅 WS 真新珠时记新珠索引，【按房存】（单值会被后台快房覆盖，首批实测踩过）。
  const [freshByRoom, setFreshByRoom] = useState({})
  const [roadTab, setRoadTab] = useState('NUMBER')
  const [userAcc, setUserAcc] = useState({ pick: true, digit: true, side: true })   // 手机手风琴玩家手动折叠态（默认三盘区全展开）；纯 UI，不动下注 state
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）：betting | drawing | settled ----
  const [uiPhase, setUiPhase] = useState('betting')
  // #42 三份「按期累积」状态全部按房存 —— 号码王比 SpeedGrid 多两份，漏一份就串流：
  //   · lastNum  上期开奖派生对象 → 喂 stageZone 待命大卡【和顶栏 subRow 的 NumberUpPodium】
  //   · recent   近 5 期 → 同样喂 NumberUpPodium（顶栏一眼可见，串了最扎眼）
  //   · history  路珠 120 期 → 喂 NumberUpRoad
  // 两房开的是完全不同的局，共用任何一份都等于把另一房的号码显到这一房头上。
  const [lastNumByRoom, setLastNumByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_LAST])))
  const [recentByRoom, setRecentByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_RECENT])))
  const [historyByRoom, setHistoryByRoom] = useState(() => Object.fromEntries(ROOMS.map((r) => [r.key, SEED_HISTORY])))
  const lastNum = lastNumByRoom[selectedRoomKey] ?? SEED_LAST
  const recent = recentByRoom[selectedRoomKey] ?? SEED_RECENT
  const history = historyByRoom[selectedRoomKey] ?? SEED_HISTORY
  const [result, setResult] = useState(null)              // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)            // 开牌动画收尾的命中预亮
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betRef = useRef(bet)
  // #47 二批 新增：珠盘路整局记账去重（按期号）。接了历史播种后必须显式去重
  //   （玩家正好在开奖动画中进页时 history 已含该期，动画结束会再追一次 = 重复上珠）。
  const roadRecordedRef = useRef(null)
  const pendingRef = useRef(null)          // 只读表演：当前动画开出号码的派生对象（.num 等）
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

  // 开奖动画演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。
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
      // 后端三态：命中高亮 = outcome 非 lose；单选无 push。
      hits = new Set((si.yourResult || []).filter(v => v.outcome !== 'lose').map(v => v.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      // 无注：仅显示，不动钱
      hits = hitsOf(r); winTotal = 0
    }
    // #42：三份累积全写进【选中房】自己的槽（动画演完才写，保悬念）。
    setLastNumByRoom(m => ({ ...m, [selectedRoomKey]: r }))
    setRecentByRoom(m => ({ ...m, [selectedRoomKey]: [r.num, ...(m[selectedRoomKey] || SEED_RECENT)].slice(0, 5) }))
    // #47：按期号去重（防与历史播种重复上珠）+ 列对齐窗口 + 新珠弹入
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setHistoryByRoom(m => {
        const next = roadWindow([...(m[selectedRoomKey] || SEED_HISTORY), r.num], DESK_ROAD)
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
      setResult(null)
      setPreHits(null)
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
    pendingRef.current = null          // 断开上一房的开奖派生对象（stageZone 三元据它判分支）
    setUiPhase('betting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey])

  // B. locked：封盘（尚在 betting UI 时切 locked；已进入 drawing 的动画不打断）
  useEffect(() => {
    if (room.phase === 'locked') setUiPhase(p => (p === 'betting' ? 'locked' : p))
  }, [room.phase])

  // C. drawn：收到本期开奖 → 启动举牌换人牌动画（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      pendingRef.current = deriveNum(room.drawResult.num)   // 后端开出号码派生（不本地 drawNumber）
      setUiPhase('drawing')
      const tm = setTimeout(() => finishRound(rnd), DRAW_ANIM_MS)
      timersRef.current.push(tm)
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  // E. #42 未选中房的三份累积：drawResult 一到就追（无动画可等）。选中房在 finishRound 里追（保悬念）。
  // ⚠ 后端号码王 drawResult 字段是 .num（SpeedGrid 是 .n），别照抄错。
  const bgDrawRoundRef = useRef({})
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue
      const rm = roomsByKey[r.key]
      if (!rm.drawResult || !rm.roundNo || bgDrawRoundRef.current[r.key] === rm.roundNo) continue
      bgDrawRoundRef.current[r.key] = rm.roundNo
      const d = deriveNum(rm.drawResult.num)
      setLastNumByRoom(m => ({ ...m, [r.key]: d }))
      setRecentByRoom(m => ({ ...m, [r.key]: [d.num, ...(m[r.key] || SEED_RECENT)].slice(0, 5) }))
      setHistoryByRoom(m => {
        const next = roadWindow([...(m[r.key] || SEED_HISTORY), d.num], DESK_ROAD)
        setFreshByRoom(f => ({ ...f, [r.key]: next.length - 1 }))
        return { ...m, [r.key]: next }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.drawResult, roomA.roundNo, roomB.drawResult, roomB.roundNo, selectedRoomKey])

  // F. #47 二批 路珠真历史播种（双流版：本款 registry rooms 两枚，有 15s 快房）。
  //   · 两房各拉各的（?room=15s 现成分流参）；limit 被后端夹在 50 → 走现成 cursor 分页。
  //   · 派生 deriveNum(num).num，与 finishRound / E 段同口径；接口新→旧、路珠旧→新故 reverse。
  //   · 首灌按【最新期号序号】定相位（非拉取条数，否则恒整除 6 会钉成满列）；不弹入。
  //   · 失败静默保留种子珠；只读，钱层零碰。
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })
  useEffect(() => {
    let cancelled = false
    // #47 三批回补 ⚠ 手机零碰：路珠 state 是【桌手共享】的，播种会把手机路珠从「种子珠」
    //   灌成满格真历史 —— 几何量虽不变，但珠数变了即违反「手机逐字节同基线」（PK10 实测
    //   有珠 30 → 120 才发现）。故播种只在 hasRail（≥1280）档进行。
    if (!hasRail) return undefined
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
      const nums = acc.slice(0, SEED_TARGET).reverse()
        .map((it) => (it?.drawResult?.num != null ? deriveNum(it.drawResult.num).num : null))
        .filter((n) => n != null)
      if (!nums.length) return
      setHistoryByRoom((m) => ({ ...m, [r.key]: roadWindowAt(nums, roundSeq(acc[0]?.roundNo), DESK_ROAD) }))
      setFreshByRoom((f) => ({ ...f, [r.key]: -1 }))
      if (r.key === selectedRoomKey) roadRecordedRef.current = acc[0]?.roundNo
      else bgDrawRoundRef.current[r.key] = acc[0]?.roundNo
    }
    for (const r of ROOMS) seedRoom(r).catch(() => { /* 静默：保留种子珠 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomKey, hasRail])

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
    // 即时扣款模型：不能超过当前余额（服务端另有权威风控/余额校验兜底）
    if (serverBalance != null && total > serverBalance) { setNetErr('余额不足'); return false }
    setNetErr(null)
    try {
      // #42：带上当期 roundId 作【房凭证】—— 后端据它在该款所有房里定位当期 betting 房。
      // 不传的话一律落标准房（房化前的行为），快房的注就跑到 30s 房去了。钱层逻辑本身零改动。
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
  function repeatBets() { placeAndPost(new Map(lastBetsRef.current)) }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel ? NUMBERUP.selTint : NUMBERUP.grey,
      border: `1px solid ${hit ? NUMBERUP.sel : sel || placed ? NUMBERUP.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${NUMBERUP.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box',
      position: 'relative',
    }
  }
  const cellName = { color: NUMBERUP.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: NUMBERUP.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: NUMBERUP.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const secHead = { color: NUMBERUP.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: NUMBERUP.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )

  // 10×10 网格格（选中亮金 / 已下注金框 / 命中亮绿）
  const gridCell = n => {
    const key = `n-${pad2(n)}`
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)
    const placed = betsPlaced.has(key)
    return (
      <button key={key} type="button" className="nuCell" disabled={!betting} onClick={() => toggleSel(key)} style={{
        height: isMobile ? 28 : 22, minWidth: 0, padding: 0,
        borderRadius: 6, cursor: betting ? 'pointer' : 'not-allowed',
        background: hit ? NUMBERUP.sel : sel ? NUMBERUP.gold : NUMBERUP.grey,
        border: `1px solid ${hit ? NUMBERUP.sel : sel || placed ? NUMBERUP.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: hit ? '0 0 10px rgba(53,208,127,0.7)' : sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        color: hit || sel ? '#083a1b' : NUMBERUP.text,
        fontSize: isMobile ? 10.5 : 10, fontWeight: 800,
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box',
        transition: 'background 0.1s, box-shadow 0.1s',
      }}>{pad2(n)}</button>
    )
  }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: NUMBERUP.dim }
    : betting
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: NUMBERUP.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: NUMBERUP.orange }
        : drawing
          ? { text: '开牌中…', c: NUMBERUP.orange }
          : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: NUMBERUP.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const subRowNode = <NumberUpPodium last={lastNum.num} recent={recent} isMobile={isMobile} />   // 上局信息条（切件）

  // #42 速度 tab 条（形态A，抽件渲染）：色值传本款 tokens，件内零硬编码主题色。
  const roomTabs = renderRoomTabs({ tokens: { sel: NUMBERUP.sel, strip: NUMBERUP.strip, dim: NUMBERUP.dim }, isMobile })

  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={NUMBERUP.band} venue={G.venue ?? G.displayName}
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
          background: 'rgba(20,16,10,0.95)', border: `1px solid ${NUMBERUP.orange}`, borderRadius: 10,
          padding: '8px 16px', color: NUMBERUP.orange, fontSize: 13, fontWeight: 800,
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

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  // #47：桌面走 DESK_ROAD；本常量降级为【手机专用】别名，解耦双端（见模块级注释）
  const ROAD_COLS = MOBILE_ROAD_COLS
  const roadItems = history.slice(-MOBILE_ROAD_CAP)   // #47：喂手机内联珠格，钉回手机专用容量
  const beads = roadItems.map(n => beadFor(roadTab, n))
  // ---- 珠盘路（切件；桌面 6×20；手机三段版另有 2 行内联）----
  const beadRoad = (
    <NumberUpRoad history={history} tab={roadTab} onTab={setRoadTab}
      cols={DESK_ROAD.cols} rows={DESK_ROAD.rows} bead={24}
      freshIndex={freshByRoom[selectedRoomKey] ?? -1}
      style={{ margin: isMobile ? '0 12px 10px' : hasRail ? '0 auto 10px' : '0 18px 10px' }} />   /* #47：hasRail 档归零侧边距 */
  )

  // ---- 开奖区（常驻顶部）：REVEAL/SETTLED 换人牌舞台 / BETTING 上期开奖静态待命 ----
  // #47 放大 ×1.2：桌面开奖台 178→214。⚠ stageZone 在 gameCard 与 mobileCard 【两处都渲染】，
  //   写死会连手机一起放大，故必须 isDesk 门控（首批学费）。
  const stageH = isMobile ? 150 : isDesk ? 214 : 178
  const stageZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      // #47 二批：补 hasRail 档 —— 外层包裹层已是 800 宽，本卡侧边距必须归零才共用同一条宽度线
      margin: isMobile ? '8px 12px 0' : hasRail ? '10px 0 0' : '10px 18px 0',
      background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', minHeight: stageH,
    }}>
      {(drawing || settled) && pendingRef.current ? (
        <NumberUpStage key={selectedRoomKey} phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ num: pendingRef.current.num }}
          height={stageH} muted={muted}
          shakeRef={cardShakeRef} onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
      ) : (
        <div style={{
          height: stageH, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
        }}>
          <span style={{ color: NUMBERUP.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>上期开奖 · 待命中</span>
          <NumberCard num={lastNum.num} w={isMobile ? 44 : 52} />
          <span style={{
            padding: '2px 14px', borderRadius: RADIUS.pill,
            background: NUMBERUP.gold, color: '#3a2c00', fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap',
          }}>号码 {pad2(lastNum.num)}</span>
        </div>
      )}
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${NUMBERUP.bgCenter}, ${NUMBERUP.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.nuCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}

      {/* ---- ① 开奖区（常驻顶部）---- */}
      {/* #47：仅在此处（gameCard）包 800 宽度线；stageZone 本体不动 → mobileCard 复用它时零感 */}
      {hasRail ? <div style={{ alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW, boxSizing: 'border-box' }}>{stageZone}</div> : stageZone}

      {/* ---- ② 下注区: 盘区三行（可滚）；PICK 网格空间不足时独立纵滚 ---- */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '8px 12px' : hasRail ? '8px 0' : '8px 18px', boxSizing: 'border-box',
        gap: 8, overflowY: 'auto',
        ...(hasRail ? { alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW } : {}),   /* #47：800 宽度线 */
      }}>
        <WinToast toasts={toasts} />
        {/* 盘口区切件（视觉原样）：点击/态由本页 state 传入，键区单一出处（多桌卡同 import） */}
        <NumberUpMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits ?? preHits} isMobile={isMobile} big />
      </div>

      <div style={{ flex: '1 0 auto' }} />

      {/* ---- ③ 珠盘路（常驻底部）---- */}
      {hasRail ? <div style={{ alignSelf: 'center', width: '100%', maxWidth: RAIL_MAXW, boxSizing: 'border-box' }}>{beadRoad}</div> : beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto', padding: hasRail ? '6px 0' : '6px 12px', background: NUMBERUP.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 110px',   /* #47：92→110 */
          gridTemplateRows: 'repeat(2, 34px)', gap: 6, maxWidth: hasRail ? RAIL_MAXW : 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="nuChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? NUMBERUP.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? NUMBERUP.sel : 'rgba(255,255,255,0.35)'}`,
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
            color: repeatOk ? COLORS.white : NUMBERUP.dim, background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : drawing ? '开牌中…' : settled ? '本期已结算' : '已锁盘'}
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
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开三盘区看 hit 高亮，betting 恢复玩家手动态。
  const SEC_TEST = {
    pick: k => k.startsWith('n-'),
    digit: k => k.startsWith('fd-') || k.startsWith('ld-'),
    side: k => k.startsWith('s-'),
  }
  const selCount = (sec) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => { if (SEC_TEST[sec](k)) n++ })
    return n
  }
  const effAcc = settled ? { pick: true, digit: true, side: true } : userAcc
  const accSection = (key, title, body) => {
    const open = effAcc[key]
    const cnt = selCount(key)
    return (
      <div style={{ borderRadius: 12, background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 6 }}>
        <button type="button" onClick={() => setUserAcc(a => ({ ...a, [key]: !a[key] }))} style={{
          width: '100%', height: 36, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '0 10px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: NUMBERUP.gold, fontSize: 11, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {cnt > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flex: '0 0 auto', color: NUMBERUP.sel, fontSize: 10, fontWeight: 900 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: NUMBERUP.sel, display: 'inline-block' }} />{cnt}
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
  // 直选去内滚：删 minHeight130 + overflowY:auto，网格在中滚区自然展开（单层滚动）
  const pickBody = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3 }}>
      {Array.from({ length: 50 }, (_, i) => gridCell(i))}
    </div>
  )
  const digitBody = (
    <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
      {[
        { pre: 'fd', label: `首位 · ${ODDS.firstDigit.toFixed(2)}`, count: 5 },
        { pre: 'ld', label: `尾数 · ${ODDS.lastDigit.toFixed(2)}`, count: 10 },
      ].map(g => (
        <div key={g.pre} style={{ flex: 1, minWidth: 0 }}>
          <div style={secHead}>{g.label}</div>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: g.count }, (_, d) => (
              <button key={d} type="button" className="nuCell" disabled={!betting} onClick={() => toggleSel(`${g.pre}-${d}`)}
                style={{ ...cellBtn(`${g.pre}-${d}`, { compact: true }), padding: '4px 0' }}>
                <span style={{ ...cellName, fontSize: 11 }}>{d}</span>
                {stakeChip(`${g.pre}-${d}`)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
  const sideBody = (
    <div style={{ display: 'flex', gap: 5 }}>
      {SIDES.map(m => (
        <button key={m.key} type="button" className="nuCell" disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
          <span style={cellName}>{m.name}</span>
          <span style={cellRange}>{m.range}</span>
          <span style={{ ...cellOdds, fontSize: 10 }}>{ODDS.side.toFixed(2)}</span>
          {stakeChip(m.key)}
        </button>
      ))}
    </div>
  )
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${NUMBERUP.bgCenter}, ${NUMBERUP.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`.nuCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ① 锁顶：GameTopBar + 单舞台（stageZone 恒常驻，canvas 相位内换，不折叠不卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {stageZone}
      </div>

      {/* ② 中滚：三盘区手风琴（直选 / 首位尾数 / 大小单双，默认全开；结算全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('pick', `直选 · 赔率 ${ODDS.pick.toFixed(2)}`, pickBody)}
        {accSection('digit', '首位 · 尾数', digitBody)}
        {accSection('side', '大小 · 单双', sideBody)}
      </div>

      {/* ③ 锁底：路珠(3视角 pill 原样 + 珠压 2 行) + 注栏 */}
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ padding: '4px 12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }}>
            {ROAD_TABS.map(t => (
              <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
                flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 10px', borderRadius: RADIUS.pill,
                background: roadTab === t ? NUMBERUP.sel : 'rgba(0,0,0,0.35)', color: roadTab === t ? '#083a1b' : NUMBERUP.dim,
                border: `1px solid ${roadTab === t ? NUMBERUP.sel : 'rgba(255,255,255,0.2)'}`,
                fontSize: 10, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
              }}>{ROAD_TAB_LABELS[t]}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 8, background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 2 }).map((_, i) => {
                const b = beads[i]
                return (
                  <span key={i} style={{
                    width: 15, height: 15, borderRadius: '50%',
                    background: b ? b.c : 'rgba(255,255,255,0.05)',
                    border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: b && b.t.length > 1 ? 6 : 8, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  }}>{b ? b.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 12px', background: NUMBERUP.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
            gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
          }}>
            {[
              { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
              { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
            ].map(({ v, col, row }) => (
              <button key={v} type="button" className="nuChip" disabled={!betting} onClick={() => setBet(v)} style={{
                gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
                fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
                background: bet === v ? NUMBERUP.selTint : 'rgba(0,0,0,0.35)',
                border: `1px solid ${bet === v ? NUMBERUP.sel : 'rgba(255,255,255,0.35)'}`,
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
              color: repeatOk ? COLORS.white : NUMBERUP.dim, background: 'rgba(0,0,0,0.35)',
              border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
              cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
              boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
            <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
              <BetButton
                state="bet"
                label={betting ? `下注 ${picks.size} 格` : drawing ? '开牌中…' : settled ? '本期已结算' : '已锁盘'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Golden Boot ----
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
      <style>{`.nuMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="nuMobileRoot" ref={cardShakeRef}>{mobileCard}</div>
    </>
  )
}
