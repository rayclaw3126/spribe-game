import { useState } from 'react'

// 玩家登录页 —— 仅 Aviator 需要真实登录（余额以服务器为准）；其它 20 款游戏
// 仍用本地模拟余额，不经过这里。登录成功后把 token/用户名交给 App，
// App 负责写 localStorage 并把玩家放进 Aviator。
export default function GameLogin({ onLogin, onCancel }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username || !password) {
      setError('请输入用户名和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, type: 'player' }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setError(data?.error || '登录失败，请重试')
        setLoading(false)
        return
      }
      onLogin({ token: data.token, username: data.username })
    } catch {
      setError('网络异常，请稍后重试')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a1119',
      padding: 20,
      boxSizing: 'border-box',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: '100%', maxWidth: 380,
        background: '#101923',
        border: '1.5px solid #232c39',
        borderRadius: 16,
        padding: 32,
        boxSizing: 'border-box',
        boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, margin: '0 auto 14px',
            background: '#1a2230', border: '1px solid #232c39',
            color: '#16c784', fontSize: 26,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✈️</div>
          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800, fontSize: 22, color: '#e8edf2', margin: 0,
          }}>玩家登录</h1>
          <p style={{ color: '#8a97a6', fontSize: 13, marginTop: 8 }}>
            Breakaway 由服务器实时驱动，登录后余额以服务器为准
          </p>
        </div>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#8a97a6', marginBottom: 6 }}>
            用户名
          </span>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="请输入用户名"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0a1119', border: '1.5px solid #243142',
              borderRadius: 10, padding: '11px 14px',
              color: '#e8edf2', fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#8a97a6', marginBottom: 6 }}>
            密码
          </span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0a1119', border: '1.5px solid #243142',
              borderRadius: 10, padding: '11px 14px',
              color: '#e8edf2', fontSize: 14,
            }}
          />
        </label>

        {error && (
          <div style={{
            background: 'rgba(226,86,74,0.12)', border: '1px solid rgba(226,86,74,0.4)',
            color: '#e2564a', fontSize: 13, fontWeight: 600,
            borderRadius: 10, padding: '10px 12px', marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '13px 0',
            borderRadius: 999, border: 'none',
            background: loading ? '#0e5c3f' : '#16c784',
            color: '#06251a', fontSize: 15, fontWeight: 800,
            cursor: loading ? 'default' : 'pointer',
            marginBottom: 12,
          }}
        >
          {loading ? '登录中…' : '登录'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              width: '100%', padding: '11px 0',
              borderRadius: 999, border: '1px solid #232c39',
              background: 'transparent',
              color: '#8a97a6', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            返回大厅
          </button>
        )}
      </form>
    </div>
  )
}
