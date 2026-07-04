import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, MOMENTUM } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetPanel from '../components/shell/BetPanel'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import bayBgUrl from '../assets/shared/bay_bg.png'

// 单T1: Momentum — Spribe Trader replica, midnight-pitch skin, single bay.
// PURE UI — no rounds, no money. Static showcase mirrors the reference:
// last-round badge, big multiplier + walking dots, rising bars on a
// match-minute axis, Bet/Auto bay (Free Bet 不做).

const MINUTES = 31
// static fake history — includes sub-1x red and 0.00x busted samples
const FAKE_HISTORY = ['2.35', '1.47', '0.80', '3.50', '0.00', '1.12', '0.90', '5.20', '1.06', '0.80']
// static showcase bars: [minute, height % of chart]
const SHOW_BARS = [[1, 34], [2, 58], [3, 82]]

export default function Momentum({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [feedBets] = useState(() => makeFeedBots())   // static fake feed (display only)

  const pillColor = v => {
    const n = Number(v)
    if (n === 0) return { bg: 'rgba(255,255,255,0.12)', fg: MOMENTUM.greyPill }
    if (n < 1) return { bg: 'rgba(224,75,58,0.2)', fg: MOMENTUM.red }
    return { bg: 'rgba(53,208,127,0.16)', fg: MOMENTUM.green }
  }

  // multiplier pill strip — desktop renders it in the 34px skeleton row,
  // mobile keeps it inside the card (never both)
  const historyStrip = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(0,0,0,0.28)', borderRadius: RADIUS.pill,
        padding: '4px 6px', overflow: 'hidden', minHeight: 24,
      }}>
        {(isMobile ? FAKE_HISTORY.slice(0, 6) : FAKE_HISTORY).map((v, i) => {
          const c = pillColor(v)
          return (
            <span key={i} style={{
              padding: '3px 10px', borderRadius: RADIUS.pill,
              background: c.bg, color: c.fg,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
            }}>{v}x</span>
          )
        })}
      </div>
  )

  const gameCard = (
      <Panel style={{
        background: `linear-gradient(180deg, ${MOMENTUM.bgTop}, ${MOMENTUM.bgBot})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative', minHeight: isMobile ? 360 : 420,
        display: 'flex', flexDirection: 'column',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {/* turf grid — same density feel as the reference chart backdrop */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `repeating-linear-gradient(0deg, ${MOMENTUM.grid} 0px, ${MOMENTUM.grid} 1px, transparent 1px, transparent 42px),
            repeating-linear-gradient(90deg, ${MOMENTUM.grid} 0px, ${MOMENTUM.grid} 1px, transparent 1px, transparent 42px)`,
        }} />

        {!isDesk && <div style={{ position: 'relative', zIndex: 1, marginBottom: 10 }}>{historyStrip}</div>}

        {/* last-round range badge (top-left) */}
        <div style={{
          position: 'absolute', top: isDesk ? 14 : 52, left: 14, zIndex: 1,
          padding: '3px 10px', borderRadius: 6, background: MOMENTUM.badgeBg,
          display: 'inline-flex', gap: 8, alignItems: 'center',
        }}>
          <span style={{ color: MOMENTUM.dim, fontSize: 11, fontWeight: 800 }}>0.90</span>
          <span style={{ color: MOMENTUM.green, fontSize: 11, fontWeight: 900 }}>1.47</span>
        </div>

        {/* center: status tag + big multiplier + walking dots */}
        <div style={{
          position: 'relative', zIndex: 1, textAlign: 'center',
          marginTop: isDesk ? 26 : 18,
        }}>
          <span style={{
            padding: '3px 14px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)',
            color: MOMENTUM.dim, fontSize: 11, fontWeight: 800, letterSpacing: 1,
          }}>状态 X</span>
          <div style={{
            marginTop: 10, color: MOMENTUM.green,
            fontSize: isMobile ? 46 : 64, fontWeight: 900, lineHeight: 1,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>1.47x</div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 5 }}>
            {[0.35, 0.9, 0.35].map((o, i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: MOMENTUM.green, opacity: o }} />
            ))}
          </div>
        </div>

        {/* chart: rising round-top bars + 1–31 match-minute axis */}
        <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 140, marginTop: 8 }}>
          {SHOW_BARS.map(([m, h]) => (
            <span key={m} style={{
              position: 'absolute', bottom: 0,
              left: `${((m - 0.5) / MINUTES) * 100}%`, transform: 'translateX(-50%)',
              width: isMobile ? 9 : 13, height: `${h}%`,
              borderRadius: '7px 7px 2px 2px',
              background: `linear-gradient(180deg, ${MOMENTUM.barTop}, ${MOMENTUM.green})`,
              boxShadow: `0 0 12px rgba(53,208,127,0.35)`,
            }} />
          ))}
        </div>
        <div style={{
          position: 'relative', zIndex: 1, display: 'flex', marginTop: 6,
          borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 4,
        }}>
          {Array.from({ length: MINUTES }, (_, i) => i + 1).map(m => (
            <span key={m} style={{
              flex: 1, textAlign: 'center', color: MOMENTUM.dim,
              fontSize: isMobile ? 7 : 9, fontWeight: 700,
            }}>{m}</span>
          ))}
        </div>
      </Panel>
  )

  // single bay — Bet/Auto tabs, all controls display-only in T1
  const bayPanel = (
        <BetPanel
          bare={isDesk}
          bet={bet}
          setBet={setBet}
          max={balance}
          inputDisabled={false}
          chipDisabled={false}
          button={{ state: 'bet', label: '▷ BET', disabled: true }}
          auto={{
            betOn: false, cashOn: false, cashMult: 2,
            onToggleBet: () => {}, onToggleCash: () => {}, onCashMult: () => {},
          }}
        />
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Dribble ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Momentum</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            <div style={{ height: LAYOUT.historyH, flex: '0 0 auto', overflow: 'hidden' }}>
              {historyStrip}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
            {/* full-bleed bottom bay strip — ambient art under a dark scrim (6b/6c) */}
            <div style={{
              flex: '0 0 auto', minHeight: LAYOUT.bottomH,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 -12px -12px',
              background: `linear-gradient(rgba(10,17,25,0.78), rgba(10,17,25,0.78)), url(${bayBgUrl}) center / cover no-repeat`,
              borderTop: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ width: LAYOUT.bayW, maxWidth: '100%' }}>{bayPanel}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout title="Momentum" emoji="📊" color={MOMENTUM.green}>
      {gameCard}
      <div style={{ maxWidth: isMobile ? '100%' : 480, margin: '14px auto 0' }}>{bayPanel}</div>
    </GameLayout>
  )
}
