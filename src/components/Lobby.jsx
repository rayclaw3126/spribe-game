import { useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'
// 游戏数据 + 分类导航全部读单一数据源 gameRegistry
import { GAME_REGISTRY as GAMES, TOP_IDS, HOT_IDS, NEW_IDS, NAV_CATS } from '../gameRegistry'
import { LOBBY_DARK as D } from './shell/tokens'

// 热门/新游 —— 并入分类行末尾做两个特殊 pill，走现有 HOT_IDS/NEW_IDS curation，功能不丢。
const SPECIAL = [
  { key: 'hot', label: '热门' },
  { key: 'new', label: '新游' },
]

// 款数一律派生（禁手写数字）。fav 分支：收藏集大小（#44）。
function catCount(key, favIds) {
  if (key === 'all') return GAMES.length
  if (key === 'hot') return HOT_IDS.length
  if (key === 'new') return NEW_IDS.length
  if (key === 'fav') return favIds ? favIds.size : 0
  return GAMES.filter(g => g.navCat === key).length
}

// 切分类纯前端 filter，零请求。fav 分支：只留收藏款（#44，按注册表顺序）。
function filterGames(key, favIds) {
  if (key === 'all') return [...TOP_IDS.map(id => GAMES.find(g => g.id === id)), ...GAMES.filter(g => !TOP_IDS.includes(g.id))]
  if (key === 'hot') return GAMES.filter(g => HOT_IDS.includes(g.id))
  if (key === 'new') return GAMES.filter(g => NEW_IDS.includes(g.id))
  if (key === 'fav') return GAMES.filter(g => favIds && favIds.has(g.id))
  return GAMES.filter(g => g.navCat === key)
}

export default function Lobby({ onSelect, onOpenMulti, favIds, onToggleFav }) {
  const isDesk = useMediaQuery('(min-width: 1024px)')   // PC ≥1024 左侧栏 / 手机 <1024 顶部横滑
  const [cat, setCat] = useState('all')                 // 默认激活「全部」
  const TABS = [...NAV_CATS, ...SPECIAL]                 // 6 分类 + 热门/新游
  // #44 收藏浮顶：各分类页里已收藏的排最前，命中组/未命中组内部各自保持原序（稳定排序，
  // ES2019 起 Array.sort 稳定）。「我的最爱」页本身全是收藏、无需再排。
  const base = filterGames(cat, favIds)
  const shown = cat === 'fav'
    ? base
    : [...base].sort((a, b) => Number(!!(favIds && favIds.has(b.id))) - Number(!!(favIds && favIds.has(a.id))))
  const favEmpty = cat === 'fav' && shown.length === 0  // #44 我的最爱空态（居中两行）

  return (
    <div style={{ background: D.bg, minHeight: 'calc(100vh - 52px)' }}>
      {/* 隐藏移动横滑分类条滚动条（webkit；Firefox/IE 走内联 scrollbarWidth/msOverflowStyle） */}
      <style>{`.lobbyNav::-webkit-scrollbar{display:none}`}</style>
      <div style={{
        maxWidth: 1200, margin: '0 auto',
        padding: isDesk ? '24px 24px 40px' : '14px 12px 32px',
        color: D.txt,
      }}>
        <h1 style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800,
          fontSize: isDesk ? 26 : 22, color: D.txt, margin: '0 0 16px',
        }}>
          <span style={{ color: D.accent, fontSize: isDesk ? 22 : 20 }}>⚽</span>
          电子游戏
        </h1>

        <div style={{ display: isDesk ? 'flex' : 'block', gap: 24, alignItems: 'flex-start' }}>
          {/* ---- PC 左侧栏（分类列表） ---- */}
          {isDesk ? (
            <aside style={{
              flex: '0 0 200px', width: 200, position: 'sticky', top: 64,
              background: D.panel, border: `1px solid ${D.line}`, borderRadius: 12, padding: 6,
            }}>
              {/* 多桌专区正式入口：融入侧栏体系（accent 底强调=导航非筛选；PC ≥1024 专属，手机分支不显） */}
              {onOpenMulti && <MultiRow onClick={onOpenMulti} />}
              {/* #44 我的最爱：金★ 筛选行（版式抄 SideRow），下接 1px 分线再列常规分类 */}
              <FavRow count={catCount('fav', favIds)} active={cat === 'fav'} onClick={() => setCat('fav')} />
              <div style={{ height: 1, background: D.line, margin: '6px 6px 8px' }} />
              {TABS.map(t => (
                <SideRow key={t.key} label={t.label} count={catCount(t.key, favIds)}
                  active={cat === t.key} onClick={() => setCat(t.key)} />
              ))}
            </aside>
          ) : (
            /* ---- 手机 顶部横滑分类 tab ---- */
            <div className="lobbyNav" style={{
              display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none', msOverflowStyle: 'none', padding: '2px 0 12px',
            }}>
              {/* #44 我的最爱：金★ pill 置于横滑首位 */}
              <FavPill count={catCount('fav', favIds)} active={cat === 'fav'} onClick={() => setCat('fav')} />
              {TABS.map(t => (
                <MobilePill key={t.key} label={t.label} count={catCount(t.key, favIds)}
                  active={cat === t.key} onClick={() => setCat(t.key)} />
              ))}
            </div>
          )}

          {/* ---- 卡片网格（现有卡片组件保留，仅卡底/边线换 LOBBY_DARK，封面原样） ---- */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {favEmpty ? (
              /* #44 我的最爱空态：居中两行提示（无收藏时） */
              <div style={{
                minHeight: 240, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center',
              }}>
                <div style={{ color: D.txt, fontSize: 16, fontWeight: 700 }}>还没有收藏的游戏</div>
                <div style={{ color: D.txtMute, fontSize: 13 }}>点游戏卡右上角 ☆ 加入我的最爱</div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: isDesk ? 'repeat(auto-fill, minmax(240px, 1fr))' : 'repeat(2, minmax(0, 1fr))',
                gap: isDesk ? 16 : 10,
              }}>
                {shown.map((g, i) => (
                  <GameCard key={g.id} game={g} index={i} onSelect={onSelect} isDesk={isDesk}
                    fav={!!(favIds && favIds.has(g.id))} onToggleFav={onToggleFav} />
                ))}
              </div>
            )}
            <p style={{ textAlign: 'center', color: D.txtMute, fontSize: 13, marginTop: 42 }}>
              所有游戏均为虚拟余额——理性游戏，享受乐趣！
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 多桌专区入口行：与 SideRow 同版式（同宽/圆角/内距），accentBg 底 + 绿字 + 左绿条 + → 箭头，
// 醒目区分「导航动作」于下方「分类筛选」；置于侧栏顶部并留下边距分隔。
function MultiRow({ onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: D.accentBg, border: `1px solid ${D.accent}`,
      borderRadius: 8, padding: '10px 12px', margin: '0 0 8px', cursor: 'pointer',
      color: D.accent, fontSize: 14, fontWeight: 800, textAlign: 'left',
    }}>
      <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, borderRadius: 2, background: D.accent }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span>▦</span> 多桌专区</span>
      <span style={{ fontSize: 13, fontWeight: 900 }}>→</span>
    </button>
  )
}

// PC 侧栏行：激活态 = 左 2px 绿条 + cardHi(#1f242b) 底 + 绿字；款数右对齐灰字。
function SideRow({ label, count, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: active ? D.cardHi : 'transparent', border: 'none',
      borderRadius: 8, padding: '10px 12px', margin: '2px 0', cursor: 'pointer',
      color: active ? D.accent : D.txtDim, fontSize: 14, fontWeight: active ? 800 : 600,
      transition: 'background 0.15s, color 0.15s', textAlign: 'left',
    }}>
      {active && <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, borderRadius: 2, background: D.accent }} />}
      <span>{label}</span>
      <span style={{ color: active ? D.accent : D.txtMute, fontSize: 12, fontWeight: 700 }}>{count}</span>
    </button>
  )
}

// #44 PC 侧栏「我的最爱」行：版式抄 SideRow，加金★前缀。激活态同 SideRow（左绿条+cardHi 底+绿字）；
// 未激活时标签用金★区分于普通分类。count = 收藏数，实时随 favIds 变。
function FavRow({ count, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      position: 'relative', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: active ? D.cardHi : 'transparent', border: 'none',
      borderRadius: 8, padding: '10px 12px', margin: '2px 0', cursor: 'pointer',
      color: active ? D.accent : D.txtDim, fontSize: 14, fontWeight: active ? 800 : 600,
      transition: 'background 0.15s, color 0.15s', textAlign: 'left',
    }}>
      {active && <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 2, borderRadius: 2, background: D.accent }} />}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#ffd54f' }}>★</span> 我的最爱
      </span>
      <span style={{ color: active ? D.accent : D.txtMute, fontSize: 12, fontWeight: 700 }}>{count}</span>
    </button>
  )
}

// #44 手机横滑「我的最爱」pill：版式抄 MobilePill，加金★前缀。激活 = 绿底 + 墨绿字。
function FavPill({ count, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: '0 0 auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5,
      background: active ? D.accent : D.card, color: active ? D.accentInk : D.txtDim,
      border: `1px solid ${active ? D.accent : D.line}`,
      borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
    }}>
      <span style={{ color: active ? D.accentInk : '#ffd54f' }}>★</span>我的最爱
      <span style={{ opacity: 0.7, fontWeight: 700, fontSize: 12 }}>{count}</span>
    </button>
  )
}

// 手机横滑 pill：激活 = 绿底 + 墨绿字。
function MobilePill({ label, count, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: '0 0 auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5,
      background: active ? D.accent : D.card, color: active ? D.accentInk : D.txtDim,
      border: `1px solid ${active ? D.accent : D.line}`,
      borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
    }}>
      {label}<span style={{ opacity: 0.7, fontWeight: 700, fontSize: 12 }}>{count}</span>
    </button>
  )
}

function GameCard({ game, index, onSelect, isDesk, fav, onToggleFav }) {
  // 角标：命中 HOT_IDS 显「热门」（绿底墨绿字），否则命中 NEW_IDS 显「新游」（#1f242b 底白字）；
  // 双标（既热门又新游）只显热门（HOT 先判）。
  const badge = HOT_IDS.includes(game.id) ? { label: '热门', bg: D.accent, ink: D.accentInk }
    : NEW_IDS.includes(game.id) ? { label: '新游', bg: D.cardHi, ink: '#fff' }
      : null
  return (
    <button
      onClick={() => onSelect(game.id)}
      style={{
        position: 'relative', display: 'block', width: '100%',
        aspectRatio: '3 / 2', overflow: 'hidden',
        background: D.card, border: `1px solid ${D.line}`, borderRadius: 12,
        padding: 0, cursor: 'pointer',
        animation: `fadeIn 0.5s ease ${index * 0.06}s both`,
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(74,222,128,0.4)'
        const img = e.currentTarget.querySelector('img'); if (img) img.style.transform = 'scale(1.03)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = D.line
        const img = e.currentTarget.querySelector('img'); if (img) img.style.transform = 'scale(1)'
      }}
    >
      {/* 封面铺满整卡 */}
      {game.cover
        ? <img src={game.cover} alt={game.name} style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block', transition: 'transform 0.2s',
          }} />
        : <div style={{ position: 'absolute', inset: 0, background: D.card }} />}

      {/* 底部遮罩：压住封面下半，保白字可读 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `linear-gradient(transparent 45%, ${D.scrim})`,
      }} />

      {/* #44 右上角 收藏☆钮（恒显，方案A）：用 span 避免 button 套 button 非法嵌套；
          点击必 stopPropagation 防冒泡触发整卡 onSelect（不进游戏）。左上角标在对角不遮。 */}
      {onToggleFav && (
        <span
          role="button"
          aria-label={fav ? '取消收藏' : '加入我的最爱'}
          onClick={(e) => { e.stopPropagation(); onToggleFav(game.id) }}
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 3,
            width: 26, height: 26, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(10,12,16,0.6)', border: '1px solid rgba(255,255,255,0.16)',
            color: fav ? '#ffd54f' : '#aab1bb', fontSize: 15, lineHeight: 1, cursor: 'pointer',
          }}
        >{fav ? '★' : '☆'}</span>
      )}

      {/* 左上角 热门/新游 角标（浮图上；游戏名在左下，二者不重叠） */}
      {badge && (
        <span style={{
          position: 'absolute', top: 8, left: 8, zIndex: 2,
          background: badge.bg, color: badge.ink,
          fontSize: isDesk ? 11 : 10, fontWeight: 800, letterSpacing: 0.3,
          padding: '3px 8px', borderRadius: 999, lineHeight: 1.4,
        }}>{badge.label}</span>
      )}

      {/* 左下角：游戏名（白 500）+ desc 单行 ellipsis */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, textAlign: 'left',
        padding: isDesk ? '10px 12px' : '8px 10px',
      }}>
        <div style={{
          color: '#fff', fontSize: isDesk ? 15 : 13, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{game.name}</div>
        <div style={{
          color: D.txtDim, fontSize: isDesk ? 12 : 11, fontWeight: 400, marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{game.desc}</div>
      </div>
    </button>
  )
}
