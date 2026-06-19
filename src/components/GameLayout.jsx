export default function GameLayout({ title, emoji, color = '#7C3AED', children, sidebar }) {
  return (
    <div style={{
      maxWidth: 960, margin: '0 auto', padding: '32px 24px',
      animation: 'fadeIn 0.4s ease',
    }}>
      {/* Game title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: color + '20',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24,
        }}>{emoji}</div>
        <h2 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800, fontSize: 26, color: 'var(--text)',
        }}>{title}</h2>
      </div>

      {/* Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: sidebar ? '1fr 300px' : '1fr',
        gap: 20,
        alignItems: 'start',
      }}>
        <div>{children}</div>
        {sidebar && <div>{sidebar}</div>}
      </div>
    </div>
  )
}

export function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1.5px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: 24,
      boxShadow: 'var(--shadow)',
      ...style,
    }}>
      {children}
    </div>
  )
}

export function BetInput({ bet, setBet, onHalf, onDouble, disabled }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 8 }}>
        Bet Amount
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number" min="1" value={bet}
          onChange={e => setBet(Math.max(1, Number(e.target.value)))}
          disabled={disabled}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid var(--border)', fontSize: 15, fontWeight: 600,
            background: 'var(--surface2)', color: 'var(--text)',
          }}
        />
        <button onClick={onHalf} disabled={disabled} style={{
          padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: 'var(--bg2)', color: 'var(--text2)',
          border: '1.5px solid var(--border)',
        }}>½</button>
        <button onClick={onDouble} disabled={disabled} style={{
          padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: 'var(--bg2)', color: 'var(--text2)',
          border: '1.5px solid var(--border)',
        }}>2×</button>
      </div>
    </div>
  )
}

export function ActionButton({ onClick, disabled, children, color = '#7C3AED', variant = 'primary' }) {
  const base = {
    width: '100%', padding: '14px', borderRadius: 12,
    fontWeight: 700, fontSize: 16, cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.15s', letterSpacing: '0.3px',
    opacity: disabled ? 0.5 : 1,
  }
  const styles = variant === 'primary' ? {
    ...base,
    background: `linear-gradient(135deg, ${color}, ${color}cc)`,
    color: '#fff',
    boxShadow: `0 4px 16px ${color}44`,
  } : {
    ...base,
    background: 'var(--surface)',
    color,
    border: `2px solid ${color}`,
  }
  return (
    <button onClick={onClick} disabled={disabled} style={styles}
      onMouseEnter={e => !disabled && (e.currentTarget.style.transform = 'translateY(-1px)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      {children}
    </button>
  )
}

export function ResultBadge({ result, win, profit }) {
  if (!result) return null
  return (
    <div style={{
      padding: '14px 20px', borderRadius: 14,
      background: win ? '#D1FAE5' : '#FEE2E2',
      border: `2px solid ${win ? '#6EE7B7' : '#FECACA'}`,
      color: win ? '#065F46' : '#991B1B',
      fontWeight: 700, fontSize: 15,
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'winPop 0.4s ease',
      marginTop: 16,
    }}>
      <span style={{ fontSize: 22 }}>{win ? '🎉' : '💔'}</span>
      <div>
        <div>{result}</div>
        {profit !== undefined && (
          <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.8 }}>
            {win ? `+$${profit.toFixed(2)}` : `-$${Math.abs(profit).toFixed(2)}`}
          </div>
        )}
      </div>
    </div>
  )
}
