import { useState, useEffect, useCallback } from 'react'
import { COLORS, DERBY, RADIUS, LAYOUT } from './tokens'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { verifyDice } from '../../lib/fairVerify'

// 可验证公平抽屉 — 共享件。壳（定位/圆角/动画/遮罩/抓手/标题行）1:1 抄 HowToPlay.jsx，
// 暗色皮同取 DERBY 系（球场绿卡底 + 金顶边/段标 + 浅绿正文），禁自编 hex。
//
// 批 C：接后端 /seed/current /rotate /client 真数据流 + 挂 verifyDice 本地重算。
// 本地验证器目前仅支持 Dice（fairVerify 只做了 verifyDice），其它游戏标"暂不支持本地重算"。
//
// 等宽字体 MONO 为【新增约定值】（tokens.js 无等宽定义，非抄袭）：用于 hash/seed 长串对齐可读。
const MONO = "ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', monospace"

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
  const [vLocal, setVLocal] = useState(null)
  const [vBusy, setVBusy] = useState(false)

  const verifierSupported = game === 'dice'

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

  async function doVerify() {
    if (!verifierSupported) return
    setVBusy(true)
    try { setVLocal(await verifyDice(vSeed.trim(), vClient.trim(), vNonce.trim())) }
    catch { setVLocal(NaN) }
    finally { setVBusy(false) }
  }

  const canSetClient = current && current.nonce === 0
  const backendNum = vBackend.trim() === '' ? null : Number(vBackend)
  const vMatch = vLocal != null && !Number.isNaN(vLocal) && backendNum != null && backendNum === vLocal

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
                {verifierSupported ? '当前支持 Dice' : '暂不支持本地重算'}
              </span>
            </div>
            {verifierSupported ? (
              <>
                <div style={{ color: DERBY.dim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
                  贴入已揭晓的 serverSeed + 当时的 clientSeed / nonce，本地 HMAC-SHA256 重算该局 roll，与后端开出的比对。
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
                <div style={{ marginBottom: 8 }}>
                  <div style={fieldLabel}>后端开出的 roll（从该局记录带入 / 手填比对）</div>
                  <input type="text" value={vBackend} onChange={e => setVBackend(e.target.value)} spellCheck={false} placeholder="例如 80.99" style={input} />
                </div>
                <button type="button" onClick={doVerify} disabled={vBusy || !vSeed.trim() || !vClient.trim() || vNonce.trim() === ''} style={{
                  width: '100%', padding: '10px 14px', border: `1px solid ${DERBY.sel}`, borderRadius: RADIUS.btn,
                  background: DERBY.selTint, color: DERBY.sel, fontSize: 13, fontWeight: 900,
                  cursor: vBusy ? 'default' : 'pointer', opacity: vBusy ? 0.6 : 1,
                }}>{vBusy ? '重算中…' : '本地重算'}</button>
                {vLocal != null && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, background: DERBY.strip, borderRadius: RADIUS.input, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: DERBY.dim }}>本地重算 roll</span>
                      <span style={{ fontFamily: MONO, color: DERBY.text, fontWeight: 800 }}>{Number.isNaN(vLocal) ? '输入有误' : vLocal}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: DERBY.dim }}>后端开出 roll</span>
                      <span style={{ fontFamily: MONO, color: DERBY.text, fontWeight: 800 }}>{backendNum == null ? '—' : vBackend}</span>
                    </div>
                    {backendNum != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, color: vMatch ? DERBY.sel : '#ff8a9a', fontSize: 13, fontWeight: 900 }}>
                        {vMatch ? '✓ 一致 · 本局公平已验证' : '✗ 不一致 · 请核对输入'}
                      </div>
                    )}
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
