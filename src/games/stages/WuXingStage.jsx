// #41 单7：五行开奖舞台组件（从 WuXing.jsx 机械搬运——20球 rAF驱DOM(render-prop DrawStage +
// zoneBody DOM)+dev钩子 __WX_RAF_ACTIVE/__WX_ANIM_LAST + WebAudio SFX，逐字节切片；DOM/样式随件迁）。
// props {phase,roundNo,drawResult,width,height,muted}(+页面 onFinale/lastRound/style)。WX_BOUNDS 主档另引故复制。
import { useState, useRef, useEffect, useMemo } from 'react'
import { useIsMobile, useMediaQuery } from '../../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../../components/shell/tokens'
import { deriveRound } from '../markets/wuxing'

// ---------- 开奖舞台时间轴（rAF 内使用，毫秒）----------
const ANIM_T0 = 250        // 首球亮起
const ANIM_GAPS = 2850     // 19 段间隔预算总和（慢放重分配，总长恒定）
const ANIM_FLASH = 280     // 亮前 0-9 快闪滚数窗口（70ms/帧 ≈ 4 帧）
const ANIM_POP = 150       // 亮球轻弹
const ANIM_SLAM = 3300     // 总和放大砸出 + 终场哨
const ANIM_WX = 3600       // 五行段亮灯 + 短哨
const WX_BOUNDS = [695, 763, 855, 923]   // 五行段分界（±30 慢放判定）

// 19 段间隔总和恒 = ANIM_GAPS（时间轴总长零改动）
function buildPlan(round) {
  let a = 0x2f6e2b1
  round.balls.forEach((n, i) => { a = (Math.imul(a, 31) + n + i + 1) >>> 0 })
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: 20 }, (_, i) => i)
  for (let i = 19; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  // 慢放权重：分界逼近球 / 末 3 球 = 1.75，其余 1；间隔 = 预算 × 权重占比
  let cum = 0
  const weights = order.map((idx, k) => {
    cum += round.balls[idx]
    const nearBound = WX_BOUNDS.some(b => Math.abs(cum - b) <= 30)
    return (nearBound || k >= 17) ? 1.75 : 1
  })
  const wSum = weights.slice(1).reduce((x, y) => x + y, 0)   // 19 段（首球走 T0）
  const launches = [ANIM_T0]
  for (let k = 1; k < 20; k++) launches.push(launches[k - 1] + ANIM_GAPS * weights[k] / wSum)
  return { order, launches }
}

// t 时刻舞台视图（纯函数）：lit[i]/flash/popAge 按格位；总和/上下计数只算已亮球
function animViewAt(round, plan, t) {
  const lit = new Array(20).fill(false)
  const flash = new Map()
  const popAge = new Map()
  let sum = 0, up = 0
  plan.order.forEach((idx, k) => {
    const at = plan.launches[k]
    if (t >= at) {
      lit[idx] = true
      sum += round.balls[idx]
      if (round.balls[idx] <= 40) up++
      if (t - at < ANIM_POP) popAge.set(idx, t - at)
    } else if (t >= at - ANIM_FLASH) {
      const fr = Math.floor((t - (at - ANIM_FLASH)) / 70)
      flash.set(idx, ((round.balls[idx] * 7 + fr * 13 + idx * 3) % 80) + 1)   // 伪滚号，零随机数
    }
  })
  return { lit, flash, popAge, sum, up, litN: lit.filter(Boolean).length, slamAge: t >= ANIM_SLAM ? t - ANIM_SLAM : null }
}

// 单 rAF 循环驱动整条时间轴；key=期号重挂载；sfx 全部挂 rAF 帧内（防双发已验接法）；
// StrictMode 双挂载由 cleanup 兜底；prefers-reduced-motion 直出终态
function DrawStage({ round, sfx, onFinale, children }) {
  const [, setFrame] = useState(0)
  const tRef = useRef(0)
  const cbRef = useRef({ sfx, onFinale })
  cbRef.current = { sfx, onFinale }
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const plan = useMemo(() => buildPlan(round), [round])

  useEffect(() => {
    if (reduced) {
      if (import.meta.env.DEV) window.__WX_ANIM_LAST = String(round.sum)
      cbRef.current.onFinale?.()
      return
    }
    if (import.meta.env.DEV) window.__WX_RAF_ACTIVE = (window.__WX_RAF_ACTIVE || 0) + 1
    const landed = new Array(20).fill(false)
    let slammed = false, wxLit = false
    let raf = 0
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      tRef.current = t
      plan.order.forEach((idx, k) => {
        if (!landed[k] && t >= plan.launches[k]) {
          landed[k] = true
          cbRef.current.sfx.tick?.(k)
        }
      })
      if (t >= ANIM_SLAM && !slammed) {
        slammed = true
        cbRef.current.sfx.final?.()
        if (import.meta.env.DEV) window.__WX_ANIM_LAST = String(round.sum)
      }
      if (t >= ANIM_WX && !wxLit) {
        wxLit = true
        cbRef.current.sfx.wx?.()
        cbRef.current.onFinale?.()   // 五行段预亮（settled 相位交给既有 result.hits）
      }
      setFrame(f => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) window.__WX_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return children(animViewAt(round, plan, reduced ? ANIM_WX + 500 : tRef.current))
}

function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

// #46 单12 追加：可选 ball（球径 px）—— 带默认值、不传即原行为。仅五行原页桌面传 32（中度放大档）；
// 多桌 stageRegistry→TableCard 与手机段均不传，走原 isMobile?26:isDesk?26:30，逐字节零感。
// 球面字号是 ball*0.42 派生，故只调这一个数即等比例放大。引用方仅两处（WuXing.jsx / stageRegistry.js）。
export default function WuXingStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, onFinale, lastRound, ball: ballProp, style }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])

    // ---------- SFX（WebAudio 已验配方，对齐 Line Up/Derby 有声版；muted 门控，
    // 触发全部挂 rAF 帧内防双发；全程短音无持续底噪，无掩蔽坑）----------
    function ensureAudio() {
      if (audioRef.current.ctx) return audioRef.current.ctx
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
      audioRef.current.ctx = ctx; return ctx
    }
    const probe = name => {
      if (import.meta.env.DEV) console.debug(`[WX-SFX] ${name} fired ctx=${audioRef.current.ctx?.state ?? 'null'} muted=${audioRef.current.muted}`)
    }
    function sfxTick(k) {   // 落球 tick：短 blip，音高随落球序缓升（20 连发）
      const ctx = ensureAudio(); probe(`tick#${k}`); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'
      const f = 480 + k * 10
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.04)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
    }
    function sfxWx() {   // 五行段亮灯：短哨单响
      const ctx = ensureAudio(); probe('wx'); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2100, t); o.frequency.linearRampToValueAtTime(2350, t + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.13)
    }
    function sfxFinal() {   // 总和砸出：终场哨两响（次响拉长）
      const ctx = ensureAudio(); probe('final'); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      ;[[0, 0.14], [0.2, 0.3]].forEach(([off, len]) => {
        const o = ctx.createOscillator(); o.type = 'square'
        o.frequency.setValueAtTime(2050, t + off); o.frequency.linearRampToValueAtTime(2400, t + off + len)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.04, t + off + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + off + len)
        o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + len + 0.02)
      })
    }
    const stageSfx = { tick: sfxTick, wx: sfxWx, final: sfxFinal }

  const drawing = phase === 'drawn'
  const settled = phase === 'settled' || phase === 'idle'
  const round = drawResult?.balls ? deriveRound(drawResult.balls) : (lastRound || null)
  const root = {
    position: 'relative', width, height, overflow: 'hidden', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 5,
    background: DERBY.strip, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
    ...style,
  }
  if (!round) return <div style={root}><StandbyBoard height={height} /></div>
  const cur = round, shown = round
    const ball = ballProp ?? (isMobile ? 26 : isDesk ? 26 : 30)
    const zBalls = drawing && cur ? cur.balls : shown.balls
    const staticView = { lit: null, flash: null, popAge: null, sum: shown.sum, up: shown.up, litN: 20, slamAge: null }
    const zoneBody = view => (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>
            {drawing ? '开奖中…' : settled ? '开奖 · 本局' : '开奖 · 上局'}
          </span>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>80 池 · 20 球</span>
        </div>
        {/* 两行 ×10 球：上盘 1-40 蓝 / 下盘 41-80 红；舞台三态 待亮/快闪滚号/已亮+轻弹 */}
        {[0, 1].map(r => (
          <div key={r} style={{ display: 'flex', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
            {zBalls.slice(r * 10, r * 10 + 10).map((n, ci) => {
              const i = r * 10 + ci
              const isLit = !view.lit || view.lit[i]
              const f = view.flash?.get(i)
              const pop = view.popAge?.get(i)
              const scale = pop != null ? 1.3 - 0.3 * (pop / ANIM_POP) : 1
              return (
                <span key={i} data-ball={n} data-lit={isLit ? 1 : 0} style={{
                  width: ball, height: ball, borderRadius: '50%',
                  background: isLit
                    ? (n <= 40 ? DERBY.home : DERBY.away)
                    : f != null ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(0,0,0,0.35)',
                  boxShadow: isLit ? 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)' : 'none',
                  color: isLit ? COLORS.white : 'rgba(255,255,255,0.7)',
                  fontSize: ball * 0.42, fontWeight: 900,
                  fontFamily: "'Space Grotesk', sans-serif",
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', flex: '0 0 auto',
                  transform: `scale(${scale})`,
                }}>{isLit ? String(n).padStart(2, '0') : f != null ? String(f).padStart(2, '0') : ''}</span>
              )
            })}
          </div>
        ))}
        {/* 统计带：龙/虎随累加和实时刷新 + TOTAL 砸出放大一拍 + 上/下计数 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
        }}>
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
            龙 {Math.floor(view.sum / 10) % 10} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 虎 {view.sum % 10}
          </span>
          <span style={{
            padding: '2px 14px', borderRadius: RADIUS.pill,
            background: DERBY.gold, color: '#3a2c00',
            fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
            transform: `scale(${view.slamAge != null ? 1 + 0.3 * Math.sin(Math.min(1, view.slamAge / 350) * Math.PI) : 1})`,
          }}>合计 {view.sum}</span>
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
            上 {view.up} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 下 {view.litN - view.up}
          </span>
        </div>
      </>
    )
  return (
    <div style={root}>
      {drawing && cur
        ? <DrawStage key={roundNo} round={cur} sfx={stageSfx} onFinale={onFinale}>{zoneBody}</DrawStage>
        : zoneBody(staticView)}
    </div>
  )
}
