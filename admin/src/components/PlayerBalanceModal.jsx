// 玩家上下分弹窗：选择上分/下分动作 -> 输入金额 -> 提交。
// idempotencyKey 由前端生成（每次提交都换一个新的，防止用户手滑重复点击时后端误判成正常重放）。
// 后端错误（额度不足/余额不足/越权）必须原样弹出，不吞。
import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { deposit, withdraw } from '../api/client.js'

function makeIdempotencyKey(action, playerId) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${action === 'deposit' ? 'dep' : 'wd'}-${playerId}-${Date.now()}-${rand}`
}

function formatAmount(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value)
}

export default function PlayerBalanceModal({ player, onClose }) {
  const { refresh } = useAgentTree()
  const { push } = useToast()

  const [action, setAction] = useState('deposit')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [lastBalance, setLastBalance] = useState(player?.balance ?? null)

  if (!player) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')

    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setFormError('请输入大于 0 的金额')
      return
    }

    setSubmitting(true)
    try {
      const idempotencyKey = makeIdempotencyKey(action, player.id)
      const result =
        action === 'deposit'
          ? await deposit(player.id, amount, idempotencyKey)
          : await withdraw(player.id, amount, idempotencyKey)

      setLastBalance(result.playerBalanceAfter)
      const actionLabel = action === 'deposit' ? '上分成功' : '下分成功'
      push(`${actionLabel}，当前余额 ¥${formatAmount(result.playerBalanceAfter)}`, 'success')
      setAmount('')
      onClose()
      await refresh()
    } catch (err) {
      setFormError(err.message || '操作失败')
      push(err.message || '操作失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: SPACE.lg,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>玩家上下分</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'none',
              border: 'none',
              color: COLORS.textMuted,
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 13.5, color: COLORS.textMuted }}>
          玩家：<strong style={{ color: COLORS.text }}>{player.username}</strong>
          <span style={{ marginLeft: SPACE.md }}>
            当前余额：<strong style={{ color: COLORS.text }}>{formatAmount(lastBalance)}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: SPACE.sm }}>
          <button
            type="button"
            onClick={() => setAction('deposit')}
            style={tabButtonStyle(action === 'deposit')}
          >
            上分
          </button>
          <button
            type="button"
            onClick={() => setAction('withdraw')}
            style={tabButtonStyle(action === 'withdraw')}
          >
            下分
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>
              {action === 'deposit' ? '上分金额（额度 → 玩家余额）' : '下分金额（玩家余额 → 额度）'}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="请输入金额"
              style={{
                padding: '9px 10px',
                fontSize: 14,
                color: COLORS.text,
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS.sm,
                outline: 'none',
              }}
            />
          </label>

          {formError && (
            <div
              style={{
                fontSize: 13,
                color: COLORS.danger,
                background: COLORS.dangerTint,
                border: '1px solid rgba(226,86,74,0.35)',
                borderRadius: RADIUS.sm,
                padding: '8px 12px',
              }}
            >
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: SPACE.sm }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                background: submitting ? COLORS.slate : action === 'deposit' ? COLORS.primary : COLORS.warning,
                border: 'none',
                borderRadius: RADIUS.sm,
                cursor: submitting ? 'default' : 'pointer',
              }}
            >
              {submitting ? '提交中…' : action === 'deposit' ? '确认上分' : '确认下分'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                color: COLORS.textMuted,
                background: 'transparent',
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS.sm,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function tabButtonStyle(active) {
  return {
    flex: 1,
    padding: '8px 12px',
    fontSize: 13.5,
    fontWeight: 600,
    color: active ? '#fff' : COLORS.textMuted,
    background: active ? COLORS.primary : COLORS.surface,
    border: `1px solid ${active ? COLORS.primaryBorder : COLORS.border}`,
    borderRadius: RADIUS.sm,
    cursor: 'pointer',
  }
}
