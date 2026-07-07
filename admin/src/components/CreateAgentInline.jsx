// 行内"新建下级代理"表单 —— 只在焦点=自己时显示（后端 /agent/create 固定在
// 登录代理自己名下建人，没有指定父级的参数）。方便自测时下级不够用时现场造一个。
import { useState } from 'react'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import { createAgent } from '../api/client.js'
import { useAgentTree } from '../state/AgentContext.jsx'
import { useToast } from '../state/ToastContext.jsx'

export default function CreateAgentInline() {
  const { refresh } = useAgentTree()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError('用户名和密码均为必填')
      return
    }
    setSubmitting(true)
    try {
      await createAgent(username, password, 'agent')
      push(`新建下级代理「${username}」成功`, 'success')
      setUsername('')
      setPassword('')
      setOpen(false)
      await refresh()
    } catch (err) {
      setError(err.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: 'flex-start',
          padding: '7px 14px',
          fontSize: 13,
          fontWeight: 500,
          color: COLORS.primary,
          background: COLORS.primarySoft,
          border: `1px solid ${COLORS.primaryBorder}`,
          borderRadius: RADIUS.sm,
          cursor: 'pointer',
        }}
      >
        + 新建下级代理
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: SPACE.sm,
        alignItems: 'flex-start',
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: RADIUS.md,
        padding: SPACE.md,
      }}
    >
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="新代理用户名"
        style={inputStyle}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="新代理密码"
        style={inputStyle}
      />
      <button type="submit" disabled={submitting} style={submitStyle}>
        {submitting ? '创建中…' : '创建'}
      </button>
      <button type="button" onClick={() => setOpen(false)} style={cancelStyle}>
        取消
      </button>
      {error && <div style={{ width: '100%', fontSize: 12.5, color: COLORS.danger }}>{error}</div>}
    </form>
  )
}

const inputStyle = {
  padding: '7px 10px',
  fontSize: 13.5,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
  minWidth: 140,
}

const submitStyle = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: COLORS.primary,
  border: 'none',
  borderRadius: RADIUS.sm,
  cursor: 'pointer',
}

const cancelStyle = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 500,
  color: COLORS.textMuted,
  background: 'transparent',
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  cursor: 'pointer',
}
