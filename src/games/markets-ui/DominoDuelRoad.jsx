// #41 单16：DominoDuel 珠盘路墙（主客走势 / 总分大小 / 总分单双 页签 + 主客比例条 + rows×cols 珠矩阵）——
// 从 DominoDuel.jsx 机械切片。判定 ddBeadFor 走引擎 MARKETS（禁二份表）。
// props {history,tab,onTab,cols,rows,bead,tabFs,ratioFs,pad,radius,style}：
//   history = [[hs,as],...]（原页 road 存整局 [主分,客分]；真开奖逐期顶入，多视角一律从整局派生）。
//   桌面 rows=6/bead=14；手机锁底 rows=2/bead=15（原页两处尺寸差，外部传参，视觉原样）。
import { COLORS, RADIUS, DERBY } from '../../components/shell/tokens'
import { MARKETS } from '../markets/dominoduel'
import { ROAD_FX_CSS, ROAD_FX_FRESH, ROAD_FX_NEXT } from './roadWindow'

const ROAD_CAP = 120
// 珠盘路多视角（B 型：存整局 [hs,as]，判定一律走引擎 MARKETS 现成 helper，禁手写第二份表）
const DD_ROAD_TABS = ['H/A', 'O/U', 'O/E']
const DD_ROAD_LABELS = { 'H/A': '主客走势', 'O/U': '总分大小', 'O/E': '总分单双' }
function ddBeadFor(tab, pair) {
  const [hs, as] = pair
  const r = { hs, as, gTotal: hs + as }
  if (tab === 'O/U') return MARKETS['g-big'].hit(r) ? { t: '大', c: DERBY.away } : { t: '小', c: DERBY.home }
  if (tab === 'O/E') return MARKETS['g-odd'].hit(r) ? { t: '单', c: DERBY.away } : { t: '双', c: DERBY.home }
  if (MARKETS['draw'].hit(r)) return { t: '平', c: DERBY.grey }              // H/A：平/主/客
  return MARKETS['home-win'].hit(r) ? { t: '主', c: DERBY.home } : { t: '客', c: DERBY.away }
}

export default function DominoDuelRoad({ history = [], tab, onTab, cols = 20, rows = 6, bead = 14, tabFs = 10, ratioFs = 9.5, pad = 6, radius = 10, freshIndex = -1, style }) {
  // #47 首批：本件自带的 ROAD_CAP=120 会把 history 截到 120 再喂 cols×rows 格 —— 桌面扩到
  //   30×6=180 格后尾部 60 格永远空（实测 120/180）。改取两者较大值：cols×rows > 120 时按格数取，
  //   否则维持 120。⚠ 这样写而非直接 cols×rows，是为了让手机段（rows=2）与多桌（cols 小）
  //   的取数范围逐字节不变 —— 它们 cols×rows < 120，仍走 120，行为零改。
  const roadPairs = history.slice(-Math.max(cols * rows, ROAD_CAP))
  const beads = roadPairs.map(p => ddBeadFor(tab, p))
  const ratioSrc = history.slice(-30)
  let rHome = 0, rDraw = 0, rAway = 0
  ratioSrc.forEach(([hs, as]) => { if (hs > as) rHome++; else if (hs === as) rDraw++; else rAway++ })
  const pct = n => Math.round((n / Math.max(1, ratioSrc.length)) * 100)
  // #47 动效：新珠弹入（仅 WS 真新珠，freshIndex 由调用方给）／下一空格呼吸游标（只此一格）
  const beadCell = (b, i, sz) => (
    <span key={i} className={i === freshIndex ? ROAD_FX_FRESH : (!b && i === beads.length ? ROAD_FX_NEXT : undefined)} style={{
      width: sz, height: sz, borderRadius: '50%',
      background: b ? b.c : 'rgba(255,255,255,0.05)',
      border: b ? '1px solid rgba(0,0,0,0.35)' : '1px solid rgba(255,255,255,0.06)',
      color: COLORS.white, fontSize: sz / 2, fontWeight: 900,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    }}>{b ? b.t : ''}</span>
  )
  return (
    <div style={style}>
      <style>{ROAD_FX_CSS}</style>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', marginBottom: 4 }}>
        {DD_ROAD_TABS.map(t => (
          <button key={t} type="button" onClick={() => onTab(t)} style={{
            flex: '0 0 auto', whiteSpace: 'nowrap', padding: '3px 10px', borderRadius: RADIUS.pill,
            background: tab === t ? DERBY.sel : 'rgba(0,0,0,0.35)', color: tab === t ? '#083a1b' : DERBY.dim,
            border: `1px solid ${tab === t ? DERBY.sel : 'rgba(255,255,255,0.2)'}`,
            fontSize: tabFs, fontWeight: 900, letterSpacing: 0.3, cursor: 'pointer',
          }}>{DD_ROAD_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: DERBY.home, fontSize: ratioFs, fontWeight: 900, whiteSpace: 'nowrap' }}>主 {pct(rHome)}%</span>
        <div style={{ flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.35)' }}>
          <span style={{ width: `${pct(rHome)}%`, background: DERBY.home }} />
          <span style={{ width: `${pct(rDraw)}%`, background: 'rgba(255,255,255,0.4)' }} />
          <span style={{ width: `${pct(rAway)}%`, background: DERBY.away }} />
        </div>
        <span style={{ color: DERBY.away, fontSize: ratioFs, fontWeight: 900, whiteSpace: 'nowrap' }}>客 {pct(rAway)}%</span>
      </div>
      <div style={{ overflowX: 'auto', borderRadius: radius, background: DERBY.strip, border: '1px solid rgba(255,255,255,0.1)', padding: pad }}>
        <div style={{
          display: 'grid', gridAutoFlow: 'column',
          gridTemplateRows: `repeat(${rows}, ${bead}px)`, gridTemplateColumns: `repeat(${cols}, ${bead}px)`,
          gap: 2, width: 'max-content',
        }}>
          {Array.from({ length: cols * rows }).map((_, i) => beadCell(beads[i], i, bead))}
        </div>
      </div>
    </div>
  )
}
