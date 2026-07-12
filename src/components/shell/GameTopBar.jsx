import { COLORS, RADIUS, DERBY, LAYOUT } from './tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useBgm, useSfxMuted } from './bgmManager'
import { MusicNoteIcon, SpeakerIcon } from './AudioIcons'

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
// 注：gameName 已不再显示（18 个调用方均传 venue，场馆行足以标识当前游戏）。

export default function GameTopBar({ venue, roundId, phaseChip, subRow, onHowTo, onFairness, onBack, balance, rightExtra, band }) {
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [bgmOn, toggleBgm] = useBgm()
  const [muted, toggleMuted] = useSfxMuted()

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
  // 场馆件：场馆名全字（禁截断）+ 期号小字；桌面内联入顶行，移动落场馆行
  const venueBits = venue && (
    <>
      <span style={{
        color: DERBY.gold, fontSize: isDesk ? 11 : 10.5, fontWeight: 900, letterSpacing: 1,
        fontFamily: "'Space Grotesk', sans-serif", whiteSpace: 'nowrap', flex: '0 0 auto',
      }}>{venue}</span>
      {roundId && (
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: isDesk ? 10 : 9.5, fontWeight: 800, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
          #{roundId}
        </span>
      )}
    </>
  )
  // 余额：数字按 2 位小数渲染；已格式化的字符串（如 Aviator 的 money()）原样透出。
  const balanceBits = balance != null && (
    <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
      {typeof balance === 'number' ? balance.toFixed(2) : balance}
      {' '}
      <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
    </span>
  )

  const rightBits = (
    <>
      {balanceBits}
      {rightExtra}
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
    <div style={{
      flex: '0 0 auto',
      padding: '6px 12px',
      background: band ?? DERBY.band,
      display: 'flex', flexDirection: 'column', gap: 5,
      position: 'relative', zIndex: 5,
    }}>
      {/* 上行（桌面 = 唯一行）：← 大厅 + [桌面并入场馆件+chip] + [桌面 subRow] + 右侧钮组 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {backBtn}
        {isDesk && venueBits}
        {isDesk && phaseChip}
        <span style={{ marginLeft: 'auto' }} />
        {isDesk && subRow}
        {rightBits}
      </div>
      {/* 移动场馆行（venue/subRow 有值才渲染）：场馆名优先左 + chip + subRow 同行拼排 */}
      {!isDesk && (venue || subRow) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: subRow ? 'wrap' : undefined }}>
          {venueBits}
          {subRow
            ? <>{phaseChip}{subRow}</>
            : <><span style={{ marginLeft: 'auto' }} />{phaseChip}</>}
        </div>
      )}
    </div>
  )
}
