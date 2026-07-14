import { COLORS, RADIUS, SPACE } from './tokens'

// Cash-out toast stack — green pill at the top-center of the arena:
// slides in 200ms, holds 2.5s, fades out. Consecutive wins stack
// vertically. Pure display; the host owns the toast list and its timers.

export default function WinToast({ toasts }) {
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs + 2,
      zIndex: 5, pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes shellToastIn {
          from { transform: translateY(-14px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shellToastOut {
          to { opacity: 0; }
        }
      `}</style>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px',
          borderRadius: RADIUS.pill,
          background: COLORS.toastBg,
          border: `1px solid ${COLORS.toastBorder}`,
          color: COLORS.greenSoft,
          fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
          animation: t.onShare
            ? 'shellToastIn 200ms ease-out, shellToastOut 300ms ease-in 4.5s forwards'
            : 'shellToastIn 200ms ease-out, shellToastOut 300ms ease-in 2.5s forwards',
        }}>
          <span>{t.label ?? `已兑现 ${t.mult.toFixed(2)}×`} <span style={{ color: COLORS.green, fontWeight: 900 }}>+${t.win.toFixed(2)}</span></span>
          {t.onShare && (
            <button type="button" onClick={t.onShare} aria-label="分享战绩" title="分享战绩" style={{
              pointerEvents: 'auto', cursor: 'pointer', width: 22, height: 22, borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,213,79,0.16)', border: '1px solid #ffd54f', color: '#ffd54f',
              fontSize: 13, fontWeight: 900, lineHeight: 1,
            }}>⤴</button>
          )}
        </div>
      ))}
    </div>
  )
}
