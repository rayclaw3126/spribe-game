// 主布局：PC(≥900px) 常驻左侧栏；移动端顶部汉堡 + 抽屉侧栏。
// 顶部条：当前代理名 + 退出按钮。主区 <Outlet/>。
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { COLORS, LAYOUT, SPACE } from '../theme/tokens.js'
import { useAuth } from '../state/AuthContext.jsx'
import Sidebar from '../components/Sidebar.jsx'
import FeedbackWidget from '../components/feedback/FeedbackWidget.jsx'
import useIsMobile from '../hooks/useIsMobile.js'

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: COLORS.bg }}>
      {!isMobile && (
        <aside
          style={{
            width: LAYOUT.sidebarW,
            flexShrink: 0,
            borderRight: `1px solid ${COLORS.border}`,
            background: COLORS.bg,
          }}
        >
          <div style={{ padding: `${SPACE.lg}px ${SPACE.md}px`, fontSize: 15, fontWeight: 600 }}>代理后台</div>
          <Sidebar />
        </aside>
      )}

      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 240,
              background: COLORS.panel,
              borderRight: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ padding: `${SPACE.lg}px ${SPACE.md}px`, fontSize: 15, fontWeight: 600 }}>代理后台</div>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            height: LAYOUT.headerH,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `0 ${SPACE.lg}px`,
            borderBottom: `1px solid ${COLORS.border}`,
            background: COLORS.panel,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
            {isMobile && (
              <button
                type="button"
                aria-label="打开菜单"
                onClick={() => setDrawerOpen(true)}
                style={{
                  background: 'none',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  width: 36,
                  height: 32,
                  color: COLORS.text,
                  fontSize: 16,
                  cursor: 'pointer',
                }}
              >
                ☰
              </button>
            )}
            <span style={{ fontSize: 13.5, color: COLORS.textMuted }}>
              当前代理：<strong style={{ color: COLORS.text, fontWeight: 600 }}>{user?.username}</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={logout}
            style={{
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: COLORS.textMuted,
              background: 'transparent',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            退出登录
          </button>
        </header>

        <main style={{ flex: 1, padding: SPACE.xl, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>

      {/* 反馈悬浮入口：登录后全局显示，挂在最外层。 */}
      <FeedbackWidget />
    </div>
  )
}
