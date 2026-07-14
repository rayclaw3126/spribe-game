import { useState, useRef, useEffect } from 'react'
import { MULTI_DARK as M } from '../shell/tokens'
import { usePlayerApi } from '../../lib/playerApi'
import { formatDraw, shortRoundNo } from '../drawFormatters'
import { MARKET_GROUPS, nameOf, venueOf, backendOf } from './mockData'
import { oddsStr, beadOf } from './marketsRegistry'
import { useSfxMuted } from '../shell/bgmManager'
import { STAGE_BY_ID } from './stageRegistry'
import Chip from '../shell/Chip'

const NOOP = () => {}   // apiGet 不写余额，setServerBalance 传稳定 noop 保 usePlayerApi memo 不抖
const BEAD_C = { up: M.beadUp, down: M.beadDown, tie: M.beadTie }   // 路珠三色（tone → tokens 色）

// 开奖大数拆两行：按首个「·」或空格拆 → [前段, 后段]；单段（如纯数字）后段为 ''
function splitDraw(s) {
  if (!s) return ['', '']
  const i = s.search(/[·\s]/)
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
}

// room.phase → 文案 + 色（服务器权威六态）。色全走 MULTI_DARK。
function phaseMeta(phase) {
  switch (phase) {
    case 'betting': return { text: '投注中', c: M.betting, bg: M.bettingTint, timed: true }
    case 'locked':  return { text: '锁盘',   c: M.locked,  bg: M.lockedTint, timed: false }
    case 'drawn':   return { text: '开奖中', c: M.drawing, bg: M.drawingTint, timed: false }
    case 'settled': return { text: '已结算', c: M.drawing, bg: M.drawingTint, timed: false }
    case 'idle':    return { text: '等待',   c: M.txtMute, bg: M.cardHi, timed: true }
    default:        return { text: '连接中', c: M.txtMute, bg: M.cardHi, timed: false }   // connecting
  }
}
// 倒计时 ms → mm:ss
const fmtMs = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// 性能桩→接活：滚出视口停「渲染」（WS 由上层常驻，不断连接）。单3 启用真 IO。
function useInViewport(ref) {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '150px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return inView
}

// 单张桌卡（接活）：room 下发相位/期号/倒计时/开奖；上期+迷你路珠首帧 /round/history 播种、
// 之后收 drawn 结果滚动追加；盘口赔率读 markets（oddsStr）；下注仍假（onAddBet → 右栏注单）。
export default function TableCard({ id, room, playerToken, onLogout, stakedAmt, stakes, mode, quickState, onAddBet, onQuickBet, onClose, onOpenGame, flash }) {
  const be = backendOf(id)
  const [muted] = useSfxMuted()   // 全局 SFX 静音（顶栏钮同步；speedgrid 真舞台用）
  // 盘口点击：快投模式 → 立即发单键；注单模式 → 进 slip
  const cellClick = (q) => (mode === 'quick' ? onQuickBet : onAddBet)(id, q.key, q.label, oddsStr(id, q.key))
  // 快投按钮态 → 底/边/透明度 + 飞行 loading 点
  const quickFx = (q) => {
    const st = quickState?.[`${id}:${q.key}`]
    return {
      bg: st === 'ok' ? M.betting : st === 'err' ? M.danger : M.cardHi,
      bd: st === 'ok' ? M.betting : st === 'err' ? M.danger : M.line,
      op: st === 'flying' ? 0.55 : 1,
      flying: st === 'flying',
    }
  }
  // 盘口键本期已投 → 键右下叠筹码码（面额=该键累投额，色随档；未投不显；避让左上 loading 点 + 底部赔率）。
  // 数据只读 stakes（= 桌头同源 submittedRef.byKey，禁另起账）。组头小计仍走文字（下方 groupStake）。
  const stakeChip = (key) => (stakes && stakes[key] > 0
    ? <span style={{ position: 'absolute', bottom: 1, right: 1, zIndex: 3, pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))' }}>
        <Chip value={stakes[key]} size={24} />
      </span>
    : null)
  const groupStake = (grp) => (stakes ? grp.keys.reduce((s, q) => s + (stakes[q.key] || 0), 0) : 0)
  const rootRef = useRef(null)
  const inView = useInViewport(rootRef)
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance: NOOP })

  const [open, setOpen] = useState({ 0: true })   // 展开状态每桌独立（key=id 天然隔离）
  const toggle = (gi) => setOpen((o) => ({ ...o, [gi]: !o[gi] }))

  // 上期 + 迷你路珠：首帧 history?limit=8 播种；新一期结算(settled) 重拉 → 滚动更新。
  // 仅在异步 .then 里 setState（合规，非 effect 同步体）。当前开奖结果在渲染层即时并入。
  const [past, setPast] = useState([])   // [{roundNo, drawResult}] 新→旧（来自 history）
  const settledRound = room.phase === 'settled' ? room.roundNo : null
  useEffect(() => {
    let cancelled = false
    api.apiGet(`/round/history/${be}?limit=8`)
      .then(d => { if (!cancelled) setPast((d.items || []).map(it => ({ roundNo: it.roundNo, drawResult: it.drawResult }))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [be, settledRound])   // eslint-disable-line react-hooks/exhaustive-deps

  // 渲染层并入「本期开奖」结果（drawn/settled 时即时上珠，早于 history 重拉），按 roundNo 去重
  const liveCur = (room.phase === 'drawn' || room.phase === 'settled') && room.drawResult && room.roundNo && past[0]?.roundNo !== room.roundNo
    ? [{ roundNo: room.roundNo, drawResult: room.drawResult }] : []
  const beads = [...liveCur, ...past].slice(0, 8)

  const ph = phaseMeta(room.phase)
  const disc = room.connected === false   // 断线：相位 chip 转「重连中」灰；恢复自动回正（退避重连在 useRoundRoom）
  const cd = fmtMs(room.countdownMs)
  const lastTxt = beads[0]?.drawResult ? (formatDraw(be, beads[0].drawResult) || '—') : '—'
  const drawTxt = room.drawResult ? (formatDraw(be, room.drawResult) || '') : ''
  const roundLabel = room.roundNo ? `#${shortRoundNo(room.roundNo)}` : '#…'

  return (
    <div ref={rootRef} data-table-id={id} style={{
      display: 'flex', flexDirection: 'column',
      background: M.card, border: `1px solid ${flash ? M.accent : M.line}`, borderRadius: 12,
      overflow: 'hidden', minHeight: 240,
      boxShadow: flash ? `0 0 0 2px ${M.accent}` : 'none', transition: 'box-shadow 0.2s, border-color 0.2s',
    }}>
      {/* —— 头行（常渲染，轻量）—— */}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderBottom: `1px solid ${M.line}`,
      }}>
        <span style={{ color: M.txt, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>{nameOf(id)}</span>
        <span title={room.roundNo || ''} style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>{roundLabel}</span>
        {stakedAmt != null && (
          <span style={{ background: M.bettingTint, color: M.accent, borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' }}>本期已投 ${stakedAmt}</span>
        )}
        <span style={{
          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
          background: disc ? M.cardHi : ph.bg, color: disc ? M.txtMute : ph.c, border: `1px solid ${disc ? M.line : ph.c}`,
          borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: disc ? M.txtMute : ph.c }} />
          {disc ? '重连中' : `${ph.text}${ph.timed && room.countdownMs > 0 ? ` · ${cd}` : ''}`}
        </span>
        <button type="button" onClick={() => onOpenGame?.(id)} aria-label="进入完整游戏页" title="进入完整游戏页" style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
          background: M.cardHi, border: `1px solid ${M.line}`, color: M.txtDim, fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⤢</button>
        <button type="button" onClick={() => onClose(id)} aria-label="下桌" style={{
          flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
          background: M.cardHi, border: `1px solid ${M.line}`, color: M.txtDim, fontSize: 13, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>×</button>
      </div>

      {/* —— 离屏：停渲染重内容，只留占位撑高（WS 不断）—— */}
      {!inView ? (
        <div style={{ flex: '1 1 auto', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: M.txtMute, fontSize: 11 }}>
          {ph.text}
        </div>
      ) : (
        <>
          {STAGE_BY_ID[id] ? (
            /* 真舞台上桌：抽件 Stage 铺满 150px（场馆皮自带）；倒计时/封盘/结算叠显上层，信息不丢 */
            (() => { const StageComp = STAGE_BY_ID[id]; return (
            <div style={{ flex: '0 0 auto', height: 150, position: 'relative', overflow: 'hidden', background: M.panel }}>
              <StageComp phase={room.phase} roundNo={room.roundNo} drawResult={room.drawResult} muted={muted} height={150} />
              <span style={{ position: 'absolute', top: 4, left: 8, color: M.txtMute, fontSize: 9, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>{venueOf(id)}</span>
              {(room.phase === 'betting' || room.phase === 'idle') && !room.drawResult && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, pointerEvents: 'none' }}>
                  <span style={{ color: room.countdownMs <= 5000 ? M.danger : M.betting, fontSize: 58, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 10px rgba(0,0,0,0.75)' }}>{cd}</span>
                  <span style={{ color: M.txt, fontSize: 11, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.85)' }}>上期 {lastTxt}</span>
                </div>
              )}
              {room.phase === 'locked' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ color: M.locked, fontSize: 58, fontWeight: 900, textShadow: '0 2px 10px rgba(0,0,0,0.75)' }}>封盘</span>
                </div>
              )}
              {room.settleInfo && room.settleInfo.roundNo === room.roundNo && (
                <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: Number(room.settleInfo.totalPayout) > 0 ? M.betting : M.txt, textShadow: '0 1px 4px rgba(0,0,0,0.85)' }}>
                    {Number(room.settleInfo.totalPayout) > 0 ? `本期 中 $${Number(room.settleInfo.totalPayout).toFixed(2)}` : '本期 未中'}
                  </span>
                </div>
              )}
            </div>
            )})()
          ) : (
          /* 迷你舞台：三相位 + 等待 定高 150px（相位切换零跳动，两行开奖副行也包在内不撑高） */
          <div style={{
            flex: '0 0 auto', height: 150, overflow: 'hidden',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, padding: '0 10px', background: M.panel,
          }}>
            <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{venueOf(id)}</span>
            {room.phase === 'connecting' ? (
              <span style={{ color: M.txtMute, fontSize: 15, fontWeight: 800 }}>连接中…</span>
            ) : (room.phase === 'drawn' || room.phase === 'settled' || (room.phase === 'idle' && room.drawResult)) ? (
              // 开奖后到下一期 betting 之间（drawn/settled/idle 且结果在）都亮开奖大数

              <>
                <span style={{ color: M.drawing, fontSize: 11, fontWeight: 900, letterSpacing: 1 }}>开奖</span>
                {(() => {
                  const [front, back] = splitDraw(drawTxt || '—')
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.02 }}>
                      <span style={{ color: M.drawing, fontSize: front.length > 5 ? 40 : 58, fontWeight: 900, textAlign: 'center' }}>{front}</span>
                      {back && <span style={{ color: M.drawing, fontSize: 14, fontWeight: 800, marginTop: 2 }}>{back}</span>}
                    </div>
                  )
                })()}
                {/* 本期结算行（读 room.settleInfo；仅本人有注才有）：中$X / 未中 */}
                {room.settleInfo && room.settleInfo.roundNo === room.roundNo && (
                  <span style={{ marginTop: 2, fontSize: 12, fontWeight: 800, color: Number(room.settleInfo.totalPayout) > 0 ? M.betting : M.txtMute }}>
                    {Number(room.settleInfo.totalPayout) > 0 ? `本期 中 $${Number(room.settleInfo.totalPayout).toFixed(2)}` : '本期 未中'}
                  </span>
                )}
              </>
            ) : room.phase === 'locked' ? (
              <>
                <span style={{ color: M.locked, fontSize: 58, fontWeight: 900, lineHeight: 1 }}>封盘</span>
                <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>上期 {lastTxt}</span>
              </>
            ) : (
              <>
                {/* 最后 5 秒（≤5000ms）转红 */}
                <span style={{ color: room.countdownMs <= 5000 ? M.danger : M.betting, fontSize: 58, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{cd}</span>
                <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>上期 {lastTxt}</span>
              </>
            )}
          </div>
          )}

          {/* 盘口分组手风琴（赔率读 markets） */}
          <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
            {(MARKET_GROUPS[id] || []).map((grp, gi) => {
              const isOpen = !!open[gi]
              const gStake = groupStake(grp)   // 组内本期已投合计
              return (
                <div key={grp.group} style={{ borderTop: `1px solid ${M.line}` }}>
                  <button type="button" onClick={() => toggle(gi)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 10px', textAlign: 'left',
                  }}>
                    <span style={{ color: M.txtMute, fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span>
                    <span style={{ flex: 1, color: isOpen ? M.txt : M.txtDim, fontSize: 12, fontWeight: 800 }}>{grp.group}</span>
                    {/* 收起且组内有注 → 组头附小计（展开则明细在键上，不重复显） */}
                    {!isOpen && gStake > 0 && (
                      <span style={{ background: M.bettingTint, color: M.amount, borderRadius: 999, padding: '0 6px', fontSize: 10, fontWeight: 900 }}>${gStake}</span>
                    )}
                    <span style={{ color: M.txtMute, fontSize: 10, fontWeight: 700 }}>{grp.keys.length}</span>
                  </button>
                  {isOpen && (grp.grid ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(42px, 1fr))', gap: 4, padding: '0 10px 10px' }}>
                      {grp.keys.map(q => { const fx = quickFx(q); return (
                        <button key={q.key} type="button" data-bet-key={q.key} onClick={() => cellClick(q)} style={{
                          position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                          background: fx.bg, border: `1px solid ${fx.bd}`, borderRadius: 6, padding: '5px 1px', cursor: 'pointer', opacity: fx.op, transition: 'background 0.15s, border-color 0.15s',
                        }}>
                          {fx.flying && <span style={{ position: 'absolute', top: 2, left: 3, width: 5, height: 5, borderRadius: '50%', background: M.locked }} />}
                          {stakeChip(q.key)}
                          <span style={{ color: M.txt, fontSize: 11, fontWeight: 800, lineHeight: 1.1 }}>{q.label}</span>
                          <span style={{ color: M.amount, fontSize: 8, fontWeight: 700 }}>{oddsStr(id, q.key)}</span>
                        </button>
                      ) })}
                    </div>
                  ) : (
                    // 对边排位：二元盘 cols:2 成对同排（大|小），三向盘 cols:3（主|和|客）；默认 3
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grp.cols || 3}, 1fr)`, gap: 5, padding: '0 10px 10px' }}>
                      {grp.keys.map(q => { const fx = quickFx(q); return (
                        <button key={q.key} type="button" data-bet-key={q.key} onClick={() => cellClick(q)} style={{
                          position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                          background: fx.bg, border: `1px solid ${fx.bd}`, borderRadius: 8, padding: '6px 2px', cursor: 'pointer', opacity: fx.op, transition: 'background 0.15s, border-color 0.15s',
                        }}>
                          {fx.flying && <span style={{ position: 'absolute', top: 2, left: 3, width: 5, height: 5, borderRadius: '50%', background: M.locked }} />}
                          {stakeChip(q.key)}
                          <span style={{ color: M.txt, fontSize: 12, fontWeight: 800 }}>{q.label}</span>
                          <span style={{ color: M.amount, fontSize: 10, fontWeight: 700 }}>{oddsStr(id, q.key)}</span>
                        </button>
                      ) })}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          {/* 迷你路珠：8 颗单字色珠。判定走 markets derive+hitsOf（beadOf，禁自建二份表），
              色走 tokens 路珠三色；title 悬浮显完整 formatDraw 串 */}
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 5, padding: '8px 10px', borderTop: `1px solid ${M.line}` }}>
            {beads.length === 0 ? (
              <span style={{ color: M.txtMute, fontSize: 10 }}>暂无路珠</span>
            ) : beads.map((p, i) => {
              const b = beadOf(id, p.drawResult)
              return (
                <span key={p.roundNo || i} title={formatDraw(be, p.drawResult) || ''} style={{
                  flex: '0 0 auto', width: 20, height: 20, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: b ? BEAD_C[b.tone] : M.cardHi, color: b ? M.accentInk : M.txtMute,
                  fontSize: 10, fontWeight: 900,
                }}>{b ? b.face : '·'}</span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
