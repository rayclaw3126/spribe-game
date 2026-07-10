// 供货商总控主布局：PC(≥900px) 常驻左侧栏；移动端顶部汉堡 + 抽屉侧栏。
// 左侧栏顶部品牌块（logo B + 供货商总控 + boss.gamehub.dad），下接分组导航。
// 照抄 admin/DashboardLayout 骨架，侧栏底色按本单 spec 用 #101923、右边框 #232c39。
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { COLORS, LAYOUT, SPACE } from '../theme/tokens.js'
import { CURRENT_USER } from '../data/session.js'
import Sidebar from '../components/Sidebar.jsx'
import useIsMobile from '../hooks/useIsMobile.js'

const SIDEBAR_W = 216

function BrandBlock() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `18px ${SPACE.md}px 14px` }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: '#2f6fe0',
          color: COLORS.white,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        B
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.text }}>供货商总控</div>
        <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>boss.gamehub.dad</div>
      </div>
    </div>
  )
}

function SidebarPanel({ onNavigate }) {
  return (
    <>
      <BrandBlock />
      <Sidebar onNavigate={onNavigate} />
    </>
  )
}

export default function VendorLayout() {
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: COLORS.bg }}>
      {!isMobile && (
        <aside
          style={{
            width: SIDEBAR_W,
            flexShrink: 0,
            borderRight: `0.5px solid #232c39`,
            background: '#101923',
          }}
        >
          <SidebarPanel />
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
              background: '#101923',
              borderRight: `0.5px solid #232c39`,
            }}
          >
            <SidebarPanel onNavigate={() => setDrawerOpen(false)} />
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
              当前账号：<strong style={{ color: COLORS.text, fontWeight: 600 }}>{CURRENT_USER}</strong>
            </span>
          </div>
        </header>

        <main style={{ flex: 1, padding: SPACE.xl, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
