import { useState, useRef, useEffect } from 'react'
import { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOLDENBOOT } from '../components/shell/tokens'
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
import car01 from '../assets/goldenboot/car_01.png'
import car02 from '../assets/goldenboot/car_02.png'
import car03 from '../assets/goldenboot/car_03.png'
import car04 from '../assets/goldenboot/car_04.png'
import car05 from '../assets/goldenboot/car_05.png'
import car06 from '../assets/goldenboot/car_06.png'
import car07 from '../assets/goldenboot/car_07.png'
import car08 from '../assets/goldenboot/car_08.png'
import car09 from '../assets/goldenboot/car_09.png'
import car10 from '../assets/goldenboot/car_10.png'
import trafficLightImg from '../assets/goldenboot/traffic_light.png'

// 赛车图按号索引（car_0X = 车号 X）
const CAR_SRC = { 1: car01, 2: car02, 3: car03, 4: car04, 5: car05, 6: car06, 7: car07, 8: car08, 9: car09, 10: car10 }

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

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '每期 10 辆车冲刺赛跑，决出 1–10 名。你可以押冠军是哪辆车、冠亚军点数之和、以及和值的大小单双。开赛前下注，冲线后命中的盘口按赔率赔付。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 冠军直选：押中冠军是哪辆车（1–10 号），约 9.60 倍。\n· 冠亚和：押冠军与亚军的车号之和（3–19），赔率随难度约 8.6 倍到 42.98 倍不等，越极端的和值赔越高。\n· 大 / 小：冠亚和以 11/12 为界，大[12-19] 约 2.15 倍 / 小[3-11] 约 1.72 倍。\n· 单 / 双：按冠亚和判定，单约 1.72 倍 / 双约 2.15 倍。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '10 辆车冲线决出名次，取冠军和冠亚军之和结算，命中的盘口立即结算，赔付直接入余额。每期独立，上期不影响下期。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半；想搏大赔押冠军直选或冠亚和两端。\n· 冠亚和押中间值（10、11、12）比押两端（3、19）容易得多。\n· 本游戏理论返还率约 95.5–96%，属娱乐性质，理性游戏。',
  },
]
const ROAD_CAP = 120

// 种子上期 + 种子历史（真开奖逐期顶掉）
const SEED_LAST = deriveRace([3, 7, 1, 9, 2, 10, 5, 8, 4, 6])
const SEED_WINNERS = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6, 2, 8, 1, 4, 10, 6, 3, 9, 7, 5, 1, 6, 4, 2, 9, 3, 10, 8, 5, 7]
const SEED_SUMS = [10, 9, 4, 13, 12, 16, 8, 14, 7, 11, 5, 15, 3, 9, 17, 10, 6, 12, 19, 8, 11, 7, 13, 5, 16, 9, 4, 18, 12, 10]
const SEED_HISTORY = SEED_WINNERS.map((w, i) => ({ winner: w, sum: SEED_SUMS[i] }))

const ROAD_TABS = ['WINNER', 'SUM']
// 珠盘页签内部 key（beadFor 判定用，不动）+ 中文显示映射（照先例分离）
const ROAD_TAB_LABELS = { WINNER: '冠军', SUM: '冠亚和' }
function beadFor(tab, h) {
  if (tab === 'WINNER') return { t: String(h.winner), c: h.winner <= 5 ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
  return h.sum >= 12 ? { t: 'B', c: GOLDENBOOT.dragon } : { t: 'S', c: GOLDENBOOT.tiger }
}

// 金靴球衣珠 — 迷你球衣轮廓 + 号码（金渐变，共享 gold/fire/goldDeep）

// 冠军直选盘口图标：Codex 真车图（car_0X，跟舞台同款）+ 左上角号码 badge
function CarImgBead({ num, size = 30 }) {
  return (
    <div style={{ position: 'relative', width: size * 1.7, height: size }}>
      <img src={CAR_SRC[num]} alt={`car ${num}`}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      <span style={{
        position: 'absolute', top: -2, left: -2,
        width: size * 0.52, height: size * 0.52, borderRadius: '50%',
        background: 'rgba(0,0,0,0.75)', border: `1px solid ${GOLDENBOOT.gold}`,
        color: GOLDENBOOT.gold, fontSize: size * 0.32, fontWeight: 900, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Space Grotesk', sans-serif", boxSizing: 'border-box',
      }}>{num}</span>
    </div>
  )
}


export default function GoldenBoot({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
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
  const [roadTab, setRoadTab] = useState('WINNER')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）----
  // uiPhase: betting | locked | racing | settled —— 由 room 相位 + 开奖动画时序派生
  const [uiPhase, setUiPhase] = useState('betting')
  const [lastRace, setLastRace] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)   // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null) // 冲刺动画收尾的命中预亮（结算前）
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)   // 是否有上局注单快照（重复钮亮灭）

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}
  const lastBetsRef = useRef(new Map())   // 上局注单快照（重复投注用）
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画名次（铁律不变）
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取
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
    if (hadBet && si.balanceAfter != null && settledRoundRef.current !== rnd) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundRef.current = rnd
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
    setLastRace(r)
    setHistory(h => [...h, { winner: r.winner, sum: r.sprintSum }].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
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
      setResult(null); setPreHits(null)
      setFeedBets(makeFeedBots())
      setNetErr(null)
      setUiPhase('betting')
    }
  }, [room.phase, room.roundNo])

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
      background: sel ? GOLDENBOOT.selTint : GOLDENBOOT.grey,
      border: `1px solid ${hit ? GOLDENBOOT.sel : sel ? GOLDENBOOT.gold : placed ? GOLDENBOOT.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? `0 0 12px ${GOLDENBOOT.selTint.replace('0.16', '0.6')}`
        : sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      opacity: betting || hit || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box',
      position: 'relative',
    }
  }
  const cellName = { color: GOLDENBOOT.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: GOLDENBOOT.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: GOLDENBOOT.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const stakeChip = key => betsPlaced.has(key) && (
    <span style={{
      position: 'absolute', top: 2, right: 3,
      padding: '1px 5px', borderRadius: RADIUS.pill,
      background: GOLDENBOOT.sel, color: '#083a1b',
      fontSize: 8, fontWeight: 900,
    }}>${betsPlaced.get(key)}</span>
  )

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
  const subRowNode = (
    <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
      {/* 上期名次串 — 只显前 3 名（冠/亚/季），删 WINNER 标后放大占满整行 */}
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flex: 1, minWidth: 0, gap: isMobile ? 6 : 12 }}>
        {lastRace.order.slice(0, 3).map((n, i) => (
          <span key={`${n}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`第${i + 1}名`}>
            <span style={{
              color: ['#ffd54f', '#cfd6de', '#d9873f'][i], fontSize: isMobile ? 10 : 12, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
            }}>{['冠', '亚', '季'][i]}</span>
            <CarImgBead num={n} size={isMobile ? 38 : 48} />
          </span>
        ))}
      </span>
    </span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} band={GOLDENBOOT.band} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} />
      {!room.connected && room.roundNo && (
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

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  const ROAD_COLS = 20
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(h => beadFor(roadTab, h))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? GOLDENBOOT.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : GOLDENBOOT.dim,
            border: `1px solid ${roadTab === t ? GOLDENBOOT.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 7 : 9, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  // ---- 开奖区（常驻顶部）：RACING/SETTLED 冲刺舞台 / BETTING 上期名次静态待命 ----
  const stageH = isMobile ? 150 : 178
  const stageZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box', minHeight: stageH,
    }}>
      {(racing || settled) && pendingRef.current ? (
        <GoldenBootStage phase={settled ? 'settled' : 'drawn'} roundNo={room.roundNo} drawResult={{ ranking: pendingRef.current.order }}
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
      <style>{`.gbCell:hover:not(:disabled) { filter: brightness(1.3); }`}</style>

      {/* ---- top bar（共享件：场馆行+特件 subRow 并入）---- */}
      {topBar}

      {/* ---- ① 开奖区（常驻顶部）---- */}
      {stageZone}

      {/* ---- ② 下注区: 盘区三族，可滚 ---- */}
      <div style={{
        flex: isDesk ? '0 1 auto' : '1 1 0', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '8px 12px' : '8px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        {/* 族① WINNER 冠军直选 1–10 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>冠军直选</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`w-${n}`)}
                style={{ ...cellBtn(`w-${n}`), flexBasis: isMobile ? '17%' : 0 }}>
                <CarImgBead num={n} size={isMobile ? 24 : 30} />
                <span style={cellOdds}>{ODDS.winner.toFixed(2)}</span>
                {stakeChip(`w-${n}`)}
              </button>
            ))}
          </div>
        </div>

        {/* 族② SPRINT SUM 冠亚和 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>冠亚和</div>
          <div style={{ display: 'flex', gap: isMobile ? 4 : 5, flexWrap: 'wrap', marginBottom: isMobile ? 6 : 8 }}>
            {Object.keys(SUM_N).map(s => (
              <button key={s} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(`sum-${s}`)}
                style={{ ...cellBtn(`sum-${s}`, { compact: true }), flexBasis: isMobile ? '14%' : 0, minWidth: isMobile ? 0 : 42 }}>
                <span style={{ ...cellName, fontSize: isMobile ? 11 : 12.5 }}>{s}</span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9 : 10.5 }}>{ODDS.sum[s].toFixed(2)}</span>
                {stakeChip(`sum-${s}`)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {[
              { key: 's-big',   name: '大', range: '12–19', odds: ODDS.big },
              { key: 's-small', name: '小', range: '3–11',  odds: ODDS.small },
              { key: 's-odd',   name: '单', range: '和为单', odds: ODDS.odd },
              { key: 's-even',  name: '双', range: '和为双', odds: ODDS.even },
            ].map(m => (
              <button key={m.key} type="button" className="gbCell" disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key)}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span style={cellOdds}>{m.odds.toFixed(2)}</span>
                {stakeChip(m.key)}
              </button>
            ))}
          </div>
        </div>

      </div>

      {isDesk && <div style={{ flex: '1 0 auto' }} />}

      {/* ---- ③ 珠盘路（常驻底部）---- */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（抄 LineUp/DominoDuel）---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: GOLDENBOOT.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
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
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
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
