// #41 单6：PK10 开奖舞台组件（从 GoldenBoot.jsx 机械搬运——10 车冲刺 canvas+rAF+dev钩子
// __GB_RAF_ACTIVE/__GB_ANIM_LAST + WebAudio 引擎 SFX，逐字节切片，仅 shakeRef 护栏）。
// 10 张车号 PNG + 红绿灯 import 随件复制（主档 CarImgBead 盘口图标另有引用，故两处并存不移出）。
// props {phase,roundNo,drawResult,width,height,muted}(+页面 shakeRef/onFinale)。
import { useRef, useEffect } from 'react'
import { GOLDENBOOT } from '../../components/shell/tokens'
import car01 from '../../assets/goldenboot/car_01.png'
import car02 from '../../assets/goldenboot/car_02.png'
import car03 from '../../assets/goldenboot/car_03.png'
import car04 from '../../assets/goldenboot/car_04.png'
import car05 from '../../assets/goldenboot/car_05.png'
import car06 from '../../assets/goldenboot/car_06.png'
import car07 from '../../assets/goldenboot/car_07.png'
import car08 from '../../assets/goldenboot/car_08.png'
import car09 from '../../assets/goldenboot/car_09.png'
import car10 from '../../assets/goldenboot/car_10.png'
import trafficLightImg from '../../assets/goldenboot/traffic_light.png'
import { deriveRace } from '../markets/goldenboot'

// 车图按号索引（= 主档 CAR_SRC，随件复制）
const CAR_SRC = { 1: car01, 2: car02, 3: car03, 4: car04, 5: car05, 6: car06, 7: car07, 8: car08, 9: car09, 10: car10 }

// ---------- 冲刺舞台时间轴（rAF 内使用，毫秒）----------
const RACE_START = 500
const SPRINT_BASE = 4800
const RANK_GAP = 160

// ---------- 冲刺舞台：单一 rAF 循环驱动全部物理（禁 CSS transition 拼接）----------
// 10 泳道横向冲刺；每人速度曲线按注入名次反推（基线到达时刻=名次序，叠加
// base·(1-base) 包络的正弦摆动 → 中途超车交错、冲线时刻不变，结局恒等于注入名次）。
// 撞线金闪 + 名次侧栏依次落位 + 整卡轻震；prefers-reduced-motion 静态示名次表。
function RaceStage({ race, height, shakeRef, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { cbRef.current.onFinale?.(); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__GB_RAF_ACTIVE = (window.__GB_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    // 预载赛车 + 红绿灯图（未 load 完用色块占位防闪白）
    const carImgs = {}
    for (let n = 1; n <= 10; n++) { const im = new Image(); im.src = CAR_SRC[n]; carImgs[n] = im }
    const trafficImg = new Image(); trafficImg.src = trafficLightImg
    // 装饰性随机（结果早已定，只抖中段轨迹，不碰确定性随机数流的位置）
    const runners = race.order.map((num, i) => ({
      num, rank: i + 1,
      fin: RACE_START + SPRINT_BASE + i * RANK_GAP,
      phase: Math.random() * Math.PI * 2,
      wobA: 0.05 + Math.random() * 0.05,
      p: 0, finished: false, trail: [],
    }))
    const byLane = [...runners].sort((a, b) => a.num - b.num)   // 泳道固定按号码
    const lastFin = RACE_START + SPRINT_BASE + 9 * RANK_GAP
    const finishedList = []
    let raf = 0, whistled = false, finaleFired = false
    let lastStep = 0, shakeUntil = 0, flashUntil = 0
    let prevLeadP = 0, engFreq = 70   // 引擎快慢感：领跑车速度 → 频率
    const t0 = performance.now()

    // 赛车 sprite（drawImage 按号选车、朝右、保宽高比；尾焰=左侧渐变三角；小号码徽标）
    const drawCar = (x, y, s, num, opts = {}) => {
      const { big = false, flame = false, noBadge = false } = opts
      if (flame) {
        const fw = s * 1.0
        const g = ctx.createLinearGradient(x - s * 0.75 - fw, y, x - s * 0.75, y)
        g.addColorStop(0, 'rgba(255,110,20,0)')
        g.addColorStop(1, 'rgba(255,185,50,0.6)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(x - s * 0.75, y - s * 0.2); ctx.lineTo(x - s * 0.75 - fw, y); ctx.lineTo(x - s * 0.75, y + s * 0.2)
        ctx.closePath(); ctx.fill()
      }
      const img = carImgs[num]
      if (img && img.complete && img.naturalWidth > 0) {
        const asp = img.naturalWidth / img.naturalHeight
        const h = s * (big ? 1.35 : 1.1), w = h * asp
        ctx.drawImage(img, x - w / 2, y - h / 2, w, h)
      } else {   // 占位色块（防闪白）
        ctx.fillStyle = big ? GOLDENBOOT.gold : GOLDENBOOT.fire
        ctx.beginPath(); ctx.roundRect(x - s * 0.75, y - s * 0.42, s * 1.5, s * 0.84, s * 0.16); ctx.fill()
      }
      if (!big && !noBadge) {   // 号码小徽标（保识别）
        const bs = s * 0.44
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.beginPath(); ctx.arc(x, y - s * 0.6, bs * 0.62, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = GOLDENBOOT.gold
        ctx.font = `900 ${Math.round(bs * 0.72)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(num), x, y - s * 0.58)
      }
    }

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      const x0 = W * 0.06, x1 = W * 0.84
      const laneH = H / 10
      const bead = Math.min(laneH * 0.92, 22 * dpr)

      // —— 时序/物理 ——
      if (!whistled && t >= RACE_START) { whistled = true; cbRef.current.sfx.whistle(); cbRef.current.sfx.engineStart?.() }
      if (whistled && finishedList.length < 10 && now - lastStep > 170) {
        lastStep = now
        cbRef.current.sfx.step()
      }
      for (const r of runners) {
        if (t < RACE_START) { r.p = 0; continue }
        const base = Math.min(1, (t - RACE_START) / (r.fin - RACE_START))
        const wob = r.wobA * Math.sin(t / 420 + r.phase) * 4 * base * (1 - base)
        r.p = Math.max(0, Math.min(1, base + wob))
        if (!r.finished && base >= 1) {
          r.finished = true
          finishedList.push(r)
          if (r.rank === 1) {
            cbRef.current.sfx.cheer()
            shakeUntil = now + 100
            flashUntil = now + 450
          }
        }
      }
      if (!finaleFired && t >= lastFin + 120) {
        finaleFired = true
        cbRef.current.sfx.engineStop?.()
        cbRef.current.sfx.chime()
        cbRef.current.onFinale?.()
        if (import.meta.env.DEV) window.__GB_ANIM_LAST = race.order.join(',')
      }
      if (shakeRef?.current) {
        shakeRef.current.style.transform = now < shakeUntil
          ? `translate(${Math.sin(now / 7) * 2}px, ${Math.cos(now / 5) * 1.5}px)`
          : ''
      }

      // —— 绘制 ——
      ctx.clearRect(0, 0, W, H)
      // 赛道皮肤：深灰沥青渐变
      const track = ctx.createLinearGradient(0, 0, 0, H)
      track.addColorStop(0, '#252932'); track.addColorStop(1, '#15181f')
      ctx.fillStyle = track; ctx.fillRect(0, 0, W, H)
      // 泳道分隔线（白虚线）+ 起点/终点线
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([10 * dpr, 8 * dpr])
      for (let i = 1; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * laneH); ctx.lineTo(W * 0.88, i * laneH); ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'
      ctx.lineWidth = 2 * dpr
      ctx.beginPath(); ctx.moveTo(x0 - bead, 0); ctx.lineTo(x0 - bead, H); ctx.stroke()
      // 终点双线
      ctx.beginPath(); ctx.moveTo(x1 + bead * 0.7, 0); ctx.lineTo(x1 + bead * 0.7, H); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath(); ctx.moveTo(x1 + bead * 0.7 + 4 * dpr, 0); ctx.lineTo(x1 + bead * 0.7 + 4 * dpr, H); ctx.stroke()
      // 撞线金闪
      if (now < flashUntil) {
        const k = (flashUntil - now) / 450
        ctx.fillStyle = `rgba(255,213,79,${0.35 * k})`
        ctx.fillRect(x1 - 30 * dpr, 0, bead * 2 + 60 * dpr, H)
      }
      // 领先者拖影（2 帧）
      let leader = null
      for (const r of runners) if (!leader || r.p > leader.p) leader = r
      // 引擎快慢感：领跑车帧间 Δp → 归一速度 → 平滑映射频率（70 慢 ~210 快）
      if (whistled && !finaleFired && leader) {
        const inst = Math.max(0, leader.p - prevLeadP)
        prevLeadP = leader.p
        const spd = Math.min(1, inst / 0.004)   // 稳态 Δp≈0.002-0.004（含 wobble 起伏）
        engFreq += (70 + spd * 140 - engFreq) * 0.12
        cbRef.current.sfx.engineRev?.(engFreq)
      }
      // 选手
      byLane.forEach((r, i) => {
        const y = i * laneH + laneH / 2
        const x = x0 + r.p * (x1 - x0)
        if (r === leader && whistled && !r.finished) {
          r.trail.push(x)
          if (r.trail.length > 2) r.trail.shift()
          r.trail.forEach((tx, ti) => {
            ctx.globalAlpha = [0.12, 0.25][ti] ?? 0.1
            drawCar(tx - bead * 0.5, y, bead, r.num)
          })
          ctx.globalAlpha = 1
        } else {
          r.trail.length = 0
        }
        drawCar(x, y, bead, r.num, { flame: whistled && !r.finished })
      })
      // 起跑红绿灯：红(0-200)→黄(200-350)→绿(350-500) 状态色辉 + 绿灯 GO!
      if (t < RACE_START + 250) {
        const lit = t < 200 ? [255, 60, 40] : t < 350 ? [255, 200, 40] : [60, 220, 90]
        if (trafficImg.complete && trafficImg.naturalWidth > 0) {
          const lh = H * 0.62, lw = lh * (trafficImg.naturalWidth / trafficImg.naturalHeight)
          ctx.drawImage(trafficImg, W / 2 - lw / 2, H * 0.16, lw, lh)
        }
        const gg = ctx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, W * 0.42)
        gg.addColorStop(0, `rgba(${lit[0]},${lit[1]},${lit[2]},0.3)`)
        gg.addColorStop(1, 'transparent')
        ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H)
      }
      if (t >= 350 && t < 900) {   // 绿灯 GO! 金字（渐隐，不改物理）
        const k = t < 520 ? 1 : Math.max(0, 1 - (t - 520) / 380)
        ctx.fillStyle = `rgba(255,213,79,${k})`
        ctx.font = `900 ${Math.round(H * 0.34)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * dpr
        ctx.fillText('出发！', W / 2, H / 2)
        ctx.shadowBlur = 0
      }
      // 名次侧栏 — 撞线依次落位
      const slotH = H / 10
      ctx.textAlign = 'left'
      finishedList.forEach((r, idx) => {
        const sy = idx * slotH + slotH / 2
        const sx = W * 0.93
        ctx.fillStyle = idx === 0 ? GOLDENBOOT.gold : 'rgba(255,255,255,0.55)'
        ctx.font = `900 ${Math.round(9 * dpr)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText(String(idx + 1), sx - Math.min(slotH * 0.78, 13 * dpr) * 0.78, sy + 3 * dpr)
        drawCar(sx, sy, Math.min(slotH * 0.78, 13 * dpr), r.num, { noBadge: true })
      })
      // 收尾：冠亚军金框定格（上下两格，车图与文字分列不重叠）
      if (finaleFired) {
        const cx = (x0 + x1) / 2, cy = H / 2
        const s = Math.min(H * 0.36, 42 * dpr)
        const bh = Math.min(s * 1.85, H * 0.6)   // ≤60% 高，上下各留 ~20% 边距
        const bw = s * 2.8
        const bx = cx - bw / 2, by = cy - bh / 2
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, bh, 12 * dpr)
        ctx.fill()
        ctx.strokeStyle = GOLDENBOOT.gold
        ctx.lineWidth = 2 * dpr
        ctx.shadowColor = GOLDENBOOT.gold
        ctx.shadowBlur = 14 * dpr
        ctx.stroke()
        ctx.shadowBlur = 0
        // 中缝分隔线
        ctx.strokeStyle = 'rgba(255,213,79,0.35)'
        ctx.lineWidth = 1 * dpr
        ctx.beginPath(); ctx.moveTo(bx + bw * 0.1, cy); ctx.lineTo(bx + bw * 0.9, cy); ctx.stroke()
        const carS = bh * 0.27   // 约格高 54%，四周留白
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ;[
          { label: '冠军', num: race.winner, ry: by + bh * 0.29, c: GOLDENBOOT.gold },
          { label: '亚军', num: race.runnerUp, ry: by + bh * 0.71, c: 'rgba(255,255,255,0.9)' },
        ].forEach(row => {
          drawCar(bx + bw * 0.27, row.ry, carS, row.num, { noBadge: true })
          ctx.fillStyle = row.c
          ctx.font = `900 ${Math.round(carS * 0.6)}px 'Space Grotesk', sans-serif`
          ctx.fillText(`${row.label}  #${row.num}`, bx + bw * 0.47, row.ry)
        })
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      cbRef.current.sfx.engineStop?.()   // 卸载停引擎轰鸣（防泄漏/跨局残响）
      if (shakeRef?.current) shakeRef.current.style.transform = ''
      if (import.meta.env.DEV) window.__GB_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；race 由 key 换新保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, flexWrap: 'wrap', padding: '0 12px',
        background: GOLDENBOOT.strip, borderRadius: 12,
      }}>
        {race.order.map((n, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, opacity: i > 2 ? 0.6 : 1 }}>
            <span style={{ color: GOLDENBOOT.dim, fontSize: 10, fontWeight: 900 }}>{i + 1}.</span>
            <img src={CAR_SRC[n]} alt={`car ${n}`} style={{ height: 22, width: 'auto', display: 'block' }} />
          </span>
        ))}
        <span style={{ color: GOLDENBOOT.gold, fontSize: 14, fontWeight: 900, marginLeft: 8 }}>冠军 #{race.winner} · 亚军 #{race.runnerUp}</span>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

// 待命态（betting/locked，多桌用；GoldenBoot 原页 betting 走静态起跑线块）
function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function GoldenBootStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, shakeRef, onFinale }) {
  const audioRef = useRef({ ctx: null, muted: false })
  const engineRef = useRef(null)
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
    function sfxWhistle() {   // 发车音：引擎猛轰上扬 rev
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.28)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(1200, t + 0.28)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
      o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.36)
    }
    function sfxStep() {   // 引擎加速脉冲（rAF 每 ~170ms 触发成节奏簇 = 排气声）
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.05)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      o.connect(lp); lp.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
    }
    // 冲刺持续引擎轰鸣：低频锯齿 + rumble LFO 调频（起跑起、finale/卸载停；muted 门控）
    function sfxEngineStart() {
      sfxEngineStop()
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 72
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 24
      const lfoG = ctx.createGain(); lfoG.gain.value = 16
      lfo.connect(lfoG); lfoG.connect(osc.frequency)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.4)
      osc.connect(lp); lp.connect(g); g.connect(ctx.destination)
      osc.start(t); lfo.start(t)
      engineRef.current = { osc, lfo, g }
    }
    // 引擎快慢感：按冲刺速度平滑更新振荡频率（70Hz 慢 → 210Hz 快）
    function sfxEngineRev(freq) {
      const e = engineRef.current; if (!e) return
      const ctx = audioRef.current.ctx; if (!ctx) return
      try { e.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05) } catch { /* 已停 */ }
    }
    function sfxEngineStop() {
      const e = engineRef.current; if (!e) return
      engineRef.current = null
      const ctx = audioRef.current.ctx; if (!ctx) return
      const t = ctx.currentTime
      try {
        e.g.gain.cancelScheduledValues(t)
        e.g.gain.setValueAtTime(Math.max(0.0001, e.g.gain.value), t)
        e.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
        e.osc.stop(t + 0.3); e.lfo.stop(t + 0.3)
      } catch { /* 已停 */ }
    }
    function sfxCheer() {   // 冲线：轮胎 screech + 观众欢呼浪涌
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      // 轮胎尖啸（高频窄带噪声速降）
      const sb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate)
      const sd = sb.getChannelData(0); for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1)
      const ss = ctx.createBufferSource(); ss.buffer = sb
      const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.Q.value = 6
      sbp.frequency.setValueAtTime(2600, t); sbp.frequency.exponentialRampToValueAtTime(1200, t + 0.28)
      const sg = ctx.createGain()
      sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.06, t + 0.02); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      ss.connect(sbp); sbp.connect(sg); sg.connect(ctx.destination); ss.start(t); ss.stop(t + 0.3)
      // 观众欢呼浪涌
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate)
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1)
      const ns = ctx.createBufferSource(); ns.buffer = nb
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
      bp.frequency.setValueAtTime(420, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.5)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + 0.1); g.gain.exponentialRampToValueAtTime(0.1, t + 0.28); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.88)
      ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t + 0.1); ns.stop(t + 0.9)
    }
    function sfxChime() {   // 收尾定格：上扬三连音
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      ;[660, 880, 1170].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
        const s = t + i * 0.08
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.1, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28)
        o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.3)
      })
    }
    const stageSfx = { whistle: sfxWhistle, step: sfxStep, cheer: sfxCheer, chime: sfxChime, engineStart: sfxEngineStart, engineStop: sfxEngineStop, engineRev: sfxEngineRev }

  const race = drawResult?.ranking ? deriveRace(drawResult.ranking) : null
  const racing = race != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <RaceStage key={roundNo} race={race} height={height} shakeRef={shakeRef} sfx={stageSfx} onFinale={onFinale} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
