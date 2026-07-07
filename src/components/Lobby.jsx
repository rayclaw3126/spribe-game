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
import coverPk10 from '../assets/covers/cover-pk10.png'
import coverNumberUp from '../assets/covers/cover_numberup.png'
import coverDerbyDay from '../assets/covers/cover_derbyday.png'
import coverLineUp from '../assets/covers/cover_lineup.png'
import coverSpeedGrid from '../assets/covers/cover_speedgrid.png'
import coverWuXing from '../assets/covers/cover_wuxing.png'
import coverRollingBall from '../assets/covers/cover_rollingball.png'
import coverDominoDuel from '../assets/covers/cover-dominoduel.png'
import { useIsMobile } from '../hooks/useMediaQuery'

const GAMES = [
  { id: 'Aviator',   name: 'Breakaway',  desc: '抢在被扑倒前兑现！', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverBreakaway, cat: 'instant' },
  { id: 'Dice',      name: '总进球',     desc: '大还是小？押总进球',   color: '#2563EB', bg: 'linear-gradient(135deg, #DBEAFE, #BFDBFE)', cover: coverTotalGoals, cat: 'instant' },
  { id: 'Plinko',    name: '任意球',   desc: '弧线球射入死角！',         color: '#D97706', bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', cover: coverFreeKick, cat: 'instant' },
  { id: 'Goal',      name: '射门',     desc: '射穿门将！',      color: '#059669', bg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', cover: coverGoal, cat: 'instant' },
  { id: 'HiLo',      name: '评分高低',    desc: '评分更高还是更低？',    color: '#DC2626', bg: 'linear-gradient(135deg, #FEE2E2, #FECACA)', cover: coverRatingHiLo, cat: 'instant' },
  { id: 'Mines',     name: '盘带过人',    desc: '盘带过人，避开抢断', color: '#7C3AED', bg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)', cover: coverDribble, cat: 'instant' },
  { id: 'Keno',      name: '球队基诺', desc: '选中获胜球队！',        color: '#DB2777', bg: 'linear-gradient(135deg, #FCE7F3, #FBCFE8)', cover: coverTeamKeno, cat: 'instant' },
  { id: 'Limbo',     name: 'Odds Climb', desc: '设定目标赔率，开球攀升！', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverOddsClimb, cat: 'instant' },
  { id: 'StreakRoll', name: '连胜转盘', desc: '转动号码带，停在倍数上！', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverStreakRoll, cat: 'instant' },
  { id: 'MiniRoulette', name: '球队轮盘', desc: '选定球队，转动轮盘！', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverTeamRoulette, cat: 'instant' },
  { id: 'Momentum', name: 'Momentum', desc: '乘势而上，巅峰兑现！', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverMomentum, cat: 'instant' },
  { id: 'HalfTime', name: '中场', desc: '押基诺总和——大/小/区间！', color: '#16C784', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverHalfTime, cat: 'lottery' },
  { id: 'GoldenBoot', name: 'PK10', desc: '十车一线，押名次！', color: '#ffd54f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverPk10, cat: 'lottery' },
  { id: 'NumberUp', name: '号码王', desc: '押球衣号码——00 到 99！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverNumberUp, cat: 'lottery' },
  // TODO: 换 Codex 专属封面（暂借 Total Goals 封面占位）
  { id: 'HatTrick', name: '帽子戏法', desc: '三颗骰子，押总点数！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverTotalGoals, cat: 'lottery' },
  { id: 'DerbyDay', name: '德比大战', desc: '主客对决，押你的一方！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverDerbyDay, cat: 'lottery' },
  { id: 'LineUp', name: '首发阵容', desc: '五行 25 号，押各行和！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverLineUp, cat: 'lottery' },
  { id: 'SpeedGrid', name: '极速方格', desc: '24 车争先，一押到底！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverSpeedGrid, cat: 'lottery' },
  { id: 'WuXing', name: '五行', desc: '二十球，五行归类！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverWuXing, cat: 'lottery' },
  { id: 'RollingBall', name: '滚球', desc: '三球滚动，逐球押注！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverRollingBall, cat: 'lottery' },
  { id: 'DominoDuel', name: '骨牌对决', desc: '主客对决，骨牌定胜负！', color: '#35d07f', bg: 'linear-gradient(135deg,#0f2a1e,#123a2a)', cover: coverDominoDuel, cat: 'lottery' },
]

const TOP_IDS = ['RollingBall', 'WuXing', 'SpeedGrid', 'LineUp', 'DerbyDay']
const HOT_IDS = ['DerbyDay', 'LineUp', 'SpeedGrid', 'WuXing', 'RollingBall', 'GoldenBoot']
const NEW_IDS = ['LineUp', 'SpeedGrid', 'WuXing', 'RollingBall', 'GoldenBoot', 'DerbyDay']

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
        所有游戏均为虚拟余额——理性游戏，享受乐趣！
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
