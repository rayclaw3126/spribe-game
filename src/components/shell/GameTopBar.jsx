import { createContext, useContext, useState } from 'react'
import { COLORS, RADIUS, DERBY, LAYOUT } from './tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useBgm, useSfxMuted } from './bgmManager'
import { MusicNoteIcon, SpeakerIcon } from './AudioIcons'
import { shortRoundNo } from '../drawFormatters'
import { GAME_REGISTRY } from '../../gameRegistry'
import GameSwitcher from './GameSwitcher'

// venue（架空场馆名）→ 游戏本名 反查：仅带 venue 的款入表。venue 串全站唯一且与游戏名零重叠，
// 故可由 venue 值反推出对应 displayName——无需改 21 款调用方，改动面收敛到本文件一处。
const VENUE_TO_NAME = Object.fromEntries(
  GAME_REGISTRY.filter(g => g.venue).map(g => [g.venue, g.displayName])
)

// App 通过此 Context 下发 setActiveGame(id|null)——GameSwitcher 切换游戏走它，
// 无需改 21 款游戏文件（它们只透传 GameTopBar，Context 隐形穿透）。
export const GameNavContext = createContext(null)

// 游戏顶栏共享件：
//   移动（<1024）两行 —— 上行 = ← 大厅 钮 + 右侧 ?/音乐/音效；
//     下行场馆行（venue/subRow 有值才渲染）= 场馆名全字 + 期号 + 相位 chip
//     + subRow 特件同行拼排（场馆名优先左；特件多时行内自换行）
//   桌面（≥1024）单行 —— 场馆行并入顶栏（← 大厅 后接 场馆名+期号+chip），
//     subRow 并入单行右侧（rightExtra 之前）
//   左上角 ← 大厅：一击直回大厅（onBack），不再是下拉菜单。
//   右侧：? 橙圆钮直接触发 onHowTo；音乐 = useBgm；音效 = useSfxMuted（全局同步）
// 砍掉旧内联顶栏的 余额 USD / DEMO MODE pill / 文字版 How-to-Play pill。
// 色值全部取 tokens 现组；band 缺省 DERBY.band（绿系轮次彩通用档）。
// 注：venue 命中反查时顶栏显「游戏名 · 场馆名」（游戏名白/永不截断，场馆名金绿/窄屏 ellipsis）；
//     venue 为游戏名兜底（无架空场馆）时保持现状，只显该名。

export default function GameTopBar({ venue, roundId, phaseChip, subRow, onHowTo, onFairness, onHistory, onBack, balance, rightExtra, band }) {
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, toggleMuted] = useSfxMuted()
  // 游戏内切换（仅移动端）：从 Context 拿 setActiveGame；当前款由 venue 反查（venue??displayName 全站唯一）。
  const switchGame = useContext(GameNavContext)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)   // 手机 ⋯ 溢出菜单
  const curGame = venue ? GAME_REGISTRY.find(g => (g.venue ?? g.displayName) === venue) : null

  const roundBtn = (onClick, title, active, children) => (
    <button key={title} type="button" onClick={onClick} title={title} style={{
      width: 28, height: 28, borderRadius: RADIUS.pill, flex: '0 0 auto',
      background: active ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
      color: active ? COLORS.white : COLORS.textMuted,
      border: `1px solid rgba(255,255,255,${active ? 0.6 : 0.25})`,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</button>
  )
  // 左上角：一击直回大厅
  const backBtn = (
    <button type="button" onClick={() => onBack?.()} title="返回大厅" style={{
      padding: '5px 14px', borderRadius: RADIUS.pill, flex: '0 0 auto',
      background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
      color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
      cursor: 'pointer', whiteSpace: 'nowrap',
    }}>← 大厅</button>
  )
  // 场馆件：命中反查=真场馆款，显「游戏名 · 场馆名」——游戏名白/永不截断，场馆名金绿/窄屏 ellipsis；
  //   未命中=venue 实为游戏名的兜底款，保持现状只显该名（不截断）。期号小字永远尾随、flex 固定不被挤叠。
  const gameName = venue ? VENUE_TO_NAME[venue] : null
  const venueBits = venue && (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, flex: gameName ? '0 1 auto' : '0 0 auto' }}>
      {gameName && (
        <>
          <span style={{
            color: COLORS.white, fontSize: isDesk ? 11 : 10.5, fontWeight: 900, letterSpacing: 1,
            fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap', flex: '0 0 auto',
          }}>{gameName}</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: isDesk ? 10 : 9.5, fontWeight: 900, flex: '0 0 auto' }}>·</span>
        </>
      )}
      <span style={{
        color: DERBY.gold, fontSize: isDesk ? 11 : 10.5, fontWeight: 900, letterSpacing: 1,
        fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap',
        ...(gameName ? { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto' } : { flex: '0 0 auto' }),
      }}>{venue}</span>
      {roundId && (
        <span title={String(roundId)} style={{ color: 'rgba(255,255,255,0.55)', fontSize: isDesk ? 10 : 9.5, fontWeight: 800, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          #{shortRoundNo(roundId)}
        </span>
      )}
    </span>
  )
  // 余额：数字按 2 位小数渲染；已格式化的字符串（如 Aviator 的 money()）原样透出。
  const balanceBits = balance != null && (
    <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
      {typeof balance === 'number' ? balance.toFixed(2) : balance}
      {' '}
      <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
    </span>
  )

  // 手机 ⋯ 溢出菜单：账单/公平性/玩法说明(各回调没传就不显该项，老规矩) + 音效开关(音乐+静音合并，显 开/关)。
  const soundOn = !muted
  const toggleSound = () => { toggleMuted(); if (bgmOn !== muted) toggleBgm() }   // 静音翻转 + bgm 同步到目标态
  const menuItem = (icon, label, onClick, hint) => (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: '9px 12px', borderRadius: 8, background: 'transparent', border: 'none',
      color: COLORS.text, fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center', flex: '0 0 auto' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ color: COLORS.green, fontSize: 12, fontWeight: 900, flex: '0 0 auto' }}>{hint}</span>}
    </button>
  )
  const overflowBtn = (
    <button type="button" onClick={() => setMenuOpen(o => !o)} title="更多" style={{
      width: 28, height: 28, borderRadius: RADIUS.pill, flex: '0 0 auto',
      background: menuOpen ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
      color: COLORS.white, border: '1px solid rgba(255,255,255,0.25)',
      fontSize: 18, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>⋯</button>
  )
  // 锚定小面板（右对齐，点外关闭）；面板挂在顶栏 div(position:relative)内、绝对定位下垂。
  const menuPanel = !isDesk && menuOpen && (
    <>
      <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 6 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 8, zIndex: 7,
        minWidth: 156, background: COLORS.panel, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        {onHistory && menuItem('📜', '账单', () => { setMenuOpen(false); onHistory() })}
        {onFairness && menuItem('⚖', '公平性', () => { setMenuOpen(false); onFairness() })}
        {onHowTo && menuItem('?', '玩法说明', () => { setMenuOpen(false); onHowTo() })}
        {menuItem(soundOn ? '♪' : '🔇', '音效开关', () => toggleSound(), soundOn ? '开' : '关')}
      </div>
    </>
  )

  const rightBits = (
    <>
      {balanceBits}
      {rightExtra}
      {/* 📜 开奖历史圆钮：仅当传入 onHistory 才渲染（照 ⚖/? 条件钮同款，轮次彩专用） */}
      {onHistory && (
        <button type="button" onClick={() => onHistory()} title="开奖历史" style={{
          width: 28, height: 28, borderRadius: RADIUS.pill, flex: '0 0 auto',
          background: 'rgba(0,0,0,0.3)', color: COLORS.textMuted, border: '1px solid rgba(255,255,255,0.25)',
          fontSize: 13, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>📜</button>
      )}
      {/* ⚖ 可验证公平圆钮：仅当传入 onFairness 才渲染（照 ? 钮同款，绿系区分玩法） */}
      {onFairness && (
        <button type="button" onClick={() => onFairness()} title="可验证公平" style={{
          width: 28, height: 28, borderRadius: RADIUS.pill, flex: '0 0 auto',
          background: DERBY.sel, color: '#0d2016', border: 'none',
          fontSize: 14, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>⚖</button>
      )}
      {/* ? 橙圆钮：仅当传入 onHowTo 才渲染（与 ⚖ 对称，避免没接玩法说明的款出死钮） */}
      {onHowTo && (
        <button type="button" onClick={() => onHowTo()} title="玩法说明" style={{
          width: 28, height: 28, borderRadius: RADIUS.pill, flex: '0 0 auto',
          background: DERBY.orange, color: COLORS.white, border: 'none',
          fontSize: 14, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>?</button>
      )}
      {roundBtn(toggleBgm, bgmOn ? '关闭背景音乐' : '开启背景音乐', bgmOn, <MusicNoteIcon on={bgmOn} />)}
      {roundBtn(toggleMuted, muted ? '取消静音' : '静音', !muted, <SpeakerIcon on={!muted} />)}
    </>
  )

  return (
    <>
    <div style={{
      flex: '0 0 auto',
      padding: '6px 12px',
      background: band ?? DERBY.band,
      display: 'flex', flexDirection: 'column', gap: 5,
      position: 'relative', zIndex: 5,
    }}>
      {/* 上行（桌面 = 唯一行）：← 大厅 + [桌面并入场馆件+chip] + [桌面 subRow] + 右侧钮组 */}
      {/* 溢出兜底：subRow 可截断（minWidth:0 overflow hidden），rightBits 不缩（flexShrink:0）——
          行再挤也是 subRow 特件被截，绝不叠到音乐钮/静音钮上。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {backBtn}
        {isDesk && venueBits}
        {isDesk && phaseChip}
        <span style={{ marginLeft: 'auto' }} />
        {isDesk && subRow && (
          <div style={{ minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>{subRow}</div>
        )}
        {/* 桌面：全钮内联；手机：只留 余额（永不挤切）+ ⋯（其余钮收进菜单） */}
        {isDesk
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{rightBits}</div>
          : <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{rightExtra}{balanceBits}{overflowBtn}</div>}
      </div>
      {/* 移动场馆行（venue/subRow 有值才渲染）：场馆名优先左 + chip + subRow 同行拼排 */}
      {!isDesk && (venue || subRow) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: subRow ? 'wrap' : undefined }}>
          {venueBits}
          {curGame && (
            <button type="button" onClick={() => setSwitcherOpen(true)} title="切换游戏" style={{
              flex: '0 0 auto', width: 20, height: 20, borderRadius: RADIUS.pill, padding: 0,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
              color: COLORS.white, fontSize: 10, lineHeight: 1, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>▾</button>
          )}
          {subRow
            ? <>{phaseChip}{subRow}</>
            : <><span style={{ marginLeft: 'auto' }} />{phaseChip}</>}
        </div>
      )}
      {menuPanel}
    </div>
    {!isDesk && (
      <GameSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)}
        currentId={curGame?.id}
        onSwitch={(id) => { setSwitcherOpen(false); switchGame?.(id) }} />
    )}
    </>
  )
}
