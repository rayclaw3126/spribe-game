// #41 单6：号码王开奖舞台组件（从 NumberUp.jsx 机械搬运——换人牌 canvas+rAF+dev钩子
// __NU_RAF_ACTIVE/__NU_ANIM_LAST + WebAudio SFX，逐字节切片，仅 shakeRef.current→shakeRef?.current 护栏）。
// props {phase,roundNo,drawResult,width,height,muted}(+页面用 shakeRef/onFinale)；key=期号重挂载在内层 BoardStage。
import { useRef, useEffect } from 'react'
import { NUMBERUP } from '../../components/shell/tokens'

// ---------- 换人牌舞台时间轴（rAF 内使用，毫秒）----------
const BOARD_RISE = 800
const TENS_LOCK = 2500
const ONES_LOCK = 4300

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
      if (shakeRef?.current) {
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
      const drawWindow = (wx, locked, finalDigit, flashAt, digits = 10) => {
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
          // 滚动列：当前/下一位按小数偏移上滚 + 残影模糊感（digits 位循环：十位 5、个位 10）
          const roll = t / 55
          const cur = Math.floor(roll) % digits
          const frac = roll - Math.floor(roll)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillText(String(cur), dx, -frac * winH * 0.9 + 1 * dpr)
          ctx.fillText(String((cur + 1) % digits), dx, (1 - frac) * winH * 0.9 + 1 * dpr)
          ctx.fillStyle = 'rgba(255,255,255,0.22)'
          ctx.fillText(String((cur + digits - 1) % digits), dx, -frac * winH * 0.9 - winH * 0.9 + 1 * dpr)
        }
        ctx.restore()
      }
      drawWindow(-winW - bw * 0.03, tensLocked, tens, tensFlash, 5)   // 十位牌只到 4
      drawWindow(bw * 0.03, onesLocked, ones, onesFlash, 10)
      ctx.restore()

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (shakeRef?.current) shakeRef.current.style.transform = ''
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

// 待命态（betting/locked，多桌用；NumberUp 原页从不挂此态——betting 走静态号码块）
function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function NumberUpStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, shakeRef, onFinale }) {
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

  const num = drawResult?.num ?? null
  const racing = num != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <BoardStage key={roundNo} num={num} height={height} shakeRef={shakeRef} sfx={stageSfx} onFinale={onFinale} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
