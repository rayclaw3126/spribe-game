// #41 单6：帽子戏法开奖舞台组件（从 HatTrick.jsx 机械搬运——三骰 canvas+rAF+dev钩子
// __HAT_RAF_ACTIVE/__HAT_ANIM_LAST + 骰 SFX(whoosh/knock/snap/chime)，逐字节切片，仅 shakeRef 护栏）。
// 揪心心跳(sfxHeartbeat)因依赖玩家注单(betsRef)留原页；DIE_LOCK 主档另有引用故随件复制。
// props {phase,roundNo,drawResult,width,height,muted}(+页面 shakeRef/onFinale/onLastSuspense/winTotal)。
import { useRef, useEffect } from 'react'
import { COLORS, HATTRICK } from '../../components/shell/tokens'
import { deriveRoll } from '../markets/hattrick'

// 骰面点位（DiceStage canvas 画点用；主档 DieFace 另有引用故随件复制）
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

// ---------- 三骰舞台时间轴（rAF 内使用，毫秒）----------
const DIE_START = [0, 250, 500]       // 各骰抛入时刻
const DIE_LOCK = [2600, 3500, 4500]   // 各骰定格时刻（第1骰 2.6s / 第2骰 3.5s / 第3骰 4.5s）
const FALL_DUR = 500                  // 抛物线下坠段
const TOTAL_LOCK = 5100               // TOTAL 大字滚动累加后定格金闪

// ---------- 三骰舞台：单一 rAF 循环驱动（禁 CSS transition 拼接）----------
// 三骰从上方错峰抛入草皮台面：抛物线下坠 + 落地弹跳衰减（指数衰减 |sin|）+
// 旋转翻面（滚动中骰面快速轮换制造模糊感），各自定格到 pendingRef 骰面
// （亮金描边一闪 + 2px/100ms 轻震）；三骰全定后 TOTAL 金色滚动累加定格，
// 豹子期额外金光爆闪一次，onFinale 预亮命中盘区。骰面结果进场前已锁定，动画只读。
function DiceStage({ roll, shakeRef, sfx, onFinale, onLastSuspense, winTotal = 0 }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale, onLastSuspense, winTotal })
  cbRef.current = { sfx, onFinale, onLastSuspense, winTotal }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) {
      cbRef.current.onFinale?.()
      if (import.meta.env.DEV) window.__HAT_ANIM_LAST = roll.dice.join(',')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__HAT_RAF_ACTIVE = (window.__HAT_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    const BOUNCES = 2.5                    // 落地后 2-3 次衰减弹跳
    const locked = [false, false, false]
    const flashAt = [0, 0, 0]
    const knocksFired = [0, 0, 0]
    let whooshed = false, finaleFired = false, finaleAt = 0, shakeUntil = 0, suspenseFired = false
    const netImpacts = []       // 球入网冲击点 { x, at }（每颗定格推一个）
    let confetti = null         // 豹子彩带粒子（finale 时初始化）
    let raf = 0
    const t0 = performance.now()
    const easeOut = p => 1 - Math.pow(1 - p, 3)

    // 每骰触地时刻表（landing + 弹跳过零点，knock 音量随之衰减）
    const knockTimes = DIE_START.map((st, i) => {
      const land = st + FALL_DUR
      const bDur = DIE_LOCK[i] - land
      return [land, land + (1 / BOUNCES) * bDur, land + (2 / BOUNCES) * bDur]
    })

    // canvas 重画骰面：复用 DieFace 的 3×3 宫格点位表，白面近黑点
    const drawDie = (x, y, size, face, angle, flashA, blur) => {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      const h = size / 2
      ctx.fillStyle = HATTRICK.face
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.roundRect(-h, -h, size, size, size * 0.2)
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = blur ? 'rgba(16,25,35,0.6)' : HATTRICK.pip
      for (const idx of PIPS[face]) {
        const col = idx % 3, row = Math.floor(idx / 3)
        ctx.beginPath()
        ctx.arc((col - 1) * size * 0.27, (row - 1) * size * 0.27, size * 0.09, 0, Math.PI * 2)
        ctx.fill()
      }
      if (flashA > 0) {   // 定格亮金描边一闪（300ms 渐隐）
        ctx.strokeStyle = `rgba(255,213,79,${flashA})`
        ctx.lineWidth = 3 * dpr
        ctx.beginPath()
        ctx.roundRect(-h, -h, size, size, size * 0.2)
        ctx.stroke()
      }
      ctx.restore()
    }

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      if (!whooshed) { whooshed = true; cbRef.current.sfx.whoosh() }

      ctx.clearRect(0, 0, W, H)
      const size = Math.min(H * 0.34, W * 0.13)
      const floorY = H * 0.46
      const xs = [W * 0.32, W * 0.5, W * 0.68]

      // ---- 球门框 + 球网背景（骰子层之前画；网随入网冲击 + 豹子沸腾摆动）----
      const gL = W * 0.15, gR = W * 0.85, gTop = H * 0.05, gBot = H * 0.44
      const gW = gR - gL, gH = gBot - gTop
      const netWobble = (sx, vy) => {   // vy: 0(顶横梁)→1(网底)，越靠底摆越大
        let dx = 0
        for (const imp of netImpacts) {
          const age = now - imp.at
          if (age > 420) continue
          const sigma = gW * 0.16
          const dist = sx - imp.x
          dx += Math.sin(age / 18) * (6 * dpr) * Math.exp(-age / 110) * Math.exp(-(dist * dist) / (2 * sigma * sigma)) * vy
        }
        if (finaleFired && roll.isTriple && now - finaleAt < 700) {   // 全场沸腾：整张网狂摆
          dx += Math.sin(now / 16 + sx * 0.012) * (11 * dpr) * (1 - (now - finaleAt) / 700) * vy
        }
        return dx
      }
      const NET_COLS = 15, NET_ROWS = 9
      ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1 * dpr
      for (let c = 0; c <= NET_COLS; c++) {   // 竖网绳
        const sx = gL + (gW * c) / NET_COLS
        ctx.beginPath()
        for (let r = 0; r <= NET_ROWS; r++) {
          const vy = r / NET_ROWS
          const px = sx + netWobble(sx, vy), py = gTop + gH * vy
          r === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
      for (let r = 0; r <= NET_ROWS; r++) {   // 横网绳
        const vy = r / NET_ROWS, py = gTop + gH * vy
        ctx.beginPath()
        for (let c = 0; c <= NET_COLS; c++) {
          const sx = gL + (gW * c) / NET_COLS
          const px = sx + netWobble(sx, vy)
          c === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
      // 门框（柱 + 横梁，压在网边之上）
      const pt = Math.max(2, 3 * dpr)
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillRect(gL - pt, gTop - pt, pt, gH + pt)
      ctx.fillRect(gR, gTop - pt, pt, gH + pt)
      ctx.fillRect(gL - pt, gTop - pt, gW + 2 * pt, pt)

      for (let i = 0; i < 3; i++) {
        const ti = t - DIE_START[i]
        if (ti < 0) continue   // 未抛入
        const x = xs[i]
        if (!locked[i] && t >= DIE_LOCK[i]) {
          locked[i] = true; flashAt[i] = now; shakeUntil = now + 100
          netImpacts.push({ x, at: now })   // 球入网 → 该列网格抖动
          cbRef.current.sfx.snap()
        }
        while (knocksFired[i] < 3 && t >= knockTimes[i][knocksFired[i]]) {
          cbRef.current.sfx.knock([0.11, 0.055, 0.028][knocksFired[i]])
          knocksFired[i] += 1
        }

        let y, angle, face, blur = false
        // 旋转全程一条减速曲线，总转角 = 整数圈 → 定格时自然回正
        const spins = (3 + i) * Math.PI * 2
        if (locked[i]) {
          y = floorY; angle = 0; face = roll.dice[i]
        } else {
          angle = spins * easeOut(Math.min(1, ti / (DIE_LOCK[i] - DIE_START[i])))
          face = ((Math.floor(ti / 85) + i * 2) % 6) + 1   // 滚动中骰面快速轮换
          blur = true
          if (ti < FALL_DUR) {
            const p = ti / FALL_DUR
            y = floorY - (1 - p * p) * H * 0.9   // 抛物线加速下坠
          } else {
            const u = (ti - FALL_DUR) / (DIE_LOCK[i] - DIE_START[i] - FALL_DUR)
            y = floorY - Math.exp(-3 * u) * Math.abs(Math.sin(u * BOUNCES * Math.PI)) * H * 0.4
          }
        }
        // 草皮阴影（随高度缩放变淡）
        const hgt = Math.max(0, (floorY - y) / (H * 0.9))
        ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - hgt * 0.8)})`
        ctx.beginPath()
        ctx.ellipse(x, floorY + size * 0.62, size * (0.55 - hgt * 0.25), size * 0.12, 0, 0, Math.PI * 2)
        ctx.fill()
        const flashA = flashAt[i] && now - flashAt[i] < 300 ? 0.9 * (1 - (now - flashAt[i]) / 300) : 0
        drawDie(x, y, size, face, angle, flashA, blur)
      }

      // 第二颗定格后、第三颗定格前的悬念窗：揪心钩子只触发一次
      if (!suspenseFired && t >= DIE_LOCK[1] && t < DIE_LOCK[2]) {
        suspenseFired = true
        cbRef.current.onLastSuspense?.()
      }

      // TOTAL 滚动累加 → 定格金闪；豹子期额外径向金光爆闪一次
      if (t >= DIE_LOCK[2]) {
        const shown = Math.round(roll.total * easeOut(Math.min(1, (t - DIE_LOCK[2]) / 500)))
        const isLockT = t >= TOTAL_LOCK
        if (!finaleFired && isLockT) {
          finaleFired = true; finaleAt = now
          cbRef.current.sfx.chime(roll.isTriple, cbRef.current.winTotal > 0)
          cbRef.current.onFinale?.()
          if (import.meta.env.DEV) window.__HAT_ANIM_LAST = roll.dice.join(',')
          if (roll.isTriple) {   // 帽子戏法：加强震屏 + 撒彩带
            shakeUntil = now + 650
            confetti = []
            const cols = [HATTRICK.gold, '#35d07f', '#ffffff', '#ff6a3d']
            for (let n = 0; n < 90; n++) confetti.push({
              x: Math.random() * W, y: -Math.random() * H * 0.4,
              vx: (Math.random() - 0.5) * 1.3 * dpr, vy: (1 + Math.random() * 2.2) * dpr,
              rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
              color: cols[n % cols.length], size: (3 + Math.random() * 4) * dpr,
            })
          }
        }
        if (finaleFired && roll.isTriple && now - finaleAt < 500) {
          const a = Math.sin(((now - finaleAt) / 500) * Math.PI) * 0.35
          const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.5)
          g.addColorStop(0, `rgba(255,213,79,${a})`)
          g.addColorStop(1, 'rgba(255,213,79,0)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, W, H)
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        if (finaleFired) {   // 金光呼吸一次（~900ms 正弦）
          const k = Math.min(1, (now - finaleAt) / 900)
          ctx.shadowColor = HATTRICK.gold
          ctx.shadowBlur = Math.sin(k * Math.PI) * 22 * dpr
        }
        ctx.fillStyle = isLockT ? HATTRICK.gold : 'rgba(255,255,255,0.85)'
        ctx.font = `900 ${Math.round(H * 0.2)}px 'Space Grotesk', sans-serif`
        ctx.fillText(roll.isTriple && isLockT ? `豹子 ${roll.tripleFace}` : `和值 ${shown}`, W / 2, H * 0.85)
        ctx.shadowBlur = 0
      }

      // ---- 进球横幅（弹入放大）：普通局 GOAL! +$X / 豹子 HAT-TRICK! ----
      if (finaleFired) {
        const age = now - finaleAt
        const pop = Math.min(1, age / 280)
        const scale = 0.4 + 0.6 * (1 - Math.pow(1 - pop, 3)) + Math.sin(pop * Math.PI) * 0.14
        ctx.save()
        ctx.translate(W / 2, H * 0.60)
        ctx.scale(scale, scale)
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        if (roll.isTriple) {
          ctx.shadowColor = HATTRICK.gold; ctx.shadowBlur = 28 * dpr
          ctx.fillStyle = HATTRICK.gold
          ctx.font = `900 ${Math.round(H * 0.17)}px 'Space Grotesk', sans-serif`
          ctx.fillText('帽子戏法！', 0, 0)
        } else {
          ctx.shadowColor = '#35d07f'; ctx.shadowBlur = 18 * dpr
          ctx.fillStyle = '#fff'
          ctx.font = `900 ${Math.round(H * 0.13)}px 'Space Grotesk', sans-serif`
          const wt = cbRef.current.winTotal
          ctx.fillText(wt > 0 ? `进球！ +$${wt.toFixed(2)}` : '进球！', 0, 0)
        }
        ctx.shadowBlur = 0
        ctx.restore()
      }

      // ---- 彩带下落（豹子）----
      if (confetti) {
        for (const p of confetti) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.03 * dpr; p.rot += p.vr
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot)
          ctx.fillStyle = p.color
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5)
          ctx.restore()
        }
      }

      if (shakeRef?.current) {
        const big = finaleFired && roll.isTriple && now - finaleAt < 650
        const ax = big ? 5 : 2, ay = big ? 4 : 1.5
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * ax}px, ${Math.cos(now / 5) * ay}px)`
          : ''
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef?.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__HAT_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；roll 由 key=期号换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 绝对定位铺满舞台槽：内容不参与 flex 高度分配，槽高各相位一致（由 min/max 定）
  if (reduced) {   // 减动效：静态直出三骰 + TOTAL
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {roll.dice.map((v, i) => <DieFace key={i} v={v} size={34} />)}
        <span style={{ color: HATTRICK.gold, fontSize: 18, fontWeight: 900 }}>
          {roll.isTriple ? `豹子 ${roll.tripleFace}` : `和值 ${roll.total}`}
        </span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} aria-hidden />
}

// 待命态（betting/locked，多桌用；HatTrick 原页从不挂此态）
function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function HatTrickStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, shakeRef, onFinale, onLastSuspense, winTotal }) {
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }

    function sfxWhoosh() {   // 射门砰：低频重击 + 破空短扫
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate)
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
      const ns = ctx.createBufferSource(); ns.buffer = nb
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
      bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16)
      const g2 = ctx.createGain()
      g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      ns.connect(bp); bp.connect(g2); g2.connect(ctx.destination); ns.start(t); ns.stop(t + 0.18)
    }
    function sfxKnock(vol) {   // 落地/弹跳：低频闷敲 + 木感 click（音量随弹跳衰减）
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.1)
      const len = Math.floor(ctx.sampleRate * 0.02)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
      const src = ctx.createBufferSource(); src.buffer = buf
      const g2 = ctx.createGain(); g2.gain.value = vol * 0.6
      src.connect(g2); g2.connect(ctx.destination); src.start(t); src.stop(t + 0.02)
    }
    function sfxSnap() {   // 入网唰：软噪声刷过网绳（骰定格=球入网）
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const len = Math.floor(ctx.sampleRate * 0.16)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1)
      const src = ctx.createBufferSource(); src.buffer = buf
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9
      bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.16)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.16)
    }
    function sfxChime(strong, win) {   // 进球：命中→球迷欢呼；豹子→全场沸腾+进球哨
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      // 人声般欢呼：宽带噪声起伏（豹子更久更响）
      const dur = strong ? 1.6 : win ? 1.1 : 0.5
      const peak = strong ? 0.15 : win ? 0.09 : 0.04
      const len = Math.floor(ctx.sampleRate * dur)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI)
      const src = ctx.createBufferSource(); src.buffer = buf
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = strong ? 1100 : 900; bp.Q.value = 0.5
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + dur)
      // 亮音欢呼点缀
      if (win || strong) {
        const notes = strong ? [660, 880, 1170, 1560] : [660, 990]
        notes.forEach((f, i) => {
          const o = ctx.createOscillator(); const og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
          const s = t + i * 0.09
          og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(strong ? 0.09 : 0.06, s + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
          o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
        })
      }
      // 豹子：进球哨（三短高哨带颤音）
      if (strong) {
        [0, 0.16, 0.32].forEach((off, i) => {
          const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2300 + i * 120
          const lfo = ctx.createOscillator(); lfo.frequency.value = 28
          const lg = ctx.createGain(); lg.gain.value = 60
          lfo.connect(lg); lg.connect(o.frequency)
          const og = ctx.createGain()
          const s = t + off
          og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.05, s + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, s + (i === 2 ? 0.22 : 0.12))
          o.connect(og); og.connect(ctx.destination)
          o.start(s); o.stop(s + 0.24); lfo.start(s); lfo.stop(s + 0.24)
        })
      }
    }
  const stageSfx = { whoosh: sfxWhoosh, knock: sfxKnock, snap: sfxSnap, chime: sfxChime }

  const roll = drawResult?.dice ? deriveRoll(drawResult.dice) : null
  const racing = roll != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <DiceStage key={roundNo} roll={roll} shakeRef={shakeRef} sfx={stageSfx} onFinale={onFinale} onLastSuspense={onLastSuspense} winTotal={winTotal} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
