// #41 单6：中场开奖舞台组件（从 HalfTime.jsx 机械搬运——20球 canvas+rAF+dev钩子 __HT_RAF_ACTIVE
// + WebAudio SFX(thump/swish/chime)，逐字节切片，仅 shakeRef 护栏）。
// props {phase,roundNo,drawResult,width,height,muted}(+页面 shakeRef/onFinale)。
import { useRef, useEffect } from 'react'
import { HALFTIME } from '../../components/shell/tokens'
import ballUrl from '../../assets/covers/ball-3d.png'
import { deriveRound } from '../markets/halftime'

// ---------- 开奖舞台时间轴（rAF 内使用，毫秒）----------
const BALL_CADENCE = 400
const BALL_FLIGHT = 530

// ---------- 开奖舞台：单一 rAF 循环驱动全部物理（禁 CSS transition 拼接）----------
// 20 球按开出顺序抛物线飞入球门，入网触发网格顶点弹簧回弹 + 整卡轻震；
// 号码轨逐颗点亮，SCORE 滚动累加，末球后 1s 大字定格并回调 onFinale。
// prefers-reduced-motion：不跑 rAF，直接静态示 20 珠 + SCORE。
function DrawStage({ round, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { cbRef.current.onFinale?.(); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__HT_RAF_ACTIVE = (window.__HT_RAF_ACTIVE || 0) + 1

    const img = new Image()
    img.src = ballUrl
    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    // —— 装饰性随机（结果早已定，只抖轨迹/落点，不碰确定性随机数流的位置）——
    const jit = k => (Math.random() * 2 - 1) * k

    // 网格 mesh：球门内 13×7 顶点弹簧阵
    const NC = 13, NR = 7
    const mesh = []   // { rx, ry (rest, 相对球门框 0..1), x, y, vx, vy }
    for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
      mesh.push({ rc: c / (NC - 1), rr: r / (NR - 1), dx: 0, dy: 0, vx: 0, vy: 0 })
    }

    const balls = round.balls.map((n, i) => ({
      n,
      launch: i * BALL_CADENCE,
      side: i % 2 ? 1 : -1,
      jx: jit(0.04), jy: jit(0.06),   // 落点微抖（球门内相对坐标）
      launched: false, landed: false,
      trail: [],
    }))
    const lastLand = (balls.length - 1) * BALL_CADENCE + BALL_FLIGHT
    let landedSum = 0, showSum = 0, landedCount = 0
    let finaleFired = false
    let shakeUntil = 0
    let lastNow = 0
    let raf = 0
    const t0 = performance.now()

    const loop = now => {
      const t = now - t0
      const dt = Math.min((now - (lastNow || now)) / 1000, 0.04)
      lastNow = now
      const W = canvas.width, H = canvas.height

      // 球门几何：居中，宽 44%，网高 52%（下方让位给两排号码轨）
      const gw = W * 0.44, gh = H * 0.52
      const gx = (W - gw) / 2, gy = H * 0.06
      const meshX = p => gx + p.rc * gw + p.dx
      const meshY = p => gy + p.rr * gh + p.dy

      // —— 物理推进 ——
      for (const b of balls) {
        if (!b.launched && t >= b.launch) {
          b.launched = true
          cbRef.current.sfx.thump()
          // 起点：底角画外；终点：球门网内（含微抖）
          b.x0 = b.side < 0 ? -30 * dpr : W + 30 * dpr
          b.y0 = H * 0.98
          b.xe = gx + gw * (0.5 + b.jx * 4 + jit(0.18))
          b.ye = gy + gh * (0.45 + b.jy * 3)
          const T = BALL_FLIGHT / 1000
          b.g = 2400 * dpr
          b.vy0 = (b.ye - b.y0 - 0.5 * b.g * T * T) / T
        }
        if (b.launched && !b.landed) {
          const p = Math.min(1, (t - b.launch) / BALL_FLIGHT)
          const tau = p * (BALL_FLIGHT / 1000)
          b.x = b.x0 + (b.xe - b.x0) * p
          b.y = b.y0 + b.vy0 * tau + 0.5 * b.g * tau * tau
          b.trail.push({ x: b.x, y: b.y })
          if (b.trail.length > 3) b.trail.shift()
          if (p >= 1) {
            b.landed = true
            landedCount++
            landedSum += b.n
            cbRef.current.sfx.swish()
            shakeUntil = now + 120
            // 入网冲量：落点半径内的顶点向后位移
            for (const m of mesh) {
              const mx = meshX(m), my = meshY(m)
              const d = Math.hypot(mx - b.xe, my - b.ye)
              const R = gw * 0.22
              if (d < R) {
                const f = (1 - d / R) * 160 * dpr
                m.vx += ((mx - b.xe) / (d + 1)) * f * 0.35
                m.vy += ((my - b.ye) / (d + 1)) * f * 0.35 + f * 0.5   // 主要向下坠
              }
            }
          }
        }
      }
      // mesh 弹簧回弹（临界阻尼附近）
      for (const m of mesh) {
        m.vx += (-140 * m.dx - 9 * m.vx) * dt
        m.vy += (-140 * m.dy - 9 * m.vy) * dt
        m.dx += m.vx * dt
        m.dy += m.vy * dt
      }
      // SCORE 滚动
      showSum += (landedSum - showSum) * Math.min(1, dt * 14)
      if (landedSum - showSum < 0.6) showSum = landedSum
      // 收尾定格
      if (!finaleFired && t >= lastLand + 80) {
        finaleFired = true
        cbRef.current.sfx.chime()
        cbRef.current.onFinale?.()
      }
      // 整卡轻震（2–3px, 120ms）
      if (shakeRef?.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 9) * 2.5}px, ${Math.cos(now / 7) * 2}px)`
          : ''
      }

      // —— 绘制 ——
      ctx.clearRect(0, 0, W, H)
      // 网格
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1 * dpr
      for (let r = 0; r < NR; r++) {
        ctx.beginPath()
        for (let c = 0; c < NC; c++) {
          const m = mesh[r * NC + c]
          c === 0 ? ctx.moveTo(meshX(m), meshY(m)) : ctx.lineTo(meshX(m), meshY(m))
        }
        ctx.stroke()
      }
      for (let c = 0; c < NC; c++) {
        ctx.beginPath()
        for (let r = 0; r < NR; r++) {
          const m = mesh[r * NC + c]
          r === 0 ? ctx.moveTo(meshX(m), meshY(m)) : ctx.lineTo(meshX(m), meshY(m))
        }
        ctx.stroke()
      }
      // 门框
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'
      ctx.lineWidth = 3 * dpr
      ctx.beginPath()
      ctx.moveTo(gx, gy + gh); ctx.lineTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.lineTo(gx + gw, gy + gh)
      ctx.stroke()
      // 飞行球 + 拖影
      const br = 9 * dpr
      for (const b of balls) {
        if (!b.launched || b.landed) continue
        b.trail.forEach((tp, ti) => {
          ctx.globalAlpha = [0.08, 0.16, 0.28][ti] ?? 0.1
          if (img.complete && img.naturalWidth) ctx.drawImage(img, tp.x - br, tp.y - br, br * 2, br * 2)
          else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tp.x, tp.y, br * 0.8, 0, 7); ctx.fill() }
        })
        ctx.globalAlpha = 1
        if (img.complete && img.naturalWidth) ctx.drawImage(img, b.x - br, b.y - br, br * 2, br * 2)
        else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, br, 0, 7); ctx.fill() }
      }
      ctx.globalAlpha = 1
      // 号码轨（已入网的珠，开出顺序，10+10 两排，两位数号码可读）
      const slotW = Math.min(W / 11, 40 * dpr)
      const beadR = slotW * 0.42
      const rowY2 = H - beadR - 5 * dpr
      const rowY1 = rowY2 - beadR * 2 - 6 * dpr
      const trackX0 = (W - slotW * 10) / 2 + slotW / 2
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < landedCount; i++) {
        const n = balls[i].n
        const cx = trackX0 + (i % 10) * slotW
        const cy = i < 10 ? rowY1 : rowY2
        ctx.fillStyle = n <= 40 ? HALFTIME.over : HALFTIME.under
        ctx.beginPath(); ctx.arc(cx, cy, beadR, 0, 7); ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `800 ${Math.round(beadR * 0.95)}px 'Space Grotesk', sans-serif`
        ctx.fillText(String(n), cx, cy + 0.5)
      }
      // SCORE
      if (finaleFired) {
        ctx.fillStyle = HALFTIME.gold
        ctx.font = `900 ${Math.round(H * 0.26)}px 'Space Grotesk', sans-serif`
        ctx.shadowColor = HALFTIME.gold; ctx.shadowBlur = 18 * dpr
        ctx.fillText(`和值 ${landedSum}`, W / 2, gy + gh * 0.48)
        ctx.shadowBlur = 0
      } else if (landedCount > 0) {
        ctx.fillStyle = HALFTIME.gold
        ctx.font = `900 ${Math.round(H * 0.12)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText(String(Math.round(showSum)), W - 10 * dpr, gy + 6 * dpr + H * 0.06)
        ctx.textAlign = 'center'
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef?.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__HT_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；round 由 key 换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {
    // 静态分支：直接示 20 珠 + SCORE
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 4, flexWrap: 'wrap', padding: '0 12px',
        background: HALFTIME.strip, borderRadius: 12,
      }}>
        {round.balls.map((n, i) => (
          <span key={i} style={{
            width: 18, height: 18, borderRadius: '50%',
            background: n <= 40 ? HALFTIME.over : HALFTIME.under, color: '#fff',
            fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
        <span style={{ color: HALFTIME.gold, fontSize: 20, fontWeight: 900, marginLeft: 10 }}>和值 {round.sum}</span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

// 待命态（betting/locked，多桌用；HalfTime 原页从不挂此态）
function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function HalfTimeStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, shakeRef, onFinale }) {
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])

    // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已定后触发）----------
    function ensureAudio() {
      if (audioRef.current.ctx) return audioRef.current.ctx
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
      audioRef.current.ctx = ctx; return ctx
    }
    function sfxThump() {   // 踢击：低频 sine 顿击 150→55Hz
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.09)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.12)
    }
    function sfxSwish() {   // 入网：带通噪声短扫 2000→600Hz
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate)
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
      const ns = ctx.createBufferSource(); ns.buffer = nb
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1
      bp.frequency.setValueAtTime(2000, t); bp.frequency.exponentialRampToValueAtTime(600, t + 0.11)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.12)
    }
    function sfxChime() {   // SCORE 定格：上扬三连音
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      ;[660, 880, 1170].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
        const s = t + i * 0.08
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
        o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
      })
    }
    const stageSfx = { thump: sfxThump, swish: sfxSwish, chime: sfxChime }

  const round = drawResult?.balls ? deriveRound(drawResult.balls) : null
  const racing = round != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <DrawStage key={roundNo} round={round} height={height} shakeRef={shakeRef} sfx={stageSfx} onFinale={onFinale} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
