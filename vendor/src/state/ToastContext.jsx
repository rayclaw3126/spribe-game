// 全局 Toast 提示：成功/失败提示统一从这里弹出，避免各页面各写一套。
import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(null)

let idSeq = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message, tone = 'success') => {
      const id = ++idSeq
      setToasts((prev) => [...prev, { id, message, tone }])
      const timer = setTimeout(() => dismiss(id), 3200)
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  const value = { push }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 999,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            style={{
              minWidth: 240,
              maxWidth: 360,
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: '#e8edf2',
              border: '1px solid',
              borderColor: t.tone === 'error' ? 'rgba(226,86,74,0.5)' : 'rgba(22,199,132,0.45)',
              background: t.tone === 'error' ? 'rgba(58,20,18,0.95)' : 'rgba(13,42,31,0.95)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
