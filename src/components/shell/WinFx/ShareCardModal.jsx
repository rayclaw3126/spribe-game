import { useRef, useEffect, useState } from 'react'
import { renderShareCard, canvasToBlob, copyBlob, canCopyImage } from './shareCard'

// #41 单10：战绩卡分享弹窗（纯前端显示层）。渲染 1080×1350 canvas 预览 + 下载PNG/复制图片。
// 复制走 ClipboardItem(image/png);不支持环境只留下载钮并注明。data 由触发时 settle 上下文取。
export default function ShareCardModal({ data, onClose }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [copyState, setCopyState] = useState('idle')   // idle | ok | fail
  const copyable = canCopyImage()

  useEffect(() => {
    let cancelled = false
    // 渲染完成再显（ready 初值 false；data 变更时旧卡暂留直到新卡出，无闪白）
    if (canvasRef.current && data) {
      renderShareCard(canvasRef.current, data).then(() => { if (!cancelled) setReady(true) })
    }
    return () => { cancelled = true }
  }, [data])

  const download = async () => {
    const blob = await canvasToBlob(canvasRef.current); if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bigwin-${data.roundNo || 'card'}.png`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const copy = async () => {
    const blob = await canvasToBlob(canvasRef.current); if (!blob) return
    const ok = await copyBlob(blob)
    setCopyState(ok ? 'ok' : 'fail')
    setTimeout(() => setCopyState('idle'), 1800)
  }

  const btn = (bg, color, bd) => ({
    padding: '11px 22px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${bd}`,
    background: bg, color, fontSize: 15, fontWeight: 800,
  })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(6,10,15,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxHeight: '92vh',
      }}>
        <canvas ref={canvasRef} style={{
          width: 'auto', height: 'min(72vh, 640px)', aspectRatio: '1080 / 1350',
          borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,0.6)', background: '#0b1016',
          opacity: ready ? 1 : 0.4, transition: 'opacity 0.2s',
        }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="button" onClick={download} disabled={!ready} style={btn('#ffd54f', '#0b2415', '#ffd54f')}>下载 PNG</button>
          {copyable && (
            <button type="button" onClick={copy} disabled={!ready} style={btn('transparent', copyState === 'ok' ? '#4ade80' : copyState === 'fail' ? '#f04438' : '#e8eef5', '#2b3a4a')}>
              {copyState === 'ok' ? '已复制 ✓' : copyState === 'fail' ? '复制失败' : '复制图片'}
            </button>
          )}
          <button type="button" onClick={onClose} style={btn('transparent', '#9fb0c0', '#2b3a4a')}>关闭</button>
        </div>
        {!copyable && <div style={{ fontSize: 11, color: '#8494a6' }}>本环境不支持复制图片，请用「下载 PNG」</div>}
      </div>
    </div>
  )
}
