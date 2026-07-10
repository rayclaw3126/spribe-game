import { useIsMobile } from '../hooks/useMediaQuery'
import badgeWinUrl from '../assets/shared/badge_win.png'
import badgeLoseUrl from '../assets/shared/badge_lose.png'

export default function GameLayout({ color = '#16C784', children, sidebar }) {
  const isMobile = useIsMobile()
  return (
    <div style={{
      maxWidth: isMobile ? 'none' : 960,
      margin: '0 auto',
      padding: isMobile ? 0 : '32px 24px',   // 手机端贴满屏幕，无黑边
      animation: 'fadeIn 0.4s ease',
    }}>
      {/* Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : (sidebar ? '1fr 300px' : '1fr'),
        gap: isMobile ? 14 : 20,
        alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>{children}</div>
        {sidebar && <div style={{ minWidth: 0 }}>{sidebar}</div>}
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
      boxSizing: 'border-box',
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
            flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: 10, minHeight: 40, boxSizing: 'border-box',
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

export function ActionButton({ onClick, disabled, children, color = '#16C784', variant = 'primary' }) {
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
      background: win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      border: `2px solid ${win ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
      color: win ? '#6EE7B7' : '#FCA5A5',
      fontWeight: 700, fontSize: 15,
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'winPop 0.4s ease',
      marginTop: 16,
    }}>
      <img src={win ? badgeWinUrl : badgeLoseUrl} alt="" draggable={false}
        style={{ height: 26, width: 'auto', pointerEvents: 'none', display: 'block' }} />
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
