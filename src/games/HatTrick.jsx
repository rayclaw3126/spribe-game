import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HATTRICK } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Hat Trick — 快3三骰彩（三骰和值 + 豹子 + 对子），第 15 卡。
// 本单为纯 UI 骨架：零逻辑、零余额副作用、零随机数——倒计时/上期骰面/珠盘路
// 全部是硬编码种子数据；CONFIRM 只显示选格数不做任何事。引擎/状态机走后续单。
// 赔率全部为占位值（TOTAL 6–60 对称铺、豹子 30/180、对子 11），引擎单标定后再定稿。

// ---------- 静态种子数据（纯展示，零随机数）----------
const ROUND_DATE = '20260705'
const ROUND_NO = 2
const LAST_DICE = [5, 2, 5]          // 上期三骰 ⚄⚁⚄（CSS 点阵画，禁 emoji）
const LAST_TOTAL = 12                 // = 5+2+5
// 30 期假历史（骰面三元组，新→旧；含 2 期豹子：[2,2,2]、[6,6,6]）
const SEED_ROUNDS = [
  [5, 2, 5], [3, 1, 6], [4, 4, 2], [6, 5, 4], [2, 2, 2], [1, 3, 4], [5, 5, 3], [6, 1, 2], [4, 3, 3], [2, 5, 6],
  [1, 1, 4], [3, 6, 6], [2, 4, 5], [6, 6, 6], [1, 2, 3], [5, 4, 2], [3, 3, 5], [4, 6, 1], [2, 3, 3], [5, 6, 6],
  [1, 4, 4], [2, 6, 3], [4, 5, 5], [3, 2, 1], [6, 4, 3], [1, 5, 2], [6, 2, 4], [3, 5, 4], [2, 1, 1], [4, 2, 6],
]
const sumOf = d => d[0] + d[1] + d[2]
const isTriple = d => d[0] === d[1] && d[1] === d[2]
const RECENT_SUMS = SEED_ROUNDS.slice(0, 5).map(sumOf)   // 近 5 期和值（新→旧）

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'ht1', name: 'gunner', bet: 113, target: 2.4, status: 'live', payout: null },
  { id: 'ht2', name: 'rivera', bet: 16, target: 1.6, status: 'live', payout: null },
  { id: 'ht3', name: 'brix', bet: 461, target: 3.1, status: 'live', payout: null },
  { id: 'ht4', name: 'toons', bet: 221, target: 1.9, status: 'live', payout: null },
  { id: 'ht5', name: 'pace9', bet: 301, target: 4.5, status: 'live', payout: null },
  { id: 'ht6', name: 'forest', bet: 39, target: 2.2, status: 'live', payout: null },
  { id: 'ht7', name: 'sisu8', bet: 1, target: 1.3, status: 'live', payout: null },
  { id: 'ht8', name: 'tigres', bet: 12, target: 5.4, status: 'live', payout: null },
  { id: 'ht9', name: 'santer', bet: 203, target: 1.7, status: 'live', payout: null },
  { id: 'ht10', name: 'primo9', bet: 145, target: 2.9, status: 'live', payout: null },
  { id: 'ht11', name: 'glazer', bet: 228, target: 3.6, status: 'live', payout: null },
  { id: 'ht12', name: 'vasco', bet: 65, target: 1.4, status: 'live', payout: null },
  { id: 'ht13', name: 'toledo', bet: 463, target: 2.1, status: 'live', payout: null },
  { id: 'ht14', name: 'ramos', bet: 26, target: 6.2, status: 'live', payout: null },
  { id: 'ht15', name: 'fuerte', bet: 25, target: 1.8, status: 'live', payout: null },
  { id: 'ht16', name: 'gomez', bet: 134, target: 2.7, status: 'live', payout: null },
  { id: 'ht17', name: 'pique2', bet: 150, target: 3.3, status: 'live', payout: null },
  { id: 'ht18', name: 'baros', bet: 49, target: 1.5, status: 'live', payout: null },
  { id: 'ht19', name: 'wing1', bet: 56, target: 4.1, status: 'live', payout: null },
  { id: 'ht20', name: 'dinho7', bet: 88, target: 2.0, status: 'live', payout: null },
]

// ---------- 占位赔率（对称铺 6–60；引擎单按真实概率标定 94–97.5% 带）----------
const TOTAL_ODDS = {
  4: 60, 5: 30, 6: 18, 7: 12, 8: 8, 9: 7, 10: 6,
  11: 6, 12: 7, 13: 8, 14: 12, 15: 18, 16: 30, 17: 60,
}
const SIDE_ODDS = 1.95        // BIG / SMALL / ODD / EVEN（豹子通杀）
const ANY_TRIPLE_ODDS = 30    // 任意豹子
const TRIPLE_ODDS = 180       // 指定三同
const DOUBLE_ODDS = 11        // 指定对子

const SIDES = [
  { key: 's-big',   name: 'BIG',   range: '11–17' },
  { key: 's-small', name: 'SMALL', range: '4–10' },
  { key: 's-odd',   name: 'ODD',   range: '和值单' },
  { key: 's-even',  name: 'EVEN',  range: '和值双' },
]

// ---------- 骰面（CSS 点阵，size 参数化；禁 emoji 禁图）----------
// 3×3 宫格索引：0 1 2 / 3 4 5 / 6 7 8
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}
function DieFace({ v, size = 18 }) {
  const dot = Math.max(2.5, size * 0.17)
  return (
    <span aria-label={`骰面 ${v}`} style={{
      width: size, height: size, borderRadius: Math.max(3, size * 0.2),
      background: HATTRICK.face, border: '1px solid rgba(0,0,0,0.3)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      display: 'inline-grid',
      gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: Math.max(2, size * 0.14), boxSizing: 'border-box', flex: '0 0 auto',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{
          alignSelf: 'center', justifySelf: 'center',
          width: dot, height: dot, borderRadius: '50%',
          background: PIPS[v].includes(i) ? HATTRICK.pip : 'transparent',
        }} />
      ))}
    </span>
  )
}

// ---------- 珠盘路 ----------
const ROAD_TABS = ['TOTAL', 'B-S', 'TRIPLE']
function beadFor(tab, dice) {
  const s = sumOf(dice)
  if (tab === 'TOTAL') return { t: String(s), c: s >= 11 ? HATTRICK.big : HATTRICK.small }
  if (tab === 'B-S') {
    if (isTriple(dice)) return { t: 'T', c: HATTRICK.gold, dark: true }   // 豹子通杀期
    return s >= 11 ? { t: 'B', c: HATTRICK.big } : { t: 'S', c: HATTRICK.small }
  }
  // TRIPLE 页：豹子期金珠，其余灰珠
  return isTriple(dice)
    ? { t: String(dice[0]), c: HATTRICK.gold, dark: true }
    : { t: '', c: 'rgba(255,255,255,0.14)' }
}

export default function HatTrick({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [roadTab, setRoadTab] = useState('TOTAL')

  // 纯 UI 选中态切换 — 不扣款不入账，CONFIRM 无逻辑
  const toggleSel = key => {
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  // ---- 样式件（选中 = 金框绿罩，照 Number Up 语言）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBtn = (key, { compact = false } = {}) => {
    const sel = picks.has(key)
    return {
      flex: 1, minWidth: 0, padding: compact ? '5px 2px' : '8px 4px',
      borderRadius: 10, cursor: 'pointer',
      background: sel
        ? HATTRICK.selTint
        : `linear-gradient(180deg, ${HATTRICK.ctrl}, ${HATTRICK.band})`,
      border: `1px solid ${sel ? HATTRICK.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: sel ? '0 0 10px rgba(255,213,79,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      transition: 'filter 0.12s, background 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: HATTRICK.text, fontSize: isMobile ? 10 : 11.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: HATTRICK.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: HATTRICK.gold, fontSize: isMobile ? 10.5 : 12.5, fontWeight: 900 }
  const secHead = { color: HATTRICK.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 6 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isMobile ? 6 : 8,
    background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }

  // TOTAL 4–17 小格（desk 14 连排 / mobile 7×2 折行不挤爆）
  const totalCell = s => {
    const key = `t-${s}`
    const sel = picks.has(key)
    return (
      <button key={key} type="button" className="htCell" onClick={() => toggleSel(key)} style={{
        minWidth: 0, padding: '4px 0',
        borderRadius: 8, cursor: 'pointer',
        background: sel ? HATTRICK.selTint : `linear-gradient(180deg, ${HATTRICK.ctrl}, ${HATTRICK.band})`,
        border: `1px solid ${sel ? HATTRICK.gold : 'rgba(255,255,255,0.14)'}`,
        boxShadow: sel ? '0 0 8px rgba(255,213,79,0.5)' : 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        boxSizing: 'border-box', transition: 'background 0.1s, box-shadow 0.1s',
      }}>
        <span style={{
          color: HATTRICK.text, fontSize: isMobile ? 12 : 13, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{s}</span>
        <span style={{ color: HATTRICK.gold, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800 }}>{TOTAL_ODDS[s]}</span>
      </button>
    )
  }

  // ---- 轮次条（desk 走骨架 34px 历史行位）----
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '4px 10px', borderRadius: RADIUS.pill,
      background: HATTRICK.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{ color: HATTRICK.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
        #{ROUND_DATE}-{String(ROUND_NO).padStart(3, '0')}
      </span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${HATTRICK.sel}`,
        color: HATTRICK.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>⏱ 00:26</span>
      {/* 上期三骰迷你面（CSS 点阵） */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {LAST_DICE.map((v, i) => <DieFace key={i} v={v} size={isMobile ? 16 : 18} />)}
      </span>
      {/* 近 5 期和值小串（新→旧） */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {RECENT_SUMS.map((s, i) => (
          <span key={i} style={{
            padding: '1px 7px', borderRadius: RADIUS.pill,
            background: s >= 11 ? HATTRICK.big : HATTRICK.small, color: COLORS.white,
            fontSize: 9.5, fontWeight: 900, opacity: i === 0 ? 1 : 0.75,
          }}>{s}</span>
        ))}
      </span>
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: HATTRICK.gold, color: '#3a2c00', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>TOTAL {LAST_TOTAL}</span>
    </div>
  )

  // ---- 珠盘路（6×20，30 期种子历史）----
  const ROAD_COLS = 20
  const beads = SEED_ROUNDS.map(d => beadFor(roadTab, d))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 10px' : '0 18px 10px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 12px', borderRadius: RADIUS.pill,
            background: roadTab === t ? HATTRICK.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : HATTRICK.dim,
            border: `1px solid ${roadTab === t ? HATTRICK.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 10, fontWeight: 900, letterSpacing: 0.5, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: HATTRICK.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
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
                color: b?.dark ? '#3a2c00' : COLORS.white,
                fontSize: b && b.t.length > 1 ? 7 : 9, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${HATTRICK.bgCenter}, ${HATTRICK.bgOuter})`,
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
        background: HATTRICK.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>HAT TRICK ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: HATTRICK.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${HATTRICK.gold}`, color: HATTRICK.gold,
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

      {/* ---- middle zone: 盘区三行 ---- */}
      <div style={{
        flex: 1, minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: isMobile ? '10px 12px' : '10px 18px', boxSizing: 'border-box',
        gap: isMobile ? 8 : 8, overflowY: 'auto',
      }}>
        {/* 行① TOTAL：4–17 十四小格 + 大小单双四大格（豹子通杀） */}
        <div style={secBox}>
          <div style={secHead}>TOTAL · 和值 4–17</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(7, 1fr)' : 'repeat(14, 1fr)',
            gap: isMobile ? 3 : 4, marginBottom: isMobile ? 6 : 8,
          }}>
            {Array.from({ length: 14 }, (_, i) => totalCell(i + 4))}
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
            {SIDES.map(m => (
              <button key={m.key} type="button" className="htCell" onClick={() => toggleSel(m.key)} style={cellBtn(m.key, { compact: true })}>
                <span style={cellName}>{m.name}</span>
                <span style={cellRange}>{m.range}</span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 10 : 11.5 }}>{SIDE_ODDS.toFixed(2)}</span>
                <span style={{ color: HATTRICK.dim, fontSize: isMobile ? 7.5 : 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Triple loses</span>
              </button>
            ))}
          </div>
        </div>

        {/* 行② HAT TRICK：任意豹子 + 指定三同六格 */}
        <div style={secBox}>
          <div style={secHead}>HAT TRICK · 豹子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <button type="button" className="htCell" onClick={() => toggleSel('tr-any')}
              style={{ ...cellBtn('tr-any'), ...(isMobile ? { flex: '1 1 100%' } : { flex: 1.6 }) }}>
              <span style={cellName}>ANY TRIPLE</span>
              <span style={cellRange}>任意豹子</span>
              <span style={cellOdds}>{ANY_TRIPLE_ODDS.toFixed(2)}</span>
            </button>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className="htCell" onClick={() => toggleSel(`tr-${v}`)}
                style={{ ...cellBtn(`tr-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 13 : 15} />)}
                </span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11 }}>{TRIPLE_ODDS.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 行③ DOUBLE：指定对子六格 */}
        <div style={secBox}>
          <div style={secHead}>DOUBLE · 对子</div>
          <div style={{ display: 'flex', gap: isMobile ? 5 : 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            {Array.from({ length: 6 }, (_, i) => i + 1).map(v => (
              <button key={v} type="button" className="htCell" onClick={() => toggleSel(`d-${v}`)}
                style={{ ...cellBtn(`d-${v}`, { compact: true }), ...(isMobile ? { flex: '1 1 30%' } : {}) }}>
                <span style={{ display: 'flex', gap: 2 }}>
                  {[v, v].map((d, i) => <DieFace key={i} v={d} size={isMobile ? 14 : 16} />)}
                </span>
                <span style={{ ...cellOdds, fontSize: isMobile ? 9.5 : 11 }}>{DOUBLE_ODDS.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- 珠盘路 ---- */}
      {beadRoad}

      {/* ---- bottom bet band — pinned（全无逻辑：CONFIRM 只显示选格数）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '12px 14px',
        background: HATTRICK.band,
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
            background: bet === v ? HATTRICK.selTint : HATTRICK.band,
            border: `1px solid ${bet === v ? HATTRICK.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: 'pointer',
          }}>{v}</button>
        ))}
        <button type="button" style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: HATTRICK.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: 'default', opacity: picks.size > 0 ? 1 : 0.55,
        }}>
          ▷ CONFIRM{picks.size > 0 ? ` (${picks.size})` : ''}
        </button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Number Up ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Hat Trick</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={SEED_FEED} myBets={[]} online={914} fill />
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
    <GameLayout title="Hat Trick" color={HATTRICK.sel}>
      {gameCard}
    </GameLayout>
  )
}
