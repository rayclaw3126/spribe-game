import { COLORS, DERBY, LAYOUT } from './tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'

// 玩法说明弹层 — 共享件。移动端(<1024)底部抽屉（从底弹起 + 抓手条 + 可滚）；
// PC(≥1024)居中大弹窗（淡入微缩放 + 四角圆 + 内容全展开）。
// 暗色皮取 DERBY 系（球场绿卡底 + 共享金顶边/段标 + 浅绿正文），禁自编 hex。
// props: { open, onClose, venue, title, sections:[{icon,title,body}] }（body 支持字符串或 JSX）
export default function HowToPlay({ open, onClose, venue, title, sections = [] }) {
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  if (!open) return null
  // 卡片定位：PC 居中大弹窗 / 移动 底部抽屉（各自定位、圆角、上限高、动画）
  const cardPos = isDesk ? {
    top: '50%', left: '50%', width: 'min(720px, calc(100vw - 48px))',
    transform: 'translate(-50%, -50%)', borderRadius: 16,
    maxHeight: '90vh', animation: 'htpFadeIn 0.2s ease-out',
  } : {
    left: 0, right: 0, bottom: 0, maxWidth: 520, margin: '0 auto',
    borderRadius: '16px 16px 0 0', maxHeight: '92vh',
    animation: 'htpSlideUp 0.28s ease-out',
  }
  return (
    <>
      <style>{`
        @keyframes htpSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes htpFadeIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      {/* 遮罩（点关） */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      }} />
      {/* 弹层卡片 */}
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', zIndex: 201,
        background: DERBY.bgOuter, borderTop: `2px solid ${DERBY.gold}`,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        ...cardPos,
      }}>
        {/* 抓手条（仅移动端） */}
        {!isDesk && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, flex: '0 0 auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.3)' }} />
          </div>
        )}
        {/* 标题行 */}
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ minWidth: 0 }}>
            {venue && <div style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{venue}</div>}
            <div style={{ color: COLORS.white, fontSize: 16, fontWeight: 900, whiteSpace: 'nowrap' }}>{title}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: COLORS.white, fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        {/* 可滚内容 */}
        <div style={{
          flex: '1 1 auto', overflowY: 'auto', padding: '14px 18px 24px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {sections.map((s, i) => (
            <div key={i}>
              <div style={{ color: DERBY.gold, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, marginBottom: 6 }}>
                {s.icon ? `${s.icon} ` : ''}{s.title}
              </div>
              <div style={{ color: DERBY.text, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
