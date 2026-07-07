// 代理树 + 面包屑焦点 的共享状态。AgentTreeView / DownlineList / CreditGrantPanel
// 都挂在同一个 Provider 下，下钻/面包屑在任意页面触发都全局同步。
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { getTree, getDownline, getMe } from '../api/client.js'
import { useAuth } from './AuthContext.jsx'
import { buildFocusView } from './agentSelectors.js'

const AgentContext = createContext(null)

export function AgentProvider({ children }) {
  const { user } = useAuth()
  const [treeFlat, setTreeFlat] = useState([])
  const [downlineOfSelf, setDownlineOfSelf] = useState([])
  const [meInfo, setMeInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 面包屑：第一项永远是登录代理自己
  const [chain, setChain] = useState(() => (user ? [{ id: user.id, username: user.username }] : []))

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tree, downline, me] = await Promise.all([getTree(), getDownline(), getMe()])
      setTreeFlat(tree || [])
      setDownlineOfSelf(downline || [])
      setMeInfo(me || null)
    } catch (err) {
      setError(err.message || '加载代理数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])

  const focus = chain[chain.length - 1] || (user ? { id: user.id, username: user.username } : null)

  const drillInto = useCallback((node) => {
    setChain((prev) => [...prev, { id: node.id, username: node.username }])
  }, [])

  const drillToIndex = useCallback((index) => {
    setChain((prev) => prev.slice(0, index + 1))
  }, [])

  const focusView = useMemo(() => {
    if (!focus || !user) return null
    return buildFocusView(treeFlat, downlineOfSelf, focus, user.id, meInfo)
  }, [treeFlat, downlineOfSelf, focus, user, meInfo])

  const value = useMemo(
    () => ({
      treeFlat,
      downlineOfSelf,
      meInfo,
      loading,
      error,
      chain,
      focus,
      focusView,
      refresh,
      drillInto,
      drillToIndex,
    }),
    [treeFlat, downlineOfSelf, meInfo, loading, error, chain, focus, focusView, refresh, drillInto, drillToIndex]
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgentTree() {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgentTree 必须在 AgentProvider 内使用')
  return ctx
}
