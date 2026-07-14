// #41 单7：首发阵容开奖舞台组件（从 LineUp.jsx 机械搬运——25格 rAF驱DOM(render-prop DrawStage +
// gridBody DOM)+dev钩子 __LU_RAF_ACTIVE/__LU_ANIM_LAST + WebAudio SFX + 红黄牌2资产，逐字节切片）。
// props {phase,roundNo,drawResult,width,height,muted}(+页面 lastRound/style)。ROW_LABELS 主档另引故复制。
import { useState, useRef, useEffect, useMemo } from 'react'
import { useIsMobile, useMediaQuery } from '../../hooks/useMediaQuery'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../../components/shell/tokens'
import cardRedImg from '../../assets/shared/card_red.png'
import cardYellowImg from '../../assets/shared/card_yellow.png'
import { deriveRound, AWAY_DIGITS, HIGH_DIGITS } from '../markets/lineup'

const ROW_LABELS = ['锋线', '前腰', '中场', '后腰', '后卫']   // = 主档 ROW_LABELS，随件复制

// ---------- 开奖舞台时间轴（rAF 内使用，毫秒）----------
const ANIM_T0 = 250       // 首格砸落时刻
const ANIM_GAP = 125      // 落格间隔（24×125+250 ≈ 3.25s 落完）
const ANIM_FLASH = 320    // 落定前 0-9 快闪滚数窗口（80ms/帧 ≈ 4 帧）
const ANIM_POP = 120      // 落格轻弹时长
const ANIM_SLAM = 3600    // TOTAL 放大砸出时刻

// 引擎随机序列与动画解耦（已知坑：乱序若走 Math.random 会破坏引擎可复现性）
function orderFrom(cells) {
  let a = 0x2f6e2b1
  cells.forEach((d, i) => { a = (Math.imul(a, 31) + d * 7 + i + 1) >>> 0 })
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: 25 }, (_, i) => i)
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// t 时刻舞台视图（纯函数）：digits[i] = 已定格数字或 null；flash = 滚数快闪帧；

// popAge = 落格轻弹进度；slamAge = TOTAL 砸出进度；行和/计数只算已落格
function animViewAt(round, order, t) {
  const digits = new Array(25).fill(null)
  const flash = new Map()
  const popAge = new Map()
  order.forEach((cell, k) => {
    const landAt = ANIM_T0 + k * ANIM_GAP
    if (t >= landAt) {
      digits[cell] = round.cells[cell]
      if (t - landAt < ANIM_POP) popAge.set(cell, t - landAt)
    } else if (t >= landAt - ANIM_FLASH) {
      // 滚数帧 = 真值+格位派生的伪序列（零随机数）
      const fr = Math.floor((t - (landAt - ANIM_FLASH)) / 80)
      flash.set(cell, (round.cells[cell] * 3 + fr * 7 + cell) % 10)
    }
  })
  const rowSums = [0, 1, 2, 3, 4].map(ri =>
    digits.slice(ri * 5, ri * 5 + 5).reduce((x, y) => x + (y ?? 0), 0))
  let home = 0, away = 0, high = 0, low = 0
  digits.forEach(d => {
    if (d == null) return
    if (AWAY_DIGITS.has(d)) away++; else home++
    if (HIGH_DIGITS.has(d)) high++; else low++
  })
  return {
    digits, flash, popAge, rowSums,
    total: rowSums.reduce((x, y) => x + y, 0),
    homeCount: home, awayCount: away, highCount: high, lowCount: low,
    slamAge: t >= ANIM_SLAM ? t - ANIM_SLAM : null,
  }
}

// 单 rAF 循环驱动整条时间轴（禁 CSS transition 拼接）；key=期号保证重挂载；
// sfx 全部在结果已锁后触发；StrictMode 双挂载由 cleanup 兜底
function DrawStage({ round, sfx, children }) {
  const [, setFrame] = useState(0)
  const tRef = useRef(0)
  const cbRef = useRef(sfx)
  cbRef.current = sfx
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const order = useMemo(() => orderFrom(round.cells), [round])

  useEffect(() => {
    if (reduced) {   // 减动效：静态直出终态，不起 rAF 不发声
      if (import.meta.env.DEV) window.__LU_ANIM_LAST = round.cells.join(',')
      return
    }
    if (import.meta.env.DEV) window.__LU_RAF_ACTIVE = (window.__LU_RAF_ACTIVE || 0) + 1
    const landed = new Array(25).fill(false)
    const rowLand = new Array(5).fill(0)
    let slammed = false
    let raf = 0
    const t0 = performance.now()
    const loop = now => {
      const t = now - t0
      tRef.current = t
      // —— 事件沿：落格 tick ×25 / 行满短哨 ×5 / TOTAL 终场哨 ——
      order.forEach((cell, k) => {
        if (landed[k] || t < ANIM_T0 + k * ANIM_GAP) return
        landed[k] = true
        cbRef.current.tick(k)
        const ri = Math.floor(cell / 5)
        if (++rowLand[ri] === 5) cbRef.current.row()
      })
      if (t >= ANIM_SLAM && !slammed) {
        slammed = true
        cbRef.current.final()
        if (import.meta.env.DEV) window.__LU_ANIM_LAST = round.cells.join(',')
      }
      setFrame(f => f + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      if (import.meta.env.DEV) window.__LU_RAF_ACTIVE -= 1
    }
    // 舞台一次挂载跑完整条时间轴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return children(animViewAt(round, order, reduced ? Infinity : tRef.current))
}

function StandbyBoard({ height = 128 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

export default function LineUpStage({ phase, roundNo, drawResult, width = '100%', height = 128, muted, lastRound, style }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])

    // ---------- SFX（WebAudio 合成器，照 Derby 配方；muted 门控，全部在结果已锁后触发）----------
    function ensureAudio() {
      if (audioRef.current.ctx) return audioRef.current.ctx
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
      audioRef.current.ctx = ctx; return ctx
    }
    function sfxTick(k) {   // 落格 tick：短 blip，音高随落格序缓升（25 连发）
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'sine'
      const f = 460 + k * 9
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.04)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08)
    }
    function sfxRow() {   // 行满：短哨单响
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      const o = ctx.createOscillator(); o.type = 'square'
      o.frequency.setValueAtTime(2100, t); o.frequency.linearRampToValueAtTime(2350, t + 0.1)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.13)
    }
    function sfxFinal() {   // TOTAL 砸出：终场哨两响（次响拉长）
      const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
      const t = ctx.currentTime
      ;[[0, 0.14], [0.2, 0.3]].forEach(([off, len]) => {
        const o = ctx.createOscillator(); o.type = 'square'
        o.frequency.setValueAtTime(2050, t + off); o.frequency.linearRampToValueAtTime(2400, t + off + len)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.04, t + off + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + off + len)
        o.connect(g); g.connect(ctx.destination); o.start(t + off); o.stop(t + off + len + 0.02)
      })
    }
    const stageSfx = { tick: sfxTick, row: sfxRow, final: sfxFinal }

  const drawing = phase === 'drawn'
  const settled = phase === 'settled' || phase === 'idle'
  const round = drawResult?.grid ? deriveRound(drawResult.grid) : (lastRound || null)
  const root = {
    position: 'relative', width, height, overflow: 'hidden', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: isMobile || isDesk ? 3 : 4,
    background: DERBY.strip, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
    ...style,
  }
  if (!round) return <div style={root}><StandbyBoard height={height} /></div>
  const cur = round, shown = round
    // 裁判牌尺寸（竖矩形 ≈26×34，desk 收档给盘区留高）
    const cardW = isMobile ? 24 : isDesk ? 22 : 26
    const cardH = isMobile ? 31 : isDesk ? 28 : 34
    const zoneTitle = drawing ? '首发阵容 · 开奖中' : settled ? '首发阵容 · 本局' : '首发阵容 · 上局'
    const staticView = {
      digits: shown.cells, flash: null, popAge: null,
      rowSums: shown.rowSums, total: shown.total,
      homeCount: shown.homeCount, awayCount: shown.awayCount,
      highCount: shown.highCount, lowCount: shown.lowCount,
      slamAge: null,
    }
    const gridBody = view => (
      <>
        {/* desk 头行并入底部统计带省一行 */}
        {!isDesk && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{zoneTitle}</span>
            <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>25 数 · 0-9</span>
          </div>
        )}
        {[0, 1, 2, 3, 4].map(ri => (
          <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
            {/* 行标：L 号圈 + 位置名 */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', width: isMobile ? 58 : 72 }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: DERBY.home, color: COLORS.white,
                fontSize: 9, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box',
              }}>L{ri + 1}</span>
              <span style={{ color: DERBY.text, fontSize: isMobile ? 10 : 11, fontWeight: 900, whiteSpace: 'nowrap' }}>{ROW_LABELS[ri]}</span>
            </span>
            {/* 5 张裁判牌：红牌 = Red(0,2,6,7,8) / 黄牌 = Black(1,3,4,5,9)，交替 ±4° 歪斜；
                舞台三态：待落=淡牌位 / 快闪=灰牌滚数 / 已定格=红黄牌图+轻弹（形变换皮，时间轴不动） */}
            {[0, 1, 2, 3, 4].map(ci => {
              const i = ri * 5 + ci
              const d = view.digits[i]
              const f = view.flash?.get(i)
              const pop = view.popAge?.get(i)
              const scale = pop != null ? 1.35 - 0.35 * (pop / ANIM_POP) : 1
              const tilt = i % 2 === 0 ? -4 : 4
              const isRed = d != null && AWAY_DIGITS.has(d)
              return (
                <span key={ci} data-cell={i} data-landed={d != null ? 1 : 0}
                  data-final={drawing && cur ? cur.cells[i] : d ?? ''}
                  style={{
                    position: 'relative',
                    width: cardW, height: cardH, borderRadius: 4,
                    background: d != null
                      ? 'none'
                      : f != null ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                    border: d != null ? 'none' : '1px solid rgba(0,0,0,0.35)',
                    color: d != null ? (isRed ? COLORS.white : '#3a2c00') : 'rgba(255,255,255,0.7)',
                    fontSize: cardH * 0.45, fontWeight: 900,
                    fontFamily: "'Space Grotesk', sans-serif",
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    boxSizing: 'border-box', flex: '0 0 auto',
                    transform: `rotate(${tilt}deg) scale(${scale})`,
                  }}>
                  {d != null && (
                    // 资产 1024² 含透明边（实牌约占 56%×76%，偏移 21%/11%）——
                    // 按包围盒放大补偿，让实牌恰好铺满 26×34 牌位
                    <img src={isRed ? cardRedImg : cardYellowImg} alt="" draggable={false} style={{
                      position: 'absolute', width: '178%', height: '131%',
                      left: '-38%', top: '-15%', maxWidth: 'none',
                      pointerEvents: 'none',
                      filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.35))',
                    }} />
                  )}
                  <span style={{ position: 'relative' }}>{d ?? (f != null ? f : '')}</span>
                </span>
              )
            })}
            {/* 行尾行和（舞台期随落格累加滚动） */}
            <span style={{
              flex: '0 0 auto', minWidth: isMobile ? 26 : 32, textAlign: 'center',
              padding: '2px 6px', borderRadius: RADIUS.pill,
              background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.2)',
              color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900,
            }}>{view.rowSums[ri]}</span>
          </div>
        ))}
        {/* 统计带：主/客计数 + TOTAL 大字（砸出放大一拍）+ 高/低 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {isDesk && (
              <span style={{ color: drawing ? DERBY.orange : DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginRight: 8 }}>{zoneTitle}</span>
            )}
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block' }} />
            <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>红牌 {view.awayCount}</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.gold, display: 'inline-block', marginLeft: 6 }} />
            <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>黄牌 {view.homeCount}</span>
          </span>
          <span style={{
            padding: '2px 14px', borderRadius: RADIUS.pill,
            background: DERBY.gold, color: '#3a2c00',
            fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
            transform: `scale(${view.slamAge != null ? 1 + 0.3 * Math.sin(Math.min(1, view.slamAge / 350) * Math.PI) : 1})`,
          }}>合计 {view.total}</span>
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
            高 {view.highCount} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 低 {view.lowCount}
          </span>
        </div>
      </>
    )
  return (
    <div style={root}>
      {drawing && cur
        ? <DrawStage key={roundNo} round={cur} sfx={stageSfx}>{gridBody}</DrawStage>
        : gridBody(staticView)}
    </div>
  )
}
