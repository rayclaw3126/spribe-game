// 系统问题 UI 配置 —— 状态/优先级配色 + tab 顺序 + 商家下拉选项。
// 数据本身走后端 /issues（见 api/client.js），本文件不再含任何假数据。
// 状态 status 与后端枚举对齐：new(新问题) / processing(处理中) / resolved(已解决) / ignored(已忽略)
// 优先级 priority: high(高) / mid(中) / low(低)

export const STATUS_META = {
  new: { label: '新问题', color: '#7f77dd', bg: 'rgba(127,119,221,0.16)' },
  processing: { label: '处理中', color: '#F5A623', bg: 'rgba(245,166,35,0.18)' },
  resolved: { label: '已解决', color: '#16C784', bg: 'rgba(22,199,132,0.16)' },
  ignored: { label: '已忽略', color: '#8a97a6', bg: '#1a2230' },
}

export const PRIORITY_META = {
  high: { label: '高', color: '#e2564a' },
  mid: { label: '中', color: '#F5A623' },
  low: { label: '低', color: '#8a97a6' },
}

// tab 顺序 + 计数依据。all 特殊：不过滤（后端不传 status）。
export const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '新问题' },
  { key: 'processing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'ignored', label: '已忽略' },
]

export const MERCHANTS = ['GameHub', 'RedPlay', 'LuckyBet', 'StarWin']

// 归属商家下拉选项（含"平台级"= 留空）
export const MERCHANT_OPTIONS = ['', ...MERCHANTS]
