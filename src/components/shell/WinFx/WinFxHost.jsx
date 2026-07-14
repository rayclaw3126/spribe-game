import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react'
import WinToast from '../WinToast'
import { createEngine } from './winFxEngine'
import { sfxDing, sfxCheerShort, sfxCheerLong } from './winFxSfx'

// #41 单8：中奖庆祝三档宿主（纯显示层）。共享覆盖 canvas + 单 rAF（播完即停，禁每桌开引擎）
// + 全屏效果单例排队（爆中优先，同刻只准一个）+ 瞬态 DOM 特效（金边脉冲/盘口金光扫过/顶栏余额金光）
// + WinToast 并入（离屏桌中奖只走 toast 不放粒子；爆中全屏除外）。走现有 SFX 通道，全局静音必吃。
// 命令式接口：ref.fire({tier,payout,name,tableEl,inView,winKeys})；日后铺回 21 款照此 mount 一份即可。
const MEGA_MS = 3400   // 爆中全屏占用时长（彩带雨最长 ttl 覆盖）——期间同刻只一个，余者排队

const FX_CSS = `
@keyframes winfxPulse { 0%{box-shadow:0 0 0 0 rgba(255,213,79,0)} 28%{box-shadow:0 0 0 3px rgba(255,213,79,0.95),0 0 26px rgba(255,213,79,0.55)} 100%{box-shadow:0 0 0 0 rgba(255,213,79,0)} }
@keyframes winfxSweep { from{transform:translateX(-120%)} to{transform:translateX(120%)} }
@keyframes winfxBal { 0%,100%{text-shadow:none} 45%{text-shadow:0 0 14px rgba(255,213,79,0.95),0 0 4px rgba(255,213,79,0.8)} }
.winfx-card-pulse { animation: winfxPulse 1s ease-out; }
.winfx-key-sweep { overflow: hidden; }
.winfx-key-sweep::after { content:''; position:absolute; inset:0; pointer-events:none; z-index:2;
  background:linear-gradient(105deg, transparent 32%, rgba(255,213,79,0.8) 50%, transparent 68%);
  transform:translateX(-120%); animation:winfxSweep 0.72s ease-out; }
.winfx-bal-glow { animation: winfxBal 1.4s ease-out; }
`

// 瞬态类：先移除+强制回流再加，保证连击可重放；ms 后摘除还原原样式。
function flashClass(el, cls, ms) {
  if (!el) return
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls)
  setTimeout(() => el.classList.remove(cls), ms)
}

export default forwardRef(function WinFxHost(_props, ref) {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const megaRef = useRef({ busy: false, pending: 0 })
  const megaTickRef = useRef(null)   // 持 startMega 供队尾自调，避开回调自引用
  const [toasts, setToasts] = useState([])
  const toastSeq = useRef(0)

  if (engineRef.current == null) engineRef.current = createEngine()

  // —— 单 rAF：有粒子才转，tick 返回 false 即熄火（离屏零开销）——
  const ensureRaf = useCallback(() => {
    if (rafRef.current) return
    const loop = (now) => {
      const cv = canvasRef.current, eng = engineRef.current
      if (!cv || !eng) { rafRef.current = 0; return }
      const ctx = cv.getContext('2d')
      const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1)
      const s = sizeRef.current
      if (s.w !== w || s.h !== h || s.dpr !== dpr) {
        cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr)
        cv.style.width = w + 'px'; cv.style.height = h + 'px'
        sizeRef.current = { w, h, dpr }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const active = eng.tick(ctx, w, h, now)
      rafRef.current = active ? requestAnimationFrame(loop) : 0
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const pushToast = useCallback((name, payout) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts(t => [...t, { id, label: `${name} 本期派彩`, win: Number(payout) || 0, mult: 0 }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }, [])

  // 爆中全屏：彩带雨 + BIG WIN 金字 + 长欢呼 + 顶栏余额金光；同刻只一个，占用中排队 FIFO。
  const startMega = useCallback(() => {
    megaRef.current.busy = true
    const eng = engineRef.current
    eng.rain(window.innerWidth, window.innerHeight)
    eng.bigWin(window.innerWidth, window.innerHeight)
    ensureRaf()
    sfxCheerLong()
    flashClass(document.querySelector('[data-winfx-balance]'), 'winfx-bal-glow', 1400)
    setTimeout(() => {
      if (megaRef.current.pending > 0) { megaRef.current.pending -= 1; megaTickRef.current?.() }
      else megaRef.current.busy = false
    }, MEGA_MS)
  }, [ensureRaf])
  useEffect(() => { megaTickRef.current = startMega }, [startMega])

  const fire = useCallback((evt) => {
    if (!evt) return
    const { tier, payout, name = '', tableEl = null, inView = false, winKeys = [] } = evt
    const eng = engineRef.current

    if (tier === 'mega') {
      // 全屏效果同刻只准一个：占用中则排队（爆中优先——非全屏档从不阻塞它）
      if (megaRef.current.busy) megaRef.current.pending += 1
      else startMega()
      return
    }

    // 小/大中：离屏桌只走 WinToast 不放粒子；在屏才落桌面特效
    if (!inView || !tableEl) { pushToast(name, payout); return }
    pushToast(name, payout)
    const r = tableEl.getBoundingClientRect()
    const cx = r.left + r.width / 2
    if (tier === 'big') {
      eng.burst(cx, r.top + 6)                 // 桌顶彩花喷发
      eng.amount(cx, r.top + 34, payout)       // 金额滚字
      flashClass(tableEl, 'winfx-card-pulse', 1000)   // 桌卡金边脉冲
      ;(winKeys || []).forEach(k => flashClass(tableEl.querySelector(`[data-bet-key="${k}"]`), 'winfx-key-sweep', 760))  // 中奖盘口键金光扫过
      sfxCheerShort()
    } else {
      eng.coins(cx, r.top + 44)                // 金币粒子一迸
      eng.amount(cx, r.top + 30, payout)       // 金额滚字 $0→$X
      sfxDing()
    }
    ensureRaf()
  }, [ensureRaf, pushToast, startMega])

  useImperativeHandle(ref, () => ({ fire }), [fire])

  // dev 预览钩子：window.__WINFX('small'|'big'|'mega') 免赌运气逐档验视觉（仅 DEV）。
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined
    window.__WINFX = (tier = 'small') => {
      if (tier === 'mega') { fire({ tier: 'mega', payout: 640, name: '预览' }); return }
      const el = document.querySelector('[data-table-id]')
      const keys = el ? [...el.querySelectorAll('[data-bet-key]')].slice(0, 2).map(n => n.getAttribute('data-bet-key')) : []
      fire({ tier, payout: tier === 'big' ? 88 : 6.5, name: '预览', tableEl: el, inView: !!el, winKeys: keys })
    }
    return () => { try { delete window.__WINFX } catch { /* ignore */ } }
  }, [fire])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return (
    <>
      <style>{FX_CSS}</style>
      <canvas ref={canvasRef} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 8, left: 0, right: 0, zIndex: 72, pointerEvents: 'none' }}>
        <WinToast toasts={toasts} />
      </div>
    </>
  )
})
