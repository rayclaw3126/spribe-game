import { useState } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, DERBY } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'
import trophyImg from '../assets/shared/trophy.png'

// Derby Day — 主客对抗 Keno（主队 10 珠 vs 客队 10 珠比和值），第 16 卡。
// 本单为纯 UI 骨架：零逻辑、零余额副作用、零随机数——倒计时/开奖区/珠盘路
// 全部是硬编码种子数据；CONFIRM 只显示选格数不做任何事。引擎/状态机走后续单。
// 赔率全部为占位值（主客 1.95 / 大小单双 1.95），引擎单标定后再定稿。
// 布局顺序（定案）：① 开奖区上 ② 盘区中 ③ 珠盘路下 ④ 注栏钉底。

// ---------- 静态种子数据（纯展示，零随机数）----------
const VENUE = 'EMERALD ARENA'          // 架空场馆名（禁真实球场名）
const ROUND_ID = 'EA20260705-088'
// 上期全场开奖：主队 10 珠 / 客队 10 珠（各 5×2），和值 841 / 695
const HOME_BALLS = [96, 93, 91, 88, 86, 84, 82, 79, 72, 70]   // Σ=841
const AWAY_BALLS = [90, 87, 83, 78, 74, 69, 62, 55, 51, 46]   // Σ=695
const HOME_SUM = 841
const AWAY_SUM = 695
const FT_TOTAL = HOME_SUM + AWAY_SUM   // 1536

// 30 期假历史 [htHome, htAway, ftHome, ftAway]（旧→新；确定性脚本预生成后硬编码）
const SEED_ROUNDS = [
  [428, 376, 853, 856], [432, 431, 788, 894], [436, 454, 877, 834], [449, 359, 866, 724], [361, 448, 822, 905], [346, 401, 786, 786],
  [372, 385, 840, 846], [393, 394, 846, 750], [353, 377, 739, 783], [476, 400, 919, 764], [395, 461, 848, 837], [410, 457, 845, 803],
  [418, 343, 852, 733], [435, 368, 822, 758], [393, 472, 788, 805], [368, 350, 798, 680], [373, 372, 766, 734], [451, 402, 862, 860],
  [422, 435, 755, 848], [397, 407, 827, 781], [403, 474, 763, 882], [466, 422, 798, 848], [427, 390, 878, 823], [372, 449, 852, 853],
  [358, 415, 789, 875], [416, 434, 759, 905], [343, 366, 741, 817], [376, 459, 741, 910], [391, 394, 722, 772], [436, 454, 885, 934],
]

// 展示用假注单（静态；引擎单换 makeFeedBots 每期换血）
const SEED_FEED = [
  { id: 'dd1', name: 'gunner', bet: 205, target: 1.9, status: 'live', payout: null },
  { id: 'dd2', name: 'rivera', bet: 44, target: 2.3, status: 'live', payout: null },
  { id: 'dd3', name: 'brix', bet: 318, target: 1.6, status: 'live', payout: null },
  { id: 'dd4', name: 'toons', bet: 129, target: 3.2, status: 'live', payout: null },
  { id: 'dd5', name: 'pace9', bet: 452, target: 1.4, status: 'live', payout: null },
  { id: 'dd6', name: 'forest', bet: 61, target: 2.8, status: 'live', payout: null },
  { id: 'dd7', name: 'sisu8', bet: 8, target: 1.7, status: 'live', payout: null },
  { id: 'dd8', name: 'tigres', bet: 97, target: 4.6, status: 'live', payout: null },
  { id: 'dd9', name: 'santer', bet: 273, target: 2.1, status: 'live', payout: null },
  { id: 'dd10', name: 'primo9', bet: 156, target: 1.5, status: 'live', payout: null },
  { id: 'dd11', name: 'glazer', bet: 334, target: 3.7, status: 'live', payout: null },
  { id: 'dd12', name: 'vasco', bet: 72, target: 2.4, status: 'live', payout: null },
  { id: 'dd13', name: 'toledo', bet: 419, target: 1.8, status: 'live', payout: null },
  { id: 'dd14', name: 'ramos', bet: 38, target: 5.1, status: 'live', payout: null },
  { id: 'dd15', name: 'fuerte', bet: 21, target: 1.3, status: 'live', payout: null },
  { id: 'dd16', name: 'gomez', bet: 187, target: 2.6, status: 'live', payout: null },
  { id: 'dd17', name: 'pique2', bet: 240, target: 3.4, status: 'live', payout: null },
  { id: 'dd18', name: 'baros', bet: 55, target: 1.9, status: 'live', payout: null },
  { id: 'dd19', name: 'wing1', bet: 93, target: 4.2, status: 'live', payout: null },
  { id: 'dd20', name: 'dinho7', bet: 141, target: 2.2, status: 'live', payout: null },
]

// ---------- 占位赔率（引擎单按真实概率标定 94–97.5% 带）----------
const ODDS_MAIN = 1.95   // 主队 / 客队
const ODDS_SIDE = 1.95   // 大 / 小 / 单 / 双

// 盘区两组（C 队色语义格）：半场 / 全场同构
const GROUPS = [
  {
    key: 'ht', label: '实况 · 半场',
    big: '811–960', small: '661–810',
  },
  {
    key: 'ft', label: '实况 · 全场',
    big: '1621–1920', small: '1322–1620',
  },
]

// ---------- 珠盘路（六页签）----------
const ROAD_TABS = ['HT-H/A', 'HT-O/U', 'HT-O/E', 'FT-H/A', 'FT-O/U', 'FT-O/E']
const HT_BIG = 811, FT_BIG = 1621
function beadFor(tab, r) {
  const [hh, ha, fh, fa] = r
  const half = tab.startsWith('HT')
  const home = half ? hh : fh
  const away = half ? ha : fa
  const total = home + away
  if (tab.endsWith('H/A')) {
    if (home === away) return { t: 'D', c: 'rgba(255,255,255,0.3)' }
    return home > away ? { t: 'H', c: DERBY.home } : { t: 'A', c: DERBY.away }
  }
  if (tab.endsWith('O/U')) {
    return total >= (half ? HT_BIG : FT_BIG) ? { t: 'O', c: DERBY.away } : { t: 'U', c: DERBY.home }
  }
  return total % 2 ? { t: 'O', c: DERBY.away } : { t: 'E', c: DERBY.home }   // O/E 单双
}

// 号码珠（主蓝/客红/灰 0 态）
function NumBead({ n, color, size = 24, blank = false }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: blank ? 'rgba(255,255,255,0.1)' : color,
      border: '1px solid rgba(0,0,0,0.35)',
      boxShadow: blank ? 'none' : 'inset 0 2px 3px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.35)',
      color: COLORS.white, fontSize: size * 0.42, fontWeight: 900,
      fontFamily: "'Space Grotesk', sans-serif",
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxSizing: 'border-box', flex: '0 0 auto',
    }}>{blank ? '' : n}</span>
  )
}

export default function DerbyDay({ balance }) {
  const isMobile = useIsMobile()
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  // desk 模式被 400px feed 收窄——1200 以下居中 DEMO 与 How-to-Play 相撞，隐藏
  const deskWide = useMediaQuery('(min-width: 1200px)')
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, setMuted] = useState(false)
  const [bet, setBet] = useState(10)
  const [picks, setPicks] = useState(() => new Set())
  const [roadTab, setRoadTab] = useState('FT-H/A')

  // 纯 UI 选中态切换 — 不扣款不入账，CONFIRM 无逻辑
  const toggleSel = key => {
    setPicks(s => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  // ---- 样式件（选中 = 金框，照全站语言）----
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

  // ---- 场馆头行（desk 走骨架 34px 历史行位）----
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
      }}>⏱ 00:19</span>
      {/* 重复投注（无逻辑占位） */}
      <span style={{
        marginLeft: 'auto', padding: '2px 12px', borderRadius: RADIUS.pill,
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: DERBY.text, fontSize: 11, fontWeight: 900, whiteSpace: 'nowrap',
      }}>↻ 重复投注</span>
    </div>
  )

  // ---- ① 开奖区：全场块 + 半场块（0 态） ----
  const beadSize = isMobile ? 18 : 19
  const ballGrid = (balls, color, blank = false) => (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(5, ${beadSize}px)`,
      gridTemplateRows: `repeat(2, ${beadSize}px)`, gap: isMobile ? 3 : 4,
    }}>
      {Array.from({ length: 10 }, (_, i) => (
        <NumBead key={i} n={blank ? 0 : balls[i]} color={color} size={beadSize} blank={blank} />
      ))}
    </div>
  )
  const drawBlock = ({ title, blank }) => (
    <div style={{
      borderRadius: 12, padding: isMobile ? '8px 8px 6px' : '8px 12px 6px',
      background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)',
      opacity: blank ? 0.85 : 1,
      display: 'flex', flexDirection: 'column', gap: 4,
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: isMobile ? 8 : 14, flexWrap: 'nowrap',
      }}>
        {ballGrid(HOME_BALLS, DERBY.home, blank)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: '0 0 auto' }}>
          <span style={{ color: DERBY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{
            padding: '2px 12px', borderRadius: RADIUS.pill,
            background: blank ? 'rgba(255,255,255,0.14)' : DERBY.gold,
            color: blank ? DERBY.dim : '#3a2c00',
            fontSize: isMobile ? 11 : 12.5, fontWeight: 900, whiteSpace: 'nowrap',
          }}>TOTAL {blank ? '—' : FT_TOTAL}</span>
        </div>
        {ballGrid(AWAY_BALLS, DERBY.away, blank)}
      </div>
      {/* 下缘比分行：主/客和值 + 胜方 trophy（资产小图） */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.home, display: 'inline-block' }} />
          主队：{blank ? '—' : HOME_SUM}
          {!blank && HOME_SUM > AWAY_SUM && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: DERBY.text, fontSize: isMobile ? 11 : 12, fontWeight: 900 }}>
          {!blank && AWAY_SUM > HOME_SUM && (
            <img src={trophyImg} alt="胜" style={{ width: isMobile ? 14 : 16, height: isMobile ? 14 : 16, objectFit: 'contain' }} />
          )}
          客队：{blank ? '—' : AWAY_SUM}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: DERBY.away, display: 'inline-block' }} />
        </span>
      </div>
    </div>
  )
  const drawZone = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '8px 12px 0' : '6px 18px 0',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {drawBlock({ title: '全场', blank: false })}
      {drawBlock({ title: '半场 · 下期', blank: true })}
    </div>
  )

  // ---- ② 盘区两组（队色语义格） ----
  const marketGroup = g => (
    <div key={g.key} style={secBox}>
      <div style={secHead}>{g.label}</div>
      {/* 行1：主队 / 客队（队色底） */}
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 5 : 6 }}>
        <button type="button" className="ddCell" onClick={() => toggleSel(`${g.key}-home`)}
          style={cellBase(`${g.key}-home`, DERBY.home)}>
          <span style={cellName}>主队 HOME</span>
          <span style={cellOdds}>{ODDS_MAIN.toFixed(2)}</span>
        </button>
        <button type="button" className="ddCell" onClick={() => toggleSel(`${g.key}-away`)}
          style={cellBase(`${g.key}-away`, DERBY.away)}>
          <span style={cellName}>客队 AWAY</span>
          <span style={cellOdds}>{ODDS_MAIN.toFixed(2)}</span>
        </button>
      </div>
      {/* 行2：大 / 小 / 单 / 双（深灰底） */}
      <div style={{ display: 'flex', gap: isMobile ? 5 : 8 }}>
        {[
          { k: 'big', name: '大', range: g.big },
          { k: 'small', name: '小', range: g.small },
          { k: 'odd', name: '单', range: '和值单' },
          { k: 'even', name: '双', range: '和值双' },
        ].map(m => (
          <button key={m.k} type="button" className="ddCell" onClick={() => toggleSel(`${g.key}-${m.k}`)}
            style={cellBase(`${g.key}-${m.k}`, DERBY.grey)}>
            <span style={cellName}>{m.name}</span>
            <span style={cellRange}>{m.range}</span>
            <span style={cellOdds}>{ODDS_SIDE.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  )

  // ---- ③ 珠盘路（六页签 + 占比条 + 6×20） ----
  const ROAD_COLS = 20
  const roadBead = isMobile ? 16 : 14   // 移动端珠子大一档（横滚可辨），桌面压一档保总高
  const beads = SEED_ROUNDS.map(r => beadFor(roadTab, r))
  const beadRoad = (
    <div style={{
      flex: '0 0 auto', position: 'relative', zIndex: 1,
      margin: isMobile ? '0 12px 8px' : '0 18px 8px',
    }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => setRoadTab(t)} style={{
            padding: '3px 9px', borderRadius: RADIUS.pill,
            background: roadTab === t ? DERBY.sel : 'rgba(0,0,0,0.35)',
            color: roadTab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${roadTab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: 9.5, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{t}</button>
        ))}
      </div>
      {/* 占比条（静态占位）：主队 48% / 和 0% / 客队 52% */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: DERBY.home, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>主队 48%</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: '48%', background: DERBY.home }} />
          <span style={{ width: '52%', background: DERBY.away }} />
        </div>
        <span style={{ color: DERBY.dim, fontSize: 9.5, fontWeight: 800, whiteSpace: 'nowrap' }}>和 0%</span>
        <span style={{ color: DERBY.away, fontSize: 9.5, fontWeight: 900, whiteSpace: 'nowrap' }}>客队 52%</span>
      </div>
      <div style={{
        overflowX: 'auto', borderRadius: 10,
        background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: 5,
      }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(6, ${roadBead}px)`, gridTemplateColumns: `repeat(${ROAD_COLS}, ${roadBead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: ROAD_COLS * 6 }).map((_, i) => {
            const b = beads[i]
            return (
              <span key={i} style={{
                width: roadBead, height: roadBead, borderRadius: '50%',
                background: b ? b.c : 'rgba(255,255,255,0.05)',
                border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
                color: COLORS.white, fontSize: 8.5, fontWeight: 900,
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
      background: `radial-gradient(circle at 50% 28%, ${DERBY.bgCenter}, ${DERBY.bgOuter})`,
      borderColor: COLORS.border, padding: 0, overflow: 'hidden',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
    }}>
      <style>{`.ddCell:hover { filter: brightness(1.2); }`}</style>

      {/* ---- top bar ---- */}
      <div style={{
        flex: '0 0 auto',
        padding: '8px 14px',
        background: DERBY.band,
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
      }}>
        <span style={navPill}>DERBY DAY ▾</span>
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

      {/* ① 开奖区（顶部）：全场块 + 半场 0 态块 */}
      {drawZone}

      {/* ② 盘区两组（中部；空间不足内部纵滚兜底） */}
      <div style={{
        flex: '0 1 auto', minHeight: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        padding: isMobile ? '6px 12px' : '4px 18px', boxSizing: 'border-box',
        gap: 4, overflowY: 'auto',
      }}>
        {GROUPS.map(marketGroup)}
      </div>

      {/* 弹性垫片：把珠盘路推向底部贴注栏 */}
      <div style={{ flex: '1 0 auto' }} />

      {/* ③ 珠盘路（底部，六页签 + 占比条） */}
      {beadRoad}

      {/* ---- ④ bottom bet band — pinned（全无逻辑：CONFIRM 只显示选格数）---- */}
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
        {[10, 50, 100, 500].map(v => (
          <button key={v} type="button" onClick={() => setBet(v)} style={{
            minWidth: 38, padding: '0 10px', height: 30, borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 900, lineHeight: 1, color: COLORS.white,
            background: bet === v ? DERBY.selTint : DERBY.band,
            border: `1px solid ${bet === v ? DERBY.sel : 'rgba(255,255,255,0.35)'}`,
            cursor: 'pointer',
          }}>{v}</button>
        ))}
        <button type="button" style={{
          minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
          background: DERBY.sel, color: '#083a1b',
          border: '1px solid rgba(255,255,255,0.35)',
          fontSize: 14, fontWeight: 900, letterSpacing: 1,
          cursor: 'default', opacity: picks.size > 0 ? 1 : 0.55,
        }}>
          ▷ CONFIRM{picks.size > 0 ? ` (${picks.size})` : ''}
        </button>
      </div>
    </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Hat Trick ----
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
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Derby Day</strong>
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
    <GameLayout title="Derby Day" color={DERBY.sel}>
      {gameCard}
    </GameLayout>
  )
}
