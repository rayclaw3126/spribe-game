import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, GOLDENBOOT } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Golden Boot — 10 球员冲刺排名彩（足球皮）。纯 UI 骨架：全静态假数据，
// 无开奖逻辑、无余额读写、无音频副作用。盘面/珠盘路/注栏只做展示与按钮态。
//
// 盘区三族：
//   ① WINNER 冠军直选 1–10（赔率占位统一 9.60）
//   ② SPRINT SUM 冠亚和 3–19 直选 + BIG/SMALL/ODD/EVEN
//   ③ DUELS 龙虎五对 1v10 / 2v9 / 3v8 / 4v7 / 5v6

// ---- 静态假数据（占位，接引擎时整体替换）----
const ROUND_ID = '20260705-001'
const COUNTDOWN = '00:38'
const LAST_RANKING = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6]   // 按名次排（冠军在首）
const LAST_CHAMP = LAST_RANKING[0]

// 30 期假历史：冠军号 / 冠亚和 / 首对(1v10)龙虎
const HIST_WINNERS = [3, 7, 1, 9, 2, 10, 5, 8, 4, 6, 2, 8, 1, 4, 10, 6, 3, 9, 7, 5, 1, 6, 4, 2, 9, 3, 10, 8, 5, 7]
const HIST_SUMS = [10, 9, 4, 13, 12, 16, 8, 14, 7, 11, 5, 15, 3, 9, 17, 10, 6, 12, 19, 8, 11, 7, 13, 5, 16, 9, 4, 18, 12, 10]
const HIST_DUEL = 'DTDDTTDTDTDDTTDTDDTTDDTTDDTTDT'.split('')

// ---- 盘面定义（赔率全为占位）----
const WINNER_ODDS = 9.6
const SUM_ODDS = { 3: 40, 4: 34, 5: 28, 6: 22, 7: 17, 8: 13, 9: 10, 10: 8.5, 11: 8, 12: 8.5, 13: 10, 14: 13, 15: 17, 16: 22, 17: 28, 18: 34, 19: 40 }
const SUM_SIDES = [
  { key: 's-big',   name: 'BIG',   range: '12–19', odds: 2.30 },
  { key: 's-small', name: 'SMALL', range: '3–11',  odds: 1.75 },
  { key: 's-odd',   name: 'ODD',   range: '和为单', odds: 1.95 },
  { key: 's-even',  name: 'EVEN',  range: '和为双', odds: 1.95 },
]
const DUELS = [
  { key: 'd1', label: '1 v 10', d: 1, t: 10 },
  { key: 'd2', label: '2 v 9',  d: 2, t: 9 },
  { key: 'd3', label: '3 v 8',  d: 3, t: 8 },
  { key: 'd4', label: '4 v 7',  d: 4, t: 7 },
  { key: 'd5', label: '5 v 6',  d: 5, t: 6 },
]
const DUEL_ODDS = 1.95

const ROAD_TABS = ['WINNER', 'SUM', 'DUELS']
function beadFor(tab, i) {
  if (tab === 'WINNER') {
    const n = HIST_WINNERS[i]
    return { t: String(n), c: n <= 5 ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
  }
  if (tab === 'SUM') {
    const s = HIST_SUMS[i]
    return s >= 12 ? { t: 'B', c: GOLDENBOOT.dragon } : { t: 'S', c: GOLDENBOOT.tiger }
  }
  const d = HIST_DUEL[i]
  return { t: d, c: d === 'D' ? GOLDENBOOT.dragon : GOLDENBOOT.tiger }
}

// 金靴球衣珠 — 迷你球衣轮廓 + 号码（金渐变，共享 gold/fire/goldDeep）
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function JerseyBead({ num, size = 16, dim = false }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 100 90" style={{ display: 'block', opacity: dim ? 0.75 : 1 }} aria-hidden="true">
      <defs>
        <linearGradient id="gbJersey" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GOLDENBOOT.gold} />
          <stop offset="55%" stopColor={GOLDENBOOT.fire} />
          <stop offset="100%" stopColor={GOLDENBOOT.goldDeep} />
        </linearGradient>
      </defs>
      <path d={JERSEY_PATH} fill="url(#gbJersey)" stroke="rgba(0,0,0,0.35)" strokeWidth="2" strokeLinejoin="round" />
      {num != null && (
        <text x="50" y="64" textAnchor="middle" fontSize="38" fontWeight="900"
          fill="#3a2c00" fontFamily="'Space Grotesk', sans-serif">{num}</text>
      )}
    </svg>
  )
}

export default function GoldenBoot({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)   // 纯视觉态 — 本游戏暂无 SFX
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState(() => new Set())   // 按钮选中态，无逻辑
  const [roadTab, setRoadTab] = useState('WINNER')
  const [feedBets] = useState(() => makeFeedBots())   // 展示用假注单

  const toggleSel = key => setSelected(s => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  // ---- 样式件（选中态照 Half Time 语言：金框 + 绿罩）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = selected.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: 'pointer',
      background: sel
        ? GOLDENBOOT.selTint
        : `linear-gradient(180deg, ${GOLDENBOOT.ctrl}, ${GOLDENBOOT.band})`,
      border: `1px solid ${sel ? GOLDENBOOT.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: sel ? `0 0 10px rgba(255,213,79,0.35)` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s',
      boxSizing: 'border-box',
    }
  }
  const cellName = { color: GOLDENBOOT.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: GOLDENBOOT.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: GOLDENBOOT.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '6px 10px', borderRadius: RADIUS.pill,
      background: GOLDENBOOT.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: GOLDENBOOT.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>#{ROUND_ID}</span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${GOLDENBOOT.sel}`,
        color: GOLDENBOOT.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>⏱ {COUNTDOWN}</span>
      {/* 上期名次串 — 名次序（冠军最左），珠上是球员号 */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', minWidth: 0 }}>
        {LAST_RANKING.map((n, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }} title={`第${i + 1}名`}>
            <JerseyBead num={n} size={isMobile ? 15 : 18} dim={i > 2} />
          </span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 12px 2px 6px', borderRadius: RADIUS.pill,
        background: GOLDENBOOT.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>
        <JerseyBead num={LAST_CHAMP} size={20} />
        WINNER #{LAST_CHAMP}
      </span>
    </div>
  )

  // ---- 珠盘路 ----
  const ROAD_COLS = 20
  const beads = HIST_WINNERS.map((_, i) => beadFor(roadTab, i))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 12px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? GOLDENBOOT.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : GOLDENBOOT.dim,
            border: `1px solid ${roadTab === t ? GOLDENBOOT.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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
                color: COLORS.white, fontSize: b && b.t.length > 1 ? 7 : 9, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${GOLDENBOOT.bgCenter}, ${GOLDENBOOT.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.gbCell:hover { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: GOLDENBOOT.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>GOLDEN BOOT ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: GOLDENBOOT.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${GOLDENBOOT.gold}`, color: GOLDENBOOT.gold,
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

      {/* 轮次条 — desk 在骨架历史行，卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ---- middle zone: 盘区三族，垂直居中 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '12px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 10,
      }}>
        {/* 族① WINNER 冠军直选 1–10 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>WINNER · 冠军直选</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} type="button" className="gbCell" onClick={() => toggleSel(`w-${n}`)}
                style={{ ...cellBtn(`w-${n}`), flexBasis: isMobile ? '17%' : 0 }}>
                <JerseyBead num={n} size={isMobile ? 20 : 26} />
                <span style={cellOdds}>{WINNER_ODDS.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 族② SPRINT SUM 冠亚和 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>SPRINT SUM · 冠亚和</div>
          <div style={{ display: 'flex', gap: isMobile ? 4 : 5, flexWrap: 'wrap', marginBottom: isMobile ? 6 : 8 }}>
            {Object.keys(SUM_ODDS).map(s => (
              <button key={s} type="button" className="gbCell" onClick={() => toggleSel(`sum-${s}`)}
                style={{ ...cellBtn(`sum-${s}`, { compact: true }), flexBasis: isMobile ? '14%' : 0, minWidth: isMobile ? 0 : 42 }}>
                <span style={{ ...cellName, fontSize: isMobile ? 11 : 12.5 }}>{s}</span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9 : 10.5 }}>{SUM_ODDS[s].toFixed(1)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {SUM_SIDES.map(m => (
              <button key={m.key} type="button" className="gbCell" onClick={() => toggleSel(m.key)} style={cellBtn(m.key)}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span style={cellOdds}>{m.odds.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 族③ DUELS 龙虎五对 */}
        <div style={{
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: GOLDENBOOT.strip, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: GOLDENBOOT.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }}>DUELS · 龙虎对决</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: 'wrap' }}>
            {DUELS.map(p => (
              <div key={p.key} style={{
                flex: 1, minWidth: isMobile ? '30%' : 0,
                display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
              }}>
                <span style={{ textAlign: 'center', color: GOLDENBOOT.dim, fontSize: 9.5, fontWeight: 800 }}>{p.label}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="gbCell" onClick={() => toggleSel(`${p.key}-d`)}
                    style={{ ...cellBtn(`${p.key}-d`, { compact: true }) }}>
                    <span style={{ ...cellName, color: GOLDENBOOT.dragon, fontSize: 9.5 }}>DRAGON</span>
                    <span style={cellRange}>#{p.d}</span>
                    <span style={{ ...cellOdds, fontSize: 10.5 }}>{DUEL_ODDS.toFixed(2)}</span>
                  </button>
                  <button type="button" className="gbCell" onClick={() => toggleSel(`${p.key}-t`)}
                    style={{ ...cellBtn(`${p.key}-t`, { compact: true }) }}>
                    <span style={{ ...cellName, color: GOLDENBOOT.tiger, fontSize: 9.5 }}>TIGER</span>
                    <span style={cellRange}>#{p.t}</span>
                    <span style={{ ...cellOdds, fontSize: 10.5 }}>{DUEL_ODDS.toFixed(2)}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned, 全无逻辑 ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: GOLDENBOOT.band,
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
            minWidth: 38, padding: '0 10px', height: 30, borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
            background: bet === v ? GOLDENBOOT.selTint : GOLDENBOOT.band,
            border: `1px solid ${bet === v ? GOLDENBOOT.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: 'pointer',
          }}>{v}</button>
        ))}
        <button type="button" style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: GOLDENBOOT.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1, cursor: 'pointer',
        }}>▷ CONFIRM {selected.size > 0 ? `(${selected.size})` : ''}</button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Half Time ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Golden Boot</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 轮次条占骨架历史行位（34px 行惯例） */}
            <div style={{ flex: '0 0 auto', minHeight: LAYOUT.historyH }}>
              {roundBar}
            </div>
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
    <GameLayout title="Golden Boot" color={GOLDENBOOT.gold}>
      {gameCard}
    </GameLayout>
  )
}
