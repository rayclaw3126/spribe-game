import { useState } from 'react'
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
import coverNumberUp from '../assets/covers/cover_numberup.png'
import coverDerbyDay from '../assets/covers/cover_derbyday.png'
import coverLineUp from '../assets/covers/cover_lineup.png'
import coverSpeedGrid from '../assets/covers/cover_speedgrid.png'
import coverWuXing from '../assets/covers/cover_wuxing.png'
import coverRollingBall from '../assets/covers/cover_rollingball.png'
import { useIsMobile } from '../hooks/useMediaQuery'

const GAMES = [
  { id: 'Aviator',   name: 'Breakaway',  desc: "Cash out before you're tackled!", color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverBreakaway, cat: 'instant' },
  { id: 'Dice',      name: 'Total Goals',     desc: 'Over or under? Call the score.',   color: '#2563EB', bg: 'linear-gradient(135deg, #DBEAFE, #BFDBFE)', cover: coverTotalGoals, cat: 'instant' },
  { id: 'Plinko',    name: 'Free Kick',   desc: 'Curl it into the zone!',         color: '#D97706', bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', cover: coverFreeKick, cat: 'instant' },
  { id: 'Goal',      name: 'Goal',     desc: 'Score past the goalkeeper!',      color: '#059669', bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', cover: coverGoal, cat: 'instant' },
  { id: 'HiLo',      name: 'Rating Hi-Lo',    desc: 'Higher or lower rating?',    color: '#DC2626', bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)', cover: coverRatingHiLo, cat: 'instant' },
  { id: 'Mines',     name: 'Dribble',    desc: 'Beat defenders, avoid tackles.', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverDribble, cat: 'instant' },
  { id: 'Keno',      name: 'Team Keno', desc: 'Pick the winning teams!',        color: '#DB2777', bg: 'linear-gradient(135deg, #FCE7F3, #FBCFE8)', cover: coverTeamKeno, cat: 'instant' },
  { id: 'Limbo',     name: 'Odds Climb', desc: 'Set target odds, kick off to climb!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverOddsClimb, cat: 'instant' },
  { id: 'StreakRoll', name: 'Streak Roll', desc: 'Roll the strip, stop on a multiplier!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverStreakRoll, cat: 'instant' },
  { id: 'MiniRoulette', name: 'Team Roulette', desc: 'Pick your team, spin the wheel!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverTeamRoulette, cat: 'instant' },
  { id: 'Momentum', name: 'Momentum', desc: 'Ride the surge, cash the peak!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverMomentum, cat: 'instant' },
  { id: 'HalfTime', name: 'Half Time', desc: 'Call the keno sum — over, under, zones!', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverHalfTime, cat: 'lottery' },
  { id: 'GoldenBoot', name: 'Golden Boot', desc: 'Ten strikers sprint — call the podium!', color: '#ffd54f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverGoldenBoot, cat: 'lottery' },
  { id: 'NumberUp', name: 'Number Up', desc: 'Pick the shirt number — 00 to 99!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverNumberUp, cat: 'lottery' },
  // TODO: 换 Codex 专属封面（暂借 Total Goals 封面占位）
  { id: 'HatTrick', name: 'Hat Trick', desc: 'Three dice — call the total!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverTotalGoals, cat: 'lottery' },
  { id: 'DerbyDay', name: 'Derby Day', desc: 'Home vs away — back your side!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverDerbyDay, cat: 'lottery' },
  { id: 'LineUp', name: 'Line Up', desc: 'Five lines, 25 numbers — call the sums!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverLineUp, cat: 'lottery' },
  { id: 'SpeedGrid', name: 'Speed Grid', desc: '24 cars, one champion — call it!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverSpeedGrid, cat: 'lottery' },
  { id: 'WuXing', name: 'Wu Xing', desc: 'Twenty balls, five elements!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverWuXing, cat: 'lottery' },
  { id: 'RollingBall', name: 'Rolling Ball', desc: 'Three balls roll — call each one!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverRollingBall, cat: 'lottery' },
  { id: 'DominoDuel', name: 'Domino Duel', desc: 'Home vs away — dominoes decide!', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: null, cat: 'lottery' },
]

const TOP_IDS = ['RollingBall', 'WuXing', 'SpeedGrid', 'LineUp', 'DerbyDay']
const HOT_IDS = ['DerbyDay', 'LineUp', 'SpeedGrid', 'WuXing', 'RollingBall']
const NEW_IDS = ['LineUp', 'SpeedGrid', 'WuXing', 'RollingBall']

const TABS = [
  { k: 'all', label: '全部' },
  { k: 'hot', label: '热门' },
  { k: 'new', label: '新游' },
  { k: 'instant', label: '即时街机' },
  { k: 'lottery', label: '轮次开奖' },
]

export default function Lobby({ onSelect, balance }) {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('hot')
  const shown = tab === 'all' ? [...TOP_IDS.map(id => GAMES.find(g => g.id === id)), ...GAMES.filter(g => !TOP_IDS.includes(g.id))]
    : tab === 'hot' ? GAMES.filter(g => HOT_IDS.includes(g.id))
      : tab === 'new' ? GAMES.filter(g => NEW_IDS.includes(g.id))
        : GAMES.filter(g => g.cat === tab)
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? '16px 12px 32px' : '32px 24px 40px', color: '#e8edf2' }}>
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
          {TABS.map(t => {
            const active = tab === t.k
            return (
              <button key={t.k} type="button" onClick={() => setTab(t.k)} style={{
                background: active ? '#16c784' : '#1a2230',
                color: active ? '#06251a' : '#8a97a6',
                border: `1px solid ${active ? '#16c784' : '#232c39'}`,
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
              }}>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: isMobile ? 10 : 16,
      }}>
        {shown.map((g, i) => (
          <GameCard key={g.id} game={g} index={i} onSelect={onSelect} isMobile={isMobile} />
        ))}
      </div>

      {/* Footer note */}
      <p style={{ textAlign: 'center', color: '#7d8a99', fontSize: 13, marginTop: 42 }}>
        All games use demo balance — play responsibly and have fun!
      </p>
    </div>
  )
}

function GameCard({ game, index, onSelect, isMobile }) {
  return (
    <button
      onClick={() => onSelect(game.id)}
      style={{
        background: '#1a2230',
        border: '1px solid #232c39',
        borderRadius: 12,
        padding: isMobile ? 0 : 18,
        overflow: isMobile ? 'hidden' : undefined,
        textAlign: 'left', cursor: 'pointer',
        transition: 'transform 0.2s, border-color 0.2s, background 0.2s',
        animation: `fadeIn 0.5s ease ${index * 0.06}s both`,
        minHeight: isMobile ? 'auto' : 178,
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
          margin: isMobile ? 0 : '-18px -18px 16px', height: isMobile ? 78 : 120, overflow: 'hidden',
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
      <div style={isMobile
        ? { fontWeight: 800, fontSize: 13, color: '#e8edf2', padding: '6px 8px 8px' }
        : { fontWeight: 800, fontSize: 17, color: '#e8edf2', marginBottom: 6 }}>
        {game.name}
      </div>
      {!isMobile && (
        <>
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
        </>
      )}
    </button>
  )
}
