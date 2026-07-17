import { useState, useEffect, lazy, Suspense } from 'react'
import { COLORS, DERBY, RADIUS, LAYOUT, MONO } from './shell/tokens'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { shortRoundNo } from './drawFormatters'
import { LOCAL_VERIFY_GAMES } from './shell/localVerifyGames'
// 单V2：本地重算验证器懒加载（引擎+纯JS rng 独立 async chunk，主包不增重）。
const LocalVerify = lazy(() => import('./shell/LocalVerify'))

// 共享局「本期可验证公平」抽屉 —— 覆盖 crash 2 款（aviator/momentum inline commit-reveal）
// + 轮次彩 9 款（useRoundRoom.commit）。与 SeedFairness（模型A·逐玩家轮换种子）并列，专供
// 「一局一把种子·全场共享·commit→reveal」形态：betting 只给承诺 hash，开奖后才 reveal serverSeed。
// 壳（定位/圆角/动画/遮罩/抓手/标题行）照 SeedFairness/HowToPlay，暗色皮取 DERBY 系，禁自编 hex。
//
// props: { open, onClose, venue, round:{ roundNo, commitHash, clientSeed, nonce, serverSeed? } }
//   commitHash = betting 期广播的承诺（crash 叫 commitHash / 轮次彩叫 serverSeedHash，wiring 侧映射统一为 commitHash）。
//   serverSeed = 开奖(crashed/done/drawn)后 reveal 的明文；未揭晓时缺省。
// 揭晓后本地 crypto.subtle SHA-256(serverSeed) 比对 commitHash（后端算法：sha256(纯 serverSeed) 无拼接，
//   见 game/aviator.js|momentum.js hashSeed + ws/roundHub.js:209，逐位一致）→ 显 ✓承诺一致 / ✗不符。

// 浏览器就地算 sha256(hex)，与后端 crypto.createHash('sha256').update(serverSeed).digest('hex') 同口径。
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function CommitRevealFairness({ open, onClose, venue, round, onViewHistory, game, drawResult }) {
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)
  const [verify, setVerify] = useState(null)   // null=未算 | 'checking' | 'match' | 'mismatch' | 'error'
  const [copied, setCopied] = useState('')
  const [recalcOpen, setRecalcOpen] = useState(false)   // 单V2：本地重算面板开关

  const roundNo = round?.roundNo ?? null
  const commitHash = round?.commitHash || ''
  const clientSeed = round?.clientSeed || ''
  const nonce = round?.nonce
  const serverSeed = round?.serverSeed || ''
  // 单V2：本期已揭晓(有 serverSeed) + nonce 非空 + 支持的排期款 → 显本地重算钮
  const canRecalc = !!game && LOCAL_VERIFY_GAMES.has(game) && !!serverSeed && nonce != null && !!drawResult

  // 揭晓后自动比对：sha256(serverSeed) === commitHash ?
  useEffect(() => {
    if (!open) return
    if (!serverSeed || !commitHash) { setVerify(null); return }
    let cancelled = false
    setVerify('checking')
    sha256Hex(serverSeed)
      .then(h => { if (!cancelled) setVerify(h.toLowerCase() === commitHash.toLowerCase() ? 'match' : 'mismatch') })
      .catch(() => { if (!cancelled) setVerify('error') })
    return () => { cancelled = true }
  }, [open, serverSeed, commitHash])

  if (!open) return null

  const cardPos = isDesk ? {
    top: '50%', left: '50%', width: 'min(720px, calc(100vw - 48px))',
    transform: 'translate(-50%, -50%)', borderRadius: 16, maxHeight: '90vh', animation: 'htpFadeIn 0.2s ease-out',
  } : {
    left: 0, right: 0, bottom: 0, maxWidth: 520, margin: '0 auto',
    borderRadius: '16px 16px 0 0', maxHeight: '92vh', animation: 'htpSlideUp 0.28s ease-out',
  }

  function copy(label, text) {
    if (!text) return
    try { navigator.clipboard?.writeText(text) } catch { /* 忽略无剪贴板权限 */ }
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  const sectionTitle = { color: DERBY.gold, fontSize: 12, fontWeight: 900, letterSpacing: 0.5, marginBottom: 8 }
  const fieldLabel = { color: DERBY.dim, fontSize: 11, fontWeight: 700, marginBottom: 4 }
  const monoBox = {
    fontFamily: MONO, fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all',
    background: DERBY.strip, border: `1px solid ${COLORS.borderLight}`,
    borderRadius: RADIUS.input, padding: '8px 10px', boxSizing: 'border-box',
  }
  // 可复制的 hash/seed 框（点击复制全量）
  const copyBox = (label, value, color) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ ...fieldLabel, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {value && <span onClick={() => copy(label, value)} style={{ cursor: 'pointer', color: copied === label ? DERBY.sel : DERBY.dim }}>{copied === label ? '✓ 已复制' : '点击复制'}</span>}
      </div>
      <div style={{ ...monoBox, color: color || DERBY.text }}>{value || '—'}</div>
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes htpSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes htpFadeIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
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
            <div style={{ color: COLORS.white, fontSize: 16, fontWeight: 900, whiteSpace: 'nowrap' }}>⚖ 本期可验证公平</div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{
            width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)', color: COLORS.white, fontSize: 15, fontWeight: 900, cursor: 'pointer',
            lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>
        {/* 可滚内容 */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 段1 本期承诺（开奖前已固定） */}
          <div>
            <div style={sectionTitle}>🔒 本期承诺（开奖前已固定）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={fieldLabel}>期号 · roundNo</span>
              <span title={roundNo ?? ''} style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, color: '#0d2016', background: DERBY.sel, borderRadius: RADIUS.pill, padding: '2px 12px' }}>{roundNo == null ? '—' : `#${shortRoundNo(roundNo)}`}</span>
              {nonce != null && (
                <><span style={{ ...fieldLabel, marginLeft: 8 }}>nonce</span>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: DERBY.text }}>{nonce}</span></>
              )}
            </div>
            {copyBox('服务器种子哈希 · commitHash（承诺）', commitHash, DERBY.gold)}
            {copyBox('客户端种子 · clientSeed', clientSeed)}
          </div>

          {/* 段2 揭晓 + 自动比对 */}
          <div>
            <div style={sectionTitle}>🔑 开奖揭晓 · serverSeed</div>
            {serverSeed ? (
              <>
                {copyBox('服务器种子明文 · serverSeed', serverSeed, DERBY.text)}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 13, fontWeight: 900,
                  color: verify === 'match' ? DERBY.sel : verify === 'checking' ? DERBY.dim : '#ff8a9a',
                }}>
                  {verify === 'checking' && '校验中… sha256(serverSeed) vs commitHash'}
                  {verify === 'match' && '✓ 承诺一致 · 本期公平已验证（sha256(serverSeed) == commitHash）'}
                  {verify === 'mismatch' && '✗ 不符 · sha256(serverSeed) 与承诺哈希不一致'}
                  {verify === 'error' && '· 本地校验失败（浏览器不支持 crypto.subtle？）'}
                </div>
              </>
            ) : (
              <div style={{ color: DERBY.dim, fontSize: 12, lineHeight: 1.6 }}>
                开奖后揭晓。届时可自行 sha256(serverSeed) 校验是否 == 上方承诺哈希，验证开奖结果未被中途篡改。
              </div>
            )}
          </div>

          {/* 单V2：本期本地重算钮（懒加载 LocalVerify）——已揭晓且三要素齐才显 */}
          {canRecalc && (
            <div>
              <button type="button" onClick={() => setRecalcOpen(v => !v)} style={{
                width: '100%', padding: '10px 14px', border: `1px solid ${COLORS.green}`, borderRadius: RADIUS.btn,
                background: recalcOpen ? COLORS.greenTint : 'transparent', color: COLORS.green, fontSize: 13, fontWeight: 900, cursor: 'pointer',
              }}>{recalcOpen ? '收起本地重算' : '🔁 本地重算（serverSeed+clientSeed+nonce → 开奖）'}</button>
              {recalcOpen && (
                <Suspense fallback={<div style={{ fontSize: 12, color: DERBY.dim, padding: '8px 2px' }}>加载重算器…</div>}>
                  <LocalVerify game={game} serverSeed={serverSeed} clientSeed={clientSeed} nonce={nonce} drawResult={drawResult} />
                </Suspense>
              )}
            </div>
          )}

          <div style={{ color: DERBY.dim, fontSize: 11, lineHeight: 1.6 }}>
            原理：开奖前只公布 serverSeed 的哈希承诺（无法反推结果）；开奖后公开 serverSeed 明文，
            任何人都能用 serverSeed + clientSeed + nonce 重算本期结果，并核对 sha256(serverSeed) == 承诺哈希，
            证明服务器没有在开奖后临时改结果。
          </div>

          {/* 查看往期（仅轮次彩接入：传 onViewHistory 才渲染；点击关本抽屉、开开奖历史） */}
          {onViewHistory && (
            <button type="button" onClick={() => { onClose(); onViewHistory() }} style={{
              width: '100%', padding: '10px 14px', border: `1px solid ${DERBY.sel}`, borderRadius: RADIUS.btn,
              background: 'transparent', color: DERBY.sel, fontSize: 13, fontWeight: 900, cursor: 'pointer',
            }}>查看往期开奖历史 →</button>
          )}
        </div>
      </div>
    </>
  )
}
