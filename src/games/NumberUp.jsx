import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, NUMBERUP } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import WinToast from '../components/shell/WinToast'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useSfxMuted } from '../components/shell/bgmManager'
import GameTopBar from '../components/shell/GameTopBar'

// Number Up — 两位数球衣号码彩（00–99）。
// 引擎：0–99 均匀抽一个；头位/尾位/大小单双全部由 num 派生。
// 轮次：BETTING(24s) → REVEAL(3s 占位，单3 换换人牌动画) → SETTLED(3s) → 下一期。
// 算钱路径：confirmBets() 唯一扣注点，settleRound() 唯一赔付点。

const pad2 = n => String(n).padStart(2, '0')

// ---------- 引擎（纯函数区，禁副作用）----------
// 0–99 均匀抽一个；rng 可注入（对账/模拟用）
export function drawNumber(rng = Math.random) {
  return Math.floor(rng() * 100)
}

// 派生：头位 / 尾位 / 大小 / 单双（单双按尾数奇偶 = num 本身奇偶）
export function deriveNum(num) {
  return { num, first: Math.floor(num / 10), last: num % 10, high: num >= 50, odd: num % 2 === 1 }
}

// 赔率配置表（均匀分布下全部精确可算，无需模拟标定）：
//   直选  95.00 × P=1/100 → RTP 95.0% 精确
//   头/尾位 9.50 × P=1/10 → RTP 95.0% 精确
//   HIGH/LOW/ODD/EVEN 1.91 × P=1/2 → RTP 95.5% 精确
export const ODDS = { pick: 95, digit: 9.5, side: 1.91 }

// 盘区判定表 — 数据驱动生成（124 键），settle/珠盘路/RTP 模拟共用，零散落 if
export const MARKETS = (() => {
  const m = {}
  for (let n = 0; n < 100; n++) m[`n-${pad2(n)}`] = { odds: ODDS.pick, hit: r => r.num === n }
  for (let d = 0; d <= 9; d++) {
    m[`fd-${d}`] = { odds: ODDS.digit, hit: r => r.first === d }
    m[`ld-${d}`] = { odds: ODDS.digit, hit: r => r.last === d }
  }
  m['s-high'] = { odds: ODDS.side, hit: r => r.high }
  m['s-low']  = { odds: ODDS.side, hit: r => !r.high }
  m['s-odd']  = { odds: ODDS.side, hit: r => r.odd }
  m['s-even'] = { odds: ODDS.side, hit: r => !r.odd }
  return m
})()
const MARKET_KEYS = Object.keys(MARKETS)
export const hitsOf = r => new Set(MARKET_KEYS.filter(k => MARKETS[k].hit(r)))

const round2 = x => Math.round(x * 100) / 100

// dev 测试钩子 — 对账脚本/RTP 模拟从浏览器直接调引擎（生产构建不暴露）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__NU = { drawNumber, deriveNum, hitsOf, MARKETS, ODDS }
}

// ---------- 轮次常量（照 Golden Boot，心跳 500ms/tick）----------
const TICK_MS = 500
const BETTING_T = 48    // 24s
const REVEAL_T = 12     // 6s = 举牌 0.8s + 两位 LED 翻数 ~3.5s + 定格金闪 1.7s
const SETTLED_T = 6     // 3s
// 换人牌舞台时间轴（rAF 内使用，毫秒）：十位先定、个位后定
const BOARD_RISE = 800
const TENS_LOCK = 2500
const ONES_LOCK = 4300
const VENUE = 'OPAL COURT'          // 架空场馆名（禁真实球场名）
const ROUND_DATE = '20260705'
const ROAD_CAP = 120

// 种子上期 + 种子历史（真开奖逐期顶掉）
const SEED_LAST = deriveNum(88)
const SEED_RECENT = [88, 7, 42, 91, 15]
const SEED_HISTORY = [
  88, 7, 42, 91, 15, 63, 20, 55, 78, 4,
  31, 96, 12, 49, 70, 27, 84, 9, 58, 36,
  61, 3, 95, 18, 44, 72, 29, 87, 50, 6,
]

const SIDES = [
  { key: 's-high', name: 'HIGH', range: '50–99' },
  { key: 's-low',  name: 'LOW',  range: '00–49' },
  { key: 's-odd',  name: 'ODD',  range: '尾数单' },
  { key: 's-even', name: 'EVEN', range: '尾数双' },
]

const ROAD_TABS = ['NUMBER', 'DIGIT', 'H-L']
function beadFor(tab, n) {
  if (tab === 'NUMBER') return { t: pad2(n), c: n >= 50 ? NUMBERUP.hi : NUMBERUP.lo }
  if (tab === 'DIGIT') { const d = n % 10; return { t: String(d), c: d % 2 ? NUMBERUP.hi : NUMBERUP.lo } }
  return n >= 50 ? { t: 'H', c: NUMBERUP.hi } : { t: 'L', c: NUMBERUP.lo }
}

// 球衣号码小卡 — 白底圆角卡 + HiLo 同款球衣轮廓 + 两位数号码
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function NumberCard({ num, w = 26 }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: w, height: w * 1.18, borderRadius: Math.max(4, w * 0.16),
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    }}>
      <svg width={w * 0.8} height={w * 0.72} viewBox="0 0 100 90" style={{ display: 'block' }} aria-hidden="true">
        <path d={JERSEY_PATH} fill={NUMBERUP.jersey} stroke="rgba(0,0,0,0.3)" strokeWidth="2" strokeLinejoin="round" />
        <text x="50" y="66" textAnchor="middle" fontSize="36" fontWeight="900"
          fill="#ffffff" fontFamily="'Space Grotesk', sans-serif">{pad2(num)}</text>
      </svg>
    </span>
  )
}

// ---------- 换人牌舞台：单一 rAF 循环驱动（禁 CSS transition 拼接）----------
// 第四官员牌从卡底升起微倾回正 → 两位 LED 独立滚数（十位先定、个位后定，
// 滚动带模糊感，定格瞬间该位亮金+轻震）→ 整牌金光呼吸一次 + onFinale 预亮。
// 号码字形照轮次条球衣卡语言（球衣绿窗 + 白色 Space Grotesk 大数）。
function BoardStage({ num, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { cbRef.current.onFinale?.(); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__NU_RAF_ACTIVE = (window.__NU_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    const tens = Math.floor(num / 10), ones = num % 10
    let raf = 0, whooshed = false, tensLocked = false, onesLocked = false, finaleFired = false
    let lastTick = 0, shakeUntil = 0, tensFlash = 0, onesFlash = 0, finaleAt = 0
    const t0 = performance.now()
    const easeOut = p => 1 - Math.pow(1 - p, 3)

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height

      // —— 时序 ——
      if (!whooshed) { whooshed = true; cbRef.current.sfx.whoosh() }
      const rolling = t >= BOARD_RISE && !onesLocked
      if (rolling && now - lastTick > 70) { lastTick = now; cbRef.current.sfx.tick() }
      if (!tensLocked && t >= TENS_LOCK) {
        tensLocked = true; tensFlash = now; shakeUntil = now + 100
        cbRef.current.sfx.snap()
      }
      if (!onesLocked && t >= ONES_LOCK) {
        onesLocked = true; onesFlash = now; shakeUntil = now + 100
        cbRef.current.sfx.snap()
      }
      if (!finaleFired && t >= ONES_LOCK + 200) {
        finaleFired = true; finaleAt = now
        cbRef.current.sfx.chime()
        cbRef.current.onFinale?.()
        if (import.meta.env.DEV) window.__NU_ANIM_LAST = String(num).padStart(2, '0')
      }
      if (shakeRef.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * 2}px, ${Math.cos(now / 5) * 1.5}px)`
          : ''
      }

      // —— 绘制 ——
      ctx.clearRect(0, 0, W, H)
      // 举牌升起 + 微倾回正
      const riseP = Math.min(1, t / BOARD_RISE)
      const cx = W / 2
      const cy = H * 0.52 + (1 - easeOut(riseP)) * H * 0.9
      const tilt = (1 - easeOut(riseP)) * -0.1   // -6° → 0
      const bw = Math.min(W * 0.5, 300 * dpr)
      const bh = Math.min(H * 0.74, bw * 0.62)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(tilt)
      // 金光呼吸（finale 后一次，~900ms 正弦）
      if (finaleFired) {
        const k = Math.min(1, (now - finaleAt) / 900)
        ctx.shadowColor = NUMBERUP.gold
        ctx.shadowBlur = Math.sin(k * Math.PI) * 26 * dpr
      }
      // 牌体：圆角面板 + 顶部握把
      ctx.fillStyle = '#101c12'
      ctx.strokeStyle = finaleFired ? NUMBERUP.gold : 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2.5 * dpr
      ctx.beginPath()
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12 * dpr)
      ctx.fill(); ctx.stroke()
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.beginPath()
      ctx.roundRect(-bw * 0.08, -bh / 2 - 8 * dpr, bw * 0.16, 8 * dpr, 3 * dpr)
      ctx.fill()

      // 双 LED 位（球衣绿窗 + 白数）
      const winW = bw * 0.38, winH = bh * 0.76
      const winY = -winH / 2
      const digitFont = `900 ${Math.round(winH * 0.72)}px 'Space Grotesk', sans-serif`
      const drawWindow = (wx, locked, finalDigit, flashAt) => {
        ctx.fillStyle = NUMBERUP.jersey
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'
        ctx.lineWidth = 1.5 * dpr
        ctx.beginPath()
        ctx.roundRect(wx, winY, winW, winH, 8 * dpr)
        ctx.fill(); ctx.stroke()
        // 定格金闪（300ms 渐隐）
        if (flashAt && now - flashAt < 300) {
          ctx.fillStyle = `rgba(255,213,79,${0.55 * (1 - (now - flashAt) / 300)})`
          ctx.beginPath()
          ctx.roundRect(wx, winY, winW, winH, 8 * dpr)
          ctx.fill()
        }
        ctx.save()
        ctx.beginPath()
        ctx.rect(wx, winY, winW, winH)
        ctx.clip()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = digitFont
        const dx = wx + winW / 2
        if (locked || t < BOARD_RISE) {
          ctx.fillStyle = '#ffffff'
          ctx.fillText(locked ? String(finalDigit) : '–', dx, 1 * dpr)
        } else {
          // 滚动列：当前/下一位按小数偏移上滚 + 残影模糊感
          const roll = t / 55
          const cur = Math.floor(roll) % 10
          const frac = roll - Math.floor(roll)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillText(String(cur), dx, -frac * winH * 0.9 + 1 * dpr)
          ctx.fillText(String((cur + 1) % 10), dx, (1 - frac) * winH * 0.9 + 1 * dpr)
          ctx.fillStyle = 'rgba(255,255,255,0.22)'
          ctx.fillText(String((cur + 9) % 10), dx, -frac * winH * 0.9 - winH * 0.9 + 1 * dpr)
        }
        ctx.restore()
      }
      drawWindow(-winW - bw * 0.03, tensLocked, tens, tensFlash)
      drawWindow(bw * 0.03, onesLocked, ones, onesFlash)
      ctx.restore()

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__NU_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；num 由 key 换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        background: NUMBERUP.strip, borderRadius: 12,
      }}>
        <NumberCard num={num} w={40} />
        <span style={{ color: NUMBERUP.gold, fontSize: 18, fontWeight: 900 }}>NUMBER {String(num).padStart(2, '0')}</span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

export default function NumberUp({ balance, setBalance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮在 GameTopBar，跨游戏同步）
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [roadTab, setRoadTab] = useState('NUMBER')
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // 展示用假注单，每期换血

  // ---- 轮次状态机 ----
  const [gamePhase, setGamePhase] = useState('betting')   // betting | reveal | settled
  const [countdown, setCountdown] = useState(BETTING_T)   // tick(500ms)
  const [roundNo, setRoundNo] = useState(2)
  const [lastNum, setLastNum] = useState(SEED_LAST)
  const [recent, setRecent] = useState(SEED_RECENT)       // 近 5 期（新→旧）
  const [history, setHistory] = useState(SEED_HISTORY)
  const [result, setResult] = useState(null)              // { hits:Set, winTotal }
  const [preHits, setPreHits] = useState(null)            // 开牌动画收尾的命中预亮
  const [toasts, setToasts] = useState([])

  const phaseRef = useRef('betting')
  const cdRef = useRef(BETTING_T)
  const picksRef = useRef(picks)
  const betsRef = useRef(new Map())
  const betRef = useRef(bet)
  const balanceRef = useRef(balance)
  const pendingRef = useRef(null)
  const toastIdRef = useRef(0)
  const timersRef = useRef([])
  const audioRef = useRef({ ctx: null, muted: false })
  const cardShakeRef = useRef(null)

  useEffect(() => { balanceRef.current = balance }, [balance])
  useEffect(() => { betRef.current = bet }, [bet])
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxWhoosh() {   // 举牌：噪声上扫
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.35)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.4)
  }
  function sfxTick() {   // 滚数：高频短击（rAF 每 ~70ms 触发成簇）
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2600 + Math.random() * 400
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.035)
  }
  function sfxSnap() {   // 位定格：短促咔 + 低敲
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.03)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.035)
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 190
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.06, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    o.connect(og); og.connect(ctx.destination); o.start(t); o.stop(t + 0.07)
  }
  function sfxChime() {   // 定格金闪：上扬三连音
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[660, 880, 1170].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.08
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
    })
  }
  const stageSfx = { whoosh: sfxWhoosh, tick: sfxTick, snap: sfxSnap, chime: sfxChime }

  function pushToast(win) {
    const id = ++toastIdRef.current
    setToasts(t => [...t, { id, label: '本期命中', win }])
    const tm = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    timersRef.current.push(tm)
  }

  // 唯一赔付点：读 pendingRef 结果，按已下注 Map 一次性入账
  function settleRound() {
    const r = pendingRef.current
    const hits = hitsOf(r)
    let winTotal = 0
    betsRef.current.forEach((stake, k) => {
      if (hits.has(k)) winTotal = round2(winTotal + stake * MARKETS[k].odds)
    })
    if (winTotal > 0) {
      setBalance(b => round2(b + winTotal))
      pushToast(winTotal)
    }
    setLastNum(r)
    setRecent(list => [r.num, ...list].slice(0, 5))
    setHistory(h => [...h, r.num].slice(-ROAD_CAP))
    setResult({ hits, winTotal })
    // 假注单本期落账（展示用，结果已定后的装饰随机）
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // 单 interval 驱动整台状态机（500ms/tick）；StrictMode 双挂载由 cleanup 兜底
  useEffect(() => {
    const id = setInterval(() => {
      cdRef.current -= 1
      if (cdRef.current > 0) { setCountdown(cdRef.current); return }
      const ph = phaseRef.current
      if (ph === 'betting') {
        // 号码此刻先定 — REVEAL 段（单3 动画）只读它，不再碰确定性随机数
        pendingRef.current = deriveNum(drawNumber())
        phaseRef.current = 'reveal'; setGamePhase('reveal')
        cdRef.current = REVEAL_T; setCountdown(REVEAL_T)
      } else if (ph === 'reveal') {
        settleRound()
        phaseRef.current = 'settled'; setGamePhase('settled')
        cdRef.current = SETTLED_T; setCountdown(SETTLED_T)
      } else {
        betsRef.current = new Map(); setBetsPlaced(new Map())
        picksRef.current = new Set(); setPicks(new Set())
        setResult(null)
        setPreHits(null)
        setFeedBets(makeFeedBots())
        setRoundNo(n => n + 1)
        phaseRef.current = 'betting'; setGamePhase('betting')
        cdRef.current = BETTING_T; setCountdown(BETTING_T)
      }
    }, TICK_MS)
    return () => clearInterval(id)
    // 引擎全程走 refs，空依赖单心跳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSel = key => {
    if (phaseRef.current !== 'betting') return   // REVEAL/SETTLED 锁盘
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      picksRef.current = n
      return n
    })
  }

  // 唯一扣注点：注额 × 选格数，一次性扣款后入 betsRef，清空待选
  function confirmBets() {
    if (phaseRef.current !== 'betting') return
    const keys = [...picksRef.current]
    const amount = betRef.current
    const total = round2(amount * keys.length)
    if (!keys.length || amount < 1 || total > balanceRef.current) return
    setBalance(b => round2(b - total))
    balanceRef.current = round2(balanceRef.current - total)
    keys.forEach(k => betsRef.current.set(k, round2((betsRef.current.get(k) || 0) + amount)))
    setBetsPlaced(new Map(betsRef.current))
    picksRef.current = new Set()
    setPicks(new Set())
  }

  const betting = gamePhase === 'betting'
  const confirmTotal = round2(bet * picks.size)
  const confirmOk = betting && picks.size > 0 && bet >= 1 && confirmTotal <= balance

  // ---- 样式件（选中=金框绿罩；命中=绿框绿晕）----
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    const hit = (result?.hits ?? preHits)?.has(key)   // 结算后 result，动画收尾先预亮
    const placed = betsPlaced.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: betting ? 'pointer' : 'not-allowed',
      background: sel
        ? NUMBERUP.selTint
        : `linear-gradient(180deg, ${NUMBERUP.ctrl}, ${NUMBERUP.band})`,
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
        background: hit ? NUMBERUP.sel : sel ? NUMBERUP.gold : `linear-gradient(180deg, ${NUMBERUP.ctrl}, ${NUMBERUP.band})`,
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
  const phaseChip = gamePhase === 'betting'
    ? { text: `⏱ 00:${String(Math.ceil(countdown / 2)).padStart(2, '0')}`, c: NUMBERUP.sel }
    : gamePhase === 'reveal'
      ? { text: '开牌中…', c: NUMBERUP.orange }
      : { text: result && result.winTotal > 0 ? `+$${result.winTotal.toFixed(2)}` : '已开奖', c: NUMBERUP.gold }
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${phaseChip.c}`,
      color: phaseChip.c, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{phaseChip.text}</span>
  )
  const subRowNode = (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, flex: '1 1 auto' }}>
      <NumberCard num={lastNum.num} w={isMobile ? 22 : 24} />
      {/* 近 5 期小号串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {recent.map((n, i) => (
          <span key={`${n}-${i}`} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: n >= 50 ? NUMBERUP.hi : NUMBERUP.lo, color: COLORS.white,
            fontSize: 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
          }}>{pad2(n)}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: NUMBERUP.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>NUMBER {pad2(lastNum.num)}</span>
    </span>
  )
  const topBar = (
    <GameTopBar gameName="NUMBER UP" band={NUMBERUP.band} venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} subRow={subRowNode} onBack={onBack} />
  )

  // ---- 珠盘路（真历史滚动，容量 6×20）----
  const ROAD_COLS = 20
  const roadItems = history.slice(-ROAD_CAP)
  const beads = roadItems.map(n => beadFor(roadTab, n))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 10px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? NUMBERUP.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : NUMBERUP.dim,
            border: `1px solid ${roadTab === t ? NUMBERUP.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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


      {/* ---- middle zone: 盘区三行；PICK 网格空间不足时独立纵滚 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '10px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 8,
      }}>
        <WinToast toasts={toasts} />
        {/* 行① PICK 00–99 网格（flex 可收缩 + 内部纵滚兜底） */}
        <div style={{
          flex: '0 1 auto', minHeight: 130, overflowY: 'auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          boxSizing: 'border-box',
        }}>
          <div style={secHead}>PICK 00–99 · 直选 · 赔率 {ODDS.pick.toFixed(2)}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)',
            gap: isMobile ? 3 : 3,
          }}>
            {Array.from({ length: 100 }, (_, i) => gridCell(i))}
          </div>
        </div>

        {/* 行② FIRST / LAST DIGIT（desk 并列，mobile 堆叠） */}
        <div style={{
          flex: '0 0 auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', gap: isMobile ? 8 : 14,
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          {[
            { pre: 'fd', label: `FIRST DIGIT · 首位 · ${ODDS.digit.toFixed(2)}` },
            { pre: 'ld', label: `LAST DIGIT · 尾数 · ${ODDS.digit.toFixed(2)}` },
          ].map(g => (
            <div key={g.pre} style={{ flex: 1, minWidth: 0 }}>
              <div style={secHead}>{g.label}</div>
              <div style={{ display: 'flex', gap: isMobile ? 3 : 4 }}>
                {Array.from({ length: 10 }, (_, d) => (
                  <button key={d} type="button" className="nuCell" disabled={!betting} onClick={() => toggleSel(`${g.pre}-${d}`)}
                    style={{ ...cellBtn(`${g.pre}-${d}`, { compact: true }), padding: '4px 0' }}>
                    <span style={{ ...cellName, fontSize: isMobile ? 11 : 12 }}>{d}</span>
                    {stakeChip(`${g.pre}-${d}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 行③ HIGH / LOW / ODD / EVEN */}
        <div style={{
          flex: '0 0 auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', gap: isMobile ? 5 : 8,
        }}>
          {SIDES.map(m => (
            <button key={m.key} type="button" className="nuCell" disabled={!betting} onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
              <span style={cellName}>{m.name}</span>
              <span style={cellRange}>{m.range}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5 }}>{ODDS.side.toFixed(2)}</span>
              {stakeChip(m.key)}
            </button>
          ))}
        </div>
      </div>

      {/* ---- 换人牌舞台占珠盘路位：REVEAL 表演 / SETTLED 定格，BETTING 换回珠盘路 ---- */}
      {gamePhase !== 'betting' && pendingRef.current ? (
        <div style={{
          flex: '0 0 auto', position: 'relative', zIndex: 1,
          margin: isMobile ? '0 12px 10px' : '0 18px 10px',
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          <BoardStage key={roundNo} num={pendingRef.current.num}
            height={isMobile ? 150 : 178}
            shakeRef={cardShakeRef} sfx={stageSfx}
            onFinale={() => setPreHits(hitsOf(pendingRef.current))} />
        </div>
      ) : beadRoad}

      {/* ---- bottom bet band — pinned ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: NUMBERUP.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          padding: '5px 18px', borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
          textAlign: 'center', lineHeight: 1.2,
          opacity: betting ? 1 : 0.6,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
          <input
            value={bet}
            disabled={!betting}
            onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
              color: COLORS.white, fontSize: 15, fontWeight: 900,
            }}
          />
        </div>
        {[10, 50, 100, 500].map(v => (
          <button key={v} type="button" disabled={!betting} onClick={() => setBet(v)} style={{
            minWidth: 38, padding: '0 10px', height: 30, borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
            background: bet === v ? NUMBERUP.selTint : NUMBERUP.band,
            border: `1px solid ${bet === v ? NUMBERUP.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: betting ? 'pointer' : 'not-allowed', opacity: betting ? 1 : 0.6,
          }}>{v}</button>
        ))}
        <button type="button" disabled={!confirmOk} onClick={confirmBets} style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: NUMBERUP.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: confirmOk ? 'pointer' : 'not-allowed',
          opacity: confirmOk ? 1 : 0.55,
        }}>
          {betting
            ? `▷ CONFIRM${picks.size > 0 ? ` $${confirmTotal.toFixed(0)}` : ''}`
            : gamePhase === 'reveal' ? '开牌中…' : '本期已结算'}
        </button>
      </div>
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
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Number Up</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

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

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout title="Number Up" color={NUMBERUP.sel}>
      <div ref={cardShakeRef}>
        {gameCard}
      </div>
    </GameLayout>
  )
}
