import { useState, useEffect } from 'react'
import { COLORS, RADIUS, MONO } from './shell/tokens'
import { PER_PLAYER_VERIFY_GAMES } from './shell/localVerifyGames'   // 零引擎 import 的轻量白名单
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePlayerApi } from '../lib/playerApi'
import { GAME_BY_BACKEND_ID, GAME_BY_ID, GAME_REGISTRY } from '../gameRegistry'
import { MARKET_GROUPS } from './MultiTable/mockData'   // #S2 档位中文 label 单一出处（禁手抄第二份）
import { extraLabelOf } from '../lib/betKeyLabels'      // #S3 roulette/rollingball 档位中文名（只 import 本模块，禁 import src/games/*，保 code-split）

// 账单抽屉：右侧滑入，两 tab —— 资金流水(/player/ledger) / 投注记录(/player/bets)。
// keyset 分页（nextCursor），只读 GET 走 playerApi.apiGet。色值全走 tokens。
// 筛选：游戏下拉(backendId) + 起止日期 + 今天/7天/30天快捷；切筛选清 cursor+list 同批重拉。

const NOOP = () => {}   // apiGet 不写余额，setServerBalance 传稳定 noop，保 usePlayerApi memo 不抖
const TABS = [{ k: 'ledger', label: '资金流水' }, { k: 'bets', label: '投注记录' }]
// 游戏下拉选项：{ value: backendId, label: displayName }，'' = 全部。用 registry 中文名渲染。
const GAME_OPTIONS = GAME_REGISTRY.map(g => ({ value: g.backendId, label: g.displayName }))
const round2 = x => Math.round(x * 100) / 100

// 本地日期 → YYYY-MM-DD（与后端 ::date 当天边界口径一致）
function ymd(d) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
// 快捷区间：days=1 今天、7 近 7 天、30 近 30 天（含今天，from=今天-(days-1)，to=今天）
function quickRange(days) {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - (days - 1))
  return { from: ymd(start), to: ymd(now) }
}

// 投注摘要：范式B(轮次彩)selections={key:n} → "key×n key×n" 通吃；
// 范式A(单人局)selections=null 且 /bets 不返 result（防泄露未开局雷位/牌序），
// 仅 mines/limbo/dice/hilo 四款用「兑现倍数=payout/amount」作摘要，其余范式A空串。
const SUMMARY_FMT_A = new Set(['mines', 'limbo', 'dice', 'hilo'])
function betSummary(it) {
  // 多注同轮：派彩为「本轮本人总额」而非单注份额（rollingball 逐球 / aviator 多注 / selections 多键），加后缀标注
  const suffix = (it.game === 'rollingball' || it.game === 'aviator'
    || (it.selections && typeof it.selections === 'object' && Object.keys(it.selections).length > 1)) ? ' ·本轮合计' : ''
  if (it.selections && typeof it.selections === 'object') {
    return Object.entries(it.selections).map(([k, v]) => `${k}×${v}`).join(' ') + suffix
  }
  if (SUMMARY_FMT_A.has(it.game) && it.outcome === 'win' && Number(it.amount) > 0) {
    return `×${round2(Number(it.payout) / Number(it.amount)).toFixed(2)}` + suffix
  }
  return suffix.trim()   // rollingball/aviator（selections=null 且非四款）：只显标注，提示派彩为本轮合计
}

// #S2 档位中文名平表：MARKET_GROUPS 键是前端 id → 经 GAME_BY_ID 反查 backendId，预构 `<be>:<key>`→label。
// 读 MARKET_GROUPS 单一出处，禁手抄。未知 key 回落原 key（老范式/未登记档位不崩）。
const LABEL_BY_BE_KEY = (() => {
  const m = {}
  for (const [fid, groups] of Object.entries(MARKET_GROUPS)) {
    const be = GAME_BY_ID[fid]?.backendId
    if (!be || !Array.isArray(groups)) continue
    for (const grp of groups) for (const { key, label } of (grp.keys || [])) m[`${be}:${key}`] = label
  }
  return m
})()
// #S3 并入 roulette/rollingball（走共享 betKeyLabels）：先查 S2 排期器平表，再查这两款，末回落原 key
const labelOf = (be, key) => LABEL_BY_BE_KEY[`${be}:${key}`] ?? extraLabelOf(be, key) ?? key

// #S2 三态标记：hit→✓ / lose→✗ / push→退（色走 tokens）
// 孤儿注恢复：refund（betting 相位被杀、本期永不开奖 → 全额退本金）复用 push 的「退」样式——
// 对玩家而言两者同义：这一注没赌成，钱原样回来。
const MARK = {
  hit: { t: '✓', c: COLORS.green }, lose: { t: '✗', c: COLORS.slate }, push: { t: '退', c: COLORS.amber },
  refund: { t: '退', c: COLORS.amber },
}
// #S2 注单明细：settle_detail=[{key,outcome,payout}] 合法非空才走子行；防 null/形状异常/切 tab 脏帧全回落 null。
// 行头派彩改显 round2(Σ本行 detail 派彩)（与子行永远对齐）；Σ > 本行 payout(轮总聚合,钳制后) → 触顶标记。
function betDetail(it) {
  const d = it && it.settle_detail
  if (!Array.isArray(d) || d.length === 0) return null
  const rows = d
    .filter(x => x && typeof x.key === 'string')
    .map(x => ({
      label: labelOf(it.game, x.key),
      stake: Number(it.selections && it.selections[x.key]) || 0,
      payout: Number(x.payout) || 0,
      mark: MARK[x.outcome] || MARK.lose,
    }))
  if (rows.length === 0) return null
  const sum = round2(rows.reduce((s, r) => s + r.payout, 0))
  // 退注行短路：refund 的钱走 <game>_refund 流水，而 it.payout 的 LATERAL 只聚合 <game>_payout →
  // payout 恒 0（void 轮 r.payout 也是 NULL），Σ退款 > 0 会让每张退注单假挂触顶标记。
  const capped = sum > Number(it.payout) && it.outcome !== 'refund'
  return { rows, sum, capped }
}

// ledger.type → { 展示名, up(是否入账), 类型词 }。type 前缀=backendId，去 _bet/_payout 后缀反查 registry。
function ledgerMeta(type) {
  if (!type) return { name: '—', up: false, kind: '' }   // 防御：切 tab 脏帧下 type 可能暂缺
  if (type === 'deposit') return { name: '充值', up: true, kind: '充值' }
  if (type === 'withdraw') return { name: '提现', up: false, kind: '提现' }
  // 孤儿注退款 <game>_refund：入账为正，类型词「退注」（与派彩区分——不是赢来的，是原路退回）
  if (type.endsWith('_refund')) {
    const g = GAME_BY_BACKEND_ID[type.replace(/_refund$/, '')]
    return { name: g ? g.displayName : '退注', up: true, kind: '退注' }
  }
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
  const [game, setGame] = useState('')           // 游戏筛选：'' = 全部，否则 backendId
  const [from, setFrom] = useState('')            // 起始日期 YYYY-MM-DD，'' = 不筛
  const [to, setTo] = useState('')                // 结束日期 YYYY-MM-DD（含当天），'' = 不筛

  // 组装查询串：limit + 筛选(game/from/to) + 可选 cursor。cursor 只夹 id，与筛选并存不冲突。
  function qs(cur) {
    const p = new URLSearchParams({ limit: '20' })
    if (game) p.set('game', game)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (cur) p.set('cursor', String(cur))
    return p.toString()
  }

  // open / tab / 任一筛选变化 → 清 cursor+list，同批重拉第一页
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setItems([]); setCursor(null); setErr(null); setFirstLoad(true); setLoading(true)
    api.apiGet(`/player/${tab}?${qs(null)}`)
      .then(d => { if (cancelled) return; setItems(d.items); setCursor(d.nextCursor) })
      .catch(e => { if (!cancelled) setErr(e?.message || '加载失败，请重试') })
      .finally(() => { if (!cancelled) { setLoading(false); setFirstLoad(false) } })
    return () => { cancelled = true }
  }, [open, tab, game, from, to])   // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true); setErr(null)
    try {
      const d = await api.apiGet(`/player/${tab}?${qs(cursor)}`)
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
              <button key={t.k} type="button" onClick={() => {
                if (t.k === tab) return
                // 同步清空旧 tab 数据，避免切 tab 那一帧用新渲染器渲旧数据形状导致崩溃；effect 随后重拉
                setItems([]); setCursor(null); setErr(null); setFirstLoad(true)
                setTab(t.k)
              }} style={{
                flex: 1, padding: '8px 0', borderRadius: RADIUS.pill, cursor: 'pointer',
                fontSize: 13, fontWeight: 800,
                background: active ? COLORS.green : COLORS.surface,
                color: active ? '#06251a' : COLORS.textMuted,
                border: `1px solid ${active ? COLORS.green : COLORS.border}`,
              }}>{t.label}</button>
            )
          })}
        </div>

        {/* 筛选栏：游戏下拉 + 起止日期 + 今天/7天/30天快捷。变更即触发 effect 清 cursor+list 同批重拉 */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          <select value={game} onChange={e => setGame(e.target.value)} style={{
            flex: '1 1 120px', minWidth: 0, padding: '6px 8px', borderRadius: RADIUS.pill,
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            <option value="">全部游戏</option>
            {GAME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={{
            flex: '1 1 110px', minWidth: 0, padding: '6px 8px', borderRadius: RADIUS.pill,
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12, fontWeight: 700,
          }} />
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={{
            flex: '1 1 110px', minWidth: 0, padding: '6px 8px', borderRadius: RADIUS.pill,
            background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12, fontWeight: 700,
          }} />
          <div style={{ display: 'flex', gap: 6, flex: '1 1 100%' }}>
            {[{ label: '今天', d: 1 }, { label: '近7天', d: 7 }, { label: '近30天', d: 30 }].map(q => (
              <button key={q.d} type="button" onClick={() => { const r = quickRange(q.d); setFrom(r.from); setTo(r.to) }} style={{
                flex: 1, padding: '5px 0', borderRadius: RADIUS.pill, cursor: 'pointer',
                background: COLORS.surface, border: `1px solid ${COLORS.border}`, color: COLORS.textMuted, fontSize: 11, fontWeight: 700,
              }}>{q.label}</button>
            ))}
            {(game || from || to) && (
              <button type="button" onClick={() => { setGame(''); setFrom(''); setTo('') }} style={{
                flex: '0 0 auto', padding: '5px 12px', borderRadius: RADIUS.pill, cursor: 'pointer',
                background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.textFaint, fontSize: 11, fontWeight: 700,
              }}>清除</button>
            )}
          </div>
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
              // 徽章四态：赢/输/已退注（孤儿注恢复退本金，中性色——非输非赢）/ 其余=进行中
              const badge = won ? { t: '赢', c: COLORS.green, bg: COLORS.greenTint }
                : it.outcome === 'lose' ? { t: '输', c: COLORS.slate, bg: COLORS.slateTint }
                  : it.outcome === 'refund' ? { t: '已退注', c: COLORS.slate, bg: COLORS.slateTint }
                    : { t: '进行中', c: COLORS.amber, bg: COLORS.amberTint }
              const detail = betDetail(it)                          // #S2 有明细→子行；无（老数据/其他范式）→ null 回落
              const summary = detail ? null : betSummary(it)        // 有明细不显裸 key×n 摘要（子行取代）
              const headPayout = detail ? detail.sum : Number(it.payout)   // #S2 行头派彩：有明细显 round2(Σ本行detail)
              return (
                <div key={it.id} style={{ display: 'flex', flexDirection: 'column', padding: '11px 6px', borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{g ? g.displayName : it.game}</div>
                      {summary && (
                        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</div>
                      )}
                      <div style={smallMuted}>
                        注 {money(it.amount)} · {fmtTime(it.created_at)}
                        {/* 单V3b：per-player 款显本局编号，点击复制 —— 拿去「⚖ 可验证公平 → 验整局」验这一局。
                            轮次彩不显（那些款在自己的抽屉里就能重算，不需要玩家手抄编号）。 */}
                        {PER_PLAYER_VERIFY_GAMES.has(it.game) && it.round_id != null && (
                          <span
                            onClick={() => navigator.clipboard?.writeText(String(it.round_id))}
                            title="点击复制本局编号，用于「可验证公平 → 验整局」"
                            style={{ marginLeft: 6, fontFamily: MONO, cursor: 'pointer', textDecoration: 'underline dotted' }}
                          >#{it.round_id}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: RADIUS.pill, fontSize: 11, fontWeight: 900, color: badge.c, background: badge.bg }}>{badge.t}</span>
                      <div style={smallMuted}>派彩 {money(headPayout)}{detail && detail.capped && <span style={{ color: COLORS.amber, marginLeft: 4 }}>已触顶钳制</span>}</div>
                    </div>
                  </div>
                  {/* #S2 注级明细子行：档位中文名 $注额 → $派彩 ✓/✗/退 */}
                  {detail && (
                    <div style={{ marginTop: 7, paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {detail.rows.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: COLORS.textMuted }}>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label} {money(r.stake)}</span>
                          <span style={{ flex: '0 0 auto', marginLeft: 8 }}>
                            → {money(r.payout)} <span style={{ color: r.mark.c, fontWeight: 900 }}>{r.mark.t}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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
