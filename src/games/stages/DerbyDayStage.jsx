// #41 单7：德比大战开奖舞台组件（从 DerbyDay.jsx 机械搬运——二阶段(半场ht/全场ft) canvas+rAF
// +彩带庆祝+dev钩子 __DD_RAF_ACTIVE/__DD_ANIM_HT/FT/__DD_CELEB/__DD_LAUNCHES/__DD_CONF_*，逐字节切片）。
// 命名导出 DrawStage 供原页两处 ht/ft 调用直接 import（SFX/双块编排留原页，体验分毫不变）；
// 默认导出 DerbyDayStage 为多桌 wrapper（自带 SFX，drawn 起演 FT 全场；HT 子相位属原页编排，多桌不复刻）。
// props {phase,roundNo,drawResult,width,height,muted}。trophyImg/NumBead 主档另引故随件复制。
import { useRef, useEffect } from 'react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import trophyImg from '../../assets/shared/trophy.png'
import { deriveMatch } from '../markets/derbyday'

// ---------- 出球舞台时间轴（rAF 内使用，毫秒）----------
const BALL_T0 = 400      // 首珠弹出时刻
const BALL_GAP = 300     // 出珠间隔（20 珠 ~6.4s 出完）
const BALL_FLIGHT = 280  // 单珠飞行时长（短抛物线）
const STAGE_FREEZE = 6600   // 和值对比定格（放大一拍 + 领先方 trophy 闪现）
// 关键球慢放：每阶段末 3 球间隔 ×1.75（相对压缩后前段 ≈×2.04），前 16 段等比
// 压缩补偿——gap 总和不变，末球弹出仍 6100ms、定格仍 6600ms，阶段/心跳表总长零改动
const SLOW_N = 3
const SLOW_X = 1.75
const BALL_LAUNCHES = (() => {
  const slow = BALL_GAP * SLOW_X
  const fast = (19 * BALL_GAP - SLOW_N * slow) / (19 - SLOW_N)
  const ls = [BALL_T0]
  for (let k = 1; k < 20; k++) ls.push(ls[k - 1] + (k > 19 - SLOW_N ? slow : fast))
  return ls
})()

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

// ---------- 出球舞台：单一 rAF 循环驱动（禁 CSS transition 拼接）----------
// 开奖区双块原位表演（不另开槽）：主客交替出珠，每珠从块中央 TOTAL 位短抛物线
// 飞入自己阵列格位（落位轻弹 + 1 帧拖影）；两侧和值随出珠滚动累加、领先方亮色；
// 阶段定格 = 和值对比放大一拍 + 领先方 trophy 闪现（平局不亮）。
// HT 段出前 10 珠（和值从 0 起滚）；FT 段出后 10 珠（和值从半场基数累计滚）。
// 结果进 HT_DRAW 前已全锁定，动画只读。
export function DrawStage({ stage, roll, beadSize, isMobile, sfx, onFinale }) {
  const canvasRef = useRef(null)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const half = stage === 'ht'
  const homeBalls = half ? roll.home20.slice(0, 10) : roll.home20.slice(10)
  const awayBalls = half ? roll.away20.slice(0, 10) : roll.away20.slice(10)
  const baseHome = half ? 0 : roll.htHome
  const baseAway = half ? 0 : roll.htAway
  const finalHome = half ? roll.htHome : roll.ftHome
  const finalAway = half ? roll.htAway : roll.ftAway
  const isTie = finalHome === finalAway
  const title = half ? '半场' : '全场'
  const innerH = beadSize * 2 + (isMobile ? 3 : 4) + 24   // 两行阵列 + 底部比分行

  useEffect(() => {
    const markKey = half ? '__DD_ANIM_HT' : '__DD_ANIM_FT'
    if (reduced) {   // 减动效：直接标记 + 收尾
      if (import.meta.env.DEV) window[markKey] = `${finalHome},${finalAway}`
      cbRef.current.onFinale?.()
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (import.meta.env.DEV) window.__DD_RAF_ACTIVE = (window.__DD_RAF_ACTIVE || 0) + 1

    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)

    const trophy = new Image()
    trophy.src = trophyImg

    const landed = new Array(20).fill(false)
    const launched = new Array(20).fill(false)   // 心跳音事件沿（慢放段）
    const lastPos = new Array(20).fill(null)   // 1 帧拖影
    let barP = 0.5                             // 拉锯条显示比例（rAF 缓动）
    let whistled = false, finaled = false, cheered = false
    if (import.meta.env.DEV) {
      if (!half) window.__DD_CELEB = null            // 每场全场舞台重置（平局保持 null）
      window[half ? '__DD_CONF_HT' : '__DD_CONF_FT'] = null   // 彩带几何记录重置（平局保持 null）
    }
    let raf = 0
    const t0 = performance.now()
    if (import.meta.env.DEV) window.__DD_LAUNCHES = BALL_LAUNCHES

    const loop = now => {
      const t = now - t0
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)

      const bs = beadSize * dpr
      const gap = (isMobile ? 3 : 4) * dpr
      const pad = (isMobile ? 8 : 14) * dpr
      const gridW = 5 * bs + 4 * gap
      const gridH = 2 * bs + gap
      const centerW = (isMobile ? 92 : 120) * dpr
      const x0 = (W - (gridW * 2 + centerW + pad * 2)) / 2
      const xa = x0 + gridW + pad * 2 + centerW
      const slot = (team, idx) => ({
        x: (team ? xa : x0) + (idx % 5) * (bs + gap) + bs / 2,
        y: Math.floor(idx / 5) * (bs + gap) + bs / 2,
      })
      const center = { x: W / 2, y: gridH / 2 }

      // —— 出珠推进 + 和值累加 ——
      let curHome = baseHome, curAway = baseAway
      const frozen = t >= STAGE_FREEZE
      for (let k = 0; k < 20; k++) {
        const team = k % 2                 // 0 主 1 客（主1客1主2客2…交替）
        const idx = Math.floor(k / 2)
        const launch = BALL_LAUNCHES[k]    // 慢放时间轴（末 3 球拉长，前段压缩补偿）
        const v = team ? awayBalls[idx] : homeBalls[idx]
        // 关键球心跳：末 3 球弹出沿触发（结果已锁，只读）
        if (t >= launch && !launched[k]) {
          launched[k] = true
          if (k >= 20 - SLOW_N && !frozen) cbRef.current.sfx.heart()
        }
        if (t >= launch + BALL_FLIGHT || frozen) {
          if (!landed[k]) { landed[k] = true; cbRef.current.sfx.pop(team) }
          if (team) curAway += v; else curHome += v
        }
      }

      // —— 定格事件 ——
      if (frozen && !whistled) { whistled = true; cbRef.current.sfx.whistle() }
      if (frozen && !finaled && t >= STAGE_FREEZE + 250) {
        finaled = true
        if (!half) cbRef.current.sfx.chime(isTie)
        if (import.meta.env.DEV) window[half ? '__DD_ANIM_HT' : '__DD_ANIM_FT'] = `${finalHome},${finalAway}`
        cbRef.current.onFinale?.()
      }

      // —— 珠位绘制（空位淡圈 / 已落珠 / 飞行珠 + 拖影）——
      const drawBead = (x, y, r, color, v, alpha = 1) => {
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'
        ctx.lineWidth = 1 * dpr
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.font = `900 ${Math.round(r * 0.85)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(v), x, y + 0.5 * dpr)
        ctx.globalAlpha = 1
      }
      for (let k = 0; k < 20; k++) {
        const team = k % 2, idx = Math.floor(k / 2)
        const s = slot(team, idx)
        const color = team ? DERBY.away : DERBY.home
        const v = team ? awayBalls[idx] : homeBalls[idx]
        const launch = BALL_LAUNCHES[k]
        if (landed[k]) {
          // 落位轻弹（120ms 半径回落）
          const since = t - (launch + BALL_FLIGHT)
          const r = (bs / 2) * (since < 120 && !frozen ? 1 + 0.22 * (1 - since / 120) : 1)
          drawBead(s.x, s.y, r, color, v)
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.beginPath(); ctx.arc(s.x, s.y, bs / 2, 0, Math.PI * 2); ctx.fill()
          if (t >= launch && t < launch + BALL_FLIGHT) {
            const p = (t - launch) / BALL_FLIGHT
            const x = center.x + (s.x - center.x) * p
            const y = center.y + (s.y - center.y) * p - Math.sin(p * Math.PI) * 18 * dpr
            if (lastPos[k]) drawBead(lastPos[k].x, lastPos[k].y, bs / 2, color, v, 0.25)   // 1 帧拖影
            drawBead(x, y, bs / 2, color, v)
            lastPos[k] = { x, y }
          }
        }
      }

      // —— 拉锯条：主客和值对比随出珠实时过渡（rAF 内宽度缓动，禁 CSS transition 拼接）——
      const barTarget = curHome + curAway > 0 ? curHome / (curHome + curAway) : 0.5
      barP += (barTarget - barP) * 0.1
      const barX = x0, barW = xa + gridW - x0
      const barY = gridH + 2 * dpr, barH = 3 * dpr
      ctx.fillStyle = DERBY.home
      ctx.fillRect(barX, barY, barW * barP, barH)
      ctx.fillStyle = DERBY.away
      ctx.fillRect(barX + barW * barP, barY, barW * (1 - barP), barH)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(barX + barW * barP - 1 * dpr, barY - 1 * dpr, 2 * dpr, barH + 2 * dpr)

      // —— 中央标题 + TOTAL 滚动 ——
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `900 ${9 * dpr}px sans-serif`
      ctx.fillText(title, W / 2, center.y - 10 * dpr)
      ctx.fillStyle = frozen ? DERBY.gold : 'rgba(255,255,255,0.9)'
      ctx.font = `900 ${13 * dpr}px 'Space Grotesk', sans-serif`
      ctx.fillText(`合计 ${curHome + curAway}`, W / 2, center.y + 7 * dpr)

      // —— 底部比分行：领先方亮色；定格放大一拍 + trophy 闪现 ——
      const by = gridH + 13 * dpr
      const scale = frozen ? 1 + 0.25 * Math.sin(Math.min(1, (t - STAGE_FREEZE) / 400) * Math.PI) : 1
      const homeLead = curHome > curAway, awayLead = curAway > curHome
      ctx.textBaseline = 'middle'
      ctx.font = `900 ${Math.round(12 * dpr * scale)}px sans-serif`
      ctx.textAlign = 'left'
      ctx.fillStyle = DERBY.home
      ctx.beginPath(); ctx.arc(x0 + 4 * dpr, by, 4 * dpr, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = homeLead ? '#ffffff' : 'rgba(255,255,255,0.6)'
      ctx.fillText(`主队：${curHome}`, x0 + 12 * dpr, by)
      ctx.textAlign = 'right'
      ctx.fillStyle = DERBY.away
      ctx.beginPath(); ctx.arc(xa + gridW - 4 * dpr, by, 4 * dpr, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = awayLead ? '#ffffff' : 'rgba(255,255,255,0.6)'
      ctx.fillText(`客队：${curAway}`, xa + gridW - 12 * dpr, by)
      // trophy 闪现（定格后领先方一侧，平局不亮）
      if (frozen && !isTie && trophy.complete) {
        const a = Math.min(1, (t - STAGE_FREEZE) / 300)
        ctx.globalAlpha = a
        const tw = 14 * dpr
        if (homeLead) ctx.drawImage(trophy, x0 + 12 * dpr + ctx.measureText(`主队：${curHome}`).width + 4 * dpr, by - tw / 2, tw, tw)
        else ctx.drawImage(trophy, xa + gridW - 12 * dpr - ctx.measureText(`客队：${curAway}`).width - tw - 4 * dpr, by - tw / 2, tw, tw)
        ctx.globalAlpha = 1
      }

      // —— 彩带雨（落区 = 胜方半场组框实际几何界 [x0,+gridW]/[xa,+gridW]，禁写死像素）——
      // HT 定格 = 短版（30 粒 ~1s，无字卡无欢呼）；FT 定格 = 正式版（70 粒 ~2s）；
      // 平局不出。参数全由粒序黄金比散列派生（零随机数），越界钳回半区
      if (frozen && !isTie) {
        const tc = t - STAGE_FREEZE
        const zoneX = homeLead ? x0 : xa
        const zoneW = gridW
        const conf = half
          ? { n: 30, fall: 800, g: 10, s: 20 }
          : { n: 70, fall: 1400, g: 20, s: 28 }
        const teamColor = homeLead ? DERBY.home : DERBY.away
        for (let i = 0; i < conf.n; i++) {
          const delay = (i % conf.g) * conf.s
          const ti = tc - delay
          if (ti < 0 || ti > conf.fall) continue
          const p = ti / conf.fall
          let x = zoneX + ((i * 0.618034 + 0.137) % 1) * zoneW + Math.sin(ti / 260 + i) * 14 * dpr
          x = Math.max(zoneX, Math.min(zoneX + zoneW, x))
          const y = -16 * dpr + p * (H + 32 * dpr)
          const sz = (2.6 + (i % 3) * 1.1) * dpr
          ctx.globalAlpha = (0.5 + (i % 4) * 0.15) * (p > 0.82 ? (1 - p) / 0.18 : 1)
          ctx.fillStyle = i % 6 === 0 ? DERBY.gold : i % 6 === 3 ? COLORS.white : teamColor
          ctx.save(); ctx.translate(x, y); ctx.rotate(ti / 180 + i)
          ctx.fillRect(-sz / 2, -sz, sz, sz * 2)
          ctx.restore()
          if (import.meta.env.DEV) {
            const kk = half ? '__DD_CONF_HT' : '__DD_CONF_FT'
            const rec = window[kk] || (window[kk] = { side: homeLead ? 'home' : 'away', minX: Infinity, maxX: -Infinity, zone: null, W: 0, n: 0 })
            rec.zone = [zoneX, zoneX + zoneW]; rec.W = W
            rec.minX = Math.min(rec.minX, x); rec.maxX = Math.max(rec.maxX, x); rec.n++
          }
        }
        ctx.globalAlpha = 1
      }

      // —— 字卡 + 欢呼（仅全场 & 非平局；并入本 rAF 单循环，禁二环）——
      if (frozen && !half && !isTie) {
        const tc = t - STAGE_FREEZE
        if (!cheered) {
          cheered = true
          cbRef.current.sfx.cheer?.()
          if (import.meta.env.DEV) window.__DD_CELEB = homeLead ? 'home' : 'away'
        }
        const teamColor = homeLead ? DERBY.home : DERBY.away
        // 字卡弹簧：160ms 线性入 → 指数衰减余弦回弹
        const base = Math.min(1, tc / 160)
        const spring = tc <= 160 ? 1.35 : 1 + 0.35 * Math.exp(-(tc - 160) / 240) * Math.cos((tc - 160) / 110)
        const label = homeLead ? '主队胜' : '客队胜'
        ctx.save()
        ctx.translate(W / 2, H - 11 * dpr); ctx.scale(base * spring, base * spring)
        ctx.font = `900 ${11 * dpr}px 'Space Grotesk', sans-serif`
        const lw = ctx.measureText(label).width
        const pw = lw + 22 * dpr, ph = 18 * dpr
        ctx.fillStyle = teamColor
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(-pw / 2, -ph / 2, pw, ph, 9 * dpr); else ctx.rect(-pw / 2, -ph / 2, pw, ph)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1 * dpr; ctx.stroke()
        ctx.fillStyle = COLORS.white
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(label, 0, 0.5 * dpr)
        ctx.restore()
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (import.meta.env.DEV) window.__DD_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴；key=期号+阶段保证重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (reduced) {   // 减动效：静态直出真珠 + 和值
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 8 : 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`, gap: isMobile ? 3 : 4 }}>
            {homeBalls.map((n, i) => <NumBead key={i} n={n} color={DERBY.home} size={beadSize} />)}
          </div>
          <span style={{ color: DERBY.gold, fontSize: 12, fontWeight: 900 }}>{title} 合计 {finalHome + finalAway}</span>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`, gap: isMobile ? 3 : 4 }}>
            {awayBalls.map((n, i) => <NumBead key={i} n={n} color={DERBY.away} size={beadSize} />)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: DERBY.text, fontSize: 12, fontWeight: 900 }}>
          <span>主队：{finalHome}</span><span>客队：{finalAway}</span>
        </div>
      </div>
    )
  }
  return <canvas ref={canvasRef} style={{ width: '100%', height: innerH, display: 'block' }} aria-hidden />
}

function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function DerbyDayStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted }) {
  const isMobile = useIsMobile()
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

  const roll = drawResult?.home20 ? deriveMatch({ home20: drawResult.home20, away20: drawResult.away20 }) : null
  const racing = roll != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  const beadSize = isMobile ? 22 : 26
  return (
    <div style={{
      position: 'relative', width, height, overflow: 'hidden', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: DERBY.strip, padding: isMobile ? '6px 8px' : '6px 12px',
    }}>
      {racing
        ? <DrawStage key={roundNo} stage="ft" roll={roll} beadSize={beadSize} isMobile={isMobile} sfx={stageSfx} onFinale={undefined} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
