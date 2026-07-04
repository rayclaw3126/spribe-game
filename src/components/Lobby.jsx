import coverBreakaway from '../assets/covers/cover-breakaway.png'
import coverDribble from '../assets/covers/cover-dribble.png'
import coverFreeKick from '../assets/covers/cover-free-kick.png'
import coverGoal from '../assets/covers/cover-goal.png'
import coverRatingHiLo from '../assets/covers/cover-rating-hi-lo.png'
import coverTeamKeno from '../assets/covers/cover-team-keno.png'
import coverTotalGoals from '../assets/covers/cover-total-goals.png'
import coverOddsClimb from '../assets/covers/cover-odds-climb.png'
import coverStreakRoll from '../assets/covers/cover-streak-roll.png'
import coverTeamRoulette from '../assets/covers/cover_miniroulette.png'
import coverMomentum from '../assets/covers/cover_momentum.png'
import coverHalfTime from '../assets/covers/cover_halftime.png'
import coverGoldenBoot from '../assets/covers/cover_goldenboot.png'

const GAMES = [
  { id: 'Aviator',   name: 'Breakaway',  desc: "Cash out before you're tackled!", color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverBreakaway },
  { id: 'Dice',      name: 'Total Goals',     desc: 'Over or under? Call the score.',   color: '#2563EB', bg: 'linear-gradient(135deg, #DBEAFE, #BFDBFE)', cover: coverTotalGoals },
  { id: 'Plinko',    name: 'Free Kick',   desc: 'Curl it into the zone!',         color: '#D97706', bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', cover: coverFreeKick },
  { id: 'Goal',      name: 'Goal',     desc: 'Score past the goalkeeper!',      color: '#059669', bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', cover: coverGoal },
  { id: 'HiLo',      name: 'Rating Hi-Lo',    desc: 'Higher or lower rating?',    color: '#DC2626', bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)', cover: coverRatingHiLo },
  { id: 'Mines',     name: 'Dribble',    desc: 'Beat defenders, avoid tackles.', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverDribble },
  { id: 'Keno',      name: 'Team Keno', desc: 'Pick the winning teams!',        color: '#DB2777', bg: 'linear-gradient(135deg, #FCE7F3, #FBCFE8)', cover: coverTeamKeno },
  { id: 'Limbo',     name: 'Odds Climb', desc: 'Set target odds, kick off to climb!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverOddsClimb },
  { id: 'StreakRoll', name: 'Streak Roll', desc: 'Roll the strip, stop on a multiplier!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverStreakRoll },
  { id: 'MiniRoulette', name: 'Team Roulette', desc: 'Pick your team, spin the wheel!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverTeamRoulette },
  { id: 'Momentum', name: 'Momentum', desc: 'Ride the surge, cash the peak!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverMomentum },
  { id: 'HalfTime', name: 'Half Time', desc: 'Call the keno sum — over, under, zones!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverHalfTime },
  { id: 'GoldenBoot', name: 'Golden Boot', desc: 'Ten strikers sprint — call the podium!', color: '#ffd54f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverGoldenBoot },
  // TODO: 换 Codex 专属封面（暂借 Rating Hi-Lo 封面占位）
  { id: 'NumberUp', name: 'Number Up', desc: 'Pick the shirt number — 00 to 99!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverRatingHiLo },
]

export default function Lobby({ onSelect, balance }) {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px 40px', color: '#e8edf2' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 22,
      }}>
        <h1 style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800,
          fontSize: 28,
          color: '#e8edf2',
          margin: 0,
        }}>
          <span style={{ color: '#16c784', fontSize: 24 }}>⚽</span>
          电子游戏
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {['热门', '全部', '新游'].map((chip, index) => {
            const active = index === 0
            return (
              <button key={chip} type="button" style={{
                background: active ? '#16c784' : '#1a2230',
                color: active ? '#06251a' : '#8a97a6',
                border: `1px solid ${active ? '#16c784' : '#232c39'}`,
                borderRadius: 999,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 800,
              }}>
                {chip}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 16,
      }}>
        {GAMES.map((g, i) => (
          <GameCard key={g.id} game={g} index={i} onSelect={onSelect} />
        ))}
      </div>

      {/* Footer note */}
      <p style={{ textAlign: 'center', color: '#7d8a99', fontSize: 13, marginTop: 42 }}>
        All games use demo balance — play responsibly and have fun!
      </p>
    </div>
  )
}

function GameCard({ game, index, onSelect }) {
  return (
    <button
      onClick={() => onSelect(game.id)}
      style={{
        background: '#1a2230',
        border: '1px solid #232c39',
        borderRadius: 12,
        padding: 18,
        textAlign: 'left', cursor: 'pointer',
        transition: 'transform 0.2s, border-color 0.2s, background 0.2s',
        animation: `fadeIn 0.5s ease ${index * 0.06}s both`,
        minHeight: 178,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.borderColor = '#3a4657'
        e.currentTarget.style.background = '#1d2736'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = '#232c39'
        e.currentTarget.style.background = '#1a2230'
      }}
    >
      {game.cover ? (
        <div style={{
          margin: '-18px -18px 16px', height: 120, overflow: 'hidden',
          borderRadius: '12px 12px 0 0',
        }}>
          <img src={game.cover} alt={game.name} style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          }} />
        </div>
      ) : (
        <div style={{
          width: 52,
          height: 52,
          borderRadius: 12,
          background: '#232c39',
          border: '1px solid #2b3543',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#16c784',
          fontSize: 26,
          marginBottom: 16,
        }} />
      )}
      <div style={{ fontWeight: 800, fontSize: 17, color: '#e8edf2', marginBottom: 6 }}>
        {game.name}
      </div>
      <div style={{ fontSize: 13, color: '#8a97a6', lineHeight: 1.5, minHeight: 40 }}>
        {game.desc}
      </div>
      <div style={{
        marginTop: 16,
        color: '#16c784',
        fontWeight: 800,
        fontSize: 13,
      }}>
        进入 →
      </div>
    </button>
  )
}
