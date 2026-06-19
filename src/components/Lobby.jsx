const GAMES = [
  { id: 'Aviator',  emoji: '✈️',  name: 'Aviator',  desc: 'Cash out before it flies away!', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)' },
  { id: 'Dice',     emoji: '🎲',  name: 'Dice',     desc: 'Roll the dice, beat the odds.',   color: '#2563EB', bg: 'linear-gradient(135deg, #DBEAFE, #BFDBFE)' },
  { id: 'Plinko',   emoji: '🔮',  name: 'Plinko',   desc: 'Drop the ball, win big!',         color: '#D97706', bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)' },
  { id: 'Goal',     emoji: '⚽',  name: 'Goal',     desc: 'Score past the goalkeeper!',      color: '#059669', bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)' },
  { id: 'HiLo',     emoji: '🃏',  name: 'Hi-Lo',    desc: 'Higher or lower? You decide.',    color: '#DC2626', bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)' },
  { id: 'Mines',    emoji: '💣',  name: 'Mines',    desc: 'Dodge the mines, grab the gems.', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)' },
  { id: 'Keno',     emoji: '🎯',  name: 'Keno',     desc: 'Pick your lucky numbers!',        color: '#DB2777', bg: 'linear-gradient(135deg, #FCE7F3, #FBCFE8)' },
  { id: 'Balloon',  emoji: '🎈',  name: 'Balloon',  desc: 'Inflate it, don\'t pop it!',     color: '#EA580C', bg: 'linear-gradient(135deg, #FFEDD5, #FED7AA)' },
]

export default function Lobby({ onSelect, balance }) {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 56, animation: 'fadeIn 0.6s ease' }}>
        <div style={{ fontSize: 56, marginBottom: 12, animation: 'float 3s ease-in-out infinite' }}>💎</div>
        <h1 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800, fontSize: 48, letterSpacing: '-1.5px',
          background: 'linear-gradient(135deg, #7C3AED, #A855F7, #EC4899)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 12,
        }}>Welcome to Spribe Gems</h1>
        <p style={{ fontSize: 18, color: 'var(--text2)', maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
          8 premium mini-games. Pure fun, zero stress. Pick your game and play!
        </p>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 20,
          background: 'linear-gradient(135deg, #7C3AED22, #A855F722)',
          border: '1px solid #DDD6FE', borderRadius: 50, padding: '10px 24px',
        }}>
          <span style={{ fontSize: 18 }}>💰</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--primary)' }}>
            Balance: ${balance.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Game Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 20,
      }}>
        {GAMES.map((g, i) => (
          <GameCard key={g.id} game={g} index={i} onSelect={onSelect} />
        ))}
      </div>

      {/* Footer note */}
      <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, marginTop: 48 }}>
        🎮 All games use demo balance — play responsibly and have fun!
      </p>
    </div>
  )
}

function GameCard({ game, index, onSelect }) {
  return (
    <button
      onClick={() => onSelect(game.id)}
      style={{
        background: 'var(--surface)',
        border: '1.5px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 0, overflow: 'hidden',
        textAlign: 'left', cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
        animation: `fadeIn 0.5s ease ${index * 0.06}s both`,
        boxShadow: 'var(--shadow)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-4px)'
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)'
        e.currentTarget.style.borderColor = game.color + '55'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'var(--shadow)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {/* Top color band */}
      <div style={{
        background: game.bg, height: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 48, position: 'relative',
      }}>
        <span style={{ animation: 'float 3s ease-in-out infinite', display: 'block' }}>
          {game.emoji}
        </span>
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: game.color, color: '#fff',
          fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '3px 8px',
          letterSpacing: '0.5px', textTransform: 'uppercase',
        }}>PLAY</div>
      </div>
      {/* Info */}
      <div style={{ padding: '16px 18px 18px' }}>
        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 4 }}>
          {game.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
          {game.desc}
        </div>
        <div style={{
          marginTop: 14,
          background: game.color + '15',
          color: game.color,
          fontWeight: 600, fontSize: 13,
          padding: '8px 14px', borderRadius: 10,
          textAlign: 'center',
        }}>
          Play Now →
        </div>
      </div>
    </button>
  )
}
