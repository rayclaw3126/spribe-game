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
import { useRoundRoom } from '../hooks/useRoundRoom'
import WuXingStage from './stages/WuXingStage'

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
const DRAW_ANIM_MS = 4500   // 收到 drawn → 开奖舞台演完 → 结算回写；须 < 服务器 wuxing idle(5500ms)
const ROAD_CAP = 120
// 舞台时间轴（rAF 内使用，毫秒）：乱序亮球 → 总和砸出 → 五行段预亮
const WX_BOUNDS = [695, 763, 855, 923]   // 五行段分界（±30 慢放判定）

// ---------- 静态种子数据（纯展示，零随机数）----------
const G = GAME_BY_ID['WuXing']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期从 1–80 号池中抽 20 个球，20 球号码相加得到总和（范围 210–1410）。各盘口按这个总和以及派生数值判定。开球前下注，开奖后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 大 / 小：以 810 为界，大[≥811]约 1.95 倍 / 小[≤810]约 1.92 倍。\n· 单 / 双：按总和判定，约 1.95 倍。\n· 龙 / 虎 / 和：比较总和的十位数与个位数。十位大押龙约 2.13 倍，个位大押虎约 9.55 倍，相等押和约 9.55 倍。\n· 上 / 下 / 和：数落在 1–40 区间的球有多少个，超过 10 个押上约 2.4 倍，少于 10 个押下约 2.4 倍，恰好 10 个押和约 4.7 倍。\n· 过关：大小和单双的组合（大单 / 小单 / 大双 / 小双），约 3.82 倍。\n· 五行：按总和落在五个区间分金木水火土 —— 金[≤695] / 木[696-763] / 水[764-855] / 火[856-923] / 土[≥924]，赔率约 2.46 至 9.35 倍不等，越窄的区间赔越高。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '20 球开出后计算总和及派生数值，命中的盘口立即结算，赔付直接入余额。龙虎、上下的胜负盘遇「和」按输处理（不退本金）。每期独立。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半；想搏大赔押龙虎和、五行金土。\n· 龙虎、上下的胜负盘遇「和」算输，若担心可加押「和」对冲。\n· 本游戏理论返还率约 95–96%，属娱乐性质，理性游戏。',
  },
]
// 种子上局 = 规则页官方示例局：总和 693 → 小/单/龙9虎3(龙)/上13下7(上)/小单/金
// （真开奖逐期顶掉）
const SEED_LAST = deriveRound([1, 4, 5, 10, 11, 13, 20, 27, 30, 32, 33, 36, 40, 47, 54, 59, 61, 64, 67, 79])

// 五行五段（格底统一普通盘键色 DERBY.grey，与大小/单双一致；五行字/赔率保留）
const WUXING = [
  { key: 'wx-gold', name: '金', range: '210-695', odds: '9.35' },
  { key: 'wx-wood', name: '木', range: '696-763', odds: '4.72' },
  { key: 'wx-water', name: '水', range: '764-855', odds: '2.46' },
  { key: 'wx-fire', name: '火', range: '856-923', odds: '4.72' },
  { key: 'wx-earth', name: '土', range: '924-1410', odds: '9.10' },
]

// 珠盘路 3 视角（road 现存整局 sum，从 sum 派生）。段判定走引擎 WX_BOUNDS + WUXING（禁手写第二份表）。
const WX_ROAD_C = [DERBY.gold, DERBY.sel, DERBY.home, DERBY.away, '#c8873a']   // 金木水火土 珠色（仅显示，非判定）
const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: n => n >= 811 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home } },
  { key: 'oe', label: '单双', judge: n => n % 2 ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home } },
  { key: 'wx', label: '五行段', judge: n => { const i = WX_BOUNDS.filter(b => n > b).length; return { t: WUXING[i].name, c: WX_ROAD_C[i] } } },
]

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
  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  const room = useRoundRoom(playerToken, G.backendId)

  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [fairOpen, setFairOpen] = useState(false)   // 本期可验证公平抽屉（共享局 commit-reveal）
  const [historyOpen, setHistoryOpen] = useState(false)   // 开奖历史抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [hasLast, setHasLast] = useState(false)
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [animRound, setAnimRound] = useState(null)       // 当前开奖动画的派生局（deriveRound 结果）
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)
  const [roadView, setRoadView] = useState('bs')   // 手机路珠视角（默认大小）；纯显示
  const [userAcc, setUserAcc] = useState({ main: true, dtud: true, parlay: true, wuxing: true })   // 4 盘区手风琴（默认全展开）；纯 UI
  const roadRecordedRef = useRef(null)   // 珠盘路整局记账去重（按 rnd，防 StrictMode 双调用重复入）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)           // 舞台尾五行段预亮
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}
  const lastBetsRef = useRef(new Map())
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生局（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取

  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
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
    if (hadBet && si.balanceAfter != null && settledRoundRef.current !== rnd) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundRef.current = rnd
    if (shownRoundRef.current !== rnd) return   // 下一期已抢先，跳过不覆盖新期 UI
    let hits, winTotal
    if (hadBet) {
      hits = new Set((si.yourResult || []).filter(v => v.outcome !== 'lose').map(v => v.key))
      winTotal = Number(si.totalPayout || 0)
      if (winTotal > 0) pushToast('本期命中', winTotal)
    } else {
      hits = hitsOf(r); winTotal = 0
    }
    setLastRound(r)
    // 珠盘路改存整局 sum（3 视角从 sum 派生）；按 rnd 去重，一局恰记一次（StrictMode 防重）
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setRoad(h => [...h, r.sum].slice(-ROAD_CAP))
    }
    setResult({ hits, winTotal })
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
      setResult(null)
      setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

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
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries) })   // 返 balanceAfter → 自动回写扣款
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
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
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
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} />
      {!room.connected && room.roundNo && (
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
    <WuXingStage phase={drawing ? 'drawn' : settled ? 'settled' : 'betting'} roundNo={room.roundNo}
      drawResult={cur ? { balls: cur.balls } : null} lastRound={shown} muted={muted}
      onFinale={() => setPreHits(new Set([...hitsOf(pendingRef.current)].filter(k => k.startsWith('wx-'))))}
      style={{ flex: '0 0 auto', zIndex: 1, margin: isMobile ? '8px 12px 0' : '6px 18px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} />
  )

  // ---- ② 盘区：主盘 / 龙虎·上下 / 过关四组合 / 五行五段 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 总和</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '811-1410', '1.95')}
        {rowCell('small', '小', '210-810', '1.92')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('odd', '单', '总和单', '1.95')}
        {rowCell('even', '双', '总和双', '1.95')}
      </div>
    </div>
  )
  const dtudBoard = (
    <div style={secBox}>
      <div style={secHead}>龙虎（和值十位/末位）｜ 上下（1-40/41-80 计数）</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('dragon', '龙', '十位', '2.13')}
        {rowCell('dt-tie', '龙虎和', '', '9.55')}
        {rowCell('tiger', '虎', '末位', '2.13')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('up', '上', '≥11 个', '2.40')}
        {rowCell('ud-tie', '上下和', '10-10', '4.70')}
        {rowCell('down', '下', '≥11 个', '2.40')}
      </div>
    </div>
  )
  const parlayBoard = (
    <div style={secBox}>
      <div style={secHead}>过关四组合</div>
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {rowCell('big-odd', '大单', '', '3.82')}
        {rowCell('small-odd', '小单', '', '3.82')}
        {rowCell('big-even', '大双', '', '3.82')}
        {rowCell('small-even', '小双', '', '3.82')}
      </div>
    </div>
  )
  // 五行五段：双端横排 5 列 grid（金→土），格内竖排 字大/区间小/赔率；
  // 430 区间小字降到 8px 保全字（禁截断禁溢出）
  const wuxingBoard = (
    <div style={secBox}>
      <div style={secHead}>五行 · 总和五段</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {WUXING.map(w => (
          <button key={w.key} type="button" className="wxCell" data-key={w.key} disabled={!betting} onClick={() => toggleSel(w.key)}
            style={{ ...cellBase(w.key, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px' }}>
            <span style={{ ...cellName, fontSize: isMobile ? 14 : 16 }}>{w.name}</span>
            <span style={{ ...cellRange, fontSize: isMobile ? 8 : 9.5 }}>{w.range}</span>
            <span style={cellOdds}>{w.odds}</span>
            {stakeChip(w.key)}
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式抄 Line Up）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const curView = ROAD_VIEWS.find(v => v.key === roadView) || ROAD_VIEWS[0]   // 路珠视角（手机/桌面共用 roadView，切了两端一致）
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {ROAD_VIEWS.map(v => {
          const on = roadView === v.key
          return (
            <button key={v.key} type="button" onClick={() => setRoadView(v.key)} style={{
              padding: '3px 12px', borderRadius: RADIUS.pill,
              background: on ? DERBY.sel : 'rgba(0,0,0,0.35)', color: on ? '#083a1b' : DERBY.dim,
              border: `1px solid ${on ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
              fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{v.label}</button>
          )
        })}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            // road 存整局 sum；按当前视角 curView.judge 派生（同一份函数，桌面/手机共用，禁复制第二份）
            const n = road.slice(-ROAD_CAP)[i]
            const d = n != null ? curView.judge(n) : null
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: d ? d.c : 'rgba(255,255,255,0.05)',
                border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{d ? d.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

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
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{dtudBoard}</div>
        </div>
        {/* 过关一行；五行 desk 独占整行（并排时五键各 ~104px 键内溢出实测，全宽后 ~190px） */}
        {parlayBoard}
        {wuxingBoard}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路 */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)',
          gap: 6,
          maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="wxChip" disabled={!betting} onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
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
                width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 14, fontWeight: 900,
              }}
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
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
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
          <div style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 2 }).map((_, i) => {
                const n = road.slice(-ROAD_CAP)[i]
                const d = n != null ? curView.judge(n) : null
                return (
                  <span key={i} style={{
                    width: 15, height: 15, borderRadius: '50%',
                    background: d ? d.c : 'rgba(255,255,255,0.05)',
                    border: d ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: 8, fontWeight: 900,
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

      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
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
