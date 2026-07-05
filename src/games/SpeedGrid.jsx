import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY, ROULETTE } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import GameTopBar from '../components/shell/GameTopBar'

// Speed Grid — DD24 结构 F1 皮（24 车号开一冠军），第 18 卡。
// 本单 X1：纯 UI 骨架——零逻辑、零余额副作用、零随机数；开奖区/珠盘路/倒计时
// 全部硬编码种子数据，下注钮只显示选格数不做任何事。引擎/状态机走后续单。
// 规则源：help.sbobet.com 站内检索无 DD24 文章（2026-07-05 实查 0 命中），
// 赔率用已知表【全部待核，X2 核后定稿】：
//   大小 [13-24 / 1-12] 1.95、单双 1.95、红黑 1.95（红黑号码归类待核）、
//   发车三段（头排1-8 / 中段9-16 / 尾排17-24，即第1/2/3个8）2.90、
//   24 车号直选 22.85；车队涂装盘规则无源 → 赔率占位 --（照 Derby 半全场先例）。
// 布局照 Line Up 定案：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底（grid 4列×2行）。

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'TOPAZ CIRCUIT'          // 架空赛道名（对齐 AMBER DOME 系，禁真实赛道名）
const ROUND_ID = 'TC20260705-088'
const CHAMP = 17                        // 上局冠军车号（写死占位）

// 4 队涂装（色值全部 tokens 现组）：蓝=DERBY.home / 红=DERBY.away /
// 金=COLORS.amberDeep / 黑=ROULETTE.black；每队 6 车按号段分组
const TEAMS = [
  { name: '蓝队', range: '1-6', c: DERBY.home },
  { name: '红队', range: '7-12', c: DERBY.away },
  { name: '金队', range: '13-18', c: COLORS.amberDeep },
  { name: '黑队', range: '19-24', c: ROULETTE.black },
]
const teamOf = n => TEAMS[Math.floor((n - 1) / 6)]

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动）
const SEED_ROAD = [
  '大', '小', '小', '大', '小', '大', '大', '小', '小', '大',
  '大', '小', '大', '大', '小', '大', '小', '小', '大', '大',
  '小', '大', '小', '小', '大', '小', '大', '大', '大', '小',
  '小', '大', '小', '大', '小', '小', '大', '小', '大', '小',
]

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'sg1', name: 'apexr', bet: 172, target: 1.9, status: 'live', payout: null },
  { id: 'sg2', name: 'boxbox', bet: 45, target: 2.9, status: 'live', payout: null },
  { id: 'sg3', name: 'slick9', bet: 310, target: 1.6, status: 'live', payout: null },
  { id: 'sg4', name: 'chicane', bet: 128, target: 3.2, status: 'live', payout: null },
  { id: 'sg5', name: 'grid17', bet: 460, target: 1.4, status: 'live', payout: null },
  { id: 'sg6', name: 'poleman', bet: 72, target: 2.8, status: 'live', payout: null },
  { id: 'sg7', name: 'kerb', bet: 15, target: 1.7, status: 'live', payout: null },
  { id: 'sg8', name: 'drs on', bet: 90, target: 4.6, status: 'live', payout: null },
  { id: 'sg9', name: 'vmax', bet: 265, target: 2.1, status: 'live', payout: null },
  { id: 'sg10', name: 'lap24', bet: 140, target: 1.5, status: 'live', payout: null },
  { id: 'sg11', name: 'undercut', bet: 350, target: 3.7, status: 'live', payout: null },
  { id: 'sg12', name: 'pitwall', bet: 63, target: 2.4, status: 'live', payout: null },
  { id: 'sg13', name: 'tarmac', bet: 405, target: 1.8, status: 'live', payout: null },
  { id: 'sg14', name: 'slip5', bet: 28, target: 5.1, status: 'live', payout: null },
  { id: 'sg15', name: 'gravel', bet: 19, target: 1.3, status: 'live', payout: null },
  { id: 'sg16', name: 'medium2', bet: 190, target: 2.6, status: 'live', payout: null },
  { id: 'sg17', name: 'octane', bet: 233, target: 3.4, status: 'live', payout: null },
  { id: 'sg18', name: 'apron', bet: 51, target: 1.9, status: 'live', payout: null },
  { id: 'sg19', name: 'flagman', bet: 99, target: 4.2, status: 'live', payout: null },
  { id: 'sg20', name: 'turbo8', bet: 136, target: 2.2, status: 'live', payout: null },
]

// ---------- 占位赔率（已知表待核；引擎单按枚举标定 94-97.5% 带）----------
const ODDS_MAIN = 1.95    // 大小 / 单双 / 红黑
const ODDS_ROW = 2.9      // 发车三段（第1/2/3个8）
const ODDS_PICK = 22.85   // 24 车号直选
// 车队涂装盘：规则无源，未定价（显示 --，不进任何下注计数）

export default function SpeedGrid({ balance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())

  const toggleSel = key => {
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  // ---- 样式件（选中=金框，同 Line Up 惯例）----
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    return {
      flex: 1, minWidth: 0,
      borderRadius: 10, cursor: 'pointer',
      background: bg,
      border: `1.5px solid ${sel ? DERBY.gold : 'rgba(255,255,255,0.16)'}`,
      boxShadow: sel ? '0 0 10px rgba(255,213,79,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      transition: 'filter 0.12s, border-color 0.12s, box-shadow 0.15s',
      boxSizing: 'border-box', position: 'relative',
    }
  }
  const cellName = { color: COLORS.white, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const cellRange = { color: 'rgba(255,255,255,0.7)', fontSize: isMobile ? 8.5 : 9.5, fontWeight: 700, whiteSpace: 'nowrap' }
  const cellOdds = { color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900 }
  const secHead = { color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, marginBottom: 4 }
  const secBox = {
    flex: '0 0 auto', borderRadius: 12, padding: isDesk ? 3 : 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }
  // 单行键（名称左/区间中/赔率右，照 Line Up 定案行式）
  const rowCell = (key, name, range, odds, bg = DERBY.grey) => (
    <button key={key} type="button" className="sgCell" data-key={key} onClick={() => toggleSel(key)}
      style={{
        ...cellBase(key, bg),
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
      }}>
      <span style={cellName}>{name}</span>
      <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span>
      <span style={cellOdds}>{odds}</span>
    </button>
  )

  // ---- 顶栏（共享件）----
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.sel}`,
      color: DERBY.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>⏱ 00:18</span>
  )
  const topBar = (
    <GameTopBar gameName="SPEED GRID" venue={VENUE} roundId={ROUND_ID}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：上局冠军大牌 + 24 车号小网格（4 队涂装分组）----
  const champTeam = teamOf(CHAMP)
  const mini = isMobile ? 22 : isDesk ? 24 : 28
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {/* 冠军大牌（上局；写死 17 号占位） */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>上局冠军</span>
        <span style={{
          width: isMobile ? 54 : 64, height: isMobile ? 66 : 78, borderRadius: 10,
          background: champTeam.c,
          border: `2px solid ${DERBY.gold}`,
          boxShadow: '0 0 14px rgba(255,213,79,0.45), inset 0 2px 3px rgba(255,255,255,0.25)',
          color: COLORS.white, fontSize: isMobile ? 26 : 32, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{CHAMP}</span>
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900 }}>{champTeam.name} · {champTeam.range}</span>
      </div>
      {/* 24 车号小网格：4 行 = 4 队涂装 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 4, flex: '0 0 auto' }}>
        {TEAMS.map((t, ti) => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 3 : 4 }}>
            {Array.from({ length: 6 }, (_, i) => {
              const n = ti * 6 + i + 1
              return (
                <span key={n} data-mini={n} style={{
                  width: mini, height: mini, borderRadius: 6,
                  background: t.c,
                  border: n === CHAMP ? `2px solid ${DERBY.gold}` : '1px solid rgba(0,0,0,0.35)',
                  boxShadow: n === CHAMP ? '0 0 8px rgba(255,213,79,0.6)' : 'inset 0 1px 2px rgba(255,255,255,0.22)',
                  color: COLORS.white, fontSize: mini * 0.42, fontWeight: 900,
                  fontFamily: "'Space Grotesk', sans-serif",
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', opacity: n === CHAMP ? 1 : 0.85,
                }}>{n}</span>
              )
            })}
            <span style={{ color: DERBY.dim, fontSize: isMobile ? 8.5 : 9.5, fontWeight: 800, whiteSpace: 'nowrap', marginLeft: 2 }}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  )

  // ---- ② 盘区：主盘 6 键 + 发车三段 3 键 + 车队涂装 4 键（--）+ 24 直选 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 冠军车号</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '13-24', ODDS_MAIN.toFixed(2))}
        {rowCell('small', '小', '1-12', ODDS_MAIN.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('odd', '单', '车号单', ODDS_MAIN.toFixed(2))}
        {rowCell('even', '双', '车号双', ODDS_MAIN.toFixed(2))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('red', '红', '归类待核', ODDS_MAIN.toFixed(2), DERBY.away)}
        {rowCell('black', '黑', '归类待核', ODDS_MAIN.toFixed(2), ROULETTE.black)}
      </div>
    </div>
  )
  const rowBoard = (
    <div style={secBox}>
      <div style={secHead}>发车三段 · 第1/2/3个8</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('grid-front', '头排', '1-8', ODDS_ROW.toFixed(2))}
        {rowCell('grid-mid', '中段', '9-16', ODDS_ROW.toFixed(2))}
        {rowCell('grid-rear', '尾排', '17-24', ODDS_ROW.toFixed(2))}
      </div>
      {/* 车队涂装盘：规则无源未定价（占位 --，X2 定），照 Derby 半全场先例 */}
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {TEAMS.map(t => rowCell(`team-${t.range}`, t.name, t.range, '--', t.c))}
      </div>
    </div>
  )
  const pickBoard = (
    <div style={secBox}>
      <div style={secHead}>车号直选 · 4×6</div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
        gap: isMobile ? 4 : 6,
      }}>
        {Array.from({ length: 24 }, (_, i) => {
          const n = i + 1
          const t = teamOf(n)
          return (
            <button key={n} type="button" className="sgCell" data-key={`car-${n}`} onClick={() => toggleSel(`car-${n}`)}
              style={{ ...cellBase(`car-${n}`, t.c), padding: isMobile ? '4px 0' : '5px 0' }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : 14, fontFamily: "'Space Grotesk', sans-serif" }}>{n}</span>
              <span style={{ ...cellOdds, fontSize: isMobile ? 8.5 : 9.5 }}>{ODDS_PICK.toFixed(2)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式抄 Line Up）----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 18 : 14
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <span style={{
          padding: '3px 12px', borderRadius: RADIUS.pill,
          background: DERBY.sel, color: '#083a1b',
          border: `1px solid ${DERBY.sel}`,
          fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
        }}>大小</span>
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 6,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = SEED_ROAD[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: t ? (t === '大' ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: roadBead / 2, fontWeight: 900,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxSizing: 'border-box',
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
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.sgCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（desk 主盘/三段并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{rowBoard}</div>
        </div>
        {pickBoard}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路 */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned，grid 4列×2行（照 Line Up 定案）：
           纯 UI：下注钮空转、重复钮无历史灰 ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '6px 12px',
        background: DERBY.band,
        borderTop: '1px solid rgba(0,0,0,0.25)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) 92px',
          gridTemplateRows: 'repeat(2, 28px)',
          gap: 6,
          maxWidth: 480, margin: '0 auto',
        }}>
          {[
            { v: 10, col: 1, row: 1 }, { v: 100, col: 2, row: 1 },
            { v: 50, col: 1, row: 2 }, { v: 500, col: 2, row: 2 },
          ].map(({ v, col, row }) => (
            <button key={v} type="button" className="sgChip" onClick={() => setBet(v)} style={{
              gridColumn: col, gridRow: row,
              width: '100%', height: '100%', borderRadius: 8,
              fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
              background: bet === v ? DERBY.selTint : 'rgba(0,0,0,0.35)',
              border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
              cursor: 'pointer', boxSizing: 'border-box',
            }}>{v}</button>
          ))}
          <div style={{
            gridColumn: 3, gridRow: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            borderRadius: 8, padding: '0 6px',
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            boxSizing: 'border-box', minWidth: 0,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>USD</span>
            <input
              value={bet}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 40, minWidth: 0, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 14, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled style={{
            gridColumn: 3, gridRow: 2,
            width: '100%', height: '100%', borderRadius: 8,
            fontSize: 11, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap',
            color: DERBY.dim,
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'not-allowed', opacity: 0.5,
            boxSizing: 'border-box',
          }}>↻ 重复</button>
          <div style={{ gridColumn: 4, gridRow: '1 / 3' }}>
            {/* 纯 UI 占位：onClick 空转，引擎单接 confirmBets */}
            <BetButton
              state="bet"
              label={`下注 ${picks.size} 格`}
              sub={`$${(bet * picks.size).toFixed(0)}`}
              onClick={() => {}}
              disabled={picks.size === 0}
              stretch
            />
          </div>
        </div>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Line Up ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Speed Grid</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={SEED_FEED} myBets={[]} online={914} fill />
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
    <GameLayout title="Speed Grid" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
