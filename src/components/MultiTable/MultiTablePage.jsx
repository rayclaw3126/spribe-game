import { useState, useRef } from 'react'
import { MULTI_DARK as M } from '../shell/tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import GameRail from './GameRail'
import TableCard from './TableCard'
import BetSlip from './BetSlip'
import { DEFAULT_TABLES, CHIP_VALUES, ONLINE_COUNT, nameOf } from './mockData'

// #41 多桌专区（静态版·全假数据零请求）。
// 两栏：左列 200(上 GameRail 可滚 + 下 BetSlip 钉底) / 中 2 列网格(随页竖滚，不限行数)。
// 仅 PC ≥1024；<1024 出提示。桌数放开：追加/下桌自由，全下完显空态。
export default function MultiTablePage({ serverBalance, onBack }) {
  const isDesk = useMediaQuery('(min-width: 1024px)')

  const [tables, setTables] = useState(DEFAULT_TABLES)     // 在桌款（默认 CATALOG 前 4），可增删不限
  const [chip, setChip] = useState(CHIP_VALUES[0])         // 当前选中筹码档
  const [slip, setSlip] = useState([])                     // 假注单
  const [flashId, setFlashId] = useState(null)             // 已上桌款被点时高亮闪一下
  const slipSeq = useRef(0)                                // 注单行自增 id（不依赖 Date/随机）
  const flashTimer = useRef(null)

  // 左栏点款：未上桌 → 追加到网格末尾（不替换）；已上桌 → scrollIntoView 该桌 + 高亮闪一下
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
  // × 下桌：从网格移除（可全下完 → 网格显空态引导）
  const closeTable = (id) => setTables(prev => prev.filter(x => x !== id))
  // 快捷注键 → 以当前筹码额加一行进注单
  function addBet(gameId, market, odds) {
    slipSeq.current += 1
    setSlip(prev => [...prev, { id: slipSeq.current, gameId, gameName: nameOf(gameId), market, odds, amount: chip }])
  }
  const removeBet = (rid) => setSlip(prev => prev.filter(it => it.id !== rid))
  const confirmBets = () => console.log('[MultiTable] 一键确认（静态占位）', slip)   // 单3 接真

  // —— <1024：一行提示 + 返回大厅 ——
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

  // —— PC ≥1024：顶栏 + 两栏（页面整体竖滚，网格不限行数）——
  return (
    <div style={{ minHeight: '100vh', background: M.bg }}>
      {/* 顶栏（钉顶，竖滚时常驻） */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 18px', borderBottom: `1px solid ${M.line}`, background: M.panel,
      }}>
        <button type="button" onClick={onBack} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
          background: 'transparent', border: 'none', color: M.txtDim, fontSize: 13, fontWeight: 800,
        }}>← 大厅</button>
        <span style={{ color: M.txt, fontSize: 15, fontWeight: 900 }}>多桌专区</span>

        {/* 筹码档 1·5·10·50 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 700 }}>筹码</span>
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

        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: M.txtDim, fontSize: 12, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: M.betting }} />
          {ONLINE_COUNT} 在线
        </span>
        <span style={{ color: M.txtMute, fontSize: 12, fontWeight: 700 }}>
          余额 <span style={{ color: M.amount, fontWeight: 900 }}>${Number(serverBalance ?? 0).toFixed(2)}</span>
        </span>
      </header>

      {/* 两栏体：左列 200 钉住(上 GameRail 可滚 + 下 BetSlip 钉底)；中 2 列网格随页竖滚，不限行数 */}
      <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
        <div style={{
          position: 'sticky', top: 65, alignSelf: 'flex-start', height: 'calc(100vh - 77px)',
          flex: '0 0 200px', width: 200, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0,
        }}>
          <GameRail tables={tables} onSelect={selectGame} />
          <BetSlip items={slip} onRemove={removeBet} onConfirm={confirmBets} />
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
          ) : tables.map(id => (
            <TableCard key={id} id={id} onAddBet={addBet} onClose={closeTable} flash={flashId === id} />
          ))}
        </div>
      </div>
    </div>
  )
}
