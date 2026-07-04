import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, NUMBERUP } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Number Up — 两位数球衣号码彩（00–99）。纯 UI 骨架：全静态假数据，
// 无开奖逻辑、无余额读写、无音频副作用。盘面/珠盘路/注栏只做展示与按钮态。
//
// 盘区三行：
//   ① PICK 00–99 直选（10×10 网格，赔率 95 标区块头）
//   ② FIRST DIGIT 0–9 十格 9.5 / LAST DIGIT 0–9 十格 9.5
//   ③ HIGH(50–99) / LOW(00–49) / ODD / EVEN 各 1.91

// ---- 静态假数据（占位，接引擎时整体替换）----
const ROUND_ID = '20260705-001'
const COUNTDOWN = '00:31'
const LAST_NUM = 88
const RECENT = [88, 7, 42, 91, 15]   // 近 5 期（新→旧）
const pad2 = n => String(n).padStart(2, '0')

// 30 期假历史
const HIST_NUMS = [
  88, 7, 42, 91, 15, 63, 20, 55, 78, 4,
  31, 96, 12, 49, 70, 27, 84, 9, 58, 36,
  61, 3, 95, 18, 44, 72, 29, 87, 50, 6,
]

const PICK_ODDS = 95
const DIGIT_ODDS = 9.5
const SIDE_ODDS = 1.91
const SIDES = [
  { key: 's-high', name: 'HIGH', range: '50–99' },
  { key: 's-low',  name: 'LOW',  range: '00–49' },
  { key: 's-odd',  name: 'ODD',  range: '尾数单' },
  { key: 's-even', name: 'EVEN', range: '尾数双' },
]

const ROAD_TABS = ['NUMBER', 'DIGIT', 'H-L']
function beadFor(tab, n) {
  if (tab === 'NUMBER') return { t: pad2(n), c: n >= 50 ? NUMBERUP.hi : NUMBERUP.lo }
  if (tab === 'DIGIT') { const d = n % 10; return { t: String(d), c: d % 2 ? NUMBERUP.hi : NUMBERUP.lo } }
  return n >= 50 ? { t: 'H', c: NUMBERUP.hi } : { t: 'L', c: NUMBERUP.lo }
}

// 球衣号码小卡 — 白底圆角卡 + HiLo 同款球衣轮廓 + 两位数号码
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function NumberCard({ num, w = 26 }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: w, height: w * 1.18, borderRadius: Math.max(4, w * 0.16),
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    }}>
      <svg width={w * 0.8} height={w * 0.72} viewBox="0 0 100 90" style={{ display: 'block' }} aria-hidden="true">
        <path d={JERSEY_PATH} fill={NUMBERUP.jersey} stroke="rgba(0,0,0,0.3)" strokeWidth="2" strokeLinejoin="round" />
        <text x="50" y="66" textAnchor="middle" fontSize="36" fontWeight="900"
          fill="#ffffff" fontFamily="'Space Grotesk', sans-serif">{pad2(num)}</text>
      </svg>
    </span>
  )
}

export default function NumberUp({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk mode narrows the card by the 400px feed — below 1200px viewport the
  // centered DEMO pill would collide with the How-to-Play pill, so hide it
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)   // 纯视觉态 — 本游戏暂无 SFX
  const [bet, setBet] = useState(10)
  const [selected, setSelected] = useState(() => new Set())   // 按钮选中态，无逻辑
  const [roadTab, setRoadTab] = useState('NUMBER')
  const [feedBets] = useState(() => makeFeedBots())   // 展示用假注单

  const toggleSel = key => setSelected(s => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  // ---- 样式件（选中态照 Golden Boot 语言：金框 + 绿罩）----
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
        ? NUMBERUP.selTint
        : `linear-gradient(180deg, ${NUMBERUP.ctrl}, ${NUMBERUP.band})`,
      border: `1px solid ${sel ? NUMBERUP.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s',
      boxSizing: 'border-box',
    }
  }
  const cellName = { color: NUMBERUP.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: NUMBERUP.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: NUMBERUP.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const secHead = { color: NUMBERUP.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }

  // 10×10 网格格（两位数小字，选中亮金）
  const gridCell = n => {
    const key = `n-${pad2(n)}`
    const sel = selected.has(key)
    return (
      <button key={key} type="button" className="nuCell" onClick={() => toggleSel(key)} style={{
        height: isMobile ? 28 : 22, minWidth: 0, padding: 0,
        borderRadius: 6, cursor: 'pointer',
        background: sel ? NUMBERUP.gold : `linear-gradient(180deg, ${NUMBERUP.ctrl}, ${NUMBERUP.band})`,
        border: `1px solid ${sel ? NUMBERUP.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        color: sel ? '#3a2c00' : NUMBERUP.text,
        fontSize: isMobile ? 10.5 : 10, fontWeight: 800,
        fontFamily: "'Space Grotesk', sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box',
        transition: 'background 0.1s, box-shadow 0.1s',
      }}>{pad2(n)}</button>
    )
  }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '4px 10px', borderRadius: RADIUS.pill,
      background: NUMBERUP.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: NUMBERUP.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>#{ROUND_ID}</span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${NUMBERUP.sel}`,
        color: NUMBERUP.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>⏱ {COUNTDOWN}</span>
      <NumberCard num={LAST_NUM} w={isMobile ? 22 : 24} />
      {/* 近 5 期小号串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {RECENT.map((n, i) => (
          <span key={i} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: n >= 50 ? NUMBERUP.hi : NUMBERUP.lo, color: COLORS.white,
            fontSize: 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
          }}>{pad2(n)}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: NUMBERUP.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>NUMBER {pad2(LAST_NUM)}</span>
    </div>
  )

  // ---- 珠盘路 ----
  const ROAD_COLS = 20
  const beads = HIST_NUMS.map(n => beadFor(roadTab, n))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 10px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? NUMBERUP.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : NUMBERUP.dim,
            border: `1px solid ${roadTab === t ? NUMBERUP.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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
      background: `radial-gradient(circle at 50% 28%, ${NUMBERUP.bgCenter}, ${NUMBERUP.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.nuCell:hover { filter: brightness(1.3); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: NUMBERUP.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>NUMBER UP ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: NUMBERUP.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${NUMBERUP.gold}`, color: NUMBERUP.gold,
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

      {/* ---- middle zone: 盘区三行；PICK 网格空间不足时独立纵滚 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '10px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 8,
      }}>
        {/* 行① PICK 00–99 网格（flex 可收缩 + 内部纵滚兜底） */}
        <div style={{
          flex: '0 1 auto', minHeight: 130, overflowY: 'auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          boxSizing: 'border-box',
        }}>
          <div style={secHead}>PICK 00–99 · 直选 · 赔率 {PICK_ODDS.toFixed(2)}</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)',
            gap: isMobile ? 3 : 3,
          }}>
            {Array.from({ length: 100 }, (_, i) => gridCell(i))}
          </div>
        </div>

        {/* 行② FIRST / LAST DIGIT（desk 并列，mobile 堆叠） */}
        <div style={{
          flex: '0 0 auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', gap: isMobile ? 8 : 14,
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          {[
            { pre: 'fd', label: `FIRST DIGIT · 首位 · ${DIGIT_ODDS.toFixed(2)}` },
            { pre: 'ld', label: `LAST DIGIT · 尾数 · ${DIGIT_ODDS.toFixed(2)}` },
          ].map(g => (
            <div key={g.pre} style={{ flex: 1, minWidth: 0 }}>
              <div style={secHead}>{g.label}</div>
              <div style={{ display: 'flex', gap: isMobile ? 3 : 4 }}>
                {Array.from({ length: 10 }, (_, d) => (
                  <button key={d} type="button" className="nuCell" onClick={() => toggleSel(`${g.pre}-${d}`)}
                    style={{ ...cellBtn(`${g.pre}-${d}`, { compact: true }), padding: '4px 0' }}>
                    <span style={{ ...cellName, fontSize: isMobile ? 11 : 12 }}>{d}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 行③ HIGH / LOW / ODD / EVEN */}
        <div style={{
          flex: '0 0 auto',
          borderRadius: 12, padding: isMobile ? 6 : 8,
          background: NUMBERUP.strip, border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', gap: isMobile ? 5 : 8,
        }}>
          {SIDES.map(m => (
            <button key={m.key} type="button" className="nuCell" onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
              <span style={cellName}>{m.name}</span>
              <span style={cellRange}>{m.range}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5 }}>{SIDE_ODDS.toFixed(2)}</span>
            </button>
          ))}
        </div>
      </div>

      {beadRoad}

      {/* ---- bottom bet band — pinned, 全无逻辑 ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: NUMBERUP.band,
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
            background: bet === v ? NUMBERUP.selTint : NUMBERUP.band,
            border: `1px solid ${bet === v ? NUMBERUP.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: 'pointer',
          }}>{v}</button>
        ))}
        <button type="button" style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: NUMBERUP.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1, cursor: 'pointer',
        }}>▷ CONFIRM {selected.size > 0 ? `(${selected.size})` : ''}</button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Golden Boot ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Number Up</strong>
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
    <GameLayout title="Number Up" color={NUMBERUP.sel}>
      {gameCard}
    </GameLayout>
  )
}
