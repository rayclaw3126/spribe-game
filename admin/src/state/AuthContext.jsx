// 登录态 context —— 包一层 authStore，让组件树能响应式拿到当前用户/token。
import { createContext, useContext, useMemo, useState, useCallback } from 'react'
import { getToken, getUser, setAuth, clearAuth } from '../auth/authStore.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getToken())
  const [user, setUser] = useState(() => getUser())

  const login = useCallback((nextToken, nextUser) => {
    setAuth(nextToken, nextUser)
    setToken(nextToken)
    setUser(nextUser)
  }, [])

  const logout = useCallback(() => {
    clearAuth()
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ token, user, isAuthenticated: Boolean(token), login, logout }),
    [token, user, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
