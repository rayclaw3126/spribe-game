export default function Header({ balance, onHome, activeGame }) {
  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: '72px',
      background: 'rgba(255,255,255,0.88)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px',
    }}>
      {/* Logo */}
      <button onClick={onHome} style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'none', padding: 0,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
        }}>💎</div>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800, fontSize: 22,
          background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px',
        }}>Spribe Gems</span>
      </button>

      {/* Center breadcrumb */}
      {activeGame && (
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 14, color: 'var(--text3)',
        }}>
          <button onClick={onHome} style={{
            background: 'none', color: 'var(--text3)', fontSize: 14,
          }}>Home</button>
          <span>›</span>
          <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{activeGame}</span>
        </div>
      )}

      {/* Balance */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg2)', borderRadius: 12, padding: '8px 16px',
        border: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 16 }}>💰</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--primary)' }}>
          ${balance.toFixed(2)}
        </span>
      </div>
    </header>
  )
}
