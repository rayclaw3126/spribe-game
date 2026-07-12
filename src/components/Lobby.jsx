import { useState } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
// 游戏数据全部读单一数据源 gameRegistry（原本地 GAMES 数组 + 21 封面 import + curation 已迁出）
import { GAME_REGISTRY as GAMES, TOP_IDS, HOT_IDS, NEW_IDS, TAB_CATS } from '../gameRegistry'

const TABS = [
  { k: 'all', label: '全部' },
  { k: 'hot', label: '热门' },
  { k: 'new', label: '新游' },
  { k: 'instant', label: '即时街机' },
  { k: 'lottery', label: '轮次开奖' },
]

export default function Lobby({ onSelect, balance }) {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('all')
  const shown = tab === 'all' ? [...TOP_IDS.map(id => GAMES.find(g => g.id === id)), ...GAMES.filter(g => !TOP_IDS.includes(g.id))]
    : tab === 'hot' ? GAMES.filter(g => HOT_IDS.includes(g.id))
      : tab === 'new' ? GAMES.filter(g => NEW_IDS.includes(g.id))
        : GAMES.filter(g => (TAB_CATS[tab] || [tab]).includes(g.cat))
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
