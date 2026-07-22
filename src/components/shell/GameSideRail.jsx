import { useState, useEffect, useRef } from 'react'
import { usePlayerApi } from '../../lib/playerApi'
import { COLORS } from './tokens'
import { GAME_REGISTRY, GAME_BY_ID, GAME_BY_BACKEND_ID, TOP_IDS, HOT_IDS, NEW_IDS } from '../../gameRegistry'
import { formatDraw } from '../drawFormatters'
// 排期器 9 款（多桌桌款）= 有 WS 轮次 + 公开 /round/history 快照的款；单一数据源沿用多桌 mockData，禁手抄第二份。
import { ALL_TABLE_IDS } from '../MultiTable/mockData'
// 单S4c：大奖跑马灯瘦版（复用多桌 BigWinMarquee，仅瘦 padding/字号）——移入右栏顶部（顶横条方案已废弃）。
import BigWinMarqueeSlim from './BigWinMarqueeSlim'

// apiGet 只读、不写余额：传稳定 noop 满足 usePlayerApi 签名并保 memo 不抖（照 TableCard 口径）。
const NOOP = () => {}
const SCHEDULER = new Set(ALL_TABLE_IDS)

// 「换个游戏」精选序：大厅 curation（热门→精选→新品）去重打底，再按 registry 顺序补全；
// 排除当前款后取 8。精选序单一出处 = gameRegistry，不在此另存名单。
function pickOthers(currentId) {
  const seen = new Set([currentId])
  const out = []
  const push = (id) => { if (id && !seen.has(id) && GAME_BY_ID[id]) { seen.add(id); out.push(id) } }
  for (const id of [...HOT_IDS, ...TOP_IDS, ...NEW_IDS]) push(id)
  for (const g of GAME_REGISTRY) push(g.id)
  return out.slice(0, 8)
}

// 卡片外壳：标题 + 内容，深色面板对齐 shell tokens。
function Card({ title, children }) {
  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12,
      padding: 8, marginBottom: 10,
    }}>
      <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 900, letterSpacing: 0.5, padding: '2px 4px 6px' }}>{title}</div>
      {children}
    </div>
  )
}

// 今日大奖：复用多桌 /player/bigwins.top（Top5），样式对齐 GameRail TopBoard，色值走 COLORS。
function TodayJackpot({ top }) {
  return (
    <Card title="今日大奖">
      {top.map((it, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 8px',
          borderRadius: 8, margin: '1px 0', background: it.mine ? COLORS.surface : 'transparent',
        }}>
          <span style={{ flex: '0 0 auto', width: 16, color: i < 3 ? COLORS.amber : COLORS.textMuted, fontSize: 11, fontWeight: 900, textAlign: 'center' }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ color: it.mine ? COLORS.amber : COLORS.text, fontSize: 11, fontWeight: it.mine ? 900 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {it.mine && <span style={{ marginRight: 3 }}>★</span>}{it.name}
            </span>
            <span style={{ color: COLORS.textMuted, fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {GAME_BY_BACKEND_ID[it.game]?.displayName ?? it.game}
            </span>
          </span>
          <span style={{ flex: '0 0 auto', color: COLORS.green, fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>+${Number(it.payout).toFixed(2)}</span>
        </div>
      ))}
    </Card>
  )
}

// 近期开奖：仅排期器 9 款渲染，/round/history?limit=5 短文案（formatDraw，与多桌上期同口径），新→旧。
function RecentDraws({ items, be }) {
  return (
    <Card title="近期开奖">
      {items.length === 0 ? (
        <div style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 600, padding: '6px 4px' }}>暂无开奖记录</div>
      ) : items.map((it, i) => {
        const txt = it.drawResult != null ? (formatDraw(be, it.drawResult) || '—') : '—'
        return (
          <div key={it.roundNo ?? i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '5px 6px 5px 8px', borderRadius: 8, margin: '1px 0',
            background: i === 0 ? COLORS.surface : 'transparent',
          }}>
            <span style={{ flex: '0 0 auto', color: COLORS.textMuted, fontSize: 9, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              #{String(it.roundNo ?? '').slice(-4) || '…'}
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'right', color: i === 0 ? COLORS.text : COLORS.textMuted, fontSize: 11, fontWeight: i === 0 ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {txt}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

// 换个游戏：精选 8 款（排除当前），小封面 + 中文名，点走 onSelect（= App setActiveGame，lazy 正常）。
function SwitchGame({ ids, onSelect }) {
  return (
    <Card title="换个游戏">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {ids.map((id) => {
          const g = GAME_BY_ID[id]
          if (!g) return null
          return (
            <button key={id} type="button" onClick={() => onSelect(id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              background: 'transparent', border: 'none', borderRadius: 8, padding: '5px 6px', cursor: 'pointer', textAlign: 'left',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.surface }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ flex: '0 0 auto', width: 34, height: 34, borderRadius: 8, overflow: 'hidden', background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                {g.cover && <img src={g.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: COLORS.text, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {g.displayName}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// 桌面单游戏页右栏（App 层挂载，仅 ≥1280 渲染）：今日大奖 / 近期开奖(仅排期器 9 款) / 换个游戏。
// 数据全复用现有前端调用（/player/bigwins、/round/history），禁新开内联 fetch；游戏内部文件零改。
export default function GameSideRail({ currentGameId, playerToken, onSelect, onLogout }) {
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance: NOOP })
  // usePlayerApi 每渲染重建（依赖不稳定），用 ref 承接免 effect 抖动；ref 写在 effect 内（禁 render 期改 ref）。
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })

  const [top, setTop] = useState([])                          // 今日大奖 Top5
  const [marquee, setMarquee] = useState([])                  // 大奖跑马灯（顶部横滚），与 top 同一 /player/bigwins 请求两用
  const [recentByBe, setRecentByBe] = useState({ be: null, items: [] })  // 近期开奖：连 be 一起存，换款前不串号

  const g = currentGameId ? GAME_BY_ID[currentGameId] : null
  const be = g?.backendId
  const isScheduler = !!currentGameId && SCHEDULER.has(currentGameId)

  // 大奖播报：20s 轮询 /player/bigwins（与多桌同频、同源）——**一次请求两用**：marquee(跑马灯)+top(今日大奖)，禁重复轮询。
  useEffect(() => {
    let cancelled = false
    const pull = () => apiRef.current.apiGet('/player/bigwins')
      .then(d => { if (!cancelled && d) { setTop(d.top || []); setMarquee(d.marquee || []) } })
      .catch(() => {})
    pull()
    const t = setInterval(pull, 20000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // 近期开奖：仅排期器款拉 /round/history?limit=5（多桌同款公开快照源），换款重拉。
  // setState 只在异步 .then 里（合规，非 effect 同步体）；非排期器/换款未回时靠下方 be 对齐派生空，禁串号。
  useEffect(() => {
    if (!isScheduler || !be) return
    let cancelled = false
    apiRef.current.apiGet(`/round/history/${be}?limit=5`)
      .then(d => { if (!cancelled) setRecentByBe({ be, items: (d?.items || []).map(it => ({ roundNo: it.roundNo, drawResult: it.drawResult })) }) })
      .catch(() => { if (!cancelled) setRecentByBe({ be, items: [] }) })
    return () => { cancelled = true }
  }, [be, isScheduler])

  // 只认与当前 be 对齐的结果：换款后旧款结果自动判空，不闪错款开奖。
  const recent = recentByBe.be === be ? recentByBe.items : []
  const others = pickOthers(currentGameId)

  return (
    <aside style={{
      // S4b：右栏改 position:fixed 贴视口右侧，脱离游戏布局流（游戏由 App 层 marginRight 让位）。
      // #46 单11 三栏配平：200→250（右胖）。⚠ 必须与 App.jsx 的 marginRight 同值同改，
      //   否则右栏压住游戏或留白（本件 fixed 脱流，靠那个 margin 让位）。
      position: 'fixed', top: 0, right: 0, width: 250, height: '100vh', overflowY: 'auto',
      zIndex: 30, boxSizing: 'border-box', padding: 10, background: COLORS.bg,
    }}>
      {/* 单S4c：大奖跑马灯 = 右栏第一件（今日大奖上方 200px 内横滚细条），融入卡风格圆角边框；空则不占位。 */}
      {marquee.length > 0 && (
        <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${COLORS.border}`, marginBottom: 10 }}>
          <BigWinMarqueeSlim items={marquee} />
        </div>
      )}
      {top.length > 0 && <TodayJackpot top={top} />}
      {isScheduler && <RecentDraws items={recent} be={be} />}
      <SwitchGame ids={others} onSelect={onSelect} />
    </aside>
  )
}
