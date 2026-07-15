import { useState } from 'react'
import { MULTI_DARK as M, COLORS } from '../shell/tokens'
import Chip from '../shell/Chip'

// 右栏 190px 注单：顶「本轮注单·N」/ 注单行（游戏·盘口 / @赔率 / 可点改金额 / ×撤 / 失败标红）
// / 底部合计 + 一键确认（提交中禁重入）。数据/逻辑由上层 MultiTablePage 持有。
export default function BetSlip({ items, mode, quickLog = [], confirming, onRemove, onEditAmount, onConfirm }) {
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const total = items.reduce((s, it) => s + Number(it.amount), 0)
  const disabled = items.length === 0 || confirming

  function startEdit(it) { setEditId(it.id); setDraft(String(it.amount)) }
  function commit() { if (editId != null) { onEditAmount(editId, draft); setEditId(null) } }

  // 快投模式：slip 收起为一行小计「本期快投 $X」，点开看明细（只读不可撤——已发后端撤不了）
  if (mode === 'quick') {
    const qTotal = quickLog.reduce((s, it) => s + Number(it.amount), 0)
    return (
      <aside style={{
        flex: '0 0 auto', width: '100%', maxHeight: '50%',
        display: 'flex', flexDirection: 'column',
        background: COLORS.panel, border: `1px solid ${M.locked}`, borderRadius: 12, overflow: 'hidden',
      }}>
        <button type="button" onClick={() => setQuickOpen(o => !o)} style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          background: 'transparent', border: 'none', cursor: 'pointer', padding: '10px 12px',
        }}>
          <span style={{ color: M.txt, fontSize: 13, fontWeight: 800 }}>
            本期快投 <span style={{ color: M.amount, fontWeight: 900 }}>${qTotal}</span>
          </span>
          <span style={{ color: M.txtMute, fontSize: 11, fontWeight: 800 }}>{quickLog.length} {quickOpen ? '▾' : '▸'}</span>
        </button>
        {quickOpen && (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px', borderTop: `1px solid ${COLORS.border}` }}>
            {quickLog.length === 0 ? (
              <div style={{ color: M.txtMute, fontSize: 11, textAlign: 'center', padding: '14px 6px' }}>点桌卡盘口即时下注</div>
            ) : quickLog.map(it => (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: M.txt, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.gameName}·{it.market}</div>
                  <div style={{ color: M.txtMute, fontSize: 10, marginTop: 1 }}>@{it.odds} · 已发</div>
                </div>
                <span style={{ flex: '0 0 auto', lineHeight: 0 }}><Chip value={it.amount} size={18} /></span>
                <span style={{ flex: '0 0 auto', color: M.amount, fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>${it.amount}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside style={{
      flex: '0 0 auto', width: '100%', maxHeight: '50%',
      display: 'flex', flexDirection: 'column',
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden',
    }}>
      {/* 顶 */}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <span style={{ color: M.txt, fontSize: 13, fontWeight: 800 }}>本轮注单</span>
        <span style={{ background: M.bettingTint, color: M.accent, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 900 }}>{items.length}</span>
      </div>

      {/* 注单行 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 8px' }}>
        {items.length === 0 ? (
          <div style={{ color: M.txtMute, fontSize: 12, textAlign: 'center', padding: '14px 6px', lineHeight: 1.7 }}>
            <div>点桌卡快捷键</div>
            <div>加入注单</div>
          </div>
        ) : items.map(it => (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 4px 7px 6px', borderBottom: `1px solid ${COLORS.border}`,
            borderLeft: it.error ? `3px solid ${M.danger}` : '3px solid transparent',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: M.txt, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.gameName}·{it.market}
              </div>
              {it.error
                ? <div style={{ color: M.danger, fontSize: 10, fontWeight: 800, marginTop: 1 }}>{it.error}</div>
                : <div style={{ color: M.txtMute, fontSize: 10, marginTop: 1 }}>@{it.odds}</div>}
            </div>
            {/* 金额可点改（数字输入，min 1；超 caps.maxBet 上层钳制 + toast） */}
            {editId === it.id ? (
              <input type="number" min={1} value={draft} autoFocus
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditId(null) }}
                style={{
                  flex: '0 0 auto', width: 46, textAlign: 'right',
                  background: COLORS.surface, border: `1px solid ${M.amount}`, borderRadius: 5, color: M.amount,
                  fontSize: 12, fontWeight: 800, padding: '2px 4px',
                }} />
            ) : (
              <>
                <span style={{ flex: '0 0 auto', lineHeight: 0 }}><Chip value={it.amount} size={18} /></span>
                <span onClick={() => startEdit(it)} title="点击改金额" style={{
                  flex: '0 0 auto', color: M.amount, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  fontVariantNumeric: 'tabular-nums', textDecoration: 'underline', textDecorationStyle: 'dotted',
                }}>${it.amount}</span>
              </>
            )}
            <button type="button" onClick={() => onRemove(it.id)} aria-label="撤销" style={{
              flex: '0 0 auto', width: 18, height: 18, borderRadius: 5, cursor: 'pointer',
              background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: M.txtMute, fontSize: 11, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        ))}
      </div>

      {/* 底部合计 + 确认 */}
      <div style={{ flex: '0 0 auto', padding: '10px 12px', borderTop: `1px solid ${COLORS.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: M.txtDim, fontSize: 12, fontWeight: 700 }}>合计</span>
          <span style={{ color: M.amount, fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>${total}</span>
        </div>
        <button type="button" disabled={disabled} onClick={onConfirm} style={{
          width: '100%', padding: '9px 0', borderRadius: 10, border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
          background: M.accent, color: M.accentInk, fontSize: 13, fontWeight: 900,
        }}>{confirming ? '提交中…' : '一键确认'}</button>
      </div>
    </aside>
  )
}
