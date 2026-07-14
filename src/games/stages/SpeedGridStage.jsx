// #41 单5：SpeedGrid 开奖舞台组件（从 SpeedGrid.jsx 机械搬运——canvas+rAF+F1冲线动画+dev钩子
// __SG_RAF_ACTIVE/__SG_ANIM_LAST/__SG_CONF + WebAudio SFX，全部逐字节搬运，仅 RaceStage→RaceCanvas
// 加 height 参）。props {phase,roundNo,drawResult,width,height,muted}；key=期号重挂载惯例在内层 RaceCanvas 保持。
// SpeedGrid 原页 = 只在 drawing/settled 挂本件(=原 RaceStage)，体验分毫不变；多桌 betting 走待命态。
import { useRef, useEffect } from 'react'
import { COLORS, DERBY, ROULETTE } from '../../components/shell/tokens'
import carSpritesImg from '../../assets/speedgrid/car_sprites.png'

// ---------- 舞台时间轴（rAF 内使用，毫秒）----------
const RACE_T = 3300     // 冲线时刻（车群段 0-2300 摆动，2300 起冠军脱出）
const BREAK_T = 2300    // 冠军脱出起点
const FREEZE_T = 3400   // 定格 + 冠军大牌弹出

// sprite 切图坐标（PIL 包围盒实测，1024² 表）：车头朝左，绘制时水平镜像向右行进
const SPRITES = [
  [17, 596, 474, 119],   // 蓝队 BL
  [21, 286, 474, 119],   // 红队 TL
  [518, 288, 474, 119],  // 金队 TR
  [516, 597, 474, 119],  // 黑队（绿车 BR，压暗滤镜代黑涂装）
]

// 陪跑 5 车从冠军号播种伪随机取（mulberry32，零额外随机数消耗）
function pacersFrom(champ) {
  let a = (Math.imul(champ, 0x9e3779b1) + 0x2f6e2b1) >>> 0
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pool = []
  for (let n = 1; n <= 24; n++) if (n !== champ) pool.push(n)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  // 每车速度系数/摆动相位一并播种（纯装饰，冠军结果不受影响）
  return pool.slice(0, 5).map((n, i) => ({
    n, f: 0.88 + rng() * 0.08, ph: rng() * Math.PI * 2, lane: 0, idx: i,
  }))
}

// 单 rAF 循环驱动整条时间轴；key=期号重挂载；sfx 在结果已锁后触发；
// StrictMode 双挂载由 cleanup 兜底；prefers-reduced-motion 直出终态帧
function RaceCanvas({ champ, sfx, height = 128 }) {
  const canvasRef = useRef(null)
  const cbRef = useRef(sfx)
  cbRef.current = sfx
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(r.width * dpr))
      canvas.height = Math.max(1, Math.floor(r.height * dpr))
    }
    fit()
    window.addEventListener('resize', fit)
    const sheet = new Image()
    sheet.src = carSpritesImg

    // 车列：冠军 + 5 陪跑，车道 = 固定映射（冠军道由号派生）
    const pacers = pacersFrom(champ)
    const champLane = (champ - 1) % 6
    const lanes = []
    let pi = 0
    for (let l = 0; l < 6; l++) {
      if (l === champLane) lanes.push({ n: champ, f: 1, ph: (champ % 7) / 7 * Math.PI * 2, isChamp: true })
      else lanes.push({ ...pacers[pi++], isChamp: false })
    }

    let whistled = false, cheered = false, horned = false, marked = false
    let raf = 0
    if (import.meta.env.DEV) window.__SG_CONF = null   // 彩带几何记录重置

    const frame = t => {
      const W = canvas.width, H = canvas.height
      ctx.clearRect(0, 0, W, H)
      const laneH = H / 6
      const carH = laneH * 0.72
      const carW = carH * (474 / 119)
      const startX = 6 * dpr
      const finishX = W - 26 * dpr
      const span = finishX - startX - carW

      // —— 赛道纹理：车道分隔虚线 + 后掠速度线（随时间左移）——
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([6 * dpr, 8 * dpr])
      for (let l = 1; l < 6; l++) {
        ctx.beginPath(); ctx.moveTo(0, l * laneH); ctx.lineTo(W, l * laneH); ctx.stroke()
      }
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      const dash = 26 * dpr
      const off = (t * 0.45 * dpr) % (dash * 2)
      for (let l = 0; l < 6; l++) {
        for (let x = -off; x < W; x += dash * 2) {
          ctx.fillRect(x, l * laneH + laneH * 0.5, dash * 0.6, 1.5 * dpr)
        }
      }
      // —— 冲线格挡旗(右缘双列棋盘格)——
      const cell = 5 * dpr
      for (let y = 0; y < H; y += cell) {
        for (let c = 0; c < 2; c++) {
          ctx.fillStyle = ((y / cell + c) % 2 < 1) ? COLORS.white : ROULETTE.black
          ctx.fillRect(finishX + carW * 0.5 + c * cell, y, cell, cell)
        }
      }

      // —— 位置计算（纯 t 函数；冠军全程不掉出前二：对第二名钳位）——
      const tc = Math.min(t, RACE_T)
      const sway = tc < BREAK_T ? 1 - (tc / BREAK_T) * 0.35 : 0.65 * (1 - Math.min(1, (tc - BREAK_T) / 700))
      const xs = lanes.map(c => {
        let x = startX + (tc / RACE_T) * span * c.f + Math.sin(tc / 260 + c.ph) * 9 * dpr * sway
        if (c.isChamp) {
          x = startX + (tc / RACE_T) * span + Math.sin(tc / 300 + c.ph) * 5 * dpr * sway
          if (tc > BREAK_T) x += ((tc - BREAK_T) / (RACE_T - BREAK_T)) * 30 * dpr   // 末段脱出
        }
        return x
      })
      const others = xs.filter((_, i) => !lanes[i].isChamp).sort((a, b) => b - a)
      const champI = lanes.findIndex(c => c.isChamp)
      xs[champI] = Math.max(xs[champI], others[1] + 2 * dpr)   // 前二钳位
      if (t >= RACE_T) xs[champI] = Math.max(xs[champI], finishX - carW)

      // —— 车（sprite 镜像向右；黑队压暗滤镜）——
      lanes.forEach((c, i) => {
        const team = Math.ceil(c.n / 6) - 1
        const [sx, sy, sw, sh] = SPRITES[team]
        const y = i * laneH + (laneH - carH) / 2
        if (sheet.complete && sheet.naturalWidth > 0) {
          ctx.save()
          ctx.translate(xs[i] + carW, y)
          ctx.scale(-1, 1)
          if (team === 3) ctx.filter = 'brightness(0.32) saturate(0.4)'
          ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, carW, carH)
          ctx.restore()
          ctx.filter = 'none'
        }
        // 车号小签
        ctx.fillStyle = c.isChamp ? DERBY.gold : 'rgba(255,255,255,0.75)'
        ctx.font = `900 ${Math.round(laneH * 0.36)}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(c.n), xs[i] + carW * 0.5, y + carH * 0.5 - laneH * 0.34)
      })

      // —— 冠军彩带（照 Derby D4/D5 已验代码搬）：定格后 ~70 粒 2s 洒落，
      //    落区 = 舞台全宽（单赛道无主客半区语义），粒色 = 冠军车队涂装色系，
      //    参数全由粒序黄金比散列派生（零随机数），并入本 rAF 单环 ——
      if (t >= FREEZE_T) {
        const tcf = t - FREEZE_T
        const teamI = Math.ceil(champ / 6) - 1
        const teamColor = [DERBY.home, DERBY.away, COLORS.amberDeep, ROULETTE.black][teamI]
        for (let i = 0; i < 70; i++) {
          const delay = (i % 20) * 28
          const ti = tcf - delay
          if (ti < 0 || ti > 1400) continue
          const p = ti / 1400
          let x = ((i * 0.618034 + 0.137) % 1) * W + Math.sin(ti / 260 + i) * 14 * dpr
          x = Math.max(0, Math.min(W, x))
          const y = -16 * dpr + p * (H + 32 * dpr)
          const sz = (2.6 + (i % 3) * 1.1) * dpr
          ctx.globalAlpha = (0.5 + (i % 4) * 0.15) * (p > 0.82 ? (1 - p) / 0.18 : 1)
          ctx.fillStyle = i % 6 === 0 ? DERBY.gold : i % 6 === 3 ? COLORS.white : teamColor
          ctx.save(); ctx.translate(x, y); ctx.rotate(ti / 180 + i)
          ctx.fillRect(-sz / 2, -sz, sz, sz * 2)
          ctx.restore()
          if (import.meta.env.DEV) {
            const rec = window.__SG_CONF || (window.__SG_CONF = { team: teamI, minX: Infinity, maxX: -Infinity, W: 0, n: 0 })
            rec.W = W; rec.minX = Math.min(rec.minX, x); rec.maxX = Math.max(rec.maxX, x); rec.n++
          }
        }
        ctx.globalAlpha = 1
      }

      // —— 冲线定格：冠军车号大牌弹簧弹出（画布中央）——
      if (t >= FREEZE_T) {
        const τ = t - FREEZE_T
        const base = Math.min(1, τ / 160)
        const spring = τ <= 160 ? 1.35 : 1 + 0.35 * Math.exp(-(τ - 160) / 240) * Math.cos((τ - 160) / 110)
        const s = base * spring
        ctx.save()
        ctx.translate(W / 2, H / 2)
        ctx.scale(s, s)
        const pw = 64 * dpr, ph2 = 78 * dpr
        const team = Math.ceil(champ / 6) - 1
        ctx.fillStyle = [DERBY.home, DERBY.away, COLORS.amberDeep, ROULETTE.black][team]
        ctx.strokeStyle = DERBY.gold
        ctx.lineWidth = 2.5 * dpr
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(-pw / 2, -ph2 / 2, pw, ph2, 10 * dpr); else ctx.rect(-pw / 2, -ph2 / 2, pw, ph2)
        ctx.fill(); ctx.stroke()
        ctx.fillStyle = COLORS.white
        ctx.font = `900 ${30 * dpr}px 'Space Grotesk', sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(champ), 0, 1 * dpr)
        ctx.restore()
      }
    }

    if (reduced) {   // 减动效：直出终态帧，不起 rAF 不发声
      const once = () => frame(FREEZE_T + 500)
      if (sheet.complete) once(); else sheet.onload = once
      if (import.meta.env.DEV) window.__SG_ANIM_LAST = String(champ)
      return () => window.removeEventListener('resize', fit)
    }

    if (import.meta.env.DEV) window.__SG_RAF_ACTIVE = (window.__SG_RAF_ACTIVE || 0) + 1
    let engined = false
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      // 引擎轰鸣挂 rAF 首帧（非 effect 体）：StrictMode 首挂载的 rAF 在首帧前被
      // cleanup 取消，天然防双发（探针实录曾抓到 effect 体触发双响）
      if (!engined) {
        engined = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger engine t=', Math.round(t))
        cbRef.current.engine?.()
      }
      if (t >= RACE_T && !whistled) {
        whistled = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger whistle t=', Math.round(t))
        cbRef.current.whistle?.()
      }
      // 庆祝套（定格后）：欢呼先起，车队号角压轴叠加
      if (t >= FREEZE_T && !cheered) {
        cheered = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger cheer t=', Math.round(t))
        cbRef.current.cheer?.()
      }
      if (t >= FREEZE_T + 500 && !horned) {
        horned = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger horn t=', Math.round(t))
        cbRef.current.horn?.(Math.ceil(champ / 6) - 1)
      }
      if (t >= FREEZE_T && !marked) {
        marked = true
        if (import.meta.env.DEV) window.__SG_ANIM_LAST = String(champ)
      }
      frame(t)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      if (import.meta.env.DEV) window.__SG_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} data-champ={champ} style={{ width: '100%', height, display: 'block' }} aria-hidden />
}

// 待命态：静态赛道（betting/locked 相位，多桌用；无 rAF）。SpeedGrid 原页从不挂此态。
function StandbyTrack({ height = 128 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const r = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(r.width * dpr))
    canvas.height = Math.max(1, Math.floor(r.height * dpr))
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const laneH = H / 6
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([6 * dpr, 8 * dpr])
    for (let l = 1; l < 6; l++) { ctx.beginPath(); ctx.moveTo(0, l * laneH); ctx.lineTo(W, l * laneH); ctx.stroke() }
    ctx.setLineDash([])
    // 右缘冲线棋盘格（静态）
    const cell = 5 * dpr, finishX = W - 26 * dpr, carW = laneH * 0.72 * (474 / 119)
    for (let y = 0; y < H; y += cell) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = ((y / cell + c) % 2 < 1) ? COLORS.white : ROULETTE.black
      ctx.fillRect(finishX + carW * 0.5 + c * cell, y, cell, cell)
    }
  }, [])
  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', opacity: 0.55 }} aria-hidden />
}

export default function SpeedGridStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted }) {
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  // 卸载关闭 AudioContext（多桌/多期不泄漏；SpeedGrid 原页单期一个、SFX 每期照响）
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])

    // ---------- SFX（WebAudio 合成器，muted 门控；全部在结果已锁后触发）----------
    function ensureAudio() {
      if (audioRef.current.ctx) return audioRef.current.ctx
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
      if (import.meta.env.DEV) console.debug('[SG-SFX] ctx-created state=', ctx.state)
      audioRef.current.ctx = ctx; return ctx
    }
    // DEV 探针：三音触发实录（触发了没响 vs 根本没触发，修法不同）
    const probe = (name, extra = '') => {
      if (import.meta.env.DEV) console.debug(`[SG-SFX] ${name} fired ctx=${audioRef.current.ctx?.state ?? 'null'} muted=${audioRef.current.muted} ${extra}`)
    }
    function sfxEngine() {   // 引擎轰鸣：满程底噪（快攻 0.25s → 渐强 → 平台撑到冲线 → 收尾接哨）
      const ctx = ensureAudio(); probe('engine'); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      // 包络时刻对齐舞台时间轴：0.25s 攻至可闻 0.07 → 2.9s 渐强至 0.14 →
      // 平台撑到 3.3s（= RACE_T 冲线哨响起）→ 3.4s 硬切（100ms；给 3400ms 起的
      // 欢呼让出频谱——掩蔽终查根因，Derby 欢呼起时无持续底噪）
      const len = 3.5
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource(); src.buffer = buf
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(260, t)
      f.frequency.linearRampToValueAtTime(520, t + 3.3)   // 提频到冲线
      const env = (g, atk, peak) => {
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(atk, t + 0.25)
        g.gain.exponentialRampToValueAtTime(peak, t + 2.9)
        g.gain.setValueAtTime(peak, t + 3.3)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)   // 冲线即刻硬切
      }
      const g = ctx.createGain(); env(g, 0.07, 0.14)
      src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + len)
      audioRef.current.engineGains = [g]   // 欢呼探针实测轰鸣残余增益用
      // 马达基音：低频锯齿随赛程升调（60→110Hz），同包络
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(60, t); o.frequency.linearRampToValueAtTime(110, t + 3.3)
      const g2 = ctx.createGain(); env(g2, 0.035, 0.06)
      o.connect(g2); g2.connect(ctx.destination); o.start(t); o.stop(t + len)
      audioRef.current.engineGains.push(g2)
      if (import.meta.env.DEV) console.debug('[SG-SFX] engine env start=0 attack@250ms=0.07 peak@2900ms=0.14 hold→3300ms hardcut→3400ms stop=3500ms')
    }
    function sfxWhistle() {   // 冲线哨（短哨两响）
      const ctx = ensureAudio(); probe('whistle'); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      ;[0, 0.16].forEach(off => {
        const o = ctx.createOscillator(); o.type = 'square'
        o.frequency.setValueAtTime(2100, t + off); o.frequency.linearRampToValueAtTime(2350, t + off + 0.1)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.035, t + off + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.12)
        o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + 0.13)
      })
    }
    function sfxHorn(teamIdx) {   // 胜出车队短号角：锯齿双音，音高随队别
      const ctx = ensureAudio(); probe('horn', `team=${teamIdx}`); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const f0 = 240 + teamIdx * 50
      ;[f0, f0 * 1.25].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
        const g = ctx.createGain()
        const s = t + i * 0.18
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.08, s + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24)
        o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26)
      })
    }
    function sfxCheer() {   // 观众欢呼声浪（照 Derby sfxCheer 已验配方：带通白噪 swell ~1.6s）
      const ctx = ensureAudio(); probe('cheer'); if (!ctx || audioRef.current.muted) return
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
      if (import.meta.env.DEV) {
        const eg = (audioRef.current.engineGains || []).map(x => +x.gain.value.toFixed(4))
        console.debug('[SG-SFX] cheer env swell@350ms=0.12 release→1600ms engineGainAtCheer=', JSON.stringify(eg))
      }
    }
    const stageSfx = { engine: sfxEngine, whistle: sfxWhistle, horn: sfxHorn, cheer: sfxCheer }

  const champ = drawResult?.n ?? null
  // 有开奖号且非投注/封盘相位 → 跑冲线动画；否则待命态。SpeedGrid 原页仅在 drawing/settled 挂载，恒为动画态。
  const racing = champ != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <RaceCanvas key={roundNo} champ={champ} sfx={stageSfx} height={height} />
        : <StandbyTrack height={height} />}
    </div>
  )
}
