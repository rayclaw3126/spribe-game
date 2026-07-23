import { useState, useEffect, useCallback } from 'react'
import { COLORS, DERBY, RADIUS, LAYOUT, MONO } from './tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { INSTANT_VERIFY, fieldsOf, verifyRound, deepEqVerify } from './instantVerify'   // #内务刀1：验整局收编进 verifyRound

// 可验证公平抽屉 — 共享件。壳（定位/圆角/动画/遮罩/抓手/标题行）1:1 抄 HowToPlay.jsx，
// 暗色皮同取 DERBY 系（球场绿卡底 + 金顶边/段标 + 浅绿正文），禁自编 hex。
//
// 批 C：接后端 /seed/current /rotate /client 真数据流 + 挂本地重算。
//
// 单V3a：本地验证器从「仅 Dice（手抄的 lib/fairVerify.js）」升级为【即时 6 款】，
// 派生统一走 shell/instantVerify.js 的 INSTANT_VERIFY 注册表（其直 import 服务端引擎导出）。
// 原 lib/fairVerify.js 是前端手抄的第二份 dice 公式（且用 crypto.subtle 异步），已整个删除：
// 手抄件与引擎迟早分叉，分叉时验证器不但证明不了公平，还会把好局判成作弊。
// 注册表的 derive 是【同步】的（纯 JS HMAC-SHA256，非 crypto.subtle），故 doVerify 不再 await。
//
// 等宽字体 MONO 已提进 tokens.js 做单一出处（单V3b）——原为本文件等 4 处逐字节相同的手抄。
// 终局状态（与后端 round.js TERMINAL_STATUSES 同口径）：只有终局才给全 result，才谈得上整局重算。
const TERMINAL = new Set(['settled', 'cashed', 'bust'])

// 手填「后端开出值」的输入提示（按款主字段的实际形状给例）。
const PLACEHOLDER = {
  dice: '例如 80.99',
  limbo: '例如 3.21',
  roulette: '例如 7',
  keno: '例如 [3,7,11,14,19,22,25,28,31,36]',
  plinko: '例如 [1,0,1,1,0,0,1,0]',
  streak: '例如 5',
}

// #内务刀1：canon/deepEq 收编 —— 深比统一用 instantVerify.deepEqVerify（实现逐字节同，消 B2 挂的两份）。
const fmtVal = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))
// 手填的「后端开出值」宽松解析：数组既收 JSON（[1,2,3]）也收逗号列（1,2,3）；数字收数字；其余按字符串。
function parseExpected(raw, sample) {
  const s = String(raw).trim()
  if (s === '') return undefined
  if (Array.isArray(sample)) {
    try { const j = JSON.parse(s); if (Array.isArray(j)) return j } catch { /* 非 JSON，落逗号列 */ }
    return s.replace(/^\[|\]$/g, '').split(',').map((x) => Number(x.trim()))
  }
  if (typeof sample === 'number') return Number(s)
  return s
}

async function seedApi(path, { method = 'GET', token, body } = {}) {
  const resp = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await resp.json() } catch { /* 无 body */ }
  if (!resp.ok) throw new Error(data?.error || `请求失败（${resp.status}）`)
  return data
}

export default function SeedFairness({ open, onClose, venue, playerToken, game }) {
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [current, setCurrent] = useState(null)   // { serverSeedHash, clientSeed, nonce }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(null) // rotate 返回的旧种子明文
  const [revealShown, setRevealShown] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [newClientSeed, setNewClientSeed] = useState('')
  const [clientMsg, setClientMsg] = useState('')
  // 本地验证器
  const [vSeed, setVSeed] = useState('')
  const [vClient, setVClient] = useState('')
  const [vNonce, setVNonce] = useState('')
  const [vBackend, setVBackend] = useState('')
  const [vLocal, setVLocal] = useState(null)     // { 字段名: 重算值 } | 'ERR'
  const [vBusy, setVBusy] = useState(false)
  const [vExtra, setVExtra] = useState({})       // 单V3a：plinko rows / streak risk 等派生额外输入
  // 单V3b「验整局」：填 roundId → GET /round/:id → 局内 client_seed/nonce/needs 自动喂注册表
  const [wRid, setWRid] = useState('')
  const [wBusy, setWBusy] = useState(false)
  const [wOut, setWOut] = useState(null)         // { rows, allOk, game, status } | { error }

  // 单V3a/V3b：支持面 = INSTANT_VERIFY 注册表（即时 6 + 多步 3）。不在表里的（aviator…）仍标"尚在开发中"。
  const spec = INSTANT_VERIFY[game]
  const verifierSupported = !!spec
  const manualSupported = !!spec && spec.manualOk !== false   // goal 的靶在 result 里，手填无意义

  const loadCurrent = useCallback(async () => {
    setLoading(true); setError('')
    try { setCurrent(await seedApi('/seed/current', { token: playerToken })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [playerToken])

  // 每次打开：拉当前种子，重置 rotate/验证器临时态
  useEffect(() => {
    if (!open) return
    setRevealed(null); setRevealShown(false); setClientMsg(''); setNewClientSeed('')
    setVLocal(null); setVBackend('')
    loadCurrent()
  }, [open, loadCurrent])

  if (!open) return null

  const cardPos = isDesk ? {
    top: '50%', left: '50%', width: 'min(720px, calc(100vw - 48px))',
    transform: 'translate(-50%, -50%)', borderRadius: 16, maxHeight: '90vh', animation: 'htpFadeIn 0.2s ease-out',
  } : {
    left: 0, right: 0, bottom: 0, maxWidth: 520, margin: '0 auto',
    borderRadius: '16px 16px 0 0', maxHeight: '92vh', animation: 'htpSlideUp 0.28s ease-out',
  }

  async function doRotate() {
    setRotating(true); setError('')
    try {
      const d = await seedApi('/seed/rotate', { method: 'POST', token: playerToken, body: {} })
      setRevealed(d.revealed); setRevealShown(true)
      setCurrent({ serverSeedHash: d.active.serverSeedHash, clientSeed: d.active.clientSeed, nonce: d.active.nonce })
      setVSeed(d.revealed.serverSeed)  // 便捷：把揭晓明文带进验证器
      setVClient(d.revealed.clientSeed)
    } catch (e) { setError(e.message) } finally { setRotating(false) }
  }

  async function doSetClient() {
    const cs = newClientSeed.trim()
    if (!cs) return
    setClientMsg('')
    try {
      const d = await seedApi('/seed/client', { method: 'POST', token: playerToken, body: { clientSeed: cs } })
      setCurrent(d); setNewClientSeed(''); setClientMsg('✓ 已更新 clientSeed')
    } catch (e) { setClientMsg(e.message) }
  }

  // 单V3a：注册表 derive 是同步纯 JS（非 crypto.subtle），无需 await；保留 vBusy 只为按钮态一致。
  function doVerify() {
    if (!spec) return
    setVBusy(true)
    try { setVLocal(spec.derive(vSeed.trim(), vClient.trim(), vNonce.trim(), vExtra)) }
    catch { setVLocal('ERR') }
    finally { setVBusy(false) }
  }

  // 单V3b「验整局」：按 roundId 拉本局记录（后端已加归属校验：他人局 404），
  // 用【局内】的 client_seed/nonce/needs 喂注册表 —— 玩家一个字段都不用手抄，也就无从抄错。
  // serverSeed 仍取上方轮换揭晓的明文（vSeed）：先用 result_hash 校验这把种子确实是本局承诺的那把，
  // 再重算 —— 否则「种子对不上」会被误读成「服务端作弊」。
  // #内务刀1：验整局一体化收编 —— 手写 GET/:id + terminal/nonce/hash/needs + derive + deepEq
  //   整段替换为 verifyRound（instantVerify 单一出处），错误统一走返回 code 的文案，行为逐字节等价。
  async function doVerifyWhole() {
    const rid = wRid.trim()
    if (!rid) return
    const seed = vSeed.trim()
    if (!seed) { setWOut({ error: '请先「轮换种子」拿到 serverSeed 明文（或在上方手填）' }); return }
    setWBusy(true); setWOut(null)
    try {
      const res = await verifyRound(rid, { token: playerToken, serverSeed: seed })
      if (res.error) { setWOut({ error: res.error }); return }
      setWOut({ rows: res.rows, allOk: res.allOk, game: res.game, status: res.status, nonce: res.nonce })
    } finally { setWBusy(false) }
  }


  const canSetClient = current && current.nonce === 0
  // 主字段 = 本款第一个靶（dice→roll / keno→drawn / roulette→n / plinko→path / limbo→finalMult / streak→idx）
  // fieldsOf：goal 的靶随终局形状变，故不能直接取 spec.fields[0]（那是个函数）
  const mainField = spec ? fieldsOf(spec, vExtra)[0] : null
  const vLocalOk = vLocal != null && vLocal !== 'ERR'
  const expected = vLocalOk ? parseExpected(vBackend, vLocal[mainField]) : undefined
  const vMatch = vLocalOk && expected !== undefined && deepEqVerify(expected, vLocal[mainField])
  // needs 齐了才让点重算（plinko 缺 rows / streak 缺 risk 时 derive 必炸）
  const extrasReady = !spec || spec.needs.every((nd) => String(vExtra[nd.key] ?? '').trim() !== '')

  // —— 样式片 ——
  const sectionTitle = { color: DERBY.gold, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, marginBottom: 8 }
  const fieldLabel = { color: DERBY.dim, fontSize: 11, fontWeight: 700, marginBottom: 4 }
  const monoBox = {
    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all',
    background: DERBY.strip, border: `1px solid ${COLORS.borderLight}`,
    borderRadius: RADIUS.input, padding: '8px 10px', boxSizing: 'border-box',
  }
  const input = { ...monoBox, width: '100%', color: DERBY.text, outline: 'none' }

  return (
    <>
      <style>{`
        @keyframes htpSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes htpFadeIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        @keyframes sfSpin { to { transform: rotate(360deg); } }
      `}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200 }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', zIndex: 201, background: DERBY.bgOuter, borderTop: `2px solid ${DERBY.gold}`,
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', ...cardPos,
      }}>
        {!isDesk && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, flex: '0 0 auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.3)' }} />
          </div>
        )}
        {/* 标题行 */}
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 18px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ minWidth: 0 }}>
            {venue && <div style={{ color: DERBY.gold, fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{venue}</div>}
            <div style={{ color: COLORS.white, fontSize: 16, fontWeight: 900, whiteSpace: 'nowrap' }}>⚖ 可验证公平</div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)', color: COLORS.white, fontSize: 15, fontWeight: 900, cursor: 'pointer',
            lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        {/* 可滚内容 */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 错误条 */}
          {error && (
            <div style={{ background: 'rgba(196,24,54,0.18)', border: '1px solid rgba(196,24,54,0.5)', borderRadius: RADIUS.input, padding: '8px 10px', color: '#ff8a9a', fontSize: 12, fontWeight: 700 }}>
              {error} · <span onClick={loadCurrent} style={{ textDecoration: 'underline', cursor: 'pointer' }}>重试</span>
            </div>
          )}

          {/* 段1 当前种子 */}
          <div>
            <div style={sectionTitle}>🔒 当前种子（下注前已承诺）</div>
            {loading && !current ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: DERBY.dim, fontSize: 12, padding: '10px 0' }}>
                <span style={{ width: 14, height: 14, border: `2px solid ${DERBY.dim}`, borderTopColor: DERBY.gold, borderRadius: '50%', display: 'inline-block', animation: 'sfSpin 0.7s linear infinite' }} />
                加载中…
              </div>
            ) : current ? (
              <>
                <div style={{ marginBottom: 8 }}>
                  <div style={fieldLabel}>服务器种子哈希 · serverSeedHash</div>
                  <div style={{ ...monoBox, color: DERBY.gold }}>{current.serverSeedHash}</div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={fieldLabel}>客户端种子 · clientSeed</div>
                  <div style={{ ...monoBox, color: DERBY.text }}>{current.clientSeed}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={fieldLabel}>已用局数 · nonce</span>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, color: '#0d2016', background: DERBY.sel, borderRadius: RADIUS.pill, padding: '2px 12px' }}>{current.nonce}</span>
                </div>
              </>
            ) : null}
          </div>

          {/* 轮换金钮 */}
          <button type="button" onClick={doRotate} disabled={rotating || !current} style={{
            width: '100%', padding: '11px 14px', border: 'none', borderRadius: RADIUS.btn,
            background: DERBY.gold, color: '#0d2016', fontSize: 14, fontWeight: 900,
            cursor: rotating || !current ? 'default' : 'pointer', letterSpacing: 0.3, opacity: rotating || !current ? 0.6 : 1,
          }}>{rotating ? '轮换中…' : '🔄 轮换种子（揭晓当前 · 换新承诺）'}</button>
          <div style={{ color: DERBY.dim, fontSize: 11, lineHeight: 1.6, marginTop: -8 }}>
            轮换后当前服务器种子明文会被公开，供你验证此前所有局；随即换一把新种子（nonce 归零）。
          </div>

          {/* 段2 已揭晓·旧服务器种子（rotate 后才有） */}
          {revealed && (
            <div>
              <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>🔑 已揭晓 · 旧服务器种子明文</span>
                <button type="button" onClick={() => setRevealShown(v => !v)} style={{ background: 'transparent', border: 'none', color: DERBY.dim, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                  {revealShown ? '隐藏 ▲' : '显示 ▼'}
                </button>
              </div>
              {revealShown && (
                <div style={{ ...monoBox, background: DERBY.selTint, border: `1px solid ${DERBY.sel}`, color: DERBY.text }}>
                  {revealed.serverSeed}
                </div>
              )}
              <div style={{ color: DERBY.dim, fontSize: 11, marginTop: 6 }}>
                旧种子 nonce 用到 {revealed.nonce} · clientSeed {revealed.clientSeed}
              </div>
            </div>
          )}

          {/* 设 clientSeed（仅 nonce=0 可改） */}
          <div>
            <div style={sectionTitle}>✏️ 设置客户端种子（仅未用过时可改）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" value={newClientSeed} onChange={e => setNewClientSeed(e.target.value)}
                placeholder={canSetClient ? '输入自定义 clientSeed' : 'nonce>0，需先轮换'}
                disabled={!canSetClient} spellCheck={false}
                style={{ ...input, flex: 1, opacity: canSetClient ? 1 : 0.5 }} />
              <button type="button" onClick={doSetClient} disabled={!canSetClient || !newClientSeed.trim()} style={{
                padding: '8px 16px', border: `1px solid ${COLORS.borderLight}`, borderRadius: RADIUS.btn,
                background: COLORS.surface, color: canSetClient ? DERBY.text : DERBY.dim, fontSize: 13, fontWeight: 800,
                cursor: canSetClient && newClientSeed.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap', flex: '0 0 auto',
                opacity: canSetClient && newClientSeed.trim() ? 1 : 0.5,
              }}>设置</button>
            </div>
            {!canSetClient && <div style={{ color: DERBY.dim, fontSize: 11, marginTop: 6 }}>当前种子已用过（nonce&gt;0），需先「轮换种子」才能改 clientSeed。</div>}
            {clientMsg && <div style={{ color: clientMsg.startsWith('✓') ? DERBY.sel : '#ff8a9a', fontSize: 11, marginTop: 6, fontWeight: 700 }}>{clientMsg}</div>}
          </div>

          {/* 段3 本地验证器 */}
          <div>
            <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🧮 本地验证器（浏览器就地重算）</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: verifierSupported ? DERBY.sel : DERBY.dim, background: verifierSupported ? DERBY.selTint : DERBY.strip, borderRadius: RADIUS.pill, padding: '1px 8px' }}>
                {verifierSupported ? '本局支持重算' : '暂不支持本地重算'}
              </span>
            </div>
            {verifierSupported ? (
              <>
                {/* 单V3b 验整局：主路径 —— 只填 roundId，其余全从本局记录自动取 */}
                <div style={{ marginBottom: 14, padding: '10px 12px', background: DERBY.strip, borderRadius: RADIUS.input, border: `1px solid ${DERBY.sel}` }}>
                  <div style={{ color: DERBY.sel, fontSize: 12, fontWeight: 900, marginBottom: 6 }}>◆ 验整局（推荐）</div>
                  <div style={{ color: DERBY.dim, fontSize: 11.5, lineHeight: 1.6, marginBottom: 8 }}>
                    填本局编号即可：clientSeed / nonce / 局内参数全部从你的这局记录自动读取，无需手抄。
                    先用上方「轮换种子」拿到 serverSeed 明文，再验此前任意一局（只能验你自己的局）。
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" value={wRid} onChange={e => setWRid(e.target.value)} spellCheck={false}
                      placeholder="本局编号 roundId（账单里可查）" style={{ ...input, flex: 1 }} />
                    <button type="button" onClick={doVerifyWhole} disabled={wBusy || !wRid.trim()} style={{
                      padding: '8px 16px', border: `1px solid ${DERBY.sel}`, borderRadius: RADIUS.btn,
                      background: DERBY.selTint, color: DERBY.sel, fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap',
                      cursor: wBusy || !wRid.trim() ? 'default' : 'pointer', opacity: wBusy || !wRid.trim() ? 0.6 : 1, flex: '0 0 auto',
                    }}>{wBusy ? '重算中…' : '验整局'}</button>
                  </div>
                  {wOut?.error && <div style={{ marginTop: 8, color: '#ff8a9a', fontSize: 11.5, fontWeight: 700, lineHeight: 1.5 }}>{wOut.error}</div>}
                  {wOut?.rows && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{
                        display: 'inline-block', fontSize: 12, fontWeight: 900, borderRadius: RADIUS.pill, padding: '3px 12px', marginBottom: 8,
                        color: wOut.allOk ? '#0d2016' : '#ff8a9a', background: wOut.allOk ? DERBY.sel : 'rgba(196,24,54,0.18)',
                      }}>
                        {wOut.allOk ? '✓ 本局完全复现 · 开奖由种子决定，服务端未作弊' : '✗ 有字段对不上，请核对种子是否为本局那把'}
                      </div>
                      <div style={{ fontSize: 10.5, color: DERBY.dim, marginBottom: 6 }}>{wOut.game} · {wOut.status} · nonce {wOut.nonce}</div>
                      {wOut.rows.map((r) => (
                        <div key={r.f} style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: MONO, marginBottom: 4, alignItems: 'flex-start' }}>
                          <span style={{ flex: '0 0 auto', color: r.ok ? DERBY.sel : '#ff8a9a', fontWeight: 900 }}>{r.ok ? '✓' : '✗'}</span>
                          <span style={{ flex: '0 0 auto', color: DERBY.dim, minWidth: 62 }}>{r.f}</span>
                          <span style={{ flex: '1 1 auto', color: DERBY.text, wordBreak: 'break-all' }}>
                            {fmtVal(r.want)}
                            {!r.ok && <span style={{ color: '#ff8a9a' }}> ≠ 重算 {fmtVal(r.got)}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {manualSupported ? (
                <>
                <div style={{ color: DERBY.dim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
                  ◇ 手填（备用）：贴入已揭晓的 serverSeed + 当时的 clientSeed / nonce，本地 HMAC-SHA256 重算该局 {fieldsOf(spec, vExtra).join(' / ')}，与后端开出的比对。
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={fieldLabel}>serverSeed（明文，轮换后带入）</div>
                  <input type="text" value={vSeed} onChange={e => setVSeed(e.target.value)} spellCheck={false} style={input} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 2 }}>
                    <div style={fieldLabel}>clientSeed</div>
                    <input type="text" value={vClient} onChange={e => setVClient(e.target.value)} spellCheck={false} style={input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={fieldLabel}>nonce</div>
                    <input type="text" value={vNonce} onChange={e => setVNonce(e.target.value)} spellCheck={false} style={input} />
                  </div>
                </div>
                {/* 单V3a：派生额外输入（plinko rows / streak risk）——是玩家下注时选的，不是派生产物，须手填 */}
                {spec.needs.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    {spec.needs.map((nd) => (
                      <div key={nd.key} style={{ flex: 1 }}>
                        <div style={fieldLabel}>{nd.label}</div>
                        <input type="text" value={vExtra[nd.key] ?? ''} spellCheck={false} style={input}
                          onChange={e => setVExtra(x => ({ ...x, [nd.key]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginBottom: 8 }}>
                  <div style={fieldLabel}>后端开出的 {mainField}（从该局记录带入 / 手填比对）</div>
                  <input type="text" value={vBackend} onChange={e => setVBackend(e.target.value)} spellCheck={false}
                    placeholder={PLACEHOLDER[game] || ''} style={input} />
                </div>
                <button type="button" onClick={doVerify} disabled={vBusy || !vSeed.trim() || !vClient.trim() || vNonce.trim() === '' || !extrasReady} style={{
                  width: '100%', padding: '10px 14px', border: `1px solid ${DERBY.sel}`, borderRadius: RADIUS.btn,
                  background: DERBY.selTint, color: DERBY.sel, fontSize: 13, fontWeight: 900,
                  cursor: vBusy || !extrasReady ? 'default' : 'pointer', opacity: vBusy || !extrasReady ? 0.6 : 1,
                }}>{vBusy ? '重算中…' : '本地重算'}</button>
                {vLocal === 'ERR' && (
                  <div style={{ marginTop: 10, color: '#ff8a9a', fontSize: 12, fontWeight: 700 }}>输入有误 · 请核对 serverSeed / clientSeed / nonce{spec.needs.length ? ` / ${spec.needs.map(n => n.key).join('/')}` : ''}</div>
                )}
                {vLocalOk && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, background: DERBY.strip, borderRadius: RADIUS.input, padding: '10px 12px' }}>
                    {/* 多字段款（streak→idx+landed）逐字段列出重算值 */}
                    {fieldsOf(spec, vExtra).map((f) => (
                      <div key={f} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                        <span style={{ color: DERBY.dim, flex: '0 0 auto' }}>本地重算 {f}</span>
                        <span style={{ fontFamily: MONO, color: DERBY.text, fontWeight: 800, wordBreak: 'break-all', textAlign: 'right' }}>{fmtVal(vLocal[f])}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
                      <span style={{ color: DERBY.dim, flex: '0 0 auto' }}>后端开出 {mainField}</span>
                      <span style={{ fontFamily: MONO, color: DERBY.text, fontWeight: 800, wordBreak: 'break-all', textAlign: 'right' }}>{expected === undefined ? '—' : fmtVal(expected)}</span>
                    </div>
                    {expected !== undefined && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, color: vMatch ? DERBY.sel : '#ff8a9a', fontSize: 13, fontWeight: 900 }}>
                        {vMatch ? '✓ 一致 · 本局公平已验证' : '✗ 不一致 · 请核对输入'}
                      </div>
                    )}
                  </div>
                )}
                </>
                ) : (
                  <div style={{ color: DERBY.dim, fontSize: 11.5, lineHeight: 1.6 }}>
                    ◇ 本款无手填路径：要比对的雷行就存在本局记录里，手填等于自己抄答案再对答案——请用上方「验整局」。
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: DERBY.dim, fontSize: 12, lineHeight: 1.6 }}>
                本游戏的本地重算器尚在开发中。你仍可用上方「轮换种子」拿到 serverSeed 明文，配合本局的 clientSeed/nonce 自行按公式校验。
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
