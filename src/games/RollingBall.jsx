import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import GameTopBar from '../components/shell/GameTopBar'

// Rolling Ball — NUMBER GAME 连开 3 球足球滚球皮（每球 1-75，同局 3 球不重复），第 20 卡。
// 本单 X1：纯 UI 骨架——零逻辑、零余额副作用、零随机数；开奖区/珠盘路/倒计时全部
// 硬编码种子数据，下注钮只显示选格数不做任何事。引擎/状态机走后续单。
// 规则源 = 官方 Number Game（规则页正文空壳指向游戏内 help，登录墙后）+ 本会话
// 逆向报告核定的第 1 球固定赔率（第 2/3 球开赛后按剩余池动态，X2 实现）：
//   大[38-75]/小[1-37] 1.92/1.98、单/双 1.92/1.98、红/蓝 1.92/1.98
//   组合 大单 3.69 / 小单 3.81 / 大双 3.81 / 小双 3.92
//   单号直选 71.42（×75 格）、列注（1-75 mod5，各 15 号）4.76
//   行注三档 >1行[15行×5号]14.28 / >3行[5行×15号]4.76 / >5行[3行×25号]2.85
//   红 = ((n-1)%4)∈{0,1}（1,2,5,6,9,10…，38 号）/ 蓝 = 其余（37 号）
// 布局照 Line Up 定案：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底（grid 4列×2行）。

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'SPINEL STADIUM'         // 架空球场名（对齐 AMBER DOME 系，禁真实球场名）
const ROUND_ID = 'SS20260706-088'
const SEED_BALLS = [21, 44, 7]         // 上局连开 3 球（写死占位）
const RED = new Set(Array.from({ length: 75 }, (_, i) => i + 1).filter(n => ((n - 1) % 4) < 2))
const isRed = n => RED.has(n)

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动，此处按第 1 球大小）
const SEED_ROAD = [
  '大', '小', '大', '大', '小', '大', '小', '小', '大', '小',
  '大', '大', '小', '大', '小', '大', '大', '小', '小', '大',
  '小', '大', '小', '大', '大', '小', '大', '小', '大', '小',
  '小', '大', '大', '小', '大', '小', '大', '大', '小', '大',
]

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'rb1', name: 'striker', bet: 160, target: 1.92, status: 'live', payout: null },
  { id: 'rb2', name: 'winger9', bet: 48, target: 3.69, status: 'live', payout: null },
  { id: 'rb3', name: 'keeper', bet: 300, target: 1.98, status: 'live', payout: null },
  { id: 'rb4', name: 'volley7', bet: 125, target: 71.42, status: 'live', payout: null },
  { id: 'rb5', name: 'pitch', bet: 455, target: 4.76, status: 'live', payout: null },
  { id: 'rb6', name: 'header', bet: 74, target: 2.85, status: 'live', payout: null },
  { id: 'rb7', name: 'nutmeg', bet: 13, target: 1.92, status: 'live', payout: null },
  { id: 'rb8', name: 'sweep', bet: 90, target: 14.28, status: 'live', payout: null },
  { id: 'rb9', name: 'derby5', bet: 262, target: 3.81, status: 'live', payout: null },
  { id: 'rb10', name: 'far post', bet: 141, target: 1.92, status: 'live', payout: null },
  { id: 'rb11', name: 'onside', bet: 348, target: 3.92, status: 'live', payout: null },
  { id: 'rb12', name: 'kickoff', bet: 62, target: 1.98, status: 'live', payout: null },
  { id: 'rb13', name: 'topbin', bet: 410, target: 4.76, status: 'live', payout: null },
  { id: 'rb14', name: 'chip9', bet: 29, target: 71.42, status: 'live', payout: null },
  { id: 'rb15', name: 'tackle', bet: 17, target: 1.92, status: 'live', payout: null },
  { id: 'rb16', name: 'cross7', bet: 188, target: 2.85, status: 'live', payout: null },
  { id: 'rb17', name: 'panenka', bet: 233, target: 3.69, status: 'live', payout: null },
  { id: 'rb18', name: 'lob44', bet: 50, target: 1.98, status: 'live', payout: null },
  { id: 'rb19', name: 'flick', bet: 101, target: 4.76, status: 'live', payout: null },
  { id: 'rb20', name: 'rabona', bet: 136, target: 14.28, status: 'live', payout: null },
]

// ---------- 占位赔率（第 1 球固定；第 2/3 球 X2 动态）----------
const MAIN = [
  { slot: 'big', name: '大', range: '38-75', odds: '1.92', bg: DERBY.grey },
  { slot: 'small', name: '小', range: '1-37', odds: '1.98', bg: DERBY.grey },
]
const OE = [
  { slot: 'odd', name: '单', range: '球号单', odds: '1.92', bg: DERBY.grey },
  { slot: 'even', name: '双', range: '球号双', odds: '1.98', bg: DERBY.grey },
]
const RB = [
  { slot: 'red', name: '红', range: '38 红号', odds: '1.92', bg: DERBY.away },
  { slot: 'blue', name: '蓝', range: '37 蓝号', odds: '1.98', bg: DERBY.home },
]
const COMBO = [
  { slot: 'big-odd', name: '大单', odds: '3.69' },
  { slot: 'small-odd', name: '小单', odds: '3.81' },
  { slot: 'big-even', name: '大双', odds: '3.81' },
  { slot: 'small-even', name: '小双', odds: '3.92' },
]
const ROWS = [
  { slot: 'row-t1', name: '>1行', range: '15行×5号', odds: '14.28' },
  { slot: 'row-t3', name: '>3行', range: '5行×15号', odds: '4.76' },
  { slot: 'row-t5', name: '>5行', range: '3行×25号', odds: '2.85' },
]
const BALL_TABS = ['第 1 球', '第 2 球', '第 3 球']

export default function RollingBall({ balance, onBack }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [ballPos, setBallPos] = useState(0)   // 押哪一球：0/1/2 = 第1/2/3 球

  // 键名按球位命名空间（各球独立选注，切球位保留）
  const kf = slot => `b${ballPos + 1}-${slot}`
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
  const rowCell = (slot, name, range, odds, bg = DERBY.grey) => {
    const key = kf(slot)
    return (
      <button key={key} type="button" className="rbCell" data-key={key} onClick={() => toggleSel(key)}
        style={{
          ...cellBase(key, bg),
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          padding: isMobile ? '6px 8px' : '5px 12px', gap: 6,
        }}>
        <span style={cellName}>{name}</span>
        {range ? <span style={{ ...cellRange, flex: 1, textAlign: 'center' }}>{range}</span> : <span style={{ flex: 1 }} />}
        <span style={cellOdds}>{odds}</span>
      </button>
    )
  }

  // ---- 顶栏（共享件；倒计时静态占位）----
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.sel}`,
      color: DERBY.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>⏱ 00:18</span>
  )
  const topBar = (
    <GameTopBar gameName="ROLLING BALL" venue={VENUE} roundId={ROUND_ID}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：3 球槽（已开亮/待开暗）+ 当前球大字 + 上局回顾 ----
  const slot = isMobile ? 40 : isDesk ? 40 : 48
  const opened = 1   // 静态占位：本局已开第 1 球
  const ballSlot = (n, i) => {
    const lit = i < opened
    return (
      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.dim, fontSize: 9, fontWeight: 900 }}>第 {i + 1} 球</span>
        <span style={{
          width: slot, height: slot, borderRadius: '50%',
          background: lit ? (isRed(n) ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.08)',
          border: lit ? `2px solid ${DERBY.gold}` : '1px dashed rgba(255,255,255,0.3)',
          boxShadow: lit ? '0 0 12px rgba(255,213,79,0.4), inset 0 2px 3px rgba(255,255,255,0.28)' : 'none',
          color: lit ? COLORS.white : DERBY.dim, fontSize: slot * 0.4, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxSizing: 'border-box',
        }}>{lit ? String(n).padStart(2, '0') : '?'}</span>
      </div>
    )
  }
  const curBall = SEED_BALLS[0]
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 10 : 18, boxSizing: 'border-box', flexWrap: 'wrap',
    }}>
      {/* 当前球大字（本局刚开第 1 球） */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>当前开球</span>
        <span style={{
          width: isMobile ? 56 : 66, height: isMobile ? 56 : 66, borderRadius: '50%',
          background: isRed(curBall) ? DERBY.away : DERBY.home,
          border: `2px solid ${DERBY.gold}`,
          boxShadow: '0 0 14px rgba(255,213,79,0.45), inset 0 2px 3px rgba(255,255,255,0.28)',
          color: COLORS.white, fontSize: isMobile ? 26 : 30, fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif",
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{String(curBall).padStart(2, '0')}</span>
        <span style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900 }}>
          {isRed(curBall) ? '红' : '蓝'} · {curBall >= 38 ? '大' : '小'} · {curBall % 2 ? '单' : '双'}
        </span>
      </div>
      {/* 3 球槽 */}
      <div style={{ display: 'flex', gap: isMobile ? 8 : 14, alignItems: 'flex-start' }}>
        {SEED_BALLS.map(ballSlot)}
      </div>
      {/* 上局回顾 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, flex: '0 0 auto' }}>
        <span style={{ color: DERBY.dim, fontSize: 9, fontWeight: 900 }}>上局回顾</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {SEED_BALLS.map((n, i) => (
            <span key={i} style={{
              width: isMobile ? 22 : 24, height: isMobile ? 22 : 24, borderRadius: '50%',
              background: isRed(n) ? DERBY.away : DERBY.home,
              border: '1px solid rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: isMobile ? 9 : 10, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box',
            }}>{String(n).padStart(2, '0')}</span>
          ))}
        </div>
      </div>
    </div>
  )

  // ---- ② 盘区：球位切换 + 9 类玩法 ----
  const ballSwitch = (
    <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {BALL_TABS.map((label, i) => (
        <button key={i} type="button" onClick={() => setBallPos(i)} style={{
          padding: '4px 12px', borderRadius: RADIUS.pill,
          background: ballPos === i ? DERBY.sel : 'rgba(0,0,0,0.35)',
          color: ballPos === i ? '#083a1b' : DERBY.dim,
          border: `1px solid ${ballPos === i ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
          fontSize: 11, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{label}</button>
      ))}
      {ballPos > 0 && (
        <span style={{ color: DERBY.orange, fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap' }}>
          赔率开赛后随剩余池动态
        </span>
      )}
    </div>
  )
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 押第 {ballPos + 1} 球</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {MAIN.map(m => rowCell(m.slot, m.name, m.range, m.odds, m.bg))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {OE.map(m => rowCell(m.slot, m.name, m.range, m.odds, m.bg))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {RB.map(m => rowCell(m.slot, m.name, m.range, m.odds, m.bg))}
      </div>
    </div>
  )
  const comboRowBoard = (
    <div style={secBox}>
      <div style={secHead}>组合 · 大小×单双 ｜ 行注三档</div>
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4,
      }}>
        {COMBO.map(m => rowCell(m.slot, m.name, '', m.odds))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {ROWS.map(m => rowCell(m.slot, m.name, m.range, m.odds))}
      </div>
    </div>
  )
  const colBoard = (
    <div style={secBox}>
      <div style={secHead}>列注 · 1-75 按 5 分列（各 15 号）</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {[1, 2, 3, 4, 5].map(c => rowCell(`col-${c}`, `列${c}`, '', '4.76'))}
      </div>
    </div>
  )
  // 单号 75 格：桌面 15 列×5 行（压总高免内滚），移动 5 列×15 行（页面自然滚）
  const numCols = isDesk ? 15 : 5
  const numBoard = (
    <div style={secBox}>
      <div style={secHead}>单号直选 · {numCols}×{75 / numCols}（71.42）</div>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${numCols}, 1fr)`, gap: isMobile ? 3 : 4,
      }}>
        {Array.from({ length: 75 }, (_, i) => {
          const n = i + 1
          const key = kf(`num-${n}`)
          return (
            <button key={n} type="button" className="rbCell" data-key={key} onClick={() => toggleSel(key)}
              style={{ ...cellBase(key, isRed(n) ? DERBY.away : DERBY.home), padding: isMobile ? '3px 0' : '4px 0', minHeight: isMobile ? 30 : 26 }}>
              <span style={{ ...cellName, fontSize: isMobile ? 12 : 12.5, fontFamily: "'Space Grotesk', sans-serif" }}>{String(n).padStart(2, '0')}</span>
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
        }}>第1球大小</span>
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
      <style>{`.rbCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（球位切换 + 9 类玩法；desk 主盘/组合并排 + 列/单号并排压总高） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        {ballSwitch}
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{comboRowBoard}</div>
        </div>
        {colBoard}
        {numBoard}
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
            <button key={v} type="button" className="rbChip" onClick={() => setBet(v)} style={{
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Rolling Ball</strong>
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
    <GameLayout title="Rolling Ball" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
