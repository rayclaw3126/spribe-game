// 展示格式化小工具。

// 后端 id 是自增数字（字符串）；列表展示统一补零到 4 位，形如 #0002。
export function padId(id) {
  return `#${String(id).padStart(4, '0')}`
}

// ISO 时间 → 'MM-DD HH:mm'（本地时区）。非法输入原样返回。
export function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
