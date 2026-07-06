import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import BetButton from '../components/shell/BetButton'
import GameTopBar from '../components/shell/GameTopBar'

// 五行 WuXing — KENO 20 球快开五项皮（80 池抽 20 比总和），第 19 卡。
// 本单 X1：纯 UI 骨架——零逻辑、零余额副作用、零随机数；开奖区/珠盘路/倒计时
// 全部硬编码种子数据，下注钮只显示选格数不做任何事。引擎/状态机走后续单。
// 规则源（help.sbobet.com Keno Betting Rules #4304 原文转录，2026-07-06 实查）：
//   大 = 总和 ≥811 @1.95 / 小 = ≤810 @1.95；单双 @1.95
//   龙 = 总和右起第 2 位数字 @1.95 / 虎 = 末位数字 @1.95 / 龙虎和（两位相等）@9.00
//   上 = 1-40 号计数 >10 @2.30 / 下 = 41-80 计数 >10 @2.30 / 上下和（10-10）@4.30
//   过关四组合 大单/大双/小单/小双 @3.70
//   五行 金[210-695]9.20 / 木[696-763]4.60 / 水[764-855]2.40 / 火[856-923]4.60 / 土[924-1410]9.20
// 布局照 Line Up 定案：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底（grid 4列×2行）。

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'GARNET PAVILION'        // 架空馆名（对齐 AMBER DOME 系，禁真实场馆名）
const ROUND_ID = 'GP20260706-088'
// 种子局 = 规则页官方示例局：总和 693 → 小/单/龙9虎3(龙)/上13下7(上)/小单/金
const SEED_BALLS = [1, 4, 5, 10, 11, 13, 20, 27, 30, 32, 33, 36, 40, 47, 54, 59, 61, 64, 67, 79]
const SEED_SUM = 693
const SEED_UP = SEED_BALLS.filter(n => n <= 40).length          // 13
const SEED_DRAGON = Math.floor(SEED_SUM / 10) % 10              // 9（右起第 2 位）
const SEED_TIGER = SEED_SUM % 10                                // 3（末位）

// 五行五段（格底统一普通盘键色 DERBY.grey，与大小/单双一致；五行字/赔率保留）
const WUXING = [
  { key: 'wx-gold', name: '金', range: '210-695', odds: '9.20' },
  { key: 'wx-wood', name: '木', range: '696-763', odds: '4.60' },
  { key: 'wx-water', name: '水', range: '764-855', odds: '2.40' },
  { key: 'wx-fire', name: '火', range: '856-923', odds: '4.60' },
  { key: 'wx-earth', name: '土', range: '924-1410', odds: '9.20' },
]

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动）
const SEED_ROAD = [
  '小', '大', '大', '小', '大', '小', '小', '大', '大', '小',
  '大', '小', '大', '大', '小', '大', '小', '大', '小', '小',
  '大', '小', '小', '大', '小', '大', '大', '小', '大', '大',
  '小', '大', '小', '大', '大', '小', '大', '小', '小', '大',
]

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'wx1', name: 'aurum', bet: 168, target: 1.9, status: 'live', payout: null },
  { id: 'wx2', name: 'timber', bet: 52, target: 4.6, status: 'live', payout: null },
  { id: 'wx3', name: 'hydro8', bet: 305, target: 2.4, status: 'live', payout: null },
  { id: 'wx4', name: 'blaze', bet: 121, target: 4.6, status: 'live', payout: null },
  { id: 'wx5', name: 'terra', bet: 452, target: 9.2, status: 'live', payout: null },
  { id: 'wx6', name: 'lodest', bet: 77, target: 2.3, status: 'live', payout: null },
  { id: 'wx7', name: 'pebble', bet: 14, target: 1.7, status: 'live', payout: null },
  { id: 'wx8', name: 'cinder', bet: 93, target: 3.7, status: 'live', payout: null },
  { id: 'wx9', name: 'brook', bet: 260, target: 2.1, status: 'live', payout: null },
  { id: 'wx10', name: 'moss42', bet: 145, target: 1.5, status: 'live', payout: null },
  { id: 'wx11', name: 'quartz', bet: 344, target: 3.7, status: 'live', payout: null },
  { id: 'wx12', name: 'ember', bet: 66, target: 2.4, status: 'live', payout: null },
  { id: 'wx13', name: 'granit', bet: 410, target: 1.8, status: 'live', payout: null },
  { id: 'wx14', name: 'sprout', bet: 31, target: 5.1, status: 'live', payout: null },
  { id: 'wx15', name: 'tide66', bet: 18, target: 1.3, status: 'live', payout: null },
  { id: 'wx16', name: 'furnce', bet: 187, target: 2.6, status: 'live', payout: null },
  { id: 'wx17', name: 'basalt', bet: 236, target: 3.4, status: 'live', payout: null },
  { id: 'wx18', name: 'willow', bet: 48, target: 1.9, status: 'live', payout: null },
  { id: 'wx19', name: 'drift', bet: 102, target: 4.2, status: 'live', payout: null },
  { id: 'wx20', name: 'ore777', bet: 133, target: 2.2, status: 'live', payout: null },
]

export default function WuXing({ balance, onBack }) {
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
    <button key={key} type="button" className="wxCell" data-key={key} onClick={() => toggleSel(key)}
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

  // ---- 顶栏（共享件；倒计时静态占位）----
  const phaseChipNode = (
    <span style={{
      padding: '2px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.sel}`,
      color: DERBY.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>⏱ 00:18</span>
  )
  const topBar = (
    <GameTopBar gameName="WU XING" venue={VENUE} roundId={ROUND_ID}
      phaseChip={phaseChipNode} onBack={onBack} />
  )

  // ---- ① 开奖区：20 球两行×10（照规则页截图布局）+ 龙虎/上下计数 + 总和大字 ----
  const ball = isMobile ? 26 : isDesk ? 26 : 30
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : isDesk ? '6px 12px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 5,
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>开奖 · 上局</span>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>80 池 · 20 球</span>
      </div>
      {/* 两行 ×10 球：上盘 1-40 蓝 / 下盘 41-80 红 */}
      {[0, 1].map(r => (
        <div key={r} style={{ display: 'flex', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
          {SEED_BALLS.slice(r * 10, r * 10 + 10).map(n => (
            <span key={n} data-ball={n} style={{
              width: ball, height: ball, borderRadius: '50%',
              background: n <= 40 ? DERBY.home : DERBY.away,
              border: '1px solid rgba(0,0,0,0.35)',
              boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: ball * 0.42, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box', flex: '0 0 auto',
            }}>{String(n).padStart(2, '0')}</span>
          ))}
        </div>
      ))}
      {/* 统计带：龙/虎（和值十位/末位）+ TOTAL 大字 + 上/下计数 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: isDesk ? 0 : 2, flexWrap: 'wrap',
      }}>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          龙 {SEED_DRAGON} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 虎 {SEED_TIGER}
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
        }}>TOTAL {SEED_SUM}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          上 {SEED_UP} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 下 {20 - SEED_UP}
        </span>
      </div>
    </div>
  )

  // ---- ② 盘区：主盘 / 龙虎·上下 / 过关四组合 / 五行五段 ----
  const mainBoard = (
    <div style={secBox}>
      <div style={secHead}>主盘 · 总和</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('big', '大', '811-1410', '1.95')}
        {rowCell('small', '小', '210-810', '1.95')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('odd', '单', '总和单', '1.95')}
        {rowCell('even', '双', '总和双', '1.95')}
      </div>
    </div>
  )
  const dtudBoard = (
    <div style={secBox}>
      <div style={secHead}>龙虎（和值十位/末位）｜ 上下（1-40/41-80 计数）</div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 4 }}>
        {rowCell('dragon', '龙', '十位', '1.95')}
        {rowCell('dt-tie', '龙虎和', '', '9.00')}
        {rowCell('tiger', '虎', '末位', '1.95')}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {rowCell('up', '上', '≥11 个', '2.30')}
        {rowCell('ud-tie', '上下和', '10-10', '4.30')}
        {rowCell('down', '下', '≥11 个', '2.30')}
      </div>
    </div>
  )
  const parlayBoard = (
    <div style={secBox}>
      <div style={secHead}>过关四组合</div>
      <div style={{
        display: isMobile ? 'grid' : 'flex',
        gridTemplateColumns: isMobile ? '1fr 1fr' : undefined,
        gap: isMobile ? 5 : 8,
      }}>
        {rowCell('big-odd', '大单', '', '3.70')}
        {rowCell('small-odd', '小单', '', '3.70')}
        {rowCell('big-even', '大双', '', '3.70')}
        {rowCell('small-even', '小双', '', '3.70')}
      </div>
    </div>
  )
  // 五行五段：双端横排 5 列 grid（金→土），格内竖排 字大/区间小/赔率；
  // 430 区间小字降到 8px 保全字（禁截断禁溢出）
  const wuxingBoard = (
    <div style={secBox}>
      <div style={secHead}>五行 · 总和五段</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: isMobile ? 4 : 8 }}>
        {WUXING.map(w => (
          <button key={w.key} type="button" className="wxCell" data-key={w.key} onClick={() => toggleSel(w.key)}
            style={{ ...cellBase(w.key, DERBY.grey), padding: isMobile ? '5px 2px' : '6px 4px' }}>
            <span style={{ ...cellName, fontSize: isMobile ? 14 : 16 }}>{w.name}</span>
            <span style={{ ...cellRange, fontSize: isMobile ? 8 : 9.5 }}>{w.range}</span>
            <span style={cellOdds}>{w.odds}</span>
          </button>
        ))}
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
      <style>{`.wxCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar（共享件）---- */}
      {topBar}

      {/* ① 开奖区 */}
      {drawZone}

      {/* ② 盘区（desk 主盘/龙虎上下并排、过关/五行并排压总高；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', flexDirection: isDesk ? 'row' : 'column', gap: isDesk ? 8 : 4, alignItems: isDesk ? 'stretch' : undefined }}>
          <div style={isDesk ? { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{mainBoard}</div>
          <div style={isDesk ? { flex: '1.4 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' } : {}}>{dtudBoard}</div>
        </div>
        {/* 过关一行；五行 desk 独占整行（并排时五键各 ~104px 键内溢出实测，全宽后 ~190px） */}
        {parlayBoard}
        {wuxingBoard}
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
            <button key={v} type="button" className="wxChip" onClick={() => setBet(v)} style={{
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Wu Xing</strong>
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
    <GameLayout title="Wu Xing" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
