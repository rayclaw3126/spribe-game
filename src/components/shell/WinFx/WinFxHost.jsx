import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react'
import WinToast from '../WinToast'
import { createEngine } from './winFxEngine'
import { sfxDing, sfxCheerShort, sfxCheerLong } from './winFxSfx'
import ShareCardModal from './ShareCardModal'

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
  const megaRef = useRef({ busy: false, pending: [] })
  const megaTickRef = useRef(null)   // 持 startMega 供队尾自调，避开回调自引用
  const [toasts, setToasts] = useState([])
  const toastSeq = useRef(0)
  const [modalData, setModalData] = useState(null)   // 战绩卡弹窗数据（点分享入口时置）
  const [megaShare, setMegaShare] = useState(null)   // 当前爆中全屏 overlay 的分享数据（在演期间显钮）

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

  const pushToast = useCallback((name, payout, onShare) => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts(t => [...t, { id, label: `${name} 本期派彩`, win: Number(payout) || 0, mult: 0, onShare }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), onShare ? 5000 : 3000)   // 可分享条多留 2s 便于点
  }, [])

  // 爆中全屏：彩带雨 + BIG WIN 金字 + 长欢呼 + 顶栏余额金光 + 分享战绩钮；同刻只一个，占用中排队 FIFO。
  const startMega = useCallback((share) => {
    megaRef.current.busy = true
    setMegaShare(share || null)
    const eng = engineRef.current
    eng.rain(window.innerWidth, window.innerHeight)
    eng.bigWin(window.innerWidth, window.innerHeight)
    ensureRaf()
    sfxCheerLong()
    flashClass(document.querySelector('[data-winfx-balance]'), 'winfx-bal-glow', 1400)
    setTimeout(() => {
      if (megaRef.current.pending.length > 0) { megaTickRef.current?.(megaRef.current.pending.shift()) }
      else { megaRef.current.busy = false; setMegaShare(null) }
    }, MEGA_MS)
  }, [ensureRaf])
  useEffect(() => { megaTickRef.current = startMega }, [startMega])

  const fire = useCallback((evt) => {
    if (!evt) return
    const { tier, payout, name = '', tableEl = null, inView = false, winKeys = [], share = null } = evt
    const eng = engineRef.current
    const onShare = share ? () => setModalData(share) : undefined   // 大中/爆中 WinToast 尾小分享 icon

    if (tier === 'mega') {
      pushToast(name, payout, onShare)   // 爆中也弹带分享 icon 的 WinToast（入口二）
      // 全屏效果同刻只准一个：占用中则排队（爆中优先——非全屏档从不阻塞它）
      if (megaRef.current.busy) megaRef.current.pending.push(share)
      else startMega(share)
      return
    }

    // 小/大中：离屏桌只走 WinToast 不放粒子；在屏才落桌面特效
    if (!inView || !tableEl) { pushToast(name, payout, tier === 'big' ? onShare : undefined); return }
    pushToast(name, payout, tier === 'big' ? onShare : undefined)
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
    const sampleShare = { gameName: '预览', venue: '预览场馆', payout: 640, mult: 21.3, name: 'a***e', roundNo: 'DEV-PREVIEW', date: '2026-07-14', color: '#243447' }
    window.__WINFX = (tier = 'small') => {
      if (tier === 'mega') { fire({ tier: 'mega', payout: 640, name: '预览', share: sampleShare }); return }
      const el = document.querySelector('[data-table-id]')
      const keys = el ? [...el.querySelectorAll('[data-bet-key]')].slice(0, 2).map(n => n.getAttribute('data-bet-key')) : []
      fire({ tier, payout: tier === 'big' ? 88 : 6.5, name: '预览', tableEl: el, inView: !!el, winKeys: keys, share: tier === 'big' ? { ...sampleShare, payout: 88, mult: 8.8 } : null })
    }
    // 战绩卡预览：免赌运气看卡（无 cover 走主题渐变底）
    window.__SHARECARD = (d = {}) => setModalData({
      gameName: '号码王', venue: '蛋白石球场', payout: 95.5, mult: 12.4,
      name: 'a***e', roundNo: 'NU-20260714-1702', date: '2026-07-14', color: '#243447', ...d,
    })
    return () => { try { delete window.__WINFX; delete window.__SHARECARD } catch { /* ignore */ } }
  }, [fire])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return (
    <>
      <style>{FX_CSS}</style>
      <canvas ref={canvasRef} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 8, left: 0, right: 0, zIndex: 72, pointerEvents: 'none' }}>
        <WinToast toasts={toasts} />
      </div>
      {/* 爆中全屏 overlay·分享战绩钮（入口一，在演期间显） */}
      {megaShare && (
        <div style={{ position: 'fixed', left: 0, right: 0, top: '56%', zIndex: 73, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <button type="button" onClick={() => setModalData(megaShare)} style={{
            pointerEvents: 'auto', cursor: 'pointer', padding: '12px 28px', borderRadius: 999,
            background: '#ffd54f', color: '#0b2415', border: 'none', fontSize: 16, fontWeight: 900,
            boxShadow: '0 8px 28px rgba(255,213,79,0.4)',
          }}>分享战绩 ⤴</button>
        </div>
      )}
      {modalData && <ShareCardModal data={modalData} onClose={() => setModalData(null)} />}
    </>
  )
})
