// 供货商总控左侧栏 —— 分组导航（总览/商家管理/财务/监控/系统）。
// 照抄 admin/Sidebar 的 NavLink 结构，扩展为「分组标题 + ti-* 图标」两级。
// 选中：bg #2f6fe0 白字；未选文字 #c4cdd8（按本单 spec，tokens.js 不改）。
import { NavLink } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'
import Icon from './Icon.jsx'

const NAV_GROUPS = [
  {
    title: '总览',
    items: [{ to: '/dashboard', label: '全平台看板', icon: 'layout-grid' }],
  },
  {
    title: '商家管理',
    items: [
      // 「开商家」侧栏入口已删，改由商家列表页右上「+ 开商家」按钮进 /merchants/new（路由保留）。
      { to: '/merchants', label: '商家列表', icon: 'building-store' },
      { to: '/skins', label: '换肤配置台', icon: 'palette' },
    ],
  },
  {
    title: '财务',
    items: [{ to: '/fees', label: '平台费流水', icon: 'cash' }],
  },
  {
    title: '监控',
    items: [{ to: '/risk', label: '跨商家风控', icon: 'shield-half' }],
  },
  {
    title: '系统',
    // 系统问题 = 本单主体，落在根路由 '/'，默认选中
    items: [{ to: '/', end: true, label: '系统问题', icon: 'bug' }],
  },
]

function navLinkStyle({ isActive }) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: RADIUS.sm,
    fontSize: 14,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? COLORS.white : '#c4cdd8',
    background: isActive ? '#2f6fe0' : 'transparent',
    textDecoration: 'none',
  }
}

export default function Sidebar({ onNavigate }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg, padding: SPACE.md }}>
      {NAV_GROUPS.map((group) => (
        <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              padding: '0 12px 2px',
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: 0.4,
              color: COLORS.textFaint,
            }}
          >
            {group.title}
          </div>
          {group.items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              style={navLinkStyle}
              onClick={onNavigate}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}
