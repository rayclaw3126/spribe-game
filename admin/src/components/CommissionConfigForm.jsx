// 占成设置表单：选一个下级代理 -> 输入输赢占成 / 流水占成 -> 提交。
// 后端会校验「不能超过我自己的占成」，超限/越权都原样把 error 弹给用户，不吞。
import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import { useToast } from '../state/ToastContext.jsx'
import { setCommissionConfig } from '../api/client.js'

export default function CommissionConfigForm() {
  const { downlineOfSelf, refresh } = useAgentTree()
  const { push } = useToast()

  const agentOptions = downlineOfSelf.filter((row) => row.kind === 'agent')

  const [agentId, setAgentId] = useState('')
  const [winLossPct, setWinLossPct] = useState('')
  const [turnoverPct, setTurnoverPct] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')

    if (!agentId) {
      setFormError('请先选择一个下级代理')
      return
    }
    const winNum = Number(winLossPct)
    const turnNum = Number(turnoverPct)
    if (!Number.isFinite(winNum) || winNum < 0 || winNum > 100) {
      setFormError('请输入 0～100 之间的输赢占成比例')
      return
    }
    if (!Number.isFinite(turnNum) || turnNum < 0 || turnNum > 100) {
      setFormError('请输入 0～100 之间的流水占成比例')
      return
    }

    setSubmitting(true)
    try {
      await setCommissionConfig(agentId, winNum, turnNum)
      push('占成设置保存成功', 'success')
      await refresh()
    } catch (err) {
      setFormError(err.message || '保存失败')
      push(err.message || '保存失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
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
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.text }}>占成设置</div>
        <div style={{ fontSize: 12.5, color: COLORS.textFaint, marginTop: 2 }}>
          仅可给本人直属下级代理设置占成，且不能超过自己当前的占成比例。
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>选择下级代理</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            style={selectStyle}
          >
            <option value="">请选择</option>
            {agentOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.username}
              </option>
            ))}
          </select>
          {agentOptions.length === 0 && (
            <span style={{ fontSize: 12, color: COLORS.textFaint }}>暂无直属下级代理，无法设置占成</span>
          )}
        </label>

        <div style={{ display: 'flex', gap: SPACE.md }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>输赢占成（%）</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={winLossPct}
              onChange={(e) => setWinLossPct(e.target.value)}
              placeholder="0～100"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>流水占成（%）</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={turnoverPct}
              onChange={(e) => setTurnoverPct(e.target.value)}
              placeholder="0～100"
              style={inputStyle}
            />
          </label>
        </div>

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

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '9px 16px',
            fontSize: 13.5,
            fontWeight: 600,
            color: '#fff',
            background: submitting ? COLORS.slate : COLORS.primary,
            border: 'none',
            borderRadius: RADIUS.sm,
            cursor: submitting ? 'default' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          {submitting ? '保存中…' : '保存设置'}
        </button>
      </form>
    </div>
  )
}

const selectStyle = {
  padding: '9px 10px',
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
}

const inputStyle = {
  padding: '9px 10px',
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
}
