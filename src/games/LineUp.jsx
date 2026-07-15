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
export { AWAY_DIGITS, HIGH_DIGITS, drawGrid, deriveRound, ODDS, MARKETS, hitsOf }

// 舞台时间轴（rAF 内使用，毫秒）：乱序砸落 25 格 → TOTAL 放大砸出
// 开奖动画总时长（收到 drawn → 开奖舞台演完 → 结算显示 + 回写余额）；须 < 服务器 lineup idle(5.5s)
const DRAW_ANIM_MS = 4500
const G = GAME_BY_ID['LineUp']

// 玩法说明文案(RULES) 已切至 ./markets-ui/lineupRules（原页 HowToPlay 与多桌卡共用，单一出处）。
const ROAD_CAP = 120

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
  // 投注盘 A/B 视图 + 维度 dim 态已随盘口区切至 LineUpMarkets（组件内部 UI 态）
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

  // ---- ② 盘区：A 列表 / B 矩阵 双视图 —— 已切至 ./markets-ui/LineUpMarkets（键区单一出处，A/B 视图+维度内建）。
  // 组装 <LineUpMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting} selected={picks} hits={result?.hits} isMobile />

  // ---- ③ 珠盘路（大小单轨）：桌面墙件已切至 ./markets-ui/LineUpRoad（判定走 ROAD_VIEWS，禁二份表）；
  // 手机三段锁死的内联 2 行路珠仍留在下方 mobileCard（分毫不变，同读 ROAD_VIEWS/curView）。----
  const ROAD_COLS = 20
  const beads = road.slice(-ROAD_CAP)
  const curView = ROAD_VIEWS.find(v => v.key === roadView) || ROAD_VIEWS[0]   // 路珠视角（手机/桌面共用 roadView，切了两端一致）

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
        <LineUpMarkets onPick={toggleSel} stakes={betsPlaced} disabled={!betting}
          selected={picks} hits={result?.hits} isMobile={isMobile} />
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，大小单轨）：切件 history=road 整值 total → 组件内 ROAD_VIEWS 派生 */}
      <LineUpRoad history={road} tab={roadView} onTab={setRoadView} isMobile={isMobile}
        cols={ROAD_COLS} rows={6} style={{ margin: isMobile ? '0 12px 8px' : '0 18px 8px' }} />

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
