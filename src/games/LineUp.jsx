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
import LineUpStage from './stages/LineUpStage'

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
export { AWAY_DIGITS, HIGH_DIGITS, drawGrid, deriveRound, ODDS, MARKETS, hitsOf }

// 舞台时间轴（rAF 内使用，毫秒）：乱序砸落 25 格 → TOTAL 放大砸出
// 开奖动画总时长（收到 drawn → 开奖舞台演完 → 结算显示 + 回写余额）；须 < 服务器 lineup idle(5.5s)
const DRAW_ANIM_MS = 4500
const G = GAME_BY_ID['LineUp']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期开出 25 个数字（0–9），排成 5×5 的方格。每个数字既是一张牌（红牌或黄牌），也参与各行和总和的计算。你可以押总盘或单独某一行的盘口。开球前下注，开奖后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 大 / 小：25 格总和，以 112 为界，大[≥113] / 小[≤112]，约 1.95 倍。\n· 单 / 双：按总和判定，约 1.95 倍。\n· 红牌多 / 黄牌多：数字 0,2,6,7,8 为红牌、1,3,4,5,9 为黄牌，哪种多押哪边，约 1.95 倍。\n· 高 / 低：数字 5-9 为高、0-4 为低，哪种多押哪边，约 1.95 倍。\n· 段位：按总和落在四个区间 —— 降级区[≤95] / 中游[96-112] / 欧战区[113-129] / 夺冠[≥130]，两端约 8 倍、中间约 2.5 倍。\n· 行式盘：单独押某一行（L1 锋线到 L5 后卫）的大小/单双/红黄，约 1.95 倍。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '25 个数字开出后计算各行和总和，命中的盘口立即结算，赔付直接入余额。每期独立，上期不影响下期。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。切换「全局 / L1-L5」维度选行式盘。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双红黄，中奖率约一半；想搏大赔押段位两端（降级 / 夺冠）。\n· 行式盘让你聚焦单行走势，玩法更细。\n· 本游戏理论返还率约 95%，属娱乐性质，理性游戏。',
  },
]
const ROAD_CAP = 120
const ROW_LABELS = ['锋线', '前腰', '中场', '后腰', '后卫']   // L1-L5

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

// 珠盘路 3 视角（road 现存整局 total，从 total 派生）。段位判定复用 MARKETS zone-* 的实值 hit
// （代码里段位带实值常量，注释值骗人；禁手写第二份表）；段珠显段位首字。
const ZONE_KEYS = ['zone-releg', 'zone-mid', 'zone-euro', 'zone-champ']
const ZONE_CHARS = ['降', '中', '欧', '冠']
const ZONE_C = [DERBY.away, DERBY.home, DERBY.sel, DERBY.gold]   // 降红/中蓝/欧绿/冠金（仅显示）
const ROAD_VIEWS = [
  { key: 'bs', label: '大小', judge: n => n >= 113 ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home } },
  { key: 'oe', label: '单双', judge: n => n % 2 ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home } },
  { key: 'zone', label: '段位', judge: n => { const i = ZONE_KEYS.findIndex(k => MARKETS[k].hit({ total: n })); return { t: ZONE_CHARS[i] ?? '', c: ZONE_C[i] ?? 'rgba(255,255,255,0.2)' } } },
]

// 普通盘四区（足球叙事换皮，段位照参考原文；⚠ RTP 出带待定，见 ODDS 注释）
const ZONES = [
  { key: 'zone-releg', name: '降级区', range: '0–95' },
  { key: 'zone-mid', name: '中游', range: '96–112' },
  { key: 'zone-euro', name: '欧战区', range: '113–129' },
  { key: 'zone-champ', name: '夺冠', range: '130–225' },
]

// ---------- 开奖舞台（drawing 相位；结果进相前已全锁定，动画只读）----------
// 落格乱序从已锁结果派生（mulberry32 播种 + Fisher-Yates）——零额外随机数消耗，


export default function LineUp({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）

  // ---- 服务器排期器房间：相位/期号/倒计时/开奖/结算唯一真相来源 ----
  const room = useRoundRoom(playerToken, G.backendId)

  const [bet, setBet] = useState(10)
  const [netErr, setNetErr] = useState(null)   // 网络/后端错误提示（不白屏）
  const [fairOpen, setFairOpen] = useState(false)   // 本期可验证公平抽屉（共享局 commit-reveal）
  const [historyOpen, setHistoryOpen] = useState(false)   // 开奖历史抽屉
  const [rulesOpen, setRulesOpen] = useState(false)   // 玩法说明抽屉
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [view, setView] = useState('A')       // 投注盘视图：A 列表 / B 矩阵
  const [dim, setDim] = useState(0)           // A 视图维度：0 全局，1-5 行 L1-L5
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | drawing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [animRound, setAnimRound] = useState(null)       // 当前开奖动画的派生局（deriveRound 结果）
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)            // 珠盘路（旧→新）：现存整局 total
  const [roadView, setRoadView] = useState('bs')         // 手机/桌面共用路珠视角（默认大小）
  const roadRecordedRef = useRef(null)                   // 珠盘路整局记账去重（按 rnd，防 StrictMode 双调用）
  const [result, setResult] = useState(null)             // { hits:Set, winTotal }
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}（stake chip/重复/余额校验）
  const lastBetsRef = useRef(new Map())          // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生局（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取


  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
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
    if (hadBet && si.balanceAfter != null && settledRoundRef.current !== rnd) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundRef.current = rnd
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
    setLastRound(r)
    // 珠盘路改存整局 total（3 视角从 total 派生）；按 rnd 去重，一局恰记一次（StrictMode 防重）
    if (rnd != null && roadRecordedRef.current !== rnd) {
      roadRecordedRef.current = rnd
      setRoad(h => [...h, r.total].slice(-ROAD_CAP))
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
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

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
      await api.apiPlay(G.backendId, { bets: Object.fromEntries(entries) })   // 返 balanceAfter → 自动回写扣款
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

  // ---- 样式件（选中=金框；命中=绿框绿晕，同 Derby 惯例）----
  // settled 相位三档：命中+有注 = 绿框绿晕+注码chip；命中+无注 = 绿框亮灯弱一档
  // （无晕）；未命中压暗（有注留金框认输）。A/B 双视图同走这一份，key 同源天然同步；
  // betting/drawing（无 result）恢复常态不残留
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hits = result?.hits ?? null            // 仅 settled 相位非空
    const isHit = hits?.has(key)
    const staked = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${isHit ? DERBY.sel : sel || staked ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: isHit && staked
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: hits
        ? (isHit ? 1 : staked ? 0.6 : 0.45)
        : betting || staked ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s, opacity 0.2s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: DERBY.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )

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
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0}
        venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode}
        onBack={onBack}
        onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)}
      />
      {/* 断线重连提示（hook 自动指数退避重连；恢复后 sync 补相位） */}
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

  const drawZone = (
    <LineUpStage phase={drawing ? 'drawn' : settled ? 'settled' : 'betting'} roundNo={room.roundNo}
      drawResult={cur ? { grid: cur.cells } : null} lastRound={shown} muted={muted}
      style={{ flex: '0 0 auto', zIndex: 1, margin: isMobile ? '8px 12px 0' : '6px 18px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} />
  )

  // ---- ② 盘区：A 列表 / B 矩阵 双视图（42 键与 MARKETS 同源同 key，选中态互通）----
  // 维度→键名映射：0 全局走普通盘键，1-5 走行式键；引擎无「行高低/行段位」键，禁造键
  const keyOf = (d, slot) => d === 0
    ? { home: 'home-more', away: 'away-more', big: 'big', small: 'small', odd: 'odd', even: 'even' }[slot]
    : `L${d}-${slot}`
  const DIM_CHIPS = ['全局', ...ROW_LABELS.map((l, i) => `L${i + 1}${l}`)]
  // 键格两款：row = 单行（名称左/区间中/赔率右，照参考 Common Bets 行式）；
  // col = 竖排三行（段位 4 键窄格用）
  const marketCell = (key, name, range, bg, layout = 'row') => (
    <button key={key} type="button" className="luCell" data-key={key} disabled={!betting} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        ...(layout === 'row' ? {
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
        } : { padding: isMobile ? '4px 2px' : '4px' }),
      }}>
      <span style={cellName}>{name}</span>
      <span style={layout === 'row' ? { ...cellRange, flex: 1, textAlign: 'center' } : cellRange}>{range}</span>
      <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
      {stakeChip(key)}
    </button>
  )
  // 高低对 + 段位排（A 全局尾部 / B 矩阵下方共用同一份）
  const hiLoPair = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
      {marketCell('high', '高', '5-9 ≥13', DERBY.grey)}
      {marketCell('low', '低', '0-4 ≥13', DERBY.grey)}
    </div>
  )
  const zonesRow = (
    <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
      {ZONES.map(z => marketCell(z.key, z.name, z.range, DERBY.grey, isMobile ? 'col' : 'row'))}
    </div>
  )
  // A 视图：维度 chip + 成对两列（行序固定 主客 → 大小 → 单双 → 高低）
  const pairRows = d => [
    [
      // 键名沿用 home/away（data-key 不动），显示层红黄牌皮；黄键底 = 共享 amberDeep
      { slot: 'home', name: '黄牌多', range: d === 0 ? '黄牌 ≥13' : '黄牌 ≥3', bg: COLORS.amberDeep },
      { slot: 'away', name: '红牌多', range: d === 0 ? '红牌 ≥13' : '红牌 ≥3', bg: DERBY.away },
    ],
    [
      { slot: 'big', name: '大', range: d === 0 ? '113–225' : '23–45', bg: DERBY.grey },
      { slot: 'small', name: '小', range: d === 0 ? '0–112' : '0–22', bg: DERBY.grey },
    ],
    [
      { slot: 'odd', name: '单', range: d === 0 ? '和值单' : '行和单', bg: DERBY.grey },
      { slot: 'even', name: '双', range: d === 0 ? '和值双' : '行和双', bg: DERBY.grey },
    ],
  ]
  const viewA = (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap' }}>
        {DIM_CHIPS.map((label, i) => (
          <button key={i} type="button" onClick={() => setDim(i)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: dim === i ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: dim === i ? '#083a1b' : DERBY.dim,
            border: `1px solid ${dim === i ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>
      {pairRows(dim).map((pair, i) => (
        <div key={i} style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
          {pair.map(m => marketCell(keyOf(dim, m.slot), m.name, m.range, m.bg))}
        </div>
      ))}
      {/* 高低 + 段位仅全局维度（行式引擎无此键） */}
      {dim === 0 && hiLoPair}
      {dim === 0 && zonesRow}
    </>
  )
  // B 视图：6×6 矩阵（列=主客大小单双，行=全局/L1-L5，格内只赔率）+ 高低/段位排底
  const MATRIX_COLS = [
    { slot: 'home', name: '黄', bg: COLORS.amberDeep },
    { slot: 'away', name: '红', bg: DERBY.away },
    { slot: 'big', name: '大', bg: DERBY.grey },
    { slot: 'small', name: '小', bg: DERBY.grey },
    { slot: 'odd', name: '单', bg: DERBY.grey },
    { slot: 'even', name: '双', bg: DERBY.grey },
  ]
  const viewB = (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: `${isMobile ? 50 : 64}px repeat(6, 1fr)`,
        gap: 3, marginBottom: isMobile ? 5 : 6,
      }}>
        <span />
        {MATRIX_COLS.map(c => (
          <span key={c.slot} style={{
            textAlign: 'center', fontSize: isMobile ? 10 : 11, fontWeight: 900,
            color: c.slot === 'home' ? DERBY.gold : c.slot === 'away' ? '#f0938a' : DERBY.dim,
          }}>{c.name}</span>
        ))}
        {[0, 1, 2, 3, 4, 5].map(d => (
          [
            <span key={`r${d}`} style={{
              display: 'inline-flex', alignItems: 'center',
              color: DERBY.text, fontSize: isMobile ? 9.5 : 10.5, fontWeight: 900, whiteSpace: 'nowrap',
            }}>{d === 0 ? '全局' : `L${d} ${ROW_LABELS[d - 1]}`}</span>,
            ...MATRIX_COLS.map(c => {
              const key = keyOf(d, c.slot)
              return (
                <button key={key} type="button" className="luCell" data-key={key} disabled={!betting}
                  onClick={() => toggleSel(key)}
                  style={{ ...cellBase(key, c.bg), padding: '2px 0' }}>
                  <span style={cellOdds}>{MARKETS[key].odds.toFixed(2)}</span>
                  {stakeChip(key)}
                </button>
              )
            }),
          ]
        ))}
      </div>
      {hiLoPair}
      {zonesRow}
    </>
  )
  const marketSection = (
    <div style={secBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={secHead}>投注盘 · {view === 'A' ? DIM_CHIPS[dim] : '总览矩阵'}</div>
        {/* A/B 小切换钮（右上角，选中态两视图互通） */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
          {['A', 'B'].map(v => (
            <button key={v} type="button" onClick={() => setView(v)} style={{
              padding: '2px 8px', borderRadius: RADIUS.pill,
              background: view === v ? DERBY.sel : 'rgba(0,0,0,0.35)',
              color: view === v ? '#083a1b' : DERBY.dim,
              border: `1px solid ${view === v ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
              fontSize: 9, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{v === 'A' ? 'A 列表' : 'B 矩阵'}</button>
          ))}
        </div>
      </div>
      {view === 'A' ? viewA : viewB}
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式同 Half Time；真历史滚动，容量 120）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14   // 移动端珠子大一档（可辨），桌面压一档保总高（同 Derby）
  const beads = road.slice(-ROAD_CAP)
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
            // road 存整局 total；按当前视角 curView.judge 派生（同一份函数，桌面/手机共用）
            const n = beads[i]
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
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件：名 pill 下拉 + 场馆/期号/相位 + ?/音频钮）---- */}
      {topBar}

      {/* ① 开奖区（顶部）：5×5 号码牌 + 统计带 */}
      {drawZone}

      {/* ② 盘区（中部，单一盘区 A/B 双视图；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {marketSection}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，大小单轨） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行：
           列1-2 面额四格（10/100 上、50/500 下）｜列3 Bet USD 上/重复钮下｜列4 下注大方钮跨两行 ---- */}
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
            <button key={v} type="button" className="luChip" disabled={!betting} onClick={() => setBet(v)} style={{
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

  // ============ 手机三段式（<1024，照德比模板）：锁顶(顶栏+舞台) / 中滚(单板整块不折叠) / 锁底(路珠3视角+注栏) ============
  // LineUp 盘区是单一 marketSection（内置 A/B 视图），无多段可分 → 不套手风琴，单板整块进中滚。钱路零改。
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`.luCell:hover:not(:disabled) { filter: brightness(1.2); }`}</style>

      {/* ① 锁顶：GameTopBar + 舞台 drawZone（非弹性自成块，canvas 常驻不折叠不卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {drawZone}
      </div>

      {/* ② 中滚：单板 marketSection 整块（含 A/B 视图，不折叠） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {marketSection}
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
                  fontSize: 10, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
                }}>{v.label}</button>
              )
            })}
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 2 }).map((_, i) => {
                const n = beads[i]
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
              <button key={v} type="button" className="luChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              opacity: betting ? 1 : 0.6, boxSizing: 'border-box', minWidth: 0,
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Derby Day ----
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
