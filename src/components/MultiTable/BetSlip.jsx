import { MULTI_DARK as M } from '../shell/tokens'

// 右栏 190px 注单：顶「本轮注单·N」/ 注单行（游戏·盘口 $额 ×撤）/ 底部合计 + 一键确认。
// 全静态；确认仅 console.log（视觉可用）。数据由上层 MultiTablePage 持有。
export default function BetSlip({ items, onRemove, onConfirm }) {
  const total = items.reduce((s, it) => s + it.amount, 0)
  return (
    <aside style={{
      flex: '0 0 auto', width: '100%', maxHeight: '50%',
      display: 'flex', flexDirection: 'column',
      background: M.panel, border: `1px solid ${M.line}`, borderRadius: 12, overflow: 'hidden',
    }}>
      {/* 顶 */}
      <div style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: `1px solid ${M.line}`,
      }}>
        <span style={{ color: M.txt, fontSize: 13, fontWeight: 800 }}>本轮注单</span>
        <span style={{
          background: M.bettingTint, color: M.accent, borderRadius: 999,
          padding: '1px 8px', fontSize: 11, fontWeight: 900,
        }}>{items.length}</span>
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
            padding: '7px 4px', borderBottom: `1px solid ${M.line}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: M.txt, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.gameName}·{it.market}
              </div>
              <div style={{ color: M.txtMute, fontSize: 10, marginTop: 1 }}>@{it.odds}</div>
            </div>
            <span style={{ flex: '0 0 auto', color: M.amount, fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>${it.amount}</span>
            <button type="button" onClick={() => onRemove(it.id)} aria-label="撤销" style={{
              flex: '0 0 auto', width: 18, height: 18, borderRadius: 5, cursor: 'pointer',
              background: M.cardHi, border: `1px solid ${M.line}`, color: M.txtMute, fontSize: 11, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>×</button>
          </div>
        ))}
      </div>

      {/* 底部合计 + 确认 */}
      <div style={{ flex: '0 0 auto', padding: '10px 12px', borderTop: `1px solid ${M.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: M.txtDim, fontSize: 12, fontWeight: 700 }}>合计</span>
          <span style={{ color: M.amount, fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>${total}</span>
        </div>
        <button type="button" disabled={items.length === 0} onClick={onConfirm} style={{
          width: '100%', padding: '9px 0', borderRadius: 10, border: 'none',
          cursor: items.length === 0 ? 'not-allowed' : 'pointer', opacity: items.length === 0 ? 0.45 : 1,
          background: M.accent, color: M.accentInk, fontSize: 13, fontWeight: 900,
        }}>一键确认</button>
      </div>
    </aside>
  )
}
