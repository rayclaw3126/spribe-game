import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HALFTIME } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Half Time — 快乐8和值盘（足球皮）。纯 UI 骨架：全静态假数据，无开奖逻辑、
// 无余额读写、无音频副作用。盘面/珠盘路/注栏只做展示与按钮态。
//
// 和值区间（20 球 × 1–80，和值 210–1410）：
//   Over 811–1410 / Under 210–810 · Odd/Even · Parlay(O/U × Odd/Even)
//   球场五段 OwnGoal 210–695 / Defense 696–763 / Midfield 764–855 /
//            Attack 856–923 / Goal 924–1410
//   1st Half / Draw / 2nd Half（上下半场落球数对比）

// ---- 静态假数据（占位，等接真开奖时整体替换）----
const ROUND_ID = '20260705-088'
const COUNTDOWN = '00:27'
const LAST_DRAW = [3, 7, 12, 18, 22, 25, 31, 36, 40, 44, 47, 52, 55, 59, 63, 66, 70, 74, 77, 80]
const LAST_SUM = LAST_DRAW.reduce((a, b) => a + b, 0)   // 881

// 30 期假历史和值（覆盖各区间；奇偶/大小混排）
const HISTORY_SUMS = [
  881, 742, 655, 930, 803, 812, 776, 948, 701, 860,
  795, 688, 917, 834, 758, 902, 641, 823, 787, 955,
  810, 869, 733, 891, 762, 926, 705, 848, 779, 812,
]
// 上/下半场假结果（F=上半场多, S=下半场多, D=平）— 与和值无关，纯占位
const HISTORY_HALF = 'FSFDSFFSDSFSFFSDFSSFDFSFSFDSSF'.split('')

const zoneOf = s => (s <= 695 ? 'OG' : s <= 763 ? 'DF' : s <= 855 ? 'MF' : s <= 923 ? 'AT' : 'GL')
const ZONE_COLOR = { OG: HALFTIME.over, DF: HALFTIME.draw, MF: HALFTIME.sel, AT: HALFTIME.draw, GL: HALFTIME.over }

// ---- 盘面定义 ----
const ROW1 = [
  { key: 'over',  name: 'OVER',  range: '811–1410', odds: 1.95 },
  { key: 'under', name: 'UNDER', range: '210–810',  odds: 1.95 },
  { key: 'odd',   name: 'ODD',   range: '和值为单',  odds: 1.95 },
  { key: 'even',  name: 'EVEN',  range: '和值为双',  odds: 1.95 },
]
const PARLAY = [
  { key: 'p-oo', name: 'O + ODD',  odds: 3.6 },
  { key: 'p-oe', name: 'O + EVEN', odds: 3.6 },
  { key: 'p-uo', name: 'U + ODD',  odds: 3.6 },
  { key: 'p-ue', name: 'U + EVEN', odds: 3.6 },
]
const ZONES = [
  { key: 'og', name: 'OWN GOAL', range: '210–695', odds: 9.25 },
  { key: 'df', name: 'DEFENSE',  range: '696–763', odds: 4.6 },
  { key: 'mf', name: 'MIDFIELD', range: '764–855', odds: 2.3 },
  { key: 'at', name: 'ATTACK',   range: '856–923', odds: 4.6 },
  { key: 'gl', name: 'GOAL',     range: '924–1410', odds: 9.25 },
]
const ROW3 = [
  { key: 'h1',   name: '1ST HALF', range: '前区多', odds: 2.24 },
  { key: 'draw', name: 'DRAW',     range: '10 / 10', odds: 3.24 },
  { key: 'h2',   name: '2ND HALF', range: '后区多', odds: 2.24 },
]

const ROAD_TABS = ['O/U', 'ODD/EVEN', 'PARLAY', 'ZONE', 'HALF']

// 每期 → 各页签的珠（letter + color），全部由假和值/假半场结果推导（展示用）
function beadFor(tab, sum, half) {
  const over = sum > 810
  const odd = sum % 2 === 1
  if (tab === 'O/U') return { t: over ? 'O' : 'U', c: over ? HALFTIME.over : HALFTIME.under }
  if (tab === 'ODD/EVEN') return { t: odd ? 'O' : 'E', c: odd ? HALFTIME.over : HALFTIME.under }
  if (tab === 'PARLAY') return { t: (over ? 'O' : 'U') + (odd ? 'O' : 'E'), c: over === odd ? HALFTIME.sel : HALFTIME.draw }
  if (tab === 'ZONE') { const z = zoneOf(sum); return { t: z, c: ZONE_COLOR[z] } }
  return { t: half, c: half === 'F' ? HALFTIME.over : half === 'S' ? HALFTIME.under : HALFTIME.draw }
}

export default function HalfTime({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)   // 纯视觉态 — 本游戏无 SFX 合成器
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState(() => new Set())   // 按钮选中态，无逻辑
  const [roadTab, setRoadTab] = useState('O/U')
  const [feedBets] = useState(() => makeFeedBots())   // 展示用假注单

  const toggleSel = key => setSelected(s => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  // ---- 样式件 ----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: HALFTIME.band, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selected.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '7px 2px' : '9px 4px',
      borderRadius: 10, cursor: 'pointer',
      background: sel
        ? HALFTIME.selTint
        : `linear-gradient(180deg, ${HALFTIME.cellTop}, ${HALFTIME.cellBot})`,
      border: `1px solid ${sel ? HALFTIME.sel : HALFTIME.cellBorder}`,
      boxShadow: sel ? `0 0 10px ${HALFTIME.selTint}` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s',
    }
  }
  const cellName = { color: HALFTIME.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HALFTIME.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HALFTIME.odds, fontSize: isMobile ? 11 : 13, fontWeight: 900 }

  const betCell = (m, opts) => (
    <button key={m.key} type="button" className="htCell" onClick={() => toggleSel(m.key)} style={cellBtn(m.key, opts)}>
      <span style={cellName}>{m.name}</span>
      {m.range && <span style={cellRange}>{m.range}</span>}
      <span style={cellOdds}>{m.odds.toFixed(2)}</span>
    </button>
  )

  // ---- 轮次条 ----
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '6px 10px', borderRadius: RADIUS.pill,
      background: HALFTIME.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: HALFTIME.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>#{ROUND_ID}</span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${HALFTIME.sel}`,
        color: HALFTIME.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>⏱ {COUNTDOWN}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
        {LAST_DRAW.map(n => (
          <span key={n} style={{
            width: isMobile ? 15 : 17, height: isMobile ? 15 : 17, borderRadius: '50%',
            background: n > 40 ? HALFTIME.under : HALFTIME.over, color: COLORS.white,
            fontSize: isMobile ? 7.5 : 8.5, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{n}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HALFTIME.sel, color: '#083a1b', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>和值 {LAST_SUM}</span>
    </div>
  )

  // ---- 珠盘路 ----
  const ROAD_COLS = 20
  const beads = HISTORY_SUMS.map((s, i) => beadFor(roadTab, s, HISTORY_HALF[i]))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? HALFTIME.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : HALFTIME.dim,
            border: `1px solid ${roadTab === t ? HALFTIME.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      {/* 6×20 珠盘格 — 竖排入珠（百家乐路样式），横向滚动不撑爆 */}
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 6.5 : 9, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
              }}>{b ? b.t : ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${HALFTIME.bgCenter}, ${HALFTIME.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.htCell:hover { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: HALFTIME.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>HALF TIME ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: HALFTIME.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${HALFTIME.gold}`, color: HALFTIME.gold,
            fontSize: 11, fontWeight: 900, letterSpacing: 2,
          }}>DEMO MODE</span>
        )}
        <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
          {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
        </span>
        <button type="button" onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
          width: 30, height: 30, borderRadius: RADIUS.pill,
          background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
          color: bgmOn ? COLORS.white : COLORS.textMuted,
          border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><MusicNoteIcon on={bgmOn} /></button>
        <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
          width: 30, height: 30, borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.3)', color: muted ? COLORS.textMuted : COLORS.white,
          border: '1px solid rgba(255,255,255,0.25)',
          cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><SpeakerIcon on={!muted} /></button>
      </div>

      {roundBar}

      {/* ---- middle zone: 盘区三行，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
      }}>
        {/* 行① Over/Under + Odd/Even + Parlay */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {ROW1.map(m => betCell(m))}
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : 2, display: 'flex', gap: isMobile ? 6 : 8 }}>
            {PARLAY.map(m => betCell(m, { compact: true }))}
          </div>
        </div>

        {/* 行② 球场五段 — 中场线贯穿，五格贴片 */}
        <div style={{
          position: 'relative', borderRadius: 12, padding: isMobile ? 6 : 8,
          background: HALFTIME.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{
            position: 'absolute', left: '50%', top: 6, bottom: 6, width: 1,
            background: 'rgba(255,255,255,0.18)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: isMobile ? 34 : 46, height: isMobile ? 34 : 46,
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: '50%',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', gap: isMobile ? 4 : 8, position: 'relative' }}>
            {ZONES.map(m => betCell(m))}
          </div>
        </div>

        {/* 行③ 1st Half / Draw / 2nd Half — 与上两行同左右边界，三等分撑满 */}
        <div style={{ display: 'flex', gap: isMobile ? 6 : 8, width: '100%' }}>
          {ROW3.map(m => betCell(m))}
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned, 全无逻辑 ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: HALFTIME.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          padding: '5px 18px', borderRadius: RADIUS.pill,
          background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
          textAlign: 'center', lineHeight: 1.2,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
          <input
            value={bet}
            onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
              color: COLORS.white, fontSize: 15, fontWeight: 900,
            }}
          />
        </div>
        {[10, 50, 100, 500].map(v => (
          <button key={v} type="button" onClick={() => setBet(v)} style={{
            ...circleBtn, width: 'auto', minWidth: 38, padding: '0 10px', height: 30,
            fontSize: 11,
            background: bet === v ? HALFTIME.selTint : HALFTIME.band,
            border: `1px solid ${bet === v ? HALFTIME.sel : 'rgba(255,255,255,0.35)'}`,
          }}>{v}</button>
        ))}
        <button type="button" style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: HALFTIME.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1, cursor: 'pointer',
        }}>▷ CONFIRM {selected.size > 0 ? `(${selected.size})` : ''}</button>
      </div>
    </Panel>
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Half Time</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024) ----
  return (
    <GameLayout title="Half Time" color={HALFTIME.sel}>
      {gameCard}
    </GameLayout>
  )
}
