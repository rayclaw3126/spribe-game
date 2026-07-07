import { NavLink } from 'react-router-dom'
import { COLORS, RADIUS, SPACE } from '../theme/tokens.js'

const NAV_ITEMS = [
  { to: '/', label: '代理树', end: true },
  { to: '/downline', label: '下级列表' },
  { to: '/credit', label: '额度下发' },
]

function navStyle({ isActive }) {
  return {
    display: 'block',
    padding: '9px 14px',
    borderRadius: RADIUS.sm,
    fontSize: 14,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? COLORS.text : COLORS.textMuted,
    background: isActive ? COLORS.surface : 'transparent',
    textDecoration: 'none',
    border: `1px solid ${isActive ? COLORS.borderLight : 'transparent'}`,
  }
}

export default function Sidebar({ onNavigate }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: SPACE.md }}>
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} style={navStyle} onClick={onNavigate}>
          {item.label}
        </NavLink>
      ))}

      <div
        title="占成设置接口待单6期上线"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SPACE.sm,
          padding: '9px 14px',
          borderRadius: RADIUS.sm,
          fontSize: 14,
          fontWeight: 500,
          color: COLORS.textFaint,
          cursor: 'not-allowed',
          userSelect: 'none',
        }}
      >
        <span>占成设置</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: COLORS.textFaint,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADIUS.sm,
            padding: '1px 5px',
          }}
        >
          单6
        </span>
      </div>
    </nav>
  )
}
