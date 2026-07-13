import { useState, useEffect } from 'react'
import { COLORS, RADIUS } from './shell/tokens'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlayerApi } from '../lib/playerApi'
import { formatDraw } from './drawFormatters'

// 开奖历史抽屉（右侧滑入，照 BillDrawer 骨架）：拉 /round/history/:game 的公开开奖结果，
// 行 = 期号 + 摘要（drawFormatters 按 game 渲染）+ 时间。keyset 分页（nextCursor），
// 只读 GET 走 playerApi.apiGet。开抽屉（open 或 game 变）拉首页。色值全走 tokens。

const NOOP = () => {}   // apiGet 不写余额，setServerBalance 传稳定 noop，保 usePlayerApi memo 不抖

function fmtTime(iso) {
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function HistoryDrawer({ open, onClose, game, venue, playerToken, onLogout }) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance: NOOP })
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)     // nextCursor：null=没有更多
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [firstLoad, setFirstLoad] = useState(true)

  // open 或 game 变化 → 重置并拉第一页
  useEffect(() => {
    if (!open || !game) return
    let cancelled = false
    setItems([]); setCursor(null); setErr(null); setFirstLoad(true); setLoading(true)
    api.apiGet(`/round/history/${game}?limit=20`)
      .then(d => { if (cancelled) return; setItems(d.items); setCursor(d.nextCursor) })
      .catch(e => { if (!cancelled) setErr(e?.message || '加载失败，请重试') })
      .finally(() => { if (!cancelled) { setLoading(false); setFirstLoad(false) } })
    return () => { cancelled = true }
  }, [open, game])   // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true); setErr(null)
    try {
      const d = await api.apiGet(`/round/history/${game}?limit=20&cursor=${cursor}`)
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

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'flex-end',
    }}>
      <style>{`@keyframes histSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: isMobile ? '100%' : 420, height: '100%',
        background: COLORS.panel, borderLeft: `1px solid ${COLORS.border}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)', animation: 'histSlideIn 0.25s ease',
      }}>
        {/* 头部：场馆名 + 标题 + 关闭 */}
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 18px', borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ minWidth: 0 }}>
            {venue && <div style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>{venue}</div>}
            <span style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>开奖历史</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: RADIUS.pill, cursor: 'pointer',
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted,
            fontSize: 14, fontWeight: 900,
          }}>✕</button>
        </div>

        {/* 列表体 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px' }}>
          {firstLoad && loading ? (
            <div style={{ textAlign: 'center', color: COLORS.textMuted, fontSize: 13, padding: '40px 0' }}>加载中…</div>
          ) : err ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ color: COLORS.amber, fontSize: 13, marginBottom: 12 }}>{err}</div>
              <button type="button" onClick={() => { setFirstLoad(true); setErr(null); setItems([]); setCursor(null); setLoading(true); api.apiGet(`/round/history/${game}?limit=20`).then(d => { setItems(d.items); setCursor(d.nextCursor) }).catch(e => setErr(e?.message || '加载失败，请重试')).finally(() => { setLoading(false); setFirstLoad(false) }) }} style={{
                padding: '6px 16px', borderRadius: RADIUS.pill, cursor: 'pointer',
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12, fontWeight: 700,
              }}>重试</button>
            </div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLORS.textFaint, fontSize: 13, padding: '48px 0' }}>暂无开奖历史</div>
          ) : (
            items.map(it => {
              const summary = formatDraw(game, it.drawResult)
              return (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{it.roundNo}</div>
                    <div style={smallMuted}>{fmtTime(it.createdAt)}</div>
                  </div>
                  <div style={{ flex: '0 0 auto', textAlign: 'right', fontSize: 15, fontWeight: 900, color: COLORS.green }}>
                    {summary || '—'}
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
