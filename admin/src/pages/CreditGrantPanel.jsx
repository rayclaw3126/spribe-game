// 额度下发面板：选下级(代理) → 输入金额 → 发放/收回。
// 后端错误(额度不足/越权)必须原样弹给用户，不吞。
import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { grantCredit, reclaimCredit } from '../api/client.js'
import PlaceholderBadge from '../components/PlaceholderBadge.jsx'

export default function CreditGrantPanel() {
  const { downlineOfSelf, refresh } = useAgentTree()
  const { push } = useToast()

  const agentOptions = downlineOfSelf.filter((row) => row.kind === 'agent')

  const [toAgent, setToAgent] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState('')
  const [formError, setFormError] = useState('')

  async function handleAction(action) {
    setFormError('')
    if (!toAgent) {
      setFormError('请先选择一个下级代理')
      return
    }
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setFormError('请输入大于 0 的金额')
      return
    }

    setSubmitting(action)
    try {
      if (action === 'grant') {
        await grantCredit(toAgent, amount)
        push('额度发放成功', 'success')
      } else {
        await reclaimCredit(toAgent, amount)
        push('额度收回成功', 'success')
      }
      setAmount('')
      await refresh()
    } catch (err) {
      setFormError(err.message || '操作失败')
      push(err.message || '操作失败', 'error')
    } finally {
      setSubmitting('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl, maxWidth: 520 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: COLORS.text, margin: '0 0 2px' }}>额度下发</h1>
        <div style={{ fontSize: 13, color: COLORS.textFaint }}>
          仅可对本人直属下级代理发放/收回额度（越权或额度不足会由后端拒绝并在此提示）。
        </div>
      </div>

      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>选择下级代理</span>
          <select
            value={toAgent}
            onChange={(e) => setToAgent(e.target.value)}
            style={{
              padding: '9px 10px',
              fontSize: 14,
              color: COLORS.text,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADIUS.sm,
              outline: 'none',
            }}
          >
            <option value="">请选择</option>
            {agentOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.username}
              </option>
            ))}
          </select>
          {agentOptions.length === 0 && (
            <span style={{ fontSize: 12, color: COLORS.textFaint }}>暂无直属下级代理，无法发放/收回额度</span>
          )}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>金额</span>
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
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => handleAction('grant')}
            style={actionButtonStyle(COLORS.primary, submitting === 'grant')}
          >
            {submitting === 'grant' ? '发放中…' : '发放'}
          </button>
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => handleAction('reclaim')}
            style={actionButtonStyle(COLORS.warning, submitting === 'reclaim')}
          >
            {submitting === 'reclaim' ? '收回中…' : '收回'}
          </button>
        </div>
      </div>

      <div
        style={{
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
          opacity: 0.55,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.text }}>占成设置</div>
          <PlaceholderBadge text="设置接口待单6" />
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>下级占成比例（%）</span>
          <input type="number" disabled placeholder="待接口开放" style={disabledInputStyle} />
        </label>
        <button type="button" disabled style={disabledButtonStyle}>
          保存设置
        </button>
      </div>
    </div>
  )
}

function actionButtonStyle(bg, busy) {
  return {
    flex: 1,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: busy ? COLORS.slate : bg,
    border: 'none',
    borderRadius: RADIUS.sm,
    cursor: busy ? 'default' : 'pointer',
  }
}

const disabledInputStyle = {
  padding: '9px 10px',
  fontSize: 14,
  color: COLORS.textFaint,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  cursor: 'not-allowed',
}

const disabledButtonStyle = {
  padding: '9px 16px',
  fontSize: 13.5,
  fontWeight: 600,
  color: COLORS.textFaint,
  background: 'transparent',
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  cursor: 'not-allowed',
}
