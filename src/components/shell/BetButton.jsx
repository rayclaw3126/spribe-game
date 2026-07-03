import { COLORS, RADIUS } from './tokens'

// Three-state bet button, purely presentational — the host game maps its own
// phase/bet state onto `state` and supplies the handler:
//   'bet'     → green,  「下注 $X」  (live amount)
//   'cancel'  → dark red「取消」     (bet placed, round not started)
//   'cashout' → amber,  「兑现 $X.XX」(live payout + breathing glow)

const STATES = {
  bet: {
    background: `linear-gradient(135deg, ${COLORS.green}, ${COLORS.greenSoft})`,
    boxShadow: `0 4px 16px ${COLORS.greenGlow}`,
    animation: 'none',
  },
  cancel: {
    background: `linear-gradient(135deg, ${COLORS.redDark}, ${COLORS.redDeep})`,
    boxShadow: `0 4px 14px ${COLORS.shadow}`,
    animation: 'none',
  },
  cashout: {
    background: `linear-gradient(135deg, ${COLORS.amber}, ${COLORS.amberDeep})`,
    boxShadow: `0 4px 18px ${COLORS.amberGlow}`,
    animation: 'shellBreath 1.4s ease-in-out infinite',
  },
  // Greyed hold state — no bet in flight ("等待下一局") or already cashed out.
  waiting: {
    background: COLORS.surface,
    boxShadow: 'none',
    animation: 'none',
  },
}

// `sub` renders a second, larger line (Spribe's「下注 / $10.00」pattern);
// `stretch` makes the button fill its flex parent's height.
export default function BetButton({ state, label, sub, onClick, disabled, stretch }) {
  const s = STATES[state] || STATES.bet
  return (
    <>
      <style>{`
        @keyframes shellBreath {
          0%, 100% { box-shadow: 0 4px 14px ${COLORS.amberGlow}; }
          50% { box-shadow: 0 4px 30px ${COLORS.amberGlow}, 0 0 22px ${COLORS.amberGlow}; }
        }
      `}</style>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          width: '100%',
          padding: stretch ? '6px 10px' : 14,
          ...(stretch ? { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 } : {}),
          borderRadius: RADIUS.btn,
          border: 'none',
          fontWeight: 800,
          fontSize: 16,
          letterSpacing: '0.3px',
          color: COLORS.white,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'opacity 0.15s, transform 0.15s',
          ...s,
        }}
      >
        {label}
        {sub && <span style={{ fontSize: 21, fontWeight: 900, lineHeight: 1 }}>{sub}</span>}
      </button>
    </>
  )
}
