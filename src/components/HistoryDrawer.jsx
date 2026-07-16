import { useState, useEffect } from 'react'
import { COLORS, RADIUS, DERBY, LAYOUT } from './shell/tokens'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlayerApi } from '../lib/playerApi'
import { formatDraw, formatDrawDetail, shortRoundNo } from './drawFormatters'

// 开奖历史抽屉（右侧滑入，照 BillDrawer 骨架）：拉 /round/history/:game 的公开开奖结果。
// 行 = 期号 + 摘要 + 时间，可点开手风琴展开卡（同时只开一行）：
//   详情标签行 → commit-reveal 验证徽章（crypto.subtle sha256(serverSeed)==serverSeedHash）
//   → 三字段 mono 可复制（承诺 hash / clientSeed / serverSeed）→「如何自己验证」折叠。
// pendingRound（可选）= 本期未揭晓局（room.commit，serverSeed 尚空），置顶显「开奖中·种子待揭晓」。
// keyset 分页（nextCursor），只读 GET 走 playerApi.apiGet。色值全走 tokens，禁新 hex。

const NOOP = () => {}   // apiGet 不写余额，setServerBalance 传稳定 noop，保 usePlayerApi memo 不抖
const MONO = "ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', monospace"

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 浏览器就地算 sha256(hex)，与后端 crypto.createHash('sha256').update(serverSeed).digest('hex') 同口径。
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function HistoryDrawer({ open, onClose, game, venue, playerToken, onLogout, pendingRound }) {
  const isMobile = useMediaQuery('(max-width: 640px)')
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)   // ≥1024 加宽，照 SeedFairness/HowToPlay 先例
  const api = usePlayerApi({ playerToken, onLogout, setServerBalance: NOOP })
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [firstLoad, setFirstLoad] = useState(true)
  const [expandedId, setExpandedId] = useState(null)   // 手风琴：同时只开一行

  useEffect(() => {
    if (!open || !game) return
    let cancelled = false
    setItems([]); setCursor(null); setErr(null); setFirstLoad(true); setLoading(true); setExpandedId(null)
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
      setItems(prev => [...prev, ...d.items]); setCursor(d.nextCursor)
    } catch (e) { setErr(e?.message || '加载失败，请重试') } finally { setLoading(false) }
  }

  if (!open) return null

  // 置顶未揭晓期（本期开奖中）+ 已揭晓历史；pendingRound 仅当其 serverSeed 尚空才算「开奖中」
  const pending = pendingRound && !pendingRound.serverSeed
    ? { id: 'pending', roundNo: pendingRound.roundNo, drawResult: null, serverSeedHash: pendingRound.serverSeedHash, clientSeed: pendingRound.clientSeed, serverSeed: null, createdAt: null, _pending: true }
    : null
  const rows = pending ? [pending, ...items] : items

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'flex-end',
    }}>
      <style>{`@keyframes histSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: isMobile ? '100%' : (isDesk ? 'min(720px, calc(100vw - 48px))' : 440), height: '100%',
        background: COLORS.panel, borderLeft: `1px solid ${COLORS.border}`,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)', animation: 'histSlideIn 0.25s ease',
      }}>
        {/* 头部 */}
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
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontSize: 14, fontWeight: 900,
          }}>✕</button>
        </div>

        {/* 如何自己验证 —— 全抽屉唯一，固定顶部（标题栏下、列表上），默认收起 */}
        <HowToVerify />

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
          ) : rows.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLORS.textFaint, fontSize: 13, padding: '48px 0' }}>暂无开奖历史</div>
          ) : (
            rows.map(it => (
              <HistoryRow key={it.id} it={it} game={game} isMobile={isMobile}
                expanded={expandedId === it.id}
                onToggle={() => setExpandedId(id => (id === it.id ? null : it.id))} />
            ))
          )}

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

// —— 单行 + 手风琴展开卡 ——
function HistoryRow({ it, game, isMobile, expanded, onToggle }) {
  const pending = it._pending
  const summary = pending ? '' : formatDraw(game, it.drawResult)
  const detail = pending ? [] : formatDrawDetail(game, it.drawResult)
  return (
    <div style={{ borderBottom: `1px solid ${COLORS.border}` }}>
      {/* 行头（点击展开） */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', cursor: 'pointer' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div title={it.roundNo} style={{ fontSize: 13, fontWeight: 700, color: COLORS.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{shortRoundNo(it.roundNo)}</div>
          <div style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 3 }}>
            {pending ? '开奖中 · 种子待揭晓' : fmtTime(it.createdAt)}
          </div>
        </div>
        <div style={{ flex: '0 0 auto', textAlign: 'right', fontSize: 15, fontWeight: 900, color: pending ? COLORS.amber : COLORS.green }}>
          {pending ? '···' : (summary || '—')}
        </div>
        <span style={{ flex: '0 0 auto', color: COLORS.textFaint, fontSize: 12, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </div>
      {/* 展开卡 */}
      {expanded && <ExpandCard it={it} detail={detail} pending={pending} isMobile={isMobile} />}
    </div>
  )
}

function ExpandCard({ it, detail, pending }) {
  const [verify, setVerify] = useState(null)   // null | 'checking' | 'match' | 'mismatch' | 'error'
  const [copied, setCopied] = useState('')

  useEffect(() => {
    if (!it.serverSeed || !it.serverSeedHash) { setVerify(pending ? 'pending' : null); return }
    let cancelled = false
    setVerify('checking')
    sha256Hex(it.serverSeed)
      .then(h => { if (!cancelled) setVerify(h.toLowerCase() === it.serverSeedHash.toLowerCase() ? 'match' : 'mismatch') })
      .catch(() => { if (!cancelled) setVerify('error') })
    return () => { cancelled = true }
  }, [it.serverSeed, it.serverSeedHash, pending])

  function copy(label, text) {
    if (!text) return
    try { navigator.clipboard?.writeText(text) } catch { /* 忽略 */ }
    setCopied(label); setTimeout(() => setCopied(''), 1500)
  }

  const monoBox = {
    fontFamily: MONO, fontSize: 11, lineHeight: 1.5, wordBreak: 'break-all',
    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.input, padding: '7px 9px',
  }
  const fieldLabel = { color: COLORS.textFaint, fontSize: 10, fontWeight: 700, marginBottom: 3, display: 'flex', justifyContent: 'space-between' }
  const copyBox = (label, value, color) => (
    <div style={{ marginBottom: 8 }}>
      <div style={fieldLabel}>
        <span>{label}</span>
        {value && <span onClick={() => copy(label, value)} style={{ cursor: 'pointer', color: copied === label ? COLORS.green : COLORS.textFaint }}>{copied === label ? '✓ 已复制' : '复制'}</span>}
      </div>
      <div style={{ ...monoBox, color: color || COLORS.text }}>{value || '开奖后揭晓'}</div>
    </div>
  )

  // 验证徽章：✓绿 / ✗红 / 待揭晓黄 / 校验中灰
  const badge = verify === 'match' ? { t: '✓ 承诺一致 · 本期公平已验证', c: COLORS.green, bg: COLORS.greenTint }
    : verify === 'mismatch' ? { t: '✗ 不符 · sha256(serverSeed) 与承诺哈希不一致', c: COLORS.redDark, bg: COLORS.slateTint }
      : verify === 'checking' ? { t: '校验中…', c: COLORS.textMuted, bg: COLORS.surface }
        : verify === 'error' ? { t: '· 浏览器不支持本地校验', c: COLORS.textMuted, bg: COLORS.surface }
          : { t: '⏳ 开奖中 · 种子待揭晓', c: COLORS.amber, bg: COLORS.amberTint }

  return (
    <div style={{ padding: '2px 6px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 详情标签行 */}
      {detail.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {detail.map((t, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 800, color: COLORS.text, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.pill, padding: '3px 10px' }}>{t}</span>
          ))}
        </div>
      )}
      {/* 验证徽章 */}
      <div style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', gap: 6, fontSize: 12, fontWeight: 900, color: badge.c, background: badge.bg, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.pill, padding: '4px 12px' }}>{badge.t}</div>
      {/* 单V1：nonce 展示位（本地重算三要素之一 serverSeed+clientSeed+nonce）。
          落库前的老局 nonce 为 null → 显「该局早于公平链升级」，不炸；重算钮留 V2。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ color: COLORS.textFaint, fontWeight: 700 }}>nonce · 随机序</span>
        {it.nonce != null
          ? <span style={{ fontFamily: MONO, fontWeight: 800, color: COLORS.text }}>{it.nonce}</span>
          : <span style={{ color: COLORS.textFaint, fontWeight: 700 }}>{pending ? '开奖后揭晓' : '该局早于公平链升级'}</span>}
      </div>
      {/* 三字段 mono 可复制 */}
      <div>
        {copyBox('服务器种子哈希 · commitHash', it.serverSeedHash, DERBY.gold)}
        {copyBox('客户端种子 · clientSeed', it.clientSeed)}
        {copyBox('服务器种子明文 · serverSeed', it.serverSeed)}
      </div>
    </div>
  )
}

// —— 「如何自己验证」折叠块（抽屉底部固定区唯一一处，默认收起） ——
function HowToVerify() {
  const [howOpen, setHowOpen] = useState(false)
  return (
    <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${COLORS.border}`, padding: '10px 18px' }}>
      <div onClick={() => setHowOpen(v => !v)} style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: COLORS.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ transform: howOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span> 如何自己验证
      </div>
      {howOpen && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: COLORS.textMuted }}>
          <div>① 开奖前服务器只公布 serverSeed 的哈希承诺（commitHash），无法反推结果。</div>
          <div>② 开奖后公布 serverSeed 明文，对它做 SHA-256，应等于该期 commitHash。</div>
          <div>③ 相等即证明结果在开奖前已定死、未被中途篡改。</div>
          <div style={{ marginTop: 6 }}>
            工具：<a href="https://emn178.github.io/online-tools/sha256.html" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.green, textDecoration: 'underline' }}>在线 SHA-256 计算器 ↗</a>（把 serverSeed 粘进去比对 hash）
          </div>
        </div>
      )}
    </div>
  )
}
