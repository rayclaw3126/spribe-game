import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { login as loginRequest } from '../api/client.js'
import { useAuth } from '../state/AuthContext.jsx'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'

export default function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError('请输入用户名和密码')
      return
    }
    setSubmitting(true)
    try {
      const result = await loginRequest(username, password)
      login(result.token, { id: result.id, username: result.username })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.bg,
        padding: SPACE.lg,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          maxWidth: '100%',
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADIUS.lg,
          padding: SPACE.xl,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.lg,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.text }}>代理后台登录</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>请使用代理账号登录</div>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>用户名</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
            autoComplete="username"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMuted }}>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
            style={inputStyle}
          />
        </label>

        {error && (
          <div
            style={{
              fontSize: 13,
              color: COLORS.danger,
              background: COLORS.dangerTint,
              border: `1px solid rgba(226,86,74,0.35)`,
              borderRadius: RADIUS.sm,
              padding: '8px 12px',
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting} style={submitStyle(submitting)}>
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}

const inputStyle = {
  padding: '9px 12px',
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: RADIUS.sm,
  outline: 'none',
}

function submitStyle(submitting) {
  return {
    marginTop: SPACE.xs,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: submitting ? COLORS.slate : COLORS.primary,
    border: 'none',
    borderRadius: RADIUS.sm,
    cursor: submitting ? 'default' : 'pointer',
  }
}
