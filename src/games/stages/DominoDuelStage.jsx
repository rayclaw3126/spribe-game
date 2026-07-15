/* eslint-disable react-refresh/only-export-components */
// ↑ 本件按需求「命名导出翻牌视觉原子供原页 import 回引」刻意组件+常量同文件共存（单一出处）；
//   react-refresh 仅 dev fast-refresh 提示、非正确性问题，此处按设计豁免。
// #44 单S1：骨牌对决多桌开奖舞台（从 DominoDuel.jsx 机械切片——CSS 3D 翻牌，非 rAF）。
// 命名导出「翻牌视觉原子」DominoTile / FLIP_DELAY|DUR|END / DD_KEYFRAMES 供原页 import 回引（单一出处，
// 原页 duelZone 布局零改动，只把这几个原子的定义搬来这里）。sfx 按 Ray 裁定：stage 自带一份拷贝
// （audioRef 模式，抄 DerbyDayStage），原页音频路径完全不动。
// 默认导出 DominoDuelStage({phase,roundNo,drawResult,width,height=150,muted})，契约对齐 DerbyDayStage：
//   · drawn/settled：deriveRound(drawResult.tiles) 只读表演，主队|比分|客队横排压进 150px（tile~26），
//     主1→客1→主2→客2 错峰翻牌、决胜张慢镜、FLIP_END≈3.15s 才 ddScoreIn 揭比分（不剧透）
//   · settled：赢方半场缩量彩带；胜负文字标签不放（TableCard settleInfo 已有中/未中反馈，防叠字）
//   · 无 drawResult / betting / locked / idle：StandbyBoard 待命面（大倒计时/封盘由 TableCard 叠层）
//   · muted 照 audioRef 模式；卸载清 audio ctx + 全部 setTimeout（timersRef，多桌关桌/切页不留泄漏）
//   · 内层 <DominoArena key={roundNo}> 每期重挂重启 CSS 翻牌；dev 钩子 __DOMSTAGE_FLIP/__DOMSTAGE_DONE 探针
import { useRef, useEffect, useMemo } from 'react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { deriveRound } from '../markets/dominoduel'

// ============================================================================
// 命名导出：翻牌视觉原子（原页 DominoDuel.jsx import 回引，纯视觉、单一出处）
// ============================================================================
// 翻牌错峰时间轴（秒）：主1→客1→主2→客2，第4张（决胜）慢镜
export const FLIP_DELAY = [0, 0.55, 1.1, 1.75]
export const FLIP_DUR = [0.55, 0.55, 0.55, 1.4]
export const FLIP_END = 1.75 + 1.4   // 末张翻完 ≈ 3.15s
// 对决区（舞台）动画 keyframes（原页两处 <style> 共用此串）
export const DD_KEYFRAMES = `
  @keyframes ddFlip { from { transform: rotateY(180deg); } to { transform: rotateY(0deg); } }
  @keyframes ddScoreIn { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.18); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes ddConfFall {
    0% { transform: translateY(-12px) rotate(0deg); opacity: 0; }
    12% { opacity: 1; }
    100% { transform: translateY(230px) rotate(var(--rot)); opacity: 0; }
  }
`

// 多米诺点位（0-6，3×3 宫格索引；照 DieFace 先例）—— 仅 DominoTile 用，stage 私有
const DOMPIPS = {
  0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

// 单张多米诺（竖向：上半 / 分隔线 / 下半，各半画 pip 点）
// flip：drawing 相位 3D 翻牌（背面队色 → 正面点数），delay/dur 错峰 + 决胜张慢镜
export function DominoTile({ a, b, size = 34, flip = false, delay = 0, dur = 0.55, backColor = DERBY.home }) {
  const half = (v, key) => (
    <div key={key} style={{
      width: size, height: size, position: 'relative',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, boxSizing: 'border-box',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {DOMPIPS[v].includes(i) && (
            <span style={{ width: size * 0.16, height: size * 0.16, borderRadius: '50%', background: '#10131a' }} />
          )}
        </span>
      ))}
    </div>
  )
  const face = (
    <div style={{
      display: 'flex', flexDirection: 'column', width: size, height: size * 2 + 2,
      background: '#f4f6fb', borderRadius: size * 0.16,
      border: '1px solid rgba(0,0,0,0.35)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      overflow: 'hidden', boxSizing: 'border-box',
    }}>
      {half(a, 'a')}
      <div style={{ height: 2, background: 'rgba(0,0,0,0.35)' }} />
      {half(b, 'b')}
    </div>
  )
  if (!flip) return face
  return (
    <div style={{ perspective: 700, width: size, height: size * 2 + 2 }}>
      <div className="ddFlipInner" style={{
        position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d',
        animation: `ddFlip ${dur}s cubic-bezier(0.4,0.75,0.3,1) ${delay}s both`,
      }}>
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>{face}</div>
        <div style={{
          position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
          borderRadius: size * 0.16, border: '1px solid rgba(0,0,0,0.4)', boxSizing: 'border-box',
          background: `linear-gradient(135deg, ${backColor}, rgba(0,0,0,0.45))`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.85)', fontSize: size * 0.55, fontWeight: 900,
        }}>⬦</div>
      </div>
    </div>
  )
}

// ============================================================================
// 待命面（无开奖时）：空白条，大倒计时/封盘由 TableCard 叠层
// ============================================================================
function StandbyBoard({ height = 150 }) { return <div style={{ width: '100%', height }} aria-hidden /> }

// ============================================================================
// 开奖竞技场（内层，key=期号 重挂重启 CSS 翻牌）
// shown = deriveRound 派生局；settled 时揭赢方半场彩带；sfx 为父级 useMemo 稳定对象（不致 effect 抖动）
// ============================================================================
function DominoArena({ shown, settled, isMobile, reduced, roundNo, sfx }) {
  const timersRef = useRef([])
  const flipping = !reduced   // 翻牌相位（reduced-motion 直接显正面）
  const tileSz = isMobile ? 24 : 26

  // 翻牌声景（whoosh 起 + snap 落，错峰）+ dev 探针：启动 __DOMSTAGE_FLIP、FLIP_END 完成 __DOMSTAGE_DONE
  useEffect(() => {
    const t = []
    if (!reduced) {
      FLIP_DELAY.forEach((d, i) => {
        t.push(setTimeout(() => sfx.whoosh(), d * 1000))
        t.push(setTimeout(() => sfx.snap(), (d + FLIP_DUR[i]) * 1000))
      })
    }
    if (import.meta.env.DEV) {
      window.__DOMSTAGE_FLIP = shown.tiles.map(x => x.join('|')).join(',')
      t.push(setTimeout(() => { window.__DOMSTAGE_DONE = roundNo }, FLIP_END * 1000))
    }
    timersRef.current = t
    return () => { t.forEach(clearTimeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // settled 欢呼：drawn→settled 不重挂（key=期号），故用 settled 变化触发；win=有决胜方（非平局）更饱满
  useEffect(() => {
    if (settled && !reduced) sfx.cheer(shown.hs !== shown.as)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])

  // 赢方半场缩量彩带（主胜落左半 / 客胜落右半 / 平局全场），几何一次算定
  const winSide = shown.hs > shown.as ? 'home' : shown.as > shown.hs ? 'away' : 'tie'
  const confRef = useRef(null)
  if (confRef.current == null) {
    confRef.current = Array.from({ length: 22 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 0.5, dur: 1.1 + Math.random() * 1.3,
      rot: (Math.random() * 2 - 1) * 540,
      color: [DERBY.gold, '#35d07f', '#ffffff', DERBY.home, DERBY.away][i % 5], size: 4 + Math.random() * 4,
    }))
  }

  // 压缩 teamBlock：队名徽（缩小）+ 两张骨牌 + 比分（翻完 ddScoreIn 揭示）
  const teamBlock = (name, tiles, score, color, side) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
      <span style={{
        padding: '1px 8px', borderRadius: RADIUS.pill, background: color,
        color: COLORS.white, fontSize: 9, fontWeight: 900, letterSpacing: 0.4,
      }}>{name}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {tiles.map((t, i) => {
          const slot = side === 'h' ? i * 2 : i * 2 + 1   // 全局翻序 主1→客1→主2→客2
          return <DominoTile key={i} a={t[0]} b={t[1]} size={tileSz}
            flip={flipping} delay={FLIP_DELAY[slot]} dur={FLIP_DUR[slot]} backColor={color} />
        })}
      </div>
      <span style={{
        color: COLORS.white, fontSize: 20, fontWeight: 900,
        fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 10px ${color}`,
        ...(flipping ? { animation: `ddScoreIn 0.4s ease ${FLIP_END}s both` } : {}),
      }}>{score}</span>
    </div>
  )

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 12 : 22, overflow: 'hidden',
    }}>
      {settled && !reduced && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3,
          left: winSide === 'away' ? '50%' : 0, right: winSide === 'home' ? '50%' : 0,
        }}>
          {confRef.current.map((p, i) => (
            <span key={i} style={{
              position: 'absolute', top: -12, left: `${p.left}%`, width: p.size, height: p.size * 0.55,
              background: p.color, borderRadius: 1, '--rot': `${p.rot}deg`,
              animation: `ddConfFall ${p.dur}s linear ${p.delay}s both`,
            }} />
          ))}
        </div>
      )}
      {teamBlock('主队', shown.homeTiles, shown.hs, DERBY.home, 'h')}
      <span style={{ color: DERBY.gold, fontSize: 16, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif", flex: '0 0 auto', zIndex: 4 }}>VS</span>
      {teamBlock('客队', shown.awayTiles, shown.as, DERBY.away, 'a')}
    </div>
  )
}

// ============================================================================
// 默认导出：多桌骨牌开奖舞台
// ============================================================================
export default function DominoDuelStage({ phase, roundNo, drawResult, width = '100%', height = 150, muted }) {
  const isMobile = useIsMobile()
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const audioRef = useRef({ ctx: null, muted: false })
  useEffect(() => { audioRef.current.muted = muted }, [muted])
  useEffect(() => () => { try { audioRef.current.ctx?.close?.() } catch { /* ignore */ } }, [])

  // —— 声景（WebAudio 合成，stage 自带拷贝；muted 门控）——
  // useMemo 一次性构建稳定 sfx 对象（闭包 audioRef 稳定引用），避免 render 中改 ref。
  const sfx = useMemo(() => {
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function sfxWhoosh() {   // 翻牌：低频重击 + 破空短扫
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2)
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.16), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.14)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.045, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    ns.connect(bp); bp.connect(g2); g2.connect(ctx.destination); ns.start(t); ns.stop(t + 0.16)
  }
  function sfxSnap() {   // 骨牌定格：软噪声刷过
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const len = Math.floor(ctx.sampleRate * 0.15)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9
    bp.frequency.setValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.15)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + 0.15)
  }
  function sfxCheer(win) {   // 定格欢呼：宽带噪声起伏 + 亮音 + 进球哨
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const dur = win ? 1.5 : 0.9, peak = win ? 0.14 : 0.08
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI)
    const src = ctx.createBufferSource(); src.buffer = buf
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1050; bp.Q.value = 0.5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp); bp.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + dur)
    if (win) {
      [660, 990, 1320].forEach((f, i) => {
        const o = ctx.createOscillator(); const og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
        const s = t + i * 0.09
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.07, s + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, s + 0.3)
        o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.32)
      })
      ;[0, 0.2].forEach((off, i) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 2300 + i * 120
        const lfo = ctx.createOscillator(); lfo.frequency.value = 26
        const lg = ctx.createGain(); lg.gain.value = 55
        lfo.connect(lg); lg.connect(o.frequency)
        const og = ctx.createGain(); const s = t + 0.5 + off
        og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.05, s + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, s + (i ? 0.24 : 0.14))
        o.connect(og); og.connect(ctx.destination); o.start(s); o.stop(s + 0.26); lfo.start(s); lfo.stop(s + 0.26)
      })
    }
  }
    return { whoosh: sfxWhoosh, snap: sfxSnap, cheer: sfxCheer }
  }, [])

  const shown = drawResult?.tiles ? deriveRound(drawResult.tiles) : null
  // 揭示相位：有开奖且非下注/封盘/连接中（drawn/settled/idle 都显）——与 DerbyDayStage racing 同门控。
  // 关键：含 idle！结果须在 idle 期（settled 后、下一局 betting 前）持续显示，否则 drawResult 仍在
  // 而 TableCard 倒计时又因 drawResult 存在被隐藏 → 舞台空窗；且保证翻牌有完整 3.15s 窗口不被 idle 截断。
  const reveal = shown && phase !== 'betting' && phase !== 'locked' && phase !== 'connecting'

  return (
    <div style={{
      position: 'relative', width, height, overflow: 'hidden', boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: DERBY.strip, padding: isMobile ? '6px 8px' : '6px 12px',
      // 自成栈上下文：内部 confetti/VS 的 z-index 封在舞台内，不逃逸盖住 TableCard 的
      // 倒计时/封盘/settleInfo 中未中叠层（⑥ 结算反馈须在舞台之上）。
      isolation: 'isolate',
    }}>
      <style>{DD_KEYFRAMES}</style>
      {reveal
        ? <DominoArena key={roundNo} shown={shown} settled={phase === 'settled'} isMobile={isMobile} reduced={reduced} roundNo={roundNo} sfx={sfx} />
        : <StandbyBoard height={height} />}
    </div>
  )
}
