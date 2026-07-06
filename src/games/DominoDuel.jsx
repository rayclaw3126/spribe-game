import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import { makeFeedBots } from '../components/shell/arenaFx'
import GameTopBar from '../components/shell/GameTopBar'

// Domino Duel — 骨牌版主客对决（闲庄→主蓝客红），第 21 卡。
// X1 纯视觉骨架：零算钱、零引擎、零 RTP（占位赔率 + useState 选中态）。
//   对决区/骨牌/开奖舞台均为静态占位；翻牌动画 + 结算引擎留给后续单。

const VENUE = 'ONYX ARENA'
const ROUND_DATE = 'OA20260706'

// 多米诺点位（0-6，3×3 宫格索引；照 DieFace 先例）
const DOMPIPS = {
  0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8],
  4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

// 占位对决数据：各方两张骨牌（每张两半 0-6），总分 = pip 和 mod 10（牌九式 → 0-9）
const HOME = { name: '主队', tiles: [[3, 2], [1, 1]] }   // 和 7 → 大·单
const AWAY = { name: '客队', tiles: [[2, 1], [0, 1]] }   // 和 4 → 小·双
const scoreOf = t => t.flat().reduce((a, b) => a + b, 0) % 10

// 珠盘路占位（主/平/客）
const SEED_ROAD = [
  '主', '客', '主', '平', '客', '主', '客', '主', '主', '客',
  '平', '主', '客', '主', '客', '主', '主', '客', '平', '主',
  '客', '主', '客', '主', '主', '客', '主', '平', '客', '主',
  '主', '客', '主', '客', '主', '平', '客', '主', '主', '客',
]

// 盘口占位赔率（X1 静态；X2 引擎再动态）
const MAIN = [
  { slot: 'home-win', name: '主队胜', odds: '1.95', bg: DERBY.home },
  { slot: 'draw', name: '平局', odds: '9.00', bg: DERBY.grey },
  { slot: 'away-win', name: '客队胜', odds: '1.95', bg: DERBY.away },
]
const totalRow = side => [
  { slot: `${side}-big`, name: '大', range: '5-9', odds: '1.96' },
  { slot: `${side}-small`, name: '小', range: '0-4', odds: '1.94' },
  { slot: `${side}-odd`, name: '单', range: '', odds: '1.92' },
  { slot: `${side}-even`, name: '双', range: '', odds: '1.98' },
]
// 全场总进球 大小单双（占位赔率；X2 定真值）
const GOALS = [
  { slot: 'g-big', name: '大', range: '3+', odds: '1.90' },
  { slot: 'g-small', name: '小', range: '0-2', odds: '1.90' },
  { slot: 'g-odd', name: '单', range: '', odds: '1.95' },
  { slot: 'g-even', name: '双', range: '', odds: '1.95' },
]
// 正确比分 · 波胆 3列×3行（列=主胜/平/客胜，行序填充，占位高赔）
const CORRECT = [
  { slot: 'cs-1-0', score: '1:0', odds: '6.50' }, { slot: 'cs-0-0', score: '0:0', odds: '8.00' }, { slot: 'cs-0-1', score: '0:1', odds: '6.50' },
  { slot: 'cs-2-1', score: '2:1', odds: '7.50' }, { slot: 'cs-1-1', score: '1:1', odds: '6.00' }, { slot: 'cs-1-2', score: '1:2', odds: '7.50' },
  { slot: 'cs-3-1', score: '3:1', odds: '12.0' }, { slot: 'cs-2-2', score: '2:2', odds: '15.0' }, { slot: 'cs-1-3', score: '1:3', odds: '18.0' },
]

// 单张多米诺（竖向：上半 / 分隔线 / 下半，各半画 pip 点）
function DominoTile({ a, b, size = 34 }) {
  const half = (v, key) => (
    <div key={key} style={{
      width: size, height: size, position: 'relative',
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
      padding: size * 0.12, boxSizing: 'border-box',
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {DOMPIPS[v].includes(i) && (
            <span style={{ width: size * 0.16, height: size * 0.16, borderRadius: '50%', background: '#10131a' }} />
          )}
        </span>
      ))}
    </div>
  )
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#f4f6fb', borderRadius: size * 0.16,
      border: '1px solid rgba(0,0,0,0.35)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      overflow: 'hidden',
    }}>
      {half(a, 'a')}
      <div style={{ height: 2, background: 'rgba(0,0,0,0.35)' }} />
      {half(b, 'b')}
    </div>
  )
}

export default function DominoDuel({ balance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [feedBets] = useState(() => makeFeedBots())
  const roundNo = 42

  // 纯视觉选中态（不算钱、不扣余额）
  const toggleSel = key => setPicks(s => {
    const n = new Set(s)
    n.has(key) ? n.delete(key) : n.add(key)
    return n
  })

  const confirmTotal = bet * picks.size

  // ---- 样式件 ----
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 4 : 5,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', boxSizing: 'border-box',
  }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    return {
      flex: 1, minWidth: 0, borderRadius: 10, cursor: 'pointer', background: bg,
      border: `1.5px solid ${sel ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const rowCell = (slot, name, range, odds, bg = DERBY.grey) => (
    <button key={slot} type="button" className="ddCell" onClick={() => toggleSel(slot)}
      style={{
        ...cellBase(slot, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '6px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
      <span style={cellOdds}>{odds}</span>
    </button>
  )
  // 紧凑竖排（抄 Hat Trick SIDES：名 / 范围小字 / 赔率，各行 nowrap；总分 8 格用，防挤爆）
  const colCell = (slot, name, range, odds, bg = DERBY.grey) => (
    <button key={slot} type="button" className="ddCell" onClick={() => toggleSel(slot)}
      style={{ ...cellBase(slot, bg), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={cellName}>{name}</span>
      {range ? <span style={cellRange}>{range}</span> : null}
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{odds}</span>
    </button>
  )

  // ---- 顶栏 ----
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.sel}`,
      color: DERBY.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>⏱ 押注 00:20</span>
  )
  const topBar = (
    <GameTopBar gameName="DOMINO DUEL" venue={VENUE}
      roundId={`${ROUND_DATE}-${String(roundNo).padStart(3, '0')}`}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 对决区：主(蓝) VS 客(红)，各两张骨牌 + 比分（静态占位）----
  const tileSz = isMobile ? 28 : 32
  const teamBlock = (team, color) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
      <span style={{
        padding: '2px 12px', borderRadius: RADIUS.pill, background: color,
        color: COLORS.white, fontSize: isMobile ? 11 : 12, fontWeight: 900, letterSpacing: 0.5,
      }}>{team.name}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {team.tiles.map((t, i) => <DominoTile key={i} a={t[0]} b={t[1]} size={tileSz} />)}
      </div>
      <span style={{
        color: COLORS.white, fontSize: isMobile ? 22 : 26, fontWeight: 900,
        fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 10px ${color}`,
      }}>{scoreOf(team.tiles)}</span>
    </div>
  )
  const duelZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '10px 8px' : '10px 18px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 14 : 30, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {teamBlock(HOME, DERBY.home)}
      <span style={{ color: DERBY.gold, fontSize: isMobile ? 16 : 20, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif", flex: '0 0 auto' }}>VS</span>
      {teamBlock(AWAY, DERBY.away)}
    </div>
  )

  // ---- ② 盘区：主要盘 + 主/客总分大小单双 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主要盘 · 主胜 / 平 / 客胜</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {MAIN.map(m => rowCell(m.slot, m.name, '', m.odds, m.bg))}
      </div>
    </div>
  )
  const totalBoard = (side, label, tint) => (
    <div style={secBox}>
      <div style={secHead}>{label} · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {totalRow(side).map(m => colCell(m.slot, m.name, m.range, m.odds, tint))}
      </div>
    </div>
  )
  // 全场总进球（竖排 colCell）
  const goalsBoard = (
    <div style={secBox}>
      <div style={secHead}>全场总进球 · 大小单双</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {GOALS.map(m => colCell(m.slot, m.name, m.range, m.odds))}
      </div>
    </div>
  )
  // 正确比分 · 波胆（网格：比分大字 + 占位高赔竖排）
  const scoreCell = m => (
    <button key={m.slot} type="button" className="ddCell" onClick={() => toggleSel(m.slot)}
      style={{ ...cellBase(m.slot, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px', gap: 2 }}>
      <span style={{ ...cellName, fontFamily: "'Space Grotesk', sans-serif" }}>{m.score}</span>
      <span style={{ ...cellOdds, whiteSpace: 'nowrap' }}>{m.odds}</span>
    </button>
  )
  const correctBoard = (
    <div style={secBox}>
      <div style={secHead}>正确比分 · 波胆</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 5 : 8 }}>
        {CORRECT.map(scoreCell)}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（主/平/客占位）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const beadRoad = (
    <div style={{ flex: '0 0 auto', position: 'relative', zIndex: 1, margin: isMobile ? '0 12px 8px' : '0 18px 8px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill, background: DERBY.sel, color: '#083a1b',
          border: `1px solid ${DERBY.sel}`, fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>主客走势</span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: 10, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6 }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = SEED_ROAD[i]
            const c = t === '主' ? DERBY.home : t === '客' ? DERBY.away : DERBY.grey
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: t ? c : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
              }}>{t || ''}</span>
            )
          })}
        </div>
      </div>
    </div>
  )

  const gameCard = (
    <Panel style={{
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.ddCell:hover { filter: brightness(1.2); }`}</style>
      {topBar}
      {duelZone}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box', gap: 5, overflowY: 'auto',
      }}>
        {mainBoard}
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 5, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('h', '主队总分', DERBY.grey)}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{totalBoard('a', '客队总分', DERBY.grey)}</div>
        </div>
        {goalsBoard}
        {correctBoard}
      </div>
      <div style={{ flex: '1 0 auto' }} />
      {beadRoad}

      {/* ---- 底部下注栏 grid 4×2（抄 Rolling Ball；X1 无重复功能，↻重复 恒置灰）---- */}
      <div style={{
        flex: '0 0 auto', padding: '6px 12px', background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)', position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)', gap: 6, maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="ddChip" onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row, width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: 'pointer', boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>USD</span>
            <input value={bet} onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none', color: COLORS.white, fontSize: 14, fontWeight: 900 }} />
          </div>
          <button type="button" disabled style={{
            gridColumn: 3, gridRow: 2, width: '100%', height: '100%', borderRadius: 8,
            fontSize: 11, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: DERBY.dim, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'not-allowed', opacity: 0.5, boxSizing: 'border-box',
          }}>↻ 重复</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            <BetButton
              state="bet"
              label={`下注 ${picks.size} 格`}
              sub={`$${confirmTotal.toFixed(0)}`}
              onClick={() => {}}
              disabled={picks.size === 0}
              stretch
            />
          </div>
        </div>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024) ----
  if (isDesk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640, background: COLORS.bg }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Domino Duel</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ flex: 1, minHeight: 0 }}>{gameCard}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <GameLayout title="Domino Duel" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
