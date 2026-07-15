import { useState, useRef, useEffect, useMemo } from 'react'
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
import DominoDuelMarkets from './markets-ui/DominoDuelMarkets'   // #41 单16：盘口区切件（section= 逐段接入手风琴，视觉原样）
import DominoDuelRoad from './markets-ui/DominoDuelRoad'         // #41 单16：珠盘路墙（页签/判定单一出处，走引擎）
import { RULES } from './markets-ui/dominoduelRules'            // #41 单16：玩法说明内容（共享）

// Domino Duel — 骨牌版主客对决（闲庄→主蓝客红），第 21 卡。
// X2：真引擎 + 真赔率 + 真算钱（抄 Derby Day 结构）。翻牌动画留 X3。
// 规则：标准 28 张多米诺(0-0..6-6) 无放回抽 4 → 主 2 张 / 客 2 张；
//   得分 = 该队 4 端点和 mod 10（0-9）。主要盘比大小，平局时主胜/客胜盘 push 退本金。
//   全场进球 = 主分+客分合计(0-18，非 mod)。主/客总分各 0-9。波胆仅 9 个热门比分开盘。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点（含 push 退注：
//   主胜/客胜盘平局退回本金，不算赢不算输，WinToast 用「平局退注」区分文案）。

// —— 引擎常量块已剪切到 ./markets/dominoduel（赔率单一数据源）。原名 import 回用 + re-export 保外部引用。——
import { round2, deriveRound, MARKETS, hitsOf, pushesOf, rollTiles, ODDS } from './markets/dominoduel'
export { rollTiles, deriveRound, ODDS, MARKETS, hitsOf, pushesOf }

// ---------- 开奖动画时长（#43 单3：收到 drawn → 翻牌演出 → 结算显示 + 回写余额）----------
// 须 < 服务器 idle(13s)。翻牌 ~3.5s（FLIP_END+揭比分）+ 悬念保留 → 6s 后翻 settled（揭胜负+彩带+余额落定才跳）。
const DRAW_ANIM_MS = 6000
// 翻牌错峰时间轴（秒）：主1→客1→主2→客2，第4张（决胜）慢镜
const FLIP_DELAY = [0, 0.55, 1.1, 1.75]
const FLIP_DUR = [0.55, 0.55, 0.55, 1.4]
const FLIP_END = 1.75 + 1.4   // 末张翻完 ≈ 3.15s
const ROAD_CAP = 120

const G = GAME_BY_ID['DominoDuel']

// 玩法说明文案（RULES）已切至 ./markets-ui/dominoduelRules（原页 HowToPlay 与多桌卡共用，single source）。
const SEED_LAST = deriveRound([[3, 2], [1, 1], [2, 1], [0, 1]])   // 上局回顾种子（真开奖逐期顶掉）
// 珠盘路种子：存整局 [主分, 客分]（真开奖逐期顶入），多视角一律从整局派生
const SEED_ROAD = [
  [6, 3], [2, 5], [7, 4], [5, 5], [1, 8], [9, 2], [3, 6], [8, 1], [6, 2], [4, 7],
  [5, 5], [7, 3], [2, 6], [8, 4], [3, 7], [9, 1], [6, 4], [2, 8], [5, 5], [7, 2],
  [3, 6], [8, 5], [4, 7], [6, 3], [7, 1], [2, 5], [6, 4], [5, 5], [3, 8], [9, 4],
  [6, 2], [4, 7], [8, 3], [2, 6], [7, 5], [4, 4], [3, 7], [6, 1], [8, 4], [2, 7],
]
// 珠盘路多视角(DD_ROAD_TABS/DD_ROAD_LABELS/ddBeadFor) 已随墙件切至 ./markets-ui/DominoDuelRoad（页签/判定单一出处，走引擎）。

// 多米诺点位（0-6，3×3 宫格索引；照 DieFace 先例）
const DOMPIPS = {
  0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

// 盘面玩法元数据(MAIN/totalRow/GOALS/CORRECT) 已随盘口区切至 ./markets-ui/DominoDuelMarkets（键区单一出处）。

// 单张多米诺（竖向：上半 / 分隔线 / 下半，各半画 pip 点）
// flip：drawing 相位 3D 翻牌（背面队色 → 正面点数），delay/dur 错峰 + 决胜张慢镜
function DominoTile({ a, b, size = 34, flip = false, delay = 0, dur = 0.55, backColor = DERBY.home }) {
  const half = (v, key) => (
    <div key={key} style={{
      width: size, height: size, position: 'relative',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, boxSizing: 'border-box',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {DOMPIPS[v].includes(i) && (
            <span style={{ width: size * 0.16, height: size * 0.16, borderRadius: '50%', background: '#10131a' }} />
          )}
        </span>
      ))}
    </div>
  )
  const face = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: size, height: size * 2 + 2,
      background: '#f4f6fb', borderRadius: size * 0.16,
      border: '1px solid rgba(0,0,0,0.35)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      overflow: 'hidden', boxSizing: 'border-box',
    }}>
      {half(a, 'a')}
      <div style={{ height: 2, background: 'rgba(0,0,0,0.35)' }} />
      {half(b, 'b')}
    </div>
  )
  if (!flip) return face
  return (
    <div style={{ perspective: 700, width: size, height: size * 2 + 2 }}>
      <div className="ddFlipInner" style={{
        position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d',
        animation: `ddFlip ${dur}s cubic-bezier(0.4,0.75,0.3,1) ${delay}s both`,
      }}>
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>{face}</div>
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
          borderRadius: size * 0.16, border: '1px solid rgba(0,0,0,0.4)', boxSizing: 'border-box',
          background: `linear-gradient(135deg, ${backColor}, rgba(0,0,0,0.45))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.85)', fontSize: size * 0.55, fontWeight: 900,
        }}>⬦</div>
      </div>
    </div>
  )
}

export default function DominoDuel({ serverBalance, setServerBalance, playerToken, onLogout, onBack }) {
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
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())
  // ---- 本地「表演」状态机（仅动画层；相位真相在 room）：betting | locked | drawing | settled ----
  const [uiPhase, setUiPhase] = useState('betting')
  const [animRound, setAnimRound] = useState(null)        // 当前开奖动画的派生局（deriveRound 形状）
  const [lastRound, setLastRound] = useState(SEED_LAST)
  const [road, setRoad] = useState(SEED_ROAD)
  const [roadTab, setRoadTab] = useState('H/A')   // 珠盘路视角（手机/桌面共用一个 state）
  const [userAcc, setUserAcc] = useState({ main: true, totals: true, goals: true, correct: false })   // 手机手风琴（波胆高赔默认收，余默认全开）
  const [result, setResult] = useState(null)              // { hits:Set, pushes:Set, winTotal, refundTotal }
  const [toasts, setToasts] = useState([])
  const [hasLast, setHasLast] = useState(false)

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

  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const audioRef = useRef({ ctx: null, muted: false })

  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- 声景（WebAudio 合成，抄 Hat Trick 足球语义；muted 门控）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxWhoosh() {   // 翻牌/射门：低频重击 + 破空短扫
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.14)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.045, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    ns.connect(bp); bp.connect(g2); g2.connect(ctx.destination); ns.start(t); ns.stop(t + 0.16)
  }
  function sfxSnap() {   // 骨牌定格/入网：软噪声刷过
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.15)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.15)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.15)
  }
  function sfxCheer(win) {   // 定格欢呼：宽带噪声起伏 + 亮音 + 进球哨
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const dur = win ? 1.5 : 0.9, peak = win ? 0.14 : 0.08
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1050; bp.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + dur)
    if (win) {
      [660, 990, 1320].forEach((f, i) => {
        const o = ctx.createOscillator(); const og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
        const s = t + i * 0.09
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.07, s + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
        o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
      })
      // 进球哨（两短高哨带颤）
      ;[0, 0.2].forEach((off, i) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2300 + i * 120
        const lfo = ctx.createOscillator(); lfo.frequency.value = 26
        const lg = ctx.createGain(); lg.gain.value = 55
        lfo.connect(lg); lg.connect(o.frequency)
        const og = ctx.createGain(); const s = t + 0.5 + off
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.05, s + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, s + (i ? 0.24 : 0.14))
        o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.26); lfo.start(s); lfo.stop(s + 0.26)
      })
    }
  }

  // 翻牌声景：进入 drawing 按错峰排「翻牌 whoosh + 落定 snap」
  useEffect(() => {
    if (uiPhase !== 'drawing' || reduced) return
    FLIP_DELAY.forEach((d, i) => {
      timersRef.current.push(setTimeout(sfxWhoosh, d * 1000))
      timersRef.current.push(setTimeout(sfxSnap, (d + FLIP_DUR[i]) * 1000))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase])
  // 结算欢呼：进入 settled，有中注则强化欢呼+哨
  useEffect(() => {
    if (uiPhase !== 'settled') return
    if (!reduced) sfxCheer(result?.winTotal > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase])

  function pushToast(label, win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label, win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 开奖动画演完：结算显示（hit/push/lose 三态）+（有注则）回写余额。余额落定才跳（settleInfo 只在此消费）。
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
    let hits, pushes, winTotal = 0, refundTotal = 0
    if (hadBet) {
      // 后端三态：hit → 命中高亮（波胆高赔）+ winTotal；push → 退注高亮 + refundTotal（退本金）；lose → 无
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
    setLastRound(r)
    setRoad(rd => [...rd, [r.hs, r.as]].slice(-ROAD_CAP))   // 存整局 → 珠盘路多视角派生（判定走引擎）
    setResult({ hits, pushes, winTotal, refundTotal })
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

  // C. drawn：收到本期开奖 → 启动翻牌演出（只读表演），到点 finishRound
  useEffect(() => {
    if (room.drawResult && room.roundNo && animatedRoundRef.current !== room.roundNo) {
      animatedRoundRef.current = room.roundNo
      const rnd = room.roundNo
      const derived = deriveRound(room.drawResult.tiles)   // 后端 4 骨牌，本地重派生 hs/as/homeTiles/awayTiles
      pendingRef.current = derived
      setAnimRound(derived)
      if (import.meta.env.DEV) window.__DOM_ANIM_LAST = derived.tiles.map(t => t.join('|')).join(',')
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
    if (amount < 1) return
    const priced = [...picksRef.current].filter(k => MARKETS[k])
    if (!priced.length) return
    const ok = await placeAndPost(new Map(priced.map(k => [k, amount])))
    if (ok) { picksRef.current = new Set(); setPicks(new Set()) }
  }
  function repeatBets() { placeAndPost(new Map(lastBetsRef.current)) }

  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && (serverBalance == null || confirmTotal <= serverBalance)
  let lastTotal = 0
  lastBetsRef.current.forEach(s => { lastTotal = round2(lastTotal + s) })
  const repeatOk = betting && hasLast && lastTotal > 0 && (serverBalance == null || lastTotal <= serverBalance)
  // 对决区当前展示局：betting/locked 显上局回顾；drawing/settled 显本局开牌
  const shown = (drawing || settled) && animRound ? animRound : lastRound

  // 盘口区键件(secHead/cellName/cellRange/cellOdds/cellBase/stakeChip/rowCell/colCell/scoreCell/oddsStr)
  // 已随盘口区切至 ./markets-ui/DominoDuelMarkets（键区单一出处）。secBox 留用于手机手风琴外壳(accSection)。
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 4 : 5,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
  }
  // 盘口区共享 props（桌面平铺 / 手机逐段 section= 同一出处，中奖高亮/退注态走件内建标准）
  const marketsProps = {
    onPick: toggleSel, stakes: betsPlaced, disabled: !betting,
    selected: picks, hits: result?.hits, pushes: result?.pushes, isMobile,
  }

  // ---- 顶栏 ----
  const connecting = !room.connected && !room.roundNo
  const secs = String(Math.max(0, Math.ceil(room.countdownMs / 1000))).padStart(2, '0')
  const phaseInfo = connecting
    ? { text: '连接中…', c: DERBY.dim }
    : betting
      ? { text: `⏱ 00:${secs}`, c: DERBY.sel }
      : uiPhase === 'locked'
        ? { text: '封盘中…', c: DERBY.orange }
        : drawing
          ? { text: '开牌中…', c: DERBY.orange }
          : { text: result && result.winTotal > 0 ? `已开 +$${result.winTotal.toFixed(2)}` : '已开牌', c: DERBY.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseInfo.c}`,
      color: phaseInfo.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseInfo.text}{phaseInfo.cd && <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{secs}</span>}</span>
  )
  const topBar = (
    <>
      <GameTopBar balance={serverBalance ?? 0} venue={G.venue ?? G.displayName}
        roundId={room.roundNo || '连接中…'}
        phaseChip={phaseChipNode} onHowTo={() => setRulesOpen(true)} onHistory={() => setHistoryOpen(true)} onFairness={() => setFairOpen(true)} onBack={onBack} />
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

  // ---- ① 对决区：主(蓝) VS 客(红)，各两张骨牌 + 比分（drawing 翻牌演出）----
  const tileSz = isMobile ? 28 : 32
  const flipping = drawing && !reduced   // 翻牌相位（动画只读 pendingRef）
  const teamBlock = (name, tiles, score, color, side) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
      <span style={{
        padding: '2px 12px', borderRadius: RADIUS.pill, background: color,
        color: COLORS.white, fontSize: isMobile ? 11 : 12, fontWeight: 900, letterSpacing: 0.5,
      }}>{name}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {tiles.map((t, i) => {
          const slot = side === 'h' ? i * 2 : i * 2 + 1   // 全局翻序 主1→客1→主2→客2
          return <DominoTile key={i} a={t[0]} b={t[1]} size={tileSz}
            flip={flipping} delay={FLIP_DELAY[slot]} dur={FLIP_DUR[slot]} backColor={color} />
        })}
      </div>
      <span style={{
        color: COLORS.white, fontSize: isMobile ? 22 : 26, fontWeight: 900,
        fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 10px ${color}`,
        ...(flipping ? { animation: `ddScoreIn 0.4s ease ${FLIP_END}s both` } : {}),   // 翻完再揭比分（不剧透）
      }}>{score}</span>
    </div>
  )
  // 结果只在 settled 揭示（drawing 不剧透胜负）
  const outcomeTag = settled && shown
    ? (shown.hs > shown.as ? { t: '主队胜', c: DERBY.home } : shown.as > shown.hs ? { t: '客队胜', c: DERBY.away } : { t: '平局', c: DERBY.gold })
    : null
  // 赢队半场彩带（主胜落左半 / 客胜落右半 / 平局全场）
  const winSide = shown ? (shown.hs > shown.as ? 'home' : shown.as > shown.hs ? 'away' : 'tie') : 'tie'
  const confetti = useMemo(() => Array.from({ length: 42 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.5, dur: 1.1 + Math.random() * 1.3,
    rot: (Math.random() * 2 - 1) * 540,
    color: [DERBY.gold, '#35d07f', '#ffffff', DERBY.home, DERBY.away][i % 5], size: 4 + Math.random() * 4,
    // room.roundNo 作重生成键：每局换一批彩带位置（body 不直接引用，禁 lint 误报）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [room.roundNo])
  const duelZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '10px 8px' : '10px 18px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 14 : 30, boxSizing: 'border-box', flexWrap: 'wrap', overflow: 'hidden',
    }}>
      {settled && !reduced && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3,
          left: winSide === 'away' ? '50%' : 0, right: winSide === 'home' ? '50%' : 0,
        }}>
          {confetti.map((p, i) => (
            <span key={i} style={{
              position: 'absolute', top: -12, left: `${p.left}%`, width: p.size, height: p.size * 0.55,
              background: p.color, borderRadius: 1, '--rot': `${p.rot}deg`,
              animation: `ddConfFall ${p.dur}s linear ${p.delay}s both`,
            }} />
          ))}
        </div>
      )}
      {teamBlock('主队', shown.homeTiles, shown.hs, DERBY.home, 'h')}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto', zIndex: 4 }}>
        <span style={{ color: DERBY.gold, fontSize: isMobile ? 16 : 20, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif" }}>VS</span>
        {outcomeTag && (
          <span style={{
            padding: '1px 8px', borderRadius: RADIUS.pill, background: 'rgba(0,0,0,0.4)',
            border: `1px solid ${outcomeTag.c}`, color: outcomeTag.c, fontSize: 9, fontWeight: 900, whiteSpace: 'nowrap',
          }}>{outcomeTag.t}</span>
        )}
      </div>
      {teamBlock('客队', shown.awayTiles, shown.as, DERBY.away, 'a')}
    </div>
  )

  // ---- ② 盘区（主要盘/主客总分/全场进球/波胆）：已切至 ./markets-ui/DominoDuelMarkets（键区单一出处）。----
  // 桌面平铺 5 盘 = 无 section 的 !isMobile 分支；手机逐段 = section= 分支（下方手风琴 body 接入）。

  // ---- ③ 珠盘路（B 型多视角：存整局 → roadTab 派生 主客/大小/单双；手机桌面共用 roadTab）----
  // 珠盘路墙（页签/比例条/珠矩阵/判定 ddBeadFor）已切至 ./markets-ui/DominoDuelRoad；road 存整局 [hs,as] 逐期派生。
  // 桌面 rows=6/bead=(手机18/桌面14)；手机锁底 rows=2/bead=15（原页两处尺寸差，外部传参，视觉原样）。
  const beadRoad = (
    <DominoDuelRoad history={road} tab={roadTab} onTab={setRoadTab}
      cols={20} rows={6} bead={isMobile ? 18 : 14} tabFs={10} ratioFs={9.5} pad={6} radius={10}
      style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, margin: isMobile ? '0 12px 8px' : '0 18px 8px' }} />
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      {/* .ddCell hover 样式已随盘口区切至 DominoDuelMarkets（组件内 <style> 挂）；下留对决区(舞台)动画 keyframes */}
      <style>{`
        @keyframes ddFlip { from { transform: rotateY(180deg); } to { transform: rotateY(0deg); } }
        @keyframes ddScoreIn { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.18); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes ddConfFall {
          0% { transform: translateY(-12px) rotate(0deg); opacity: 0; }
          12% { opacity: 1; }
          100% { transform: translateY(230px) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
      {topBar}
      {duelZone}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box', gap: 5, overflowY: 'auto',
      }}>
        <WinToast toasts={toasts} />
        <DominoDuelMarkets {...marketsProps} isDesk={isDesk} />
      </div>
      <div style={{ flex: '1 0 auto' }} />
      {beadRoad}

      {/* ---- 底部下注栏 grid 4×2 ---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: DERBY.band,
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
            <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
            color: repeatOk ? COLORS.white : DERBY.dim, background: 'rgba(0,0,0,0.35)',
            border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
            cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
            boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={betting ? `下注 ${picks.size} 格` : drawing ? '开牌中…' : '本局已结'}
              sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
              onClick={confirmBets}
              disabled={!confirmOk}
              stretch
            />
          </div>
        </div>
      </div>

      {/* 玩法说明抽屉（position:fixed 覆盖，桌面/移动两分支共用同一 gameCard）*/}
      <CommitRevealFairness open={fairOpen} onClose={() => setFairOpen(false)} venue={G.venue ?? G.displayName} round={room.commit ? { ...room.commit, commitHash: room.commit.serverSeedHash } : null} onViewHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} game={G.backendId} venue={G.venue ?? G.displayName} playerToken={playerToken} onLogout={onLogout} pendingRound={room.commit} />
      <HowToPlay open={rulesOpen} onClose={() => setRulesOpen(false)}
        venue={G.venue ?? G.displayName} title={`${G.displayName} 玩法说明`} sections={RULES} />
    </Panel>
  )

  // ============ 手机三段式（<1024，照德比 fc5fcd1）：锁顶(顶栏+对决区) / 中滚(四折叠盘区) / 锁底(珠盘路多视角+注栏) ============
  // 折叠纯 UI（userAcc），不动下注 state；结算相位(settled)自动展开看 hit/push/lose 高亮，betting 恢复玩家手动态。
  const effAcc = settled ? { main: true, totals: true, goals: true, correct: true } : userAcc
  const selCount = section => {
    let n = 0
    new Set([...picks, ...betsPlaced.keys()]).forEach(k => {
      const belong = section === 'main' ? ['home-win', 'away-win', 'draw'].includes(k)
        : section === 'totals' ? (k.startsWith('h-') || k.startsWith('a-'))
          : section === 'goals' ? k.startsWith('g-')
            : k.startsWith('cs-')   // correct
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
  // 盘区体（去 secBox/secHead，逐段 section= 接入手风琴）：键区/subLabel 已切至 DominoDuelMarkets（单一出处，分毫不变）。
  const mainBody = <DominoDuelMarkets {...marketsProps} section="main" />
  const totalsBody = <DominoDuelMarkets {...marketsProps} section="totals" />
  const goalsBody = <DominoDuelMarkets {...marketsProps} section="goals" />
  const correctBody = <DominoDuelMarkets {...marketsProps} section="correct" />

  const mobileCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    }}>
      {/* .ddCell hover 样式已随盘口区切至 DominoDuelMarkets（组件内 <style> 挂）；下留对决区(舞台)动画 keyframes */}
      <style>{`
        @keyframes ddFlip { from { transform: rotateY(180deg); } to { transform: rotateY(0deg); } }
        @keyframes ddScoreIn { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.18); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes ddConfFall { 0% { transform: translateY(-12px) rotate(0deg); opacity: 0; } 12% { opacity: 1; } 100% { transform: translateY(230px) rotate(var(--rot)); opacity: 0; } }
      `}</style>

      {/* ① 锁顶：GameTopBar + 对决区（DOM 常驻，禁折叠禁卸载） */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        {topBar}
        {duelZone}
      </div>

      {/* ② 中滚：四盘区手风琴（主要/总分/进球 开，波胆收；结算相位全展开） */}
      <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '6px 12px', position: 'relative', zIndex: 1 }}>
        <WinToast toasts={toasts} />
        {accSection('main', '主要盘 · 主胜 / 平 / 客胜', mainBody)}
        {accSection('totals', '队伍总分 · 大小单双', totalsBody)}
        {accSection('goals', '全场总进球 · 大小单双', goalsBody)}
        {accSection('correct', '正确比分 · 波胆', correctBody)}
      </div>

      {/* ③ 锁底：珠盘路多视角 pill + 注栏（原样搬） */}
      <div style={{ flex: '0 0 auto' }}>
        <DominoDuelRoad history={road} tab={roadTab} onTab={setRoadTab}
          cols={20} rows={2} bead={15} tabFs={9.5} ratioFs={8.5} pad={3} radius={8}
          style={{ padding: '4px 12px 0', position: 'relative', zIndex: 1 }} />
        <div style={{ padding: '6px 12px', background: DERBY.band, borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
            gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
          }}>
            {[
              { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
              { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
            ].map(({ v, col, row }) => (
              <button key={v} type="button" className="ddChip" disabled={!betting} onClick={() => setBet(v)} style={{
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
              color: repeatOk ? COLORS.white : DERBY.dim, background: 'rgba(0,0,0,0.35)',
              border: `1px solid rgba(255,255,255,${repeatOk ? 0.35 : 0.15})`,
              cursor: repeatOk ? 'pointer' : 'not-allowed', opacity: repeatOk ? 1 : 0.5,
              boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>↻ 重复{hasLast ? ` $${lastTotal.toFixed(0)}` : ''}</button>
            <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
              <BetButton state="bet"
                label={betting ? `下注 ${picks.size} 格` : drawing ? '开牌中…' : '本局已结'}
                sub={betting ? `$${confirmTotal.toFixed(0)}` : undefined}
                onClick={confirmBets} disabled={!confirmOk} stretch />
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

  // ---- Spribe-parity desktop skeleton (≥1024) ----
  if (isDesk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640, background: COLORS.bg }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ flex: 1, minHeight: 0 }}>{gameCard}</div>
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
