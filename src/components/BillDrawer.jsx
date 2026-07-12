import { useState, useEffect } from 'react'
import { COLORS, RADIUS } from './shell/tokens'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlayerApi } from '../lib/playerApi'
import { GAME_BY_BACKEND_ID } from '../gameRegistry'

// 账单抽屉：右侧滑入，两 tab —— 资金流水(/player/ledger) / 投注记录(/player/bets)。
// keyset 分页（nextCursor），只读 GET 走 playerApi.apiGet。色值全走 tokens。

const NOOP = () => {}   // apiGet 不写余额，setServerBalance 传稳定 noop，保 usePlayerApi memo 不抖
const TABS = [{ k: 'ledger', label: '资金流水' }, { k: 'bets', label: '投注记录' }]

// ledger.type → { 展示名, up(是否入账), 类型词 }。type 前缀=backendId，去 _bet/_payout 后缀反查 registry。
function ledgerMeta(type) {
  if (type === 'deposit') return { name: '充值', up: true, kind: '充值' }
  if (type === 'withdraw') return { name: '提现', up: false, kind: '提现' }
  const isPay = type.endsWith('_payout') || type === 'payout'
  const backendId = type.replace(/_(bet|payout)$/, '')
  const g = GAME_BY_BACKEND_ID[backendId]
  return { name: g ? g.displayName : (isPay ? '派彩' : '下注'), up: isPay, kind: isPay ? '派彩' : '下注' }
}

function fmtTime(iso) {
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const money = n => Number(n || 0).toFixed(2)

export default function BillDrawer({ open, onClose, playerToken, onLogout }) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance: NOOP })
  const [tab, setTab] = useState('ledger')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)     // nextCursor：null=没有更多
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [firstLoad, setFirstLoad] = useState(true)

  // open 或 tab 变化 → 重置并拉第一页
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setItems([]); setCursor(null); setErr(null); setFirstLoad(true); setLoading(true)
    api.apiGet(`/player/${tab}?limit=20`)
      .then(d => { if (cancelled) return; setItems(d.items); setCursor(d.nextCursor) })
      .catch(e => { if (!cancelled) setErr(e?.message || '加载失败，请重试') })
      .finally(() => { if (!cancelled) { setLoading(false); setFirstLoad(false) } })
    return () => { cancelled = true }
  }, [open, tab])   // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true); setErr(null)
    try {
      const d = await api.apiGet(`/player/${tab}?limit=20&cursor=${cursor}`)
      setItems(prev => [...prev, ...d.items])
      setCursor(d.nextCursor)
    } catch (e) {
      setErr(e?.message || '加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  const smallMuted = { fontSize: 11, color: COLORS.textFaint, marginTop: 3 }
  const iconBox = (bg, color) => ({
    width: 34, height: 34, borderRadius: RADIUS.pill, flex: '0 0 auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: bg, color, fontSize: 16, fontWeight: 900,
  })

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'flex-end',
    }}>
      <style>{`@keyframes billSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: isMobile ? '100%' : 420, height: '100%',
        background: COLORS.panel, borderLeft: `1px solid ${COLORS.border}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)', animation: 'billSlideIn 0.25s ease',
      }}>
        {/* 头部：标题 + 关闭 */}
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px', borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>我的账单</span>
          <button type="button" onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: RADIUS.pill, cursor: 'pointer',
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted,
            fontSize: 14, fontWeight: 900,
          }}>✕</button>
        </div>

        {/* tab 切换 */}
        <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, padding: '12px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          {TABS.map(t => {
            const active = tab === t.k
            return (
              <button key={t.k} type="button" onClick={() => setTab(t.k)} style={{
                flex: 1, padding: '8px 0', borderRadius: RADIUS.pill, cursor: 'pointer',
                fontSize: 13, fontWeight: 800,
                background: active ? COLORS.green : COLORS.surface,
                color: active ? '#06251a' : COLORS.textMuted,
                border: `1px solid ${active ? COLORS.green : COLORS.border}`,
              }}>{t.label}</button>
            )
          })}
        </div>

        {/* 列表体 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
          {firstLoad && loading ? (
            <div style={{ textAlign: 'center', color: COLORS.textMuted, fontSize: 13, padding: '40px 0' }}>加载中…</div>
          ) : err ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ color: COLORS.amber, fontSize: 13, marginBottom: 12 }}>{err}</div>
              <button type="button" onClick={() => setTab(tab)} style={{
                padding: '6px 16px', borderRadius: RADIUS.pill, cursor: 'pointer',
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12, fontWeight: 700,
              }}>重试</button>
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLORS.textFaint, fontSize: 13, padding: '48px 0' }}>
              {tab === 'ledger' ? '暂无资金流水' : '暂无投注记录'}
            </div>
          ) : tab === 'ledger' ? (
            items.map(it => {
              const m = ledgerMeta(it.type)
              const color = m.up ? COLORS.green : (it.type === 'withdraw' ? COLORS.amber : COLORS.redDark)
              const tint = m.up ? COLORS.greenTint : (it.type === 'withdraw' ? COLORS.amberTint : COLORS.slateTint)
              return (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={iconBox(tint, color)}>{m.up ? '↑' : (it.type === 'withdraw' ? '−' : '↓')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{m.name}</div>
                    <div style={smallMuted}>{m.kind} · {fmtTime(it.created_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color }}>{m.up ? '+' : '−'}{money(it.amount)}</div>
                    <div style={smallMuted}>余额 {money(it.balance_after)}</div>
                  </div>
                </div>
              )
            })
          ) : (
            items.map(it => {
              const g = GAME_BY_BACKEND_ID[it.game]
              const won = it.outcome === 'win'
              const badge = won ? { t: '赢', c: COLORS.green, bg: COLORS.greenTint } : it.outcome === 'lose' ? { t: '输', c: COLORS.slate, bg: COLORS.slateTint } : { t: '进行中', c: COLORS.amber, bg: COLORS.amberTint }
              return (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{g ? g.displayName : it.game}</div>
                    <div style={smallMuted}>注 {money(it.amount)} · {fmtTime(it.created_at)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: RADIUS.pill, fontSize: 11, fontWeight: 900, color: badge.c, background: badge.bg }}>{badge.t}</span>
                    <div style={smallMuted}>派彩 {money(it.payout)}</div>
                  </div>
                </div>
              )
            })
          )}

          {/* 加载更多（有 nextCursor 才显示；error/空态时不显示）*/}
          {!firstLoad && !err && items.length > 0 && cursor && (
            <button type="button" onClick={loadMore} disabled={loading} style={{
              width: '100%', margin: '12px 0 6px', padding: '10px 0', borderRadius: RADIUS.pill,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
              background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontSize: 13, fontWeight: 700,
            }}>{loading ? '加载中…' : '加载更多'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
