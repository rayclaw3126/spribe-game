import { useState, useRef, useEffect } from 'react'
import { MULTI_DARK as M } from '../shell/tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { usePlayerApi } from '../../lib/playerApi'
import WinToast from '../shell/WinToast'
import GameRail from './GameRail'
import TableCard from './TableCard'
import BetSlip from './BetSlip'
import { useAllRooms } from './useAllRooms'
import { mapBetError } from './betErrors'
import { DEFAULT_TABLES, CHIP_VALUES, ONLINE_COUNT, ALL_TABLE_IDS, nameOf, backendOf } from './mockData'

// #41 多桌专区（单4 接真下注）。
// 钱路径唯一 = playerApi.apiPlay（每款一次 POST /round/<be>/play，自动幂等键 + balanceAfter 回写）；
// 余额只认 balanceAfter（下注回写 + settleInfo 回写）；禁改后端。相位/期号/开奖/路珠走 useRoundRoom。
// 两栏：左列 200(GameRail + BetSlip) / 中 2 列网格竖滚。仅 PC ≥1024。
export default function MultiTablePage({ serverBalance, setServerBalance, caps, playerToken, onLogout, onBack }) {
  const isDesk = useMediaQuery('(min-width: 1024px)')
  const rooms = useAllRooms(isDesk ? playerToken : '')   // 9 条 WS 常驻
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance })   // apiPlay 自动回写 balanceAfter

  const [tables, setTables] = useState(DEFAULT_TABLES)
  const [chip, setChip] = useState(CHIP_VALUES[0])
  const [slip, setSlip] = useState([])                 // [{id, gameId, gameName, key, market, odds, amount, error}]
  const [submitted, setSubmitted] = useState({})       // {gameId:{roundNo,total}} 本期已投（roundNo 不匹配即隐）
  const [confirming, setConfirming] = useState(false)  // 确认中：禁重入
  const [toasts, setToasts] = useState([])             // 瞬时提示（已封盘/触顶/错误）
  const [winToasts, setWinToasts] = useState([])       // 中奖 WinToast
  const [flashId, setFlashId] = useState(null)
  const [mode, setMode] = useState('slip')             // 'slip' 注单模式(默认) | 'quick' 快投
  const [quickState, setQuickState] = useState({})     // {`gid:key`: 'flying'|'ok'|'err'} 快投按钮态
  const [quickLog, setQuickLog] = useState([])         // 已发快投明细（只读不可撤）
  const slipSeq = useRef(0)
  const toastSeq = useRef(0)
  const winSeq = useRef(0)
  const quickSeq = useRef(0)
  const flashTimer = useRef(null)
  const seenSettleRef = useRef(new Set())

  const capOf = (gameId) => caps?.[backendOf(gameId)] || {}
  function pushToast(text) {
    toastSeq.current += 1
    const tid = toastSeq.current
    setToasts(t => [...t, { id: tid, text }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== tid)), 2200)
  }

  // 左栏点款：未上桌 → 追加末尾；已上桌 → 滚到 + 高亮闪
  function selectGame(id) {
    if (tables.includes(id)) {
      document.querySelector(`[data-table-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashId(id)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlashId(null), 700)
    } else {
      setTables(prev => [...prev, id])
    }
  }
  const closeTable = (id) => setTables(prev => prev.filter(x => x !== id))

  // 挂注：该桌非 betting → 拒挂 toast；风控前置显示预估派彩超顶警示（不拦，后端结算钳制）
  function addBet(gameId, key, label, odds) {
    const room = rooms[gameId]
    if (!room || room.phase !== 'betting') { pushToast(`${nameOf(gameId)}·已封盘`); return }
    const cap = capOf(gameId)
    const est = chip * Number(odds || 0)
    if (cap.maxPayout != null && est > Number(cap.maxPayout)) pushToast(`⚠ 触顶 上限 $${Number(cap.maxPayout).toFixed(0)}`)
    slipSeq.current += 1
    setSlip(prev => [...prev, { id: slipSeq.current, gameId, gameName: nameOf(gameId), key, market: label, odds, amount: chip, error: null }])
  }
  const removeBet = (rid) => setSlip(prev => prev.filter(it => it.id !== rid))

  // 金额编辑：min 1；超该款 caps.maxBet 钳制 + toast
  function editAmount(rowId, raw) {
    const row = slip.find(it => it.id === rowId)
    if (!row) return
    let v = Math.floor(Number(raw))
    if (!Number.isFinite(v) || v < 1) v = 1
    const cap = capOf(row.gameId)
    if (cap.maxBet != null && v > Number(cap.maxBet)) { v = Number(cap.maxBet); pushToast(`超上限 已钳制 $${Number(cap.maxBet).toFixed(0)}`) }
    setSlip(prev => prev.map(it => (it.id === rowId ? { ...it, amount: v, error: null } : it)))
  }

  // 本期已投累加（快投逐笔加；roundNo 换即重置）
  function recordSubmitted(gid, roundNo, add) {
    setSubmitted(prev => {
      const cur = prev[gid]
      const total = cur && cur.roundNo === roundNo ? cur.total + add : add
      return { ...prev, [gid]: { roundNo, total: Number(total.toFixed(2)) } }
    })
  }
  const clearCell = (ck) => setQuickState(s => { const n = { ...s }; delete n[ck]; return n })
  const flashErr = (ck) => { setQuickState(s => ({ ...s, [ck]: 'err' })); setTimeout(() => clearCell(ck), 800) }

  // 快投：点盘口即发单键 apiPlay，不进 slip。同键在飞禁重入（不同键可并发）；
  // 前置校验（点击前判，超 maxBet / 触顶 maxPayout / 已封盘 → toast + 闪红，不发）。
  async function quickBet(gameId, key, label, odds) {
    const ck = `${gameId}:${key}`
    if (quickState[ck] === 'flying') return
    const room = rooms[gameId]
    const cap = capOf(gameId)
    if (!room || room.phase !== 'betting') { pushToast(`${nameOf(gameId)}·已封盘`); flashErr(ck); return }
    if (cap.maxBet != null && chip > Number(cap.maxBet)) { pushToast(`超单注上限 $${Number(cap.maxBet).toFixed(0)}`); flashErr(ck); return }
    if (cap.maxPayout != null && chip * Number(odds || 0) > Number(cap.maxPayout)) { pushToast(`⚠ 触顶 上限 $${Number(cap.maxPayout).toFixed(0)}`); flashErr(ck); return }
    setQuickState(s => ({ ...s, [ck]: 'flying' }))
    try {
      const res = await api.apiPlay(backendOf(gameId), { bets: { [key]: chip } })   // ★唯一钱路径·单键
      setQuickState(s => ({ ...s, [ck]: 'ok' }))
      setTimeout(() => clearCell(ck), 700)
      recordSubmitted(gameId, res.roundNo, chip)
      quickSeq.current += 1
      setQuickLog(l => [{ id: quickSeq.current, gameName: nameOf(gameId), market: label, odds, amount: chip, roundNo: res.roundNo }, ...l])
    } catch (e) {
      setQuickState(s => ({ ...s, [ck]: 'err' }))   // 封盘竞态/后端 error → 闪红不重试
      setTimeout(() => clearCell(ck), 800)
      pushToast(mapBetError(e))
    }
  }

  // 一键确认：按 game 分组 → 每款一次 apiPlay（串行）；已封盘款整组退回标红，其余照发；
  // 成功款清出、记本期已投；失败款保留标红显后端 error 中文映射。
  async function confirmBets() {
    if (confirming || slip.length === 0) return
    const byGame = {}
    slip.forEach(it => { (byGame[it.gameId] ||= []).push(it) })

    const lockedRowIds = new Set()
    const sendable = []
    Object.keys(byGame).forEach(gid => {
      const r = rooms[gid]
      if (!r || r.phase !== 'betting') byGame[gid].forEach(it => lockedRowIds.add(it.id))
      else sendable.push(gid)
    })

    if (sendable.length === 0) {
      setSlip(prev => prev.map(it => (lockedRowIds.has(it.id) ? { ...it, error: '未提交·已封盘' } : it)))
      pushToast('全部已封盘，未提交')
      return
    }

    setConfirming(true)
    const succeededRowIds = new Set()
    const failedMsg = {}      // gid -> 中文错误
    const newSubmitted = {}
    for (const gid of sendable) {
      const rows = byGame[gid]
      const bets = {}   // 同 key 聚合注额
      rows.forEach(it => { bets[it.key] = Number((Number(bets[it.key] || 0) + Number(it.amount)).toFixed(2)) })
      try {
        const res = await api.apiPlay(backendOf(gid), { bets })   // ★唯一钱路径：POST /round/<be>/play
        rows.forEach(it => succeededRowIds.add(it.id))
        const total = rows.reduce((s, it) => s + Number(it.amount), 0)
        newSubmitted[gid] = { roundNo: res.roundNo, total: Number(total.toFixed(2)) }
      } catch (e) {
        failedMsg[gid] = mapBetError(e)
      }
    }

    // 单次收敛 slip：成功清出；封盘/失败保留标红
    setSlip(prev => prev
      .filter(it => !succeededRowIds.has(it.id))
      .map(it => {
        if (lockedRowIds.has(it.id)) return { ...it, error: '未提交·已封盘' }
        if (failedMsg[it.gameId]) return { ...it, error: failedMsg[it.gameId] }
        return { ...it, error: null }
      }))
    if (Object.keys(newSubmitted).length) setSubmitted(prev => ({ ...prev, ...newSubmitted }))
    const okN = Object.keys(newSubmitted).length
    const badN = Object.keys(failedMsg).length + (lockedRowIds.size ? 1 : 0)
    pushToast(badN ? `已提交 ${okN} 款 · ${badN > 0 ? '部分未成' : ''}`.trim() : `已提交 ${okN} 款`)
    setConfirming(false)
  }

  // 结算：各房 settleInfo 到达（新 roundId）→ 余额认 balanceAfter + 单期派彩>0 弹 WinToast。
  // 异步 .then 里 setState（非 effect 同步体，合规）。
  const settleSig = ALL_TABLE_IDS.map(id => rooms[id]?.settleInfo?.roundId || '').join('|')
  useEffect(() => {
    ALL_TABLE_IDS.forEach(id => {
      const si = rooms[id]?.settleInfo
      if (!si || si.roundId == null || seenSettleRef.current.has(si.roundId)) return
      seenSettleRef.current.add(si.roundId)
      Promise.resolve().then(() => {
        if (si.balanceAfter != null) setServerBalance(Number(si.balanceAfter))
        const pay = Number(si.totalPayout || 0)
        if (pay > 0) {
          winSeq.current += 1
          const tid = winSeq.current
          setWinToasts(w => [...w, { id: tid, label: `${nameOf(id)} 本期派彩`, win: pay }])
          setTimeout(() => setWinToasts(w => w.filter(t => t.id !== tid)), 3000)
        }
      })
    })
  }, [settleSig])   // eslint-disable-line react-hooks/exhaustive-deps

  // —— <1024：提示 + 返回 ——
  if (!isDesk) {
    return (
      <div style={{
        minHeight: '100vh', background: M.bg, color: M.txt,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.6 }}>多桌专区请使用电脑访问</div>
        <button type="button" onClick={onBack} style={{
          padding: '10px 22px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${M.line}`,
          background: M.card, color: M.txtDim, fontSize: 14, fontWeight: 800,
        }}>返回大厅</button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: M.bg }}>
      {/* 中奖 WinToast + 瞬时 toast 叠层（fixed 顶部居中） */}
      <div style={{ position: 'fixed', top: 8, left: 0, right: 0, zIndex: 60, pointerEvents: 'none' }}>
        <WinToast toasts={winToasts} />
      </div>
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: 56, left: 0, right: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: M.panel, border: `1px solid ${M.line}`, color: M.txt,
              borderRadius: 999, padding: '6px 16px', fontSize: 12, fontWeight: 800, boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
            }}>{t.text}</div>
          ))}
        </div>
      )}

      {/* 顶栏 */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 18px', borderBottom: `1px solid ${M.line}`, background: M.panel,
      }}>
        <button type="button" onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
          background: 'transparent', border: 'none', color: M.txtDim, fontSize: 13, fontWeight: 800,
        }}>← 大厅</button>
        <span style={{ color: M.txt, fontSize: 15, fontWeight: 900 }}>多桌专区</span>
        {/* 筹码档（快投模式高亮加边示警） */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: mode === 'quick' ? '3px 8px' : '0',
          borderRadius: 999, border: `1px solid ${mode === 'quick' ? M.locked : 'transparent'}`,
        }}>
          <span style={{ color: mode === 'quick' ? M.locked : M.txtMute, fontSize: 11, fontWeight: 700 }}>筹码</span>
          {CHIP_VALUES.map(v => {
            const on = v === chip
            return (
              <button key={v} type="button" onClick={() => setChip(v)} style={{
                minWidth: 30, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
                background: on ? M.amount : M.card, color: on ? M.accentInk : M.txtDim,
                border: `1px solid ${on ? M.amount : M.line}`, fontSize: 12, fontWeight: 900,
              }}>{v}</button>
            )
          })}
        </div>

        {/* 模式开关：注单(默认) / 快投 */}
        <div style={{ display: 'flex', border: `1px solid ${M.line}`, borderRadius: 999, overflow: 'hidden' }}>
          {[['slip', '注单'], ['quick', '快投']].map(([mk, ml]) => {
            const on = mode === mk
            return (
              <button key={mk} type="button" onClick={() => setMode(mk)} style={{
                padding: '4px 12px', cursor: 'pointer', border: 'none',
                background: on ? (mk === 'quick' ? M.locked : M.accent) : 'transparent',
                color: on ? M.accentInk : M.txtDim, fontSize: 12, fontWeight: 900,
              }}>{ml}</button>
            )
          })}
        </div>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: M.txtDim, fontSize: 12, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: M.betting }} />
          {ONLINE_COUNT} 在线
        </span>
        <span style={{ color: M.txtMute, fontSize: 12, fontWeight: 700 }}>
          余额 <span style={{ color: M.amount, fontWeight: 900 }}>${Number(serverBalance ?? 0).toFixed(2)}</span>
        </span>
      </header>

      {/* 两栏体 */}
      <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
        <div style={{
          position: 'sticky', top: 65, alignSelf: 'flex-start', height: 'calc(100vh - 77px)',
          flex: '0 0 200px', width: 200, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0,
        }}>
          <GameRail tables={tables} onSelect={selectGame} rooms={rooms} />
          <BetSlip items={slip} mode={mode} quickLog={quickLog} confirming={confirming} onRemove={removeBet} onEditAmount={editAmount} onConfirm={confirmBets} />
        </div>

        <div style={{
          flex: 1, minWidth: 0, display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridAutoRows: 'minmax(240px, auto)',
          gap: 12, alignContent: 'start',
        }}>
          {tables.length === 0 ? (
            <div style={{
              gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10, minHeight: 320, color: M.txtMute,
              background: M.card, border: `1px dashed ${M.line}`, borderRadius: 12,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: M.txtDim }}>桌面已清空</div>
              <div style={{ fontSize: 12 }}>从左栏点选游戏上桌</div>
            </div>
          ) : tables.map(id => {
            const room = rooms[id]
            const sub = submitted[id]
            const stakedAmt = sub && room?.roundNo === sub.roundNo ? sub.total : null   // 本期已投（roundNo 匹配才显）
            return (
              <TableCard key={id} id={id} room={room} playerToken={playerToken} onLogout={onLogout}
                stakedAmt={stakedAmt} mode={mode} quickState={quickState}
                onAddBet={addBet} onQuickBet={quickBet} onToast={pushToast} onClose={closeTable} flash={flashId === id} />
            )
          })}
        </div>
      </div>
    </div>
  )
}
