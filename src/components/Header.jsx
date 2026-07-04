import { useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'

const GAME_NAMES = {
  Aviator: 'Breakaway',
  Dice: 'Total Goals',
  Plinko: 'Free Kick',
  Goal: 'Goal',
  HiLo: 'Rating Hi-Lo',
  Mines: 'Dribble',
  Keno: 'Team Keno',
  Limbo: 'Odds Climb',
  StreakRoll: 'Streak Roll',
}

export default function Header({ balance, onHome, activeGame }) {
  const tabs = ['体育', '滚球', '真人', '电子', '电竞', '彩票']
  const isMobile = useMediaQuery('(max-width: 900px)')
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: '60px',
      background: '#141b26',
      borderBottom: '1px solid #232c39',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 28, minWidth: 0 }}>
        {isMobile && (
          <button onClick={() => setDrawerOpen(true)} aria-label="menu" style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'none', color: '#e8edf2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flex: '0 0 auto',
          }}>☰</button>
        )}

        <button onClick={onHome} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'none', padding: 0, flex: '0 0 auto',
        }}>
          <span style={{
            width: 34, height: 34, borderRadius: 10,
            background: '#1a2230',
            border: '1px solid #232c39',
            color: '#16c784',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>⚽</span>
          {!isMobile && (
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 800, fontSize: 19,
              color: '#e8edf2',
              letterSpacing: '0.4px',
            }}>SPORTS</span>
          )}
        </button>

        {!isMobile && (
          <nav style={{ display: 'flex', alignItems: 'stretch', height: 60, gap: 6 }}>
            {tabs.map(tab => {
              const active = tab === '电子'
              return (
                <button
                  key={tab}
                  type="button"
                  style={{
                    position: 'relative',
                    background: 'none',
                    color: active ? '#fff' : '#8a97a6',
                    fontSize: 14,
                    fontWeight: active ? 700 : 600,
                    padding: '0 12px',
                    minWidth: 48,
                    borderRadius: 0,
                  }}
                >
                  {tab}
                  {active && (
                    <span style={{
                      position: 'absolute',
                      left: 12,
                      right: 12,
                      bottom: 0,
                      height: 2,
                      background: '#16c784',
                      borderRadius: 2,
                    }} />
                  )}
                </button>
              )
            })}
          </nav>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {!isMobile && activeGame && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: '#7d8a99',
          }}>
            <button onClick={onHome} style={{
              background: 'none', color: '#8a97a6', fontSize: 13, padding: 0,
            }}>Home</button>
            <span>›</span>
            <span style={{ color: '#16c784', fontWeight: 700 }}>{GAME_NAMES[activeGame] || activeGame}</span>
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#1a2230',
          borderRadius: 999,
          padding: '8px 14px',
          border: '1px solid #232c39',
        }}>
          <span style={{ fontSize: 15 }}>💳</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#e8edf2' }}>
            ${balance.toFixed(2)}
          </span>
        </div>

        <button type="button" style={{
          background: '#16c784',
          color: '#06251a',
          borderRadius: 999,
          padding: '9px 18px',
          fontSize: 14,
          fontWeight: 800,
        }}>存款</button>

        {!isMobile && (
          <div style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: '#1a2230',
            border: '1px solid #232c39',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#8a97a6',
            fontSize: 14,
            fontWeight: 800,
          }}>R</div>
        )}
      </div>

      {/* Mobile drawer */}
      {isMobile && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 150,
            }}
          />
          <aside style={{
            position: 'fixed', left: 0, top: 0, bottom: 0,
            width: 260, zIndex: 160,
            background: '#141b26',
            borderRight: '1px solid #232c39',
            padding: 16,
            display: 'flex', flexDirection: 'column', gap: 6,
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 800, fontSize: 18, color: '#e8edf2', letterSpacing: '0.4px',
              }}>SPORTS</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="close" style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'none', color: '#8a97a6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}>✕</button>
            </div>

            {tabs.map(tab => {
              const active = tab === '电子'
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    minHeight: 44, padding: '0 14px',
                    borderRadius: 10,
                    background: active ? '#16c784' : 'none',
                    color: active ? '#06251a' : '#8a97a6',
                    fontSize: 15,
                    fontWeight: active ? 800 : 600,
                    textAlign: 'left',
                  }}
                >
                  {tab}
                </button>
              )
            })}
          </aside>
        </>
      )}
    </header>
  )
}
