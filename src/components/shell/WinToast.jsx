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
          padding: '6px 16px',
          borderRadius: RADIUS.pill,
          background: COLORS.toastBg,
          border: `1px solid ${COLORS.toastBorder}`,
          color: COLORS.greenSoft,
          fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
          animation: 'shellToastIn 200ms ease-out, shellToastOut 300ms ease-in 2.5s forwards',
        }}>
          {t.label ?? `已兑现 ${t.mult.toFixed(2)}×`} <span style={{ color: COLORS.green, fontWeight: 900 }}>+${t.win.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}
