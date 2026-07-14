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
import { DrawStage } from './stages/DerbyDayStage'
import trophyImg from '../assets/shared/trophy.png'

// Derby Day — 主客对抗 Keno（主队 10 珠 vs 客队 10 珠比和值），第 16 卡。
// 引擎：主客各自独立 80 池 Fisher-Yates 抽 20 无重复（前 10 = 半场，全 20 = 全场累计）。
// 轮次（一期一场两阶段，多场馆/浮动赔率二期）：
//   BETTING(24s) → HT_DRAW(3s 占位，单3 换动画) → HT_SHOWN(6s 半场块亮真珠，仅展示，
//   全部盘 BETTING 截止后已锁死) → FT_DRAW(3s 占位) → SETTLED(4s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（含 push 退注：
// H/A 盘平局退回本金，不算赢不算输，WinToast 用「平局退注」区分文案）。

// —— 引擎常量块已剪切到 ./markets/derbyday（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { deriveMatch, ODDS, MARKETS, hitsOf, pushesOf, round2, HT_BIG, FT_BIG, drawMatch } from './markets/derbyday'
export { drawMatch, deriveMatch, ODDS, MARKETS, hitsOf, pushesOf }

// ---------- 开奖动画分段时长（#43单3：服务器排期器驱动，本地不再有相位 setInterval）----------
// 收到 drawn 消息后本地按 HT出球 → 半场定格 → FT出球 依次演，总长 DRAW_ANIM_MS 必须 < 服务器 derbyday idle(24s)。
const HT_DRAW_MS = 8000    // 半场 20 珠交替出珠 + 和值对比定格
const HT_SHOWN_MS = 6000   // 半场定格展示（不动）
const FT_DRAW_MS = 8000    // 全场 20 珠（同构）
const DRAW_ANIM_MS = HT_DRAW_MS + HT_SHOWN_MS + FT_DRAW_MS   // 22000
const G = GAME_BY_ID['DerbyDay']

// 玩法说明文案（中文；盘口数字照实）
const RULES = [
  {
    icon: '🎯', title: '怎么玩',
    body: '主队和客队各自从 1–80 号池中抽 20 个球。前 10 球算半场（HT）比分，20 球累计算全场（FT）比分。两队比分高低决定胜负，你可以押半场或全场的多种盘口。下注在开球前截止，之后分半场、全场两阶段揭示。',
  },
  {
    icon: '📊', title: '盘口与赔率',
    body: '· 胜负：半场/全场分别押主队胜或客队胜，约 1.95 倍。若该阶段两队打平，退回本金（不算输赢）。\n· 大 / 小：半场以 810、全场以 1620 为界，大约 1.95 倍 / 小约 1.92 倍。\n· 单 / 双：按该阶段两队总分判定，约 1.95 倍。\n· 半全场：押半场和全场的胜方组合（主主 / 主客 / 客主 / 客客）。同向（主主、客客）约 2.65 倍，反转（主客、客主）约 7.1 倍。半场或全场任一打平则退本金。',
  },
  {
    icon: '🎬', title: '开奖与结算',
    body: '先揭示半场（前 10 球），再揭示全场（累计 20 球）。所有盘口在开球前已锁定，两阶段揭示只是展示过程，命中的盘口按锁定赔率结算。打平的胜负盘、半全场盘退回本金。每期独立。',
  },
  {
    icon: '🎰', title: '如何下注',
    body: '点筹码设每注金额，点盘口格下注，可同时押多个盘口。点「↻ 重复」按上一局注单原额重下。确认后一次扣款。',
  },
  {
    icon: '💡', title: '小技巧',
    body: '· 想稳押大小单双，中奖率约一半；想搏大赔押半全场反转。\n· 胜负盘和半全场盘遇平局退本金，降低了风险。\n· 本游戏理论返还率约 96%，属娱乐性质，理性游戏。',
  },
]
const ROAD_CAP = 120

// 种子上局（确定性脚本预生成后硬编码；真开奖逐期顶掉）
const SEED_LAST = deriveMatch({
  home20: [22, 13, 2, 57, 44, 64, 49, 70, 54, 62, 46, 65, 78, 27, 75, 11, 51, 14, 39, 5],
  away20: [8, 24, 25, 71, 66, 7, 44, 60, 52, 62, 40, 3, 17, 58, 23, 73, 64, 12, 53, 33],
})   // htHome 437 / htAway 419 / ftHome 848 / ftAway 795 / ftTotal 1643

// 30 期假历史 [htHome, htAway, ftHome, ftAway]（旧→新；真开奖逐期顶掉）
const SEED_ROUNDS = [
  [428, 376, 853, 856], [432, 431, 788, 894], [436, 454, 877, 834], [449, 359, 866, 724], [361, 448, 822, 905], [346, 401, 786, 786],
  [372, 385, 840, 846], [393, 394, 846, 750], [353, 377, 739, 783], [476, 400, 919, 764], [395, 461, 848, 837], [410, 457, 845, 803],
  [418, 343, 852, 733], [435, 368, 822, 758], [393, 472, 788, 805], [368, 350, 798, 680], [373, 372, 766, 734], [451, 402, 862, 860],
  [422, 435, 755, 848], [397, 407, 827, 781], [403, 474, 763, 882], [466, 422, 798, 848], [427, 390, 878, 823], [372, 449, 852, 853],
  [358, 415, 789, 875], [416, 434, 759, 905], [343, 366, 741, 817], [376, 459, 741, 910], [391, 394, 722, 772], [436, 454, 885, 934],
]

// ---------- 珠盘路（六页签）----------
const ROAD_TABS = ['HT-H/A', 'HT-O/U', 'HT-O/E', 'FT-H/A', 'FT-O/U', 'FT-O/E']
// 页签中文显示标签（key = 内部值不碰，仅译显示层）
const ROAD_TAB_LABELS = {
  'HT-H/A': '半场胜负', 'HT-O/U': '半场大小', 'HT-O/E': '半场单双',
  'FT-H/A': '全场胜负', 'FT-O/U': '全场大小', 'FT-O/E': '全场单双',
}
function beadFor(tab, r) {
  const [hh, ha, fh, fa] = r
  const half = tab.startsWith('HT')
  const home = half ? hh : fh
  const away = half ? ha : fa
  const total = home + away
  if (tab.endsWith('H/A')) {
    if (home === away) return { t: 'D', c: 'rgba(255,255,255,0.3)' }
    return home > away ? { t: 'H', c: DERBY.home } : { t: 'A', c: DERBY.away }
  }
  if (tab.endsWith('O/U')) {
    return total >= (half ? HT_BIG : FT_BIG) ? { t: 'O', c: DERBY.away } : { t: 'U', c: DERBY.home }
  }
  return total % 2 ? { t: 'O', c: DERBY.away } : { t: 'E', c: DERBY.home }   // O/E 单双
}

// 号码珠（主蓝/客红/灰 0 态）
function NumBead({ n, color, size = 24, blank = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: blank ? 'rgba(255,255,255,0.1)' : color,
      border: '1px solid rgba(0,0,0,0.35)',
      boxShadow: blank ? 'none' : 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)',
      color: COLORS.white, fontSize: size * 0.42, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box', flex: '0 0 auto',
    }}>{blank ? '' : n}</span>
  )
}


export default function DerbyDay({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
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
  const [roadTab, setRoadTab] = useState('FT-H/A')
  const [userAcc, setUserAcc] = useState({ ht: true, ft: true, htft: true })   // 手机手风琴玩家手动折叠态（默认三盘区全展开，玩家可自行收）；纯 UI，不动下注 state
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 本地「表演」子相位（仅动画层；相位/期号/倒计时真相在 room）----
  // gamePhase: betting | ht_draw | ht_shown | ft_draw | settled —— 收 drawn 后本地按时序推进
  const [gamePhase, setGamePhase] = useState('betting')
  const [animRoll, setAnimRoll] = useState(null)        // 当前开奖动画的派生赛果（触发 drawZone 重渲）
  const [lastMatch, setLastMatch] = useState(SEED_LAST)
  const [history, setHistory] = useState(SEED_ROUNDS)   // 珠盘路 + 占比条（旧→新）
  const [result, setResult] = useState(null)            // { hits:Set, pushes:Set, winTotal, refundTotal }
  const [preHits, setPreHits] = useState(null)          // FT 定格后的命中预亮
  const [toasts, setToasts] = useState([])

  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())        // 本期已下注并落库的 {key: 累计注额}（stake chip / 重复 / 余额校验）
  const lastBetsRef = useRef(new Map())          // 上局注单快照（重复投注用，照 Line Up 接法）
  const [hasLast, setHasLast] = useState(false)
  const betRef = useRef(bet)
  const pendingRef = useRef(null)          // 只读表演：当前动画派生赛果
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）
  const settledRoundRef = useRef(null)     // 已回写余额的期号（每期只回写一次）
  const settleInfoRef = useRef(null)       // 镜像 room.settleInfo，供动画结束时读取
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxPop(team) {   // 出珠：交替双音高（主低客高微差）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    const f = team ? 640 : 520
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
  }
  function sfxWhistle() {   // 阶段定格：短哨两响
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[0, 0.16].forEach(off => {
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2100, t + off); o.frequency.linearRampToValueAtTime(2350, t + off + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.035, t + off + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.13)
    })
  }
  function sfxChime(tie) {   // FT 定格：上扬三连音；平局期换中性双音
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const notes = tie ? [620, 620] : [660, 880, 1170]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * (tie ? 0.14 : 0.08)
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  function sfxHeart() {   // 关键球心跳：低频双搏 lub-dub（慢放段每球一次）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[0, 0.14].forEach((off, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(i ? 78 : 95, t + off)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.09, t + off + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16)
      o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.18)
    })
  }
  function sfxCheer() {   // 胜方欢呼声浪：带通白噪声 swell ~1.6s（结果已定后的装饰随机）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = 1.6
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(); src.buffer = buf
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + len)
  }
  const stageSfx = { pop: sfxPop, whistle: sfxWhistle, chime: sfxChime, heart: sfxHeart, cheer: sfxCheer }

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画（HT→半场定格→FT）演完：结算显示 + （有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。
  function finishRound(rnd) {
    const si = settleInfoRef.current
    const hadBet = si && si.roundNo === rnd
    // 余额回写（每期一次）：有注用后端 settleInfo.balanceAfter；无注不动钱。
    if (hadBet && si.balanceAfter != null && settledRoundRef.current !== rnd) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundRef.current = rnd
    // 视觉结算仅当本期仍是当前展示期（若下一期 betting 已抢先，跳过不覆盖新期 UI）
    if (shownRoundRef.current !== rnd) return
    const r = pendingRef.current
    let hits, pushes, winTotal = 0, refundTotal = 0
    if (hadBet) {
      // 后端三态：outcome hit → 命中高亮 + winTotal；outcome push → 退注高亮 + refundTotal（退本金）
      hits = new Set(); pushes = new Set()
      for (const it of (si.yourResult || [])) {
        if (it.outcome === 'hit') { hits.add(it.key); winTotal = round2(winTotal + Number(it.payout)) }
        else if (it.outcome === 'push') { pushes.add(it.key); refundTotal = round2(refundTotal + Number(it.payout)) }
      }
    } else {
      // 无注：仅显示，不动钱
      hits = hitsOf(r); pushes = pushesOf(r)
    }
    if (winTotal > 0) pushToast('本期命中', winTotal)
    if (refundTotal > 0) pushToast('平局退注', refundTotal)   // push 区分文案
    setLastMatch(r)
    setHistory(h => [...h, [r.htHome, r.htAway, r.ftHome, r.ftAway]].slice(-ROAD_CAP))
    setResult({ hits, pushes, winTotal, refundTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
    setGamePhase('settled')
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
      setGamePhase('betting')
    }
  }, [room.phase, room.roundNo])

  // C. drawn：收到本期开奖 → 本地依次演 HT出球(8s) → 半场定格(6s) → FT出球(8s)，到点 finishRound。
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      const roll = deriveMatch({ home20: room.drawResult.home20, away20: room.drawResult.away20 })
      pendingRef.current = roll
      setAnimRoll(roll)
      setPreHits(null)
      setGamePhase('ht_draw')
      timersRef.current.push(setTimeout(() => setGamePhase('ht_shown'), HT_DRAW_MS))
      timersRef.current.push(setTimeout(() => setGamePhase('ft_draw'), HT_DRAW_MS + HT_SHOWN_MS))
      timersRef.current.push(setTimeout(() => finishRound(rnd), DRAW_ANIM_MS))
    }
    // finishRound 走 refs，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.drawResult, room.roundNo])

  const toggleSel = key => {
    if (room.phase !== 'betting') return   // 仅 betting 相位可选，之后全盘锁死
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
      if (e?.data?.error === 'round_locked') pushToast('本期已封盘', 0)
      else setNetErr(e.message)
      return false
    }
  }
  async function confirmBets() {
    const amount = betRef.current
    if (amount < 1) return
    // 只下已定价键；未定价键（半全场占位，历史遗留）留在待选态，零扣款
    const priced = [...picksRef.current].filter(k => MARKETS[k])
    if (!priced.length) return
    const ok = await placeAndPost(new Map(priced.map(k => [k, amount])))
    if (ok) {
      const rest = new Set([...picksRef.current].filter(k => !MARKETS[k]))
      picksRef.current = rest
      setPicks(rest)
    }
  }
  // 重复投注 = 复用上局注单快照原键原额重下（结算含 push 退注路径不碰）
  function repeatBets() {
    placeAndPost(new Map(lastBetsRef.current))
  }

  const betting = room.phase === 'betting'
  // 未定价键（半全场四键，D3 枚举定价前）不进任何扣款路径：金额/可点/下单全按已定价键算
  const pricedOf = set => [...set].filter(k => MARKETS[k])
  const confirmTotal = round2(bet * pricedOf(picks).length)
  const confirmOk = betting && pricedOf(picks).length > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  const cur = animRoll
  const htVisible = cur && (gamePhase === 'ht_shown' || gamePhase === 'ft_draw' || gamePhase === 'settled')
  const ftVisible = cur && gamePhase === 'settled'

  // ---- 样式件（选中=金框；命中=绿框绿晕；push=灰金框）----
  // 三件套之三 · 胜侧泛光（settled，FT 平局整套不出）：胜方 H/A 键队色呼吸光、
  // 败方压暗；灯色由 DERBY.home/away 现组 hexA 派生，键集仅四个 H/A 键
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const ftWinner = cur && cur.ftHome !== cur.ftAway ? (cur.ftHome > cur.ftAway ? 'home' : 'away') : null
  const sideWins = result && cur && ftWinner
    ? {
        ...(cur.htHome !== cur.htAway
          ? { 'ht-home': cur.htHome > cur.htAway, 'ht-away': cur.htAway > cur.htHome }
          : {}),
        'ft-home': ftWinner === 'home', 'ft-away': ftWinner === 'away',
      }
    : null
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，FT 定格先预亮
    const pushed = result?.pushes?.has(key) && betsPlaced.has(key)
    const placed = betsPlaced.has(key)
    const sideWin = sideWins && Object.prototype.hasOwnProperty.call(sideWins, key) ? sideWins[key] : undefined
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : isDesk ? '5px 4px' : '6px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: bg,
      border: `1.5px solid ${hit ? DERBY.sel : pushed ? 'rgba(255,255,255,0.6)' : sel || placed ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: hit
        ? '0 0 12px rgba(53,208,127,0.6)'
        : sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      opacity: betting || hit || pushed || placed ? 1 : 0.75,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
      // 胜侧呼吸光 / 败侧压暗（覆盖在基础分层之上）
      ...(sideWin === true
        ? { animation: `${key.endsWith('home') ? 'ddWinBreathH' : 'ddWinBreathA'} 1.3s ease-in-out infinite` }
        : sideWin === false ? { opacity: 0.45 } : {}),
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
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

  // ---- 场馆头行（desk 走骨架 34px 历史行位）----
  const connecting = !room.connected && !room.roundNo
  const cdSec = Math.max(0, Math.ceil(room.countdownMs / 1000))
  const phaseChip = connecting
    ? { text: '连接中…', c: DERBY.dim }
    : room.phase === 'betting'
      ? { text: `⏱ 00:${String(cdSec).padStart(2, '0')}`, c: DERBY.sel }
      : room.phase === 'locked' && gamePhase === 'betting'
        ? { text: '封盘中…', c: DERBY.orange }
        : gamePhase === 'ht_draw'
          ? { text: '半场开奖中…', c: DERBY.orange }
          : gamePhase === 'ht_shown'
            ? { text: `半场已开 ${cur ? `${cur.htHome}–${cur.htAway}` : ''}`, c: DERBY.gold }
            : gamePhase === 'ft_draw'
              ? { text: '全场开奖中…', c: DERBY.orange }
              : { text: result && result.winTotal + result.refundTotal > 0 ? `+$${(result.winTotal + result.refundTotal).toFixed(2)}` : '已开奖', c: DERBY.gold }
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

  // ---- ① 开奖区：半场块（前 10 珠）+ 全场块（后 10 珠 + 累计和值） ----
  const beadSize = isMobile ? 18 : 19
  const ballGrid = (balls, color, lit) => (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`,
      gridTemplateRows: `repeat(2, ${beadSize}px)`, gap: isMobile ? 3 : 4,
    }}>
      {Array.from({ length: 10 }, (_, i) => (
        <NumBead key={i} n={lit ? balls[i] : 0} color={color} size={beadSize} blank={!lit} />
      ))}
    </div>
  )
  // 半场块 = 两队前 10 珠 + 半场和值；全场块 = 两队后 10 珠 + 全场累计和值
  const drawBlock = ({ title, homeBalls, awayBalls, homeSum, awaySum, total, lit, dimmed }) => (
    <div style={{
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 6px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      opacity: lit ? 1 : dimmed ? 0.85 : 1,
      display: 'flex', flexDirection: 'column', gap: 4,
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: isMobile ? 8 : 14, flexWrap: 'nowrap',
      }}>
        {ballGrid(homeBalls, DERBY.home, lit)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{
            padding: '2px 12px', borderRadius: RADIUS.pill,
            background: lit ? DERBY.gold : 'rgba(255,255,255,0.14)',
            color: lit ? '#3a2c00' : DERBY.dim,
            fontSize: isMobile ? 11 : 12.5, fontWeight: 900, whiteSpace: 'nowrap',
          }}>合计 {lit ? total : '—'}</span>
        </div>
        {ballGrid(awayBalls, DERBY.away, lit)}
      </div>
      {/* 下缘比分行：主/客和值 + 胜方 trophy（平局双方都不亮） */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.home, display: 'inline-block' }} />
          主队：{lit ? homeSum : '—'}
          {lit && homeSum > awaySum && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          {lit && awaySum > homeSum && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
          客队：{lit ? awaySum : '—'}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block' }} />
        </span>
      </div>
    </div>
  )
  // 舞台块外壳（与静态块同款，出球舞台原位表演不另开槽）
  const stageShell = children => (
    <div style={{
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 6px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      boxSizing: 'border-box',
    }}>{children}</div>
  )
  // 半场块：HT_DRAW 原位舞台 → 本期 HT 先亮定格；全场块：FT_DRAW 原位舞台 → FT 后亮；
  // BETTING 期全场块回显上局
  const halfBlock = gamePhase === 'ht_draw' && cur
    ? stageShell(
        <DrawStage key={`${room.roundNo}-ht`} stage="ht" roll={cur}
          beadSize={beadSize} isMobile={isMobile} sfx={stageSfx} onFinale={() => {}} />
      )
    : drawBlock(htVisible
      ? { title: '半场', homeBalls: cur.home20.slice(0, 10), awayBalls: cur.away20.slice(0, 10), homeSum: cur.htHome, awaySum: cur.htAway, total: cur.htTotal, lit: true }
      : { title: '半场 · 下期', homeBalls: [], awayBalls: [], lit: false, dimmed: true })
  // 全场舞台延挂到 settled：定格帧 + 彩带/字卡在结算期继续展示（单 rAF 贯穿，
  // 下一期 betting 换静态上局块时卸载归零）
  const fullBlock = (gamePhase === 'ft_draw' || gamePhase === 'settled') && cur
    ? stageShell(
        <DrawStage key={`${room.roundNo}-ft`} stage="ft" roll={cur}
          beadSize={beadSize} isMobile={isMobile} sfx={stageSfx}
          onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
      )
    : drawBlock(ftVisible
      ? { title: '全场', homeBalls: cur.home20.slice(10), awayBalls: cur.away20.slice(10), homeSum: cur.ftHome, awaySum: cur.ftAway, total: cur.ftTotal, lit: true }
      : betting || !cur
        ? { title: '全场 · 上局', homeBalls: lastMatch.home20.slice(10), awayBalls: lastMatch.away20.slice(10), homeSum: lastMatch.ftHome, awaySum: lastMatch.ftAway, total: lastMatch.ftTotal, lit: true }
        : { title: '全场 · 待开', homeBalls: [], awayBalls: [], lit: false, dimmed: true })
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {fullBlock}
      {halfBlock}
    </div>
  )

  // ---- ② 盘区两组（队色语义格） ----
  const GROUPS = [
    { key: 'ht', label: '实况 · 半场', big: '811–960', small: '661–810' },
    { key: 'ft', label: '实况 · 全场', big: '1621–1920', small: '1322–1620' },
  ]
  const marketGroup = g => (
    <div key={g.key} style={{ ...secBox, ...(isDesk ? { flex: '1 1 0', minWidth: 0 } : {}) }}>
      <div style={secHead}>{g.label}</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-home`)}
          style={cellBase(`${g.key}-home`, DERBY.home)}>
          <span style={cellName}>主队</span>
          <span style={cellOdds}>{ODDS.main.toFixed(2)}</span>
          {stakeChip(`${g.key}-home`)}
        </button>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-away`)}
          style={cellBase(`${g.key}-away`, DERBY.away)}>
          <span style={cellName}>客队</span>
          <span style={cellOdds}>{ODDS.main.toFixed(2)}</span>
          {stakeChip(`${g.key}-away`)}
        </button>
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {[
          { k: 'big', name: '大', range: g.big },
          { k: 'small', name: '小', range: g.small },
          { k: 'odd', name: '单', range: '和值单' },
          { k: 'even', name: '双', range: '和值双' },
        ].map(m => (
          <button key={m.k} type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-${m.k}`)}
            style={cellBase(`${g.key}-${m.k}`, DERBY.grey)}>
            <span style={cellName}>{m.name}</span>
            <span style={cellRange}>{m.range}</span>
            <span style={cellOdds}>{MARKETS[`${g.key}-${m.k}`].odds.toFixed(2)}</span>
            {stakeChip(`${g.key}-${m.k}`)}
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ②b 半全场组合盘（D3 已定价接结算：走 MARKETS 既有 hit/push 路径）----
  const HTFT = [
    { key: 'ht-ft-hh', a: '主', b: '主' },
    { key: 'ht-ft-ha', a: '主', b: '客' },
    { key: 'ht-ft-ah', a: '客', b: '主' },
    { key: 'ht-ft-aa', a: '客', b: '客' },
  ]
  const htftCell = m => (
    <button key={m.key} type="button" className="ddCell" data-key={m.key} disabled={!betting}
      onClick={() => toggleSel(m.key)} style={cellBase(m.key, DERBY.grey)}>
      <span style={cellName}>
        <span style={{ color: m.a === '主' ? DERBY.home : DERBY.away }}>{m.a}</span>
        <span style={{ color: DERBY.dim, padding: '0 3px' }}>/</span>
        <span style={{ color: m.b === '主' ? DERBY.home : DERBY.away }}>{m.b}</span>
      </span>
      <span style={cellOdds}>{MARKETS[m.key].odds.toFixed(2)}</span>
      {stakeChip(m.key)}
    </button>
  )
  const htftGroup = (
    <div style={secBox}>
      <div style={secHead}>半全场 · 半场胜方 / 全场胜方</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
        {HTFT.slice(0, 2).map(htftCell)}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {HTFT.slice(2).map(htftCell)}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（六页签 + 占比条按近 30 期重算 + 6×20 真历史） ----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 16 : 14   // 移动端珠子大一档（横滚可辨），桌面压一档保总高
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(r => beadFor(roadTab, r))
  // 占比条：近 30 期按当前页签所属盘（HT/FT）的 H/A 重算
  const ratioSrc = history.slice(-30)
  const ratioHalf = roadTab.startsWith('HT')
  let hw = 0, dw = 0, aw = 0
  ratioSrc.forEach(([hh, ha, fh, fa]) => {
    const home = ratioHalf ? hh : fh, away = ratioHalf ? ha : fa
    if (home > away) hw++; else if (home === away) dw++; else aw++
  })
  const pct = n => Math.round((n / Math.max(1, ratioSrc.length)) * 100)
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: roadTab === t ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${roadTab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{ROAD_TAB_LABELS[t]}</button>
        ))}
      </div>
      {/* 占比条：近 30 期 H/A 分布（随页签 HT/FT 切换重算） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: DERBY.home, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主队 {pct(hw)}%</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: `${pct(hw)}%`, background: DERBY.home }} />
          <span style={{ width: `${pct(dw)}%`, background: 'rgba(255,255,255,0.4)' }} />
          <span style={{ width: `${pct(aw)}%`, background: DERBY.away }} />
        </div>
        <span style={{ color: DERBY.dim, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>和 {pct(dw)}%</span>
        <span style={{ color: DERBY.away, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客队 {pct(aw)}%</span>
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: 8.5, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
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
      <style>{`
        .ddCell:hover:not(:disabled) { filter: brightness(1.2); }
        @keyframes ddWinBreathH {
          0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.home, 0.45)}; }
          50% { box-shadow: 0 0 18px ${hexA(DERBY.home, 0.8)}, 0 0 30px ${hexA(DERBY.home, 0.4)}; }
        }
        @keyframes ddWinBreathA {
          0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.away, 0.45)}; }
          50% { box-shadow: 0 0 18px ${hexA(DERBY.away, 0.8)}, 0 0 30px ${hexA(DERBY.away, 0.4)}; }
        }
      `}</style>

      {/* ---- top bar（共享件：名 pill 下拉 + 场馆/期号/相位 + ?/音频钮）---- */}
      {topBar}

      {/* ① 开奖区（顶部）：全场块 + 半场块（按相位亮真珠） */}
      {drawZone}

      {/* ② 盘区：半场/全场两组（desk 并排压总高）+ 半全场占位组（中部；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          {GROUPS.map(marketGroup)}
        </div>
        {htftGroup}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，六页签 + 占比条） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案版式）：
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
            <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              label={betting ? `▷ 下注 ${pricedOf(picks).length} 格` : gamePhase === 'settled' ? '本期已结算' : '已锁盘 · 开赛中'}
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

  // ============ 手机三段式（<1024，照滚球 5fb7171）：锁顶(顶栏+双舞台) / 中滚(三折叠盘区) / 锁底(珠盘路+注栏) ============
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开三盘区看 hit/push/lose 高亮，betting 恢复玩家手动态。
  const settledOpen = gamePhase === 'settled'
  const effAcc = settledOpen ? { ht: true, ft: true, htft: true } : userAcc
  const selCount = (section) => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => {
      const belong = section === 'htft' ? k.startsWith('ht-ft-')
        : section === 'ht' ? (k.startsWith('ht-') && !k.startsWith('ht-ft-'))
          : k.startsWith('ft-')
      if (belong) n++
    })
    return n
  }
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
  // 盘区体（去 secBox/secHead，供折叠体；桌面仍走 marketGroup/htftGroup 原 const，零改）
  const marketBody = g => (
    <>
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-home`)} style={cellBase(`${g.key}-home`, DERBY.home)}>
          <span style={cellName}>主队</span><span style={cellOdds}>{ODDS.main.toFixed(2)}</span>{stakeChip(`${g.key}-home`)}
        </button>
        <button type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-away`)} style={cellBase(`${g.key}-away`, DERBY.away)}>
          <span style={cellName}>客队</span><span style={cellOdds}>{ODDS.main.toFixed(2)}</span>{stakeChip(`${g.key}-away`)}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        {[
          { k: 'big', name: '大', range: g.big },
          { k: 'small', name: '小', range: g.small },
          { k: 'odd', name: '单', range: '和值单' },
          { k: 'even', name: '双', range: '和值双' },
        ].map(m => (
          <button key={m.k} type="button" className="ddCell" disabled={!betting} onClick={() => toggleSel(`${g.key}-${m.k}`)} style={cellBase(`${g.key}-${m.k}`, DERBY.grey)}>
            <span style={cellName}>{m.name}</span><span style={cellRange}>{m.range}</span><span style={cellOdds}>{MARKETS[`${g.key}-${m.k}`].odds.toFixed(2)}</span>{stakeChip(`${g.key}-${m.k}`)}
          </button>
        ))}
      </div>
    </>
  )
  const htftBody = (
    <>
      <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>{HTFT.slice(0, 2).map(htftCell)}</div>
      <div style={{ display: 'flex', gap: 5 }}>{HTFT.slice(2).map(htftCell)}</div>
    </>
  )
  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      <style>{`
        .ddCell:hover:not(:disabled) { filter: brightness(1.2); }
        @keyframes ddWinBreathH { 0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.home, 0.45)}; } 50% { box-shadow: 0 0 18px ${hexA(DERBY.home, 0.8)}, 0 0 30px ${hexA(DERBY.home, 0.4)}; } }
        @keyframes ddWinBreathA { 0%, 100% { box-shadow: 0 0 8px ${hexA(DERBY.away, 0.45)}; } 50% { box-shadow: 0 0 18px ${hexA(DERBY.away, 0.8)}, 0 0 30px ${hexA(DERBY.away, 0.4)}; } }
      `}</style>

      {/* ① 锁顶：GameTopBar + 双舞台 drawZone（canvas 常驻挂载，禁折叠禁卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {drawZone}
      </div>

      {/* ② 中滚：三盘区手风琴（HT 开 / FT 开 / 半全场 收；结算相位全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('ht', GROUPS[0].label, marketBody(GROUPS[0]))}
        {accSection('ft', GROUPS[1].label, marketBody(GROUPS[1]))}
        {accSection('htft', '半全场 · 半场胜方 / 全场胜方', htftBody)}
      </div>

      {/* ③ 锁底：珠盘路(6视角 pill 原样 + 珠压 2 行 + 占比细条 ~110px) + 注栏 */}
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ padding: '4px 12px 0', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 3 }}>
            {ROAD_TABS.map(t => (
              <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
                flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 9px', borderRadius: RADIUS.pill,
                background: roadTab === t ? DERBY.sel : 'rgba(0,0,0,0.35)', color: roadTab === t ? '#083a1b' : DERBY.dim,
                border: `1px solid ${roadTab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
                fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
              }}>{ROAD_TAB_LABELS[t]}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ color: DERBY.home, fontSize: 8.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主 {pct(hw)}%</span>
            <div style={{ flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
              <span style={{ width: `${pct(hw)}%`, background: DERBY.home }} />
              <span style={{ width: `${pct(dw)}%`, background: 'rgba(255,255,255,0.4)' }} />
              <span style={{ width: `${pct(aw)}%`, background: DERBY.away }} />
            </div>
            <span style={{ color: DERBY.away, fontSize: 8.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客 {pct(aw)}%</span>
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 8, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 3 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(2, 15px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 15px)`, gap: 2, width: 'max-content' }}>
              {Array.from({ length: ROAD_COLS * 2 }).map((_, i) => {
                const b = beads[i]
                return (
                  <span key={i} style={{
                    width: 15, height: 15, borderRadius: '50%',
                    background: b ? b.c : 'rgba(255,255,255,0.05)',
                    border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: COLORS.white, fontSize: 7.5, fontWeight: 900,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                  }}>{b ? b.t : ''}</span>
                )
              })}
            </div>
          </div>
        </div>
        <div style={{ padding: '6px 12px', background: DERBY.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
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
              <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
                label={betting ? `▷ 下注 ${pricedOf(picks).length} 格` : gamePhase === 'settled' ? '本期已结算' : '已锁盘 · 开赛中'}
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

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Hat Trick ----
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
      <style>{`.ddMobileRoot{height:100vh;height:100dvh;overflow:hidden}`}</style>
      <div className="ddMobileRoot">{mobileCard}</div>
    </>
  )
}
