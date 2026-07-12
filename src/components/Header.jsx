import { useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { COLORS } from './shell/tokens'
import { useBgm } from './shell/bgmManager'
import BillDrawer from './BillDrawer'

export default function Header({ balance, onHome, onLogout, playerToken }) {
  const isMobile = useMediaQuery('(max-width: 900px)')
  // BGM master switch — global singleton state, shared with every game's toggle.
  const [bgmUiOn, toggleBgm] = useBgm()
  const [billOpen, setBillOpen] = useState(false)

  return (
    <>
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: '52px',
      background: '#141b26',
      borderBottom: '1px solid #232c39',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px',
      boxSizing: 'border-box',
    }}>
      <button onClick={onHome} style={{
        display: 'flex', alignItems: 'center',
        background: 'none', padding: 0, flex: '0 0 auto',
      }}>
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800, fontSize: isMobile ? 16 : 19,
          color: '#e8edf2',
          letterSpacing: '0.4px',
        }}>SPORTS</span>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={toggleBgm}
          aria-label={bgmUiOn ? '关闭背景音乐' : '开启背景音乐'}
          title={bgmUiOn ? '关闭背景音乐' : '开启背景音乐'}
          style={{
            width: 34, height: 34, borderRadius: '50%',
            flex: '0 0 auto', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: bgmUiOn ? COLORS.greenTint : COLORS.surface,
            border: `1px solid ${bgmUiOn ? COLORS.greenGlow : COLORS.border}`,
            color: bgmUiOn ? COLORS.green : COLORS.textMuted,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
            {bgmUiOn ? (
              <>
                <path d="M15 8.5a5 5 0 0 1 0 7" />
                <path d="M18 5.5a9.5 9.5 0 0 1 0 13" />
              </>
            ) : (
              <line x1="14.5" y1="8.5" x2="21.5" y2="15.5" />
            )}
          </svg>
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#1a2230',
          borderRadius: 999,
          padding: '8px 14px',
          border: '1px solid #232c39',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16c784" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
            <rect x="2" y="5" width="20" height="14" rx="3" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#e8edf2' }}>
            ${balance.toFixed(2)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setBillOpen(true)}
          aria-label="我的账单"
          title="我的账单"
          style={{
            width: 34, height: 34, borderRadius: '50%',
            flex: '0 0 auto', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted,
            cursor: 'pointer',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
            <line x1="8.5" y1="9" x2="15" y2="9" />
            <line x1="8.5" y1="13" x2="15" y2="13" />
            <line x1="8.5" y1="17" x2="12.5" y2="17" />
          </svg>
        </button>

        <button type="button" onClick={onLogout} style={{
          background: 'none',
          color: '#8a97a6',
          border: '1px solid #232c39',
          borderRadius: 999,
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}>登出</button>
      </div>
    </header>
    <BillDrawer open={billOpen} onClose={() => setBillOpen(false)} playerToken={playerToken} onLogout={onLogout} />
    </>
  )
}
