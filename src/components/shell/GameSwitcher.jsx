import { useEffect, useRef } from 'react'
// 从注册表取同 navCat 全部款；名字/封面/分类标题均走单一数据源。
import { GAME_REGISTRY, GAME_BY_ID, NAV_CATS } from '../../gameRegistry'
import { COLORS, SWITCHER } from './tokens'

// 底部抽屉：从当前款的 navCat 列出同类全部款，点击直切；「返回大厅查看全部」→ onSwitch(null)。
// 仅移动端（GameTopBar <1024 才挂）。遮罩点击/上划/ESC 关闭，slideUp 动画，maxHeight 70vh 内滚。
export default function GameSwitcher({ open, onClose, currentId, onSwitch }) {
  const cur = currentId ? GAME_BY_ID[currentId] : null
  const navCat = cur?.navCat
  const peers = navCat ? GAME_REGISTRY.filter(g => g.navCat === navCat) : []
  const catLabel = NAV_CATS.find(c => c.key === navCat)?.label || '同类'
  const startY = useRef(null)

  // ESC 关闭 + 打开时锁背景滚动
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: SWITCHER.scrim, display: 'flex', alignItems: 'flex-end',
    }}>
      <style>{`@keyframes gsSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div
        onClick={e => e.stopPropagation()}
        onTouchStart={e => { startY.current = e.touches[0].clientY }}
        onTouchMove={e => {
          if (startY.current != null && e.touches[0].clientY - startY.current > 60) { startY.current = null; onClose?.() }
        }}
        style={{
          width: '100%', maxHeight: '70vh',
          background: SWITCHER.sheet,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          boxShadow: '0 -8px 30px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          animation: 'gsSlideUp 0.25s ease',
        }}
      >
        {/* 抓手条 */}
        <div style={{ padding: '8px 0 4px', display: 'flex', justifyContent: 'center', flex: '0 0 auto' }}>
          <span style={{ width: 40, height: 4, borderRadius: 2, background: SWITCHER.handle }} />
        </div>
        {/* 标题：分类 label · N 款 */}
        <div style={{ padding: '2px 18px 10px', color: COLORS.white, fontSize: 15, fontWeight: 900, flex: '0 0 auto' }}>
          {catLabel} · {peers.length} 款
        </div>
        {/* 卡片网格（2 列，内滚） */}
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 14px 8px', flex: '1 1 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {peers.map(g => {
              const isCur = g.id === currentId
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={isCur}
                  onClick={() => { if (!isCur) onSwitch?.(g.id) }}
                  style={{
                    position: 'relative', textAlign: 'left', padding: 0, overflow: 'hidden',
                    aspectRatio: '3 / 2', background: SWITCHER.card,
                    border: isCur ? `1.5px solid ${SWITCHER.current}` : `1px solid ${SWITCHER.cardLine}`,
                    borderRadius: 12, cursor: isCur ? 'default' : 'pointer', opacity: isCur ? 0.92 : 1,
                  }}
                >
                  {g.cover && (
                    <img src={g.cover} alt={g.name} style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                    }} />
                  )}
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: SWITCHER.cardScrim }} />
                  {isCur && (
                    <span style={{
                      position: 'absolute', top: 6, left: 6,
                      background: SWITCHER.current, color: SWITCHER.currentInk,
                      fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                    }}>当前</span>
                  )}
                  <span style={{
                    position: 'absolute', left: 8, right: 8, bottom: 7,
                    color: COLORS.white, fontSize: 13, fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{g.name}</span>
                </button>
              )
            })}
          </div>
        </div>
        {/* 底部：返回大厅查看全部 */}
        <div style={{ padding: '10px 14px calc(12px + env(safe-area-inset-bottom))', flex: '0 0 auto', borderTop: `1px solid ${SWITCHER.cardLine}` }}>
          <button type="button" onClick={() => onSwitch?.(null)} style={{
            width: '100%', padding: '11px', borderRadius: 10,
            background: SWITCHER.btnBg, border: `1px solid ${SWITCHER.cardLine}`,
            color: COLORS.white, fontSize: 14, fontWeight: 800, cursor: 'pointer',
          }}>返回大厅查看全部</button>
        </div>
      </div>
    </div>
  )
}
