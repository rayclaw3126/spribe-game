import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import ChipQuickBet from '../components/shell/ChipQuickBet'
import BetButton from '../components/shell/BetButton'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'

// Line Up — ATOM 5×5 数字彩（25 个 0-9 随机数排成五行，行/全局和值盘），第 17 卡。
// 本单为纯 UI 骨架：零逻辑、零余额副作用、零随机数——开奖区/珠盘路/倒计时全部
// 硬编码种子数据；下注按钮只显示选格数不做任何事。引擎/状态机走后续单。
// 赔率为占位值，对照参考规则（help.sbobet.com Atom Betting Rules #4303）：
//   普通盘/行式盘 大小·单双·主客色·高低 = 1.95；
//   四区 = 降级区[0-95] 7.50 / 中游[96-112] 2.30 / 欧战区[113-129] 2.30 / 夺冠[130-225] 7.50
//   （参考 Spring/Summer/Autumn/Winter 同段同赔，足球叙事换皮）。
// 红/黑归类（参考规则原文，X2 结算用）：
//   Red  = "drawn at 0, 2, 6, 7 and 8, which are classified as Red"   → 本作客红
//   Black = "drawn at 1, 3, 4, 5 and 9, which are classified as Black" → 本作主蓝
// 布局顺序（照 Derby 定案标准）：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底。

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'SAPPHIRE PARK'          // 架空场馆名（禁真实球场名）
const ROUND_ID = 'SP20260705-088'
// 上局开奖 5×5（取自参考规则页 ATOM 25's 实拍局）：行和 12/18/10/22/28，总和 90
const GRID = [
  [2, 6, 3, 1, 0],
  [6, 0, 6, 1, 5],
  [2, 0, 1, 7, 0],
  [1, 6, 4, 9, 2],
  [7, 4, 6, 6, 5],
]
// 归类表（参考原文映射）：客红 = Red(0,2,6,7,8)；主蓝 = Black(1,3,4,5,9)；
// 高 = 5-9 / 低 = 0-4（参考 High/Low 原文）
const AWAY_DIGITS = new Set([0, 2, 6, 7, 8])
const HIGH_DIGITS = new Set([5, 6, 7, 8, 9])
const ROW_LABELS = ['锋线', '前腰', '中场', '后腰', '后卫']   // L1-L5

// 派生统计（种子局写死对账：行和 12/18/10/22/28，客 15 主 10，高 11 低 14，总和 90）
const ROW_SUMS = GRID.map(r => r.reduce((a, b) => a + b, 0))
const FLAT = GRID.flat()
const TOTAL_SUM = FLAT.reduce((a, b) => a + b, 0)
const AWAY_COUNT = FLAT.filter(n => AWAY_DIGITS.has(n)).length
const HOME_COUNT = 25 - AWAY_COUNT
const HIGH_COUNT = FLAT.filter(n => HIGH_DIGITS.has(n)).length
const LOW_COUNT = 25 - HIGH_COUNT

// 40 期假珠盘（大小单轨，旧→新；引擎单换真历史滚动）
const SEED_ROAD = [
  '小', '大', '大', '小', '大', '小', '小', '大', '大', '大',
  '小', '大', '小', '小', '大', '小', '大', '大', '小', '小',
  '大', '小', '大', '大', '小', '大', '小', '小', '小', '大',
  '大', '小', '大', '小', '大', '大', '小', '大', '小', '大',
]

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'lu1', name: 'volley', bet: 184, target: 1.9, status: 'live', payout: null },
  { id: 'lu2', name: 'marek', bet: 52, target: 2.3, status: 'live', payout: null },
  { id: 'lu3', name: 'nine10', bet: 305, target: 1.6, status: 'live', payout: null },
  { id: 'lu4', name: 'crossa', bet: 118, target: 3.2, status: 'live', payout: null },
  { id: 'lu5', name: 'palmer', bet: 466, target: 1.4, status: 'live', payout: null },
  { id: 'lu6', name: 'zidane8', bet: 74, target: 2.8, status: 'live', payout: null },
  { id: 'lu7', name: 'kwon', bet: 12, target: 1.7, status: 'live', payout: null },
  { id: 'lu8', name: 'stade', bet: 88, target: 4.6, status: 'live', payout: null },
  { id: 'lu9', name: 'ferro', bet: 264, target: 2.1, status: 'live', payout: null },
  { id: 'lu10', name: 'lobo11', bet: 143, target: 1.5, status: 'live', payout: null },
  { id: 'lu11', name: 'brygge', bet: 351, target: 3.7, status: 'live', payout: null },
  { id: 'lu12', name: 'perin', bet: 66, target: 2.4, status: 'live', payout: null },
  { id: 'lu13', name: 'talles', bet: 402, target: 1.8, status: 'live', payout: null },
  { id: 'lu14', name: 'rondo5', bet: 29, target: 5.1, status: 'live', payout: null },
  { id: 'lu15', name: 'vardy9', bet: 17, target: 1.3, status: 'live', payout: null },
  { id: 'lu16', name: 'moura', bet: 195, target: 2.6, status: 'live', payout: null },
  { id: 'lu17', name: 'keita4', bet: 228, target: 3.4, status: 'live', payout: null },
  { id: 'lu18', name: 'brozo', bet: 49, target: 1.9, status: 'live', payout: null },
  { id: 'lu19', name: 'winger', bet: 101, target: 4.2, status: 'live', payout: null },
  { id: 'lu20', name: 'dybal10', bet: 137, target: 2.2, status: 'live', payout: null },
]

// ---------- 占位赔率（引擎单按真实概率标定 94–97.5% 带）----------
const ODDS_MAIN = 1.95    // 大小 / 单双 / 主色多客色多 / 高低（普通盘 + 行式盘同档）
const ODDS_EDGE = 7.5     // 降级区 / 夺冠（对照参考 Spring/Winter 段）
const ODDS_MID = 2.3      // 中游 / 欧战区（对照参考 Summer/Autumn 段）

// 普通盘四区（足球叙事换皮，段位照参考原文）
const ZONES = [
  { key: 'zone-releg', name: '降级区', range: '0–95', odds: ODDS_EDGE },
  { key: 'zone-mid', name: '中游', range: '96–112', odds: ODDS_MID },
  { key: 'zone-euro', name: '欧战区', range: '113–129', odds: ODDS_MID },
  { key: 'zone-champ', name: '夺冠', range: '130–225', odds: ODDS_EDGE },
]

export default function LineUp({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [lineSel, setLineSel] = useState(0)   // 行式盘 L1-L5 选线器

  const toggleSel = key => {
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  // ---- 样式件（选中=金框，同 Derby 惯例）----
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const cellBase = (key, bg) => {
    const sel = picks.has(key)
    return {
      flex: 1, minWidth: 0, padding: isMobile ? '6px 2px' : '6px 4px',
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
    flex: '0 0 auto', borderRadius: 12, padding: 4,
    background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
    boxSizing: 'border-box',
  }

  // ---- 场馆头行（desk 走骨架 34px 历史行位；倒计时静态占位）----
  const roundBar = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isDesk ? 0 : isMobile ? '10px 12px 0' : '12px 18px 0',
      padding: '4px 10px', borderRadius: RADIUS.pill,
      background: DERBY.strip,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      <span style={{
        color: DERBY.gold, fontSize: 12, fontWeight: 900, letterSpacing: 1.5,
        fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
      }}>{VENUE}</span>
      <span style={{ color: DERBY.dim, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>#{ROUND_ID}</span>
      <span style={{
        padding: '2px 10px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.sel}`,
        color: DERBY.sel, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap',
      }}>⏱ 00:18</span>
      {/* 重复投注（无逻辑占位，引擎单接） */}
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: DERBY.text, fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap',
      }}>↻ 重复投注</span>
    </div>
  )

  // ---- ① 开奖区：5×5 号码牌（行标 + 行和）+ 统计带（主客计数/总和/高低）----
  const tile = isMobile ? 30 : isDesk ? 32 : 36   // desk 收一档给盘区留高
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 8px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', flexDirection: 'column', gap: isMobile ? 3 : 4,
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>首发阵容 · 上局</span>
        <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 800 }}>25 数 · 0-9</span>
      </div>
      {GRID.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, justifyContent: 'center' }}>
          {/* 行标：L 号圈 + 位置名 */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', width: isMobile ? 58 : 72 }}>
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              background: DERBY.home, color: COLORS.white,
              fontSize: 9, fontWeight: 900,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.35)', boxSizing: 'border-box',
            }}>L{ri + 1}</span>
            <span style={{ color: DERBY.text, fontSize: isMobile ? 10 : 11, fontWeight: 900, whiteSpace: 'nowrap' }}>{ROW_LABELS[ri]}</span>
          </span>
          {/* 5 号码牌：主蓝 = Black(1,3,4,5,9) / 客红 = Red(0,2,6,7,8) */}
          {row.map((n, ci) => (
            <span key={ci} style={{
              width: tile, height: tile, borderRadius: 8,
              background: AWAY_DIGITS.has(n) ? DERBY.away : DERBY.home,
              border: '1px solid rgba(0,0,0,0.35)',
              boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.25), 0 1px 3px rgba(0,0,0,0.35)',
              color: COLORS.white, fontSize: tile * 0.5, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box', flex: '0 0 auto',
            }}>{n}</span>
          ))}
          {/* 行尾行和 */}
          <span style={{
            flex: '0 0 auto', minWidth: isMobile ? 26 : 32, textAlign: 'center',
            padding: '2px 6px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.2)',
            color: DERBY.gold, fontSize: isMobile ? 10.5 : 12, fontWeight: 900,
          }}>{ROW_SUMS[ri]}</span>
        </div>
      ))}
      {/* 统计带：主/客计数 + 总和大字 + 高/低 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: isMobile ? 6 : 10, paddingTop: 2, flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.home, display: 'inline-block' }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>主 {HOME_COUNT}</span>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block', marginLeft: 6 }} />
          <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>客 {AWAY_COUNT}</span>
        </span>
        <span style={{
          padding: '2px 14px', borderRadius: RADIUS.pill,
          background: DERBY.gold, color: '#3a2c00',
          fontSize: isMobile ? 13 : 15, fontWeight: 900, letterSpacing: 0.5,
        }}>SUM {TOTAL_SUM}</span>
        <span style={{ color: DERBY.text, fontSize: isMobile ? 10.5 : 11.5, fontWeight: 900 }}>
          高 {HIGH_COUNT} <span style={{ color: DERBY.dim, fontWeight: 700 }}>/</span> 低 {LOW_COUNT}
        </span>
      </div>
    </div>
  )

  // ---- ② 盘区：普通盘（全局 25 数）+ 行式盘（L1-L5 单行 5 数）----
  const commonPairs = [
    [
      { key: 'big', name: '大', range: '113–225', bg: DERBY.grey },
      { key: 'small', name: '小', range: '0–112', bg: DERBY.grey },
      { key: 'odd', name: '单', range: '和值单', bg: DERBY.grey },
      { key: 'even', name: '双', range: '和值双', bg: DERBY.grey },
    ],
    [
      { key: 'home-more', name: '主色多', range: '主蓝 ≥13', bg: DERBY.home },
      { key: 'away-more', name: '客色多', range: '客红 ≥13', bg: DERBY.away },
      { key: 'high', name: '高', range: '5-9 ≥13', bg: DERBY.grey },
      { key: 'low', name: '低', range: '0-4 ≥13', bg: DERBY.grey },
    ],
  ]
  const commonBoard = (
    <div style={{ ...secBox, ...(isDesk ? { flex: '3 1 0', minWidth: 0 } : {}) }}>
      <div style={secHead}>普通盘 · 全局 25 数</div>
      {commonPairs.map((cells, i) => (
        <div key={i} style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
          {cells.map(m => (
            <button key={m.key} type="button" className="luCell" onClick={() => toggleSel(m.key)}
              style={cellBase(m.key, m.bg)}>
              <span style={cellName}>{m.name}</span>
              <span style={cellRange}>{m.range}</span>
              <span style={cellOdds}>{ODDS_MAIN.toFixed(2)}</span>
            </button>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {ZONES.map(z => (
          <button key={z.key} type="button" className="luCell" onClick={() => toggleSel(z.key)}
            style={cellBase(z.key, DERBY.grey)}>
            <span style={cellName}>{z.name}</span>
            <span style={cellRange}>{z.range}</span>
            <span style={cellOdds}>{z.odds.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  )
  const lineBoard = (
    <div style={{ ...secBox, ...(isDesk ? { flex: '2 1 0', minWidth: 0 } : {}) }}>
      <div style={secHead}>行式盘 · 单行 5 数</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap' }}>
        {ROW_LABELS.map((label, i) => (
          <button key={i} type="button" onClick={() => setLineSel(i)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: lineSel === i ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: lineSel === i ? '#083a1b' : DERBY.dim,
            border: `1px solid ${lineSel === i ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>L{i + 1} {label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {[
          { k: 'big', name: '大', range: '23–45' },
          { k: 'small', name: '小', range: '0–22' },
          { k: 'odd', name: '单', range: '行和单' },
          { k: 'even', name: '双', range: '行和双' },
        ].map(m => (
          <button key={m.k} type="button" className="luCell" onClick={() => toggleSel(`L${lineSel + 1}-${m.k}`)}
            style={cellBase(`L${lineSel + 1}-${m.k}`, DERBY.grey)}>
            <span style={cellName}>{m.name}</span>
            <span style={cellRange}>{m.range}</span>
            <span style={cellOdds}>{ODDS_MAIN.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（大小单轨，样式同 Half Time；静态种子）----
  const ROAD_COLS = 20
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
          gridTemplateRows: 'repeat(6, 18px)', gridTemplateColumns: `repeat(${ROAD_COLS}, 18px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const t = SEED_ROAD[i]
            return (
              <span key={i} style={{
                width: 18, height: 18, borderRadius: '50%',
                background: t ? (t === '大' ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.05)',
                border: t ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: 9, fontWeight: 900,
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
      <style>{`.luCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: DERBY.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>LINE UP ▾</span>
        <span style={{
          padding: '5px 14px', borderRadius: RADIUS.pill,
          background: DERBY.orange, color: COLORS.white,
          fontSize: 12, fontWeight: 900,
        }}>? How to Play?</span>
        {!isMobile && (!isDesk || deskWide) && (
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            padding: '4px 18px', borderRadius: RADIUS.pill,
            border: `1px solid ${DERBY.gold}`, color: DERBY.gold,
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

      {/* 场馆头行 — desk 在骨架历史行，卡内只在 <1024 渲染 */}
      {!isDesk && roundBar}

      {/* ① 开奖区（顶部）：5×5 号码牌 + 统计带 */}
      {drawZone}

      {/* ② 盘区两组（中部；desk 并排双列压总高，空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: isDesk ? 'row' : 'column',
        alignItems: isDesk ? 'stretch' : undefined,
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: isDesk ? 8 : 4, overflowY: 'auto',
      }}>
        {commonBoard}
        {lineBoard}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，大小单轨） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned（ChipQuickBet + BetButton 共享件直接接）---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '10px 14px',
        background: DERBY.band,
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
        <div style={{ width: isMobile ? 132 : 150 }}>
          <ChipQuickBet value={bet} onSelect={setBet} />
        </div>
        <div style={{ width: isMobile ? 170 : 230 }}>
          {/* 纯 UI 占位：onClick 空转，引擎单接 confirmBets */}
          <BetButton
            state="bet"
            label={`下注 · ${picks.size} 格`}
            sub={`$${(bet * picks.size).toFixed(0)}`}
            onClick={() => {}}
            disabled={picks.size === 0}
            stretch
          />
        </div>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Derby Day ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Line Up</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={SEED_FEED} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* 场馆头行占骨架历史行位（34px 行惯例） */}
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
    <GameLayout title="Line Up" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
