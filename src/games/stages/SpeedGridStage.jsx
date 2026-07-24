// #41 单5：SpeedGrid 开奖舞台组件（从 SpeedGrid.jsx 机械搬运——canvas+rAF+F1冲线动画+dev钩子
// __SG_RAF_ACTIVE/__SG_ANIM_LAST/__SG_CONF + WebAudio SFX，全部逐字节搬运，仅 RaceStage→RaceCanvas
// 加 height 参）。props {phase,roundNo,drawResult,width,height,muted}；key=期号重挂载惯例在内层 RaceCanvas 保持。
// SpeedGrid 原页 = 只在 drawing/settled 挂本件(=原 RaceStage)，体验分毫不变；多桌 betting 走待命态。
import { useRef, useEffect } from 'react'
// #Ray 真音效（Mixkit License 免署名商用，见 assets/speedgrid/sfx/LICENSE.txt）——WebAudio 合成器退役。
import engineUrl from '../../assets/speedgrid/sfx/engine.mp3'
import finishUrl from '../../assets/speedgrid/sfx/finish.mp3'
import winUrl from '../../assets/speedgrid/sfx/win.mp3'
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

    let whistled = false, cheered = false, marked = false   // #Ray：horned 退役（车队号角合成器已删）
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
      // #Ray：冲线撞击（原 whistle 位，RACE_T 冲线帧）——engine 冲线即止在 finish 回调内
      if (t >= RACE_T && !whistled) {
        whistled = true
        if (import.meta.env.DEV) console.debug('[SG-SFX] trigger finish t=', Math.round(t))
        cbRef.current.finish?.()
      }
      if (t >= FREEZE_T && !cheered) { cheered = true }   // #Ray：win 改由 SpeedGridStage 的 playerWon effect 触发（见下）——
      //   rAF 时间轴在 FREEZE_T(3400) 时 result 尚未 set（finishRound 在 DRAW_ANIM_MS=4600 才置 winTotal），
      //   放这里 playerWon 恒 false 永不响；改成监听 playerWon 翻真，天然排在 finish(3300) 之后。
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

export default function SpeedGridStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, playerWon = false }) {
  // #Ray 真音频（替代 WebAudio 合成器）：三条 HTMLAudio 惰性建，muted 门控 + 卸载释放。
  //   铁律不破：muted 原样（含多桌 activeCard 单声道，muted prop 由 TableCard 传入）；
  //   触发时机原样（RaceCanvas rAF「结果已锁后」时间轴）；卸载 pause+断源，多桌/多期不泄漏。
  const audioRef = useRef({ muted: false, els: null, engineOn: false })
  useEffect(() => {
    audioRef.current.muted = muted
    if (muted && audioRef.current.engineOn) { try { audioRef.current.els.engine.pause() } catch { /* */ } audioRef.current.engineOn = false }
  }, [muted])
  useEffect(() => () => {
    const els = audioRef.current.els
    if (els) for (const el of Object.values(els)) { try { el.pause(); el.src = '' } catch { /* */ } }
    audioRef.current.els = null; audioRef.current.engineOn = false
    if (import.meta.env.DEV && els) window.__SG_AUDIO = (window.__SG_AUDIO || 0) - 3   // 泄漏探针：释放对冲建时 +3
  }, [])
  const ensureEls = () => {
    if (audioRef.current.els) return audioRef.current.els
    const engine = new Audio(engineUrl); engine.loop = true; engine.preload = 'auto'   // 铺满整段，无缝循环
    const finish = new Audio(finishUrl); finish.preload = 'auto'
    const win = new Audio(winUrl); win.preload = 'auto'
    audioRef.current.els = { engine, finish, win }
    if (import.meta.env.DEV) window.__SG_AUDIO = (window.__SG_AUDIO || 0) + 3
    return audioRef.current.els
  }
  const playOnce = (name) => {
    if (audioRef.current.muted) return
    const el = ensureEls()[name]; try { el.currentTime = 0; el.play().catch(() => {}) } catch { /* */ }
  }
  const startEngine = () => {
    if (audioRef.current.muted) return
    const el = ensureEls().engine; audioRef.current.engineOn = true
    try { el.currentTime = 0; el.play().catch(() => {}) } catch { /* */ }
  }
  const stopEngine = () => {
    if (!audioRef.current.engineOn) return
    audioRef.current.engineOn = false
    try { audioRef.current.els.engine.pause() } catch { /* */ }
  }
  const stageSfx = {
    engine: startEngine,
    finish: () => { stopEngine(); playOnce('finish') },   // 冲线：先停引擎再撞击
  }
  // #Ray：win 仅玩家中奖时响，【排在 finish 之后】——finish 在 rAF 3300ms 触发，playerWon 由页面
  //   winTotal>0 驱动、在 DRAW_ANIM_MS(4600) 才翻真，故此 effect 必晚于 finish。同 roundNo 只响一次。
  const winRndRef = useRef(null)
  useEffect(() => {
    if (!playerWon || winRndRef.current === roundNo) return
    winRndRef.current = roundNo
    playOnce('win')
    // playOnce 走 refs，仅随 playerWon/roundNo 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerWon, roundNo])

  const champ = drawResult?.n ?? null
  const racing = champ != null && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'
  return (
    <div style={{ position: 'relative', width, height }}>
      {racing
        ? <RaceCanvas key={roundNo} champ={champ} sfx={stageSfx} height={height} />
        : <StandbyTrack height={height} />}
    </div>
  )
}
