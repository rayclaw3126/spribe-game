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

// 款数一律派生（禁手写数字）
function catCount(key) {
  if (key === 'all') return GAMES.length
  if (key === 'hot') return HOT_IDS.length
  if (key === 'new') return NEW_IDS.length
  return GAMES.filter(g => g.navCat === key).length
}

// 切分类纯前端 filter，零请求
function filterGames(key) {
  if (key === 'all') return [...TOP_IDS.map(id => GAMES.find(g => g.id === id)), ...GAMES.filter(g => !TOP_IDS.includes(g.id))]
  if (key === 'hot') return GAMES.filter(g => HOT_IDS.includes(g.id))
  if (key === 'new') return GAMES.filter(g => NEW_IDS.includes(g.id))
  return GAMES.filter(g => g.navCat === key)
}

export default function Lobby({ onSelect }) {
  const isDesk = useMediaQuery('(min-width: 1024px)')   // PC ≥1024 左侧栏 / 手机 <1024 顶部横滑
  const [cat, setCat] = useState('all')                 // 默认激活「全部」
  const shown = filterGames(cat)
  const TABS = [...NAV_CATS, ...SPECIAL]                 // 6 分类 + 热门/新游

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
              {TABS.map(t => (
                <SideRow key={t.key} label={t.label} count={catCount(t.key)}
                  active={cat === t.key} onClick={() => setCat(t.key)} />
              ))}
            </aside>
          ) : (
            /* ---- 手机 顶部横滑分类 tab ---- */
            <div className="lobbyNav" style={{
              display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none', msOverflowStyle: 'none', padding: '2px 0 12px',
            }}>
              {TABS.map(t => (
                <MobilePill key={t.key} label={t.label} count={catCount(t.key)}
                  active={cat === t.key} onClick={() => setCat(t.key)} />
              ))}
            </div>
          )}

          {/* ---- 卡片网格（现有卡片组件保留，仅卡底/边线换 LOBBY_DARK，封面原样） ---- */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isDesk ? 'repeat(auto-fill, minmax(240px, 1fr))' : 'repeat(2, minmax(0, 1fr))',
              gap: isDesk ? 16 : 10,
            }}>
              {shown.map((g, i) => (
                <GameCard key={g.id} game={g} index={i} onSelect={onSelect} isDesk={isDesk} />
              ))}
            </div>
            <p style={{ textAlign: 'center', color: D.txtMute, fontSize: 13, marginTop: 42 }}>
              所有游戏均为虚拟余额——理性游戏，享受乐趣！
            </p>
          </div>
        </div>
      </div>
    </div>
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

function GameCard({ game, index, onSelect, isDesk }) {
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
