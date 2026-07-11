// 内联 Tabler(ti-*) 线性图标 —— 后台/admin 侧无图标库，为免引入 CDN 依赖，
// 这里把本单用到的少量 ti-* 图标以 stroke SVG 内联，风格与 Tabler 官方一致
// (24 视框 / 2px 描边 / currentColor)。新增图标时按 ti-<name> 补进 PATHS 即可。
const PATHS = {
  'layout-grid': (
    <>
      <path d="M4 4h6v6h-6z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6h-6z" />
      <path d="M14 14h6v6h-6z" />
    </>
  ),
  'building-store': (
    <>
      <path d="M3 21l18 0" />
      <path d="M3 7v1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1h-18l2 -4h14l2 4" />
      <path d="M5 21l0 -10.15" />
      <path d="M19 21l0 -10.15" />
      <path d="M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5l0 14" />
      <path d="M5 12l14 0" />
    </>
  ),
  palette: (
    <>
      <path d="M12 21a9 9 0 0 1 0 -18a9 8 0 0 1 9 8a4.5 4 0 0 1 -4.5 4h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25" />
      <path d="M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    </>
  ),
  cash: (
    <>
      <path d="M7 9m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" />
      <path d="M14 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M17 9v-2a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v6a2 2 0 0 0 2 2h2" />
    </>
  ),
  'shield-half': (
    <>
      <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
      <path d="M12 3v18" />
    </>
  ),
  bug: (
    <>
      <path d="M9 9v-1a3 3 0 0 1 6 0v1" />
      <path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3" />
      <path d="M3 13l4 0" />
      <path d="M17 13l4 0" />
      <path d="M12 20l0 -6" />
      <path d="M4 19l3.35 -2" />
      <path d="M20 19l-3.35 -2" />
      <path d="M4 7l3.75 2.4" />
      <path d="M20 7l-3.75 2.4" />
    </>
  ),
  search: (
    <>
      <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
      <path d="M21 21l-6 -6" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6l6 -6" />,
  user: (
    <>
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    </>
  ),
  photo: (
    <>
      <path d="M15 8h.01" />
      <path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z" />
      <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" />
      <path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" />
    </>
  ),
}

export default function Icon({ name, size = 18, color = 'currentColor', style }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
