// 平台费流水 UI 配置（时间范围选项 + 类型/状态配色 meta）。数据走后端 /fees/list，本文件无假数据行。

// 时间范围（传后端 range 参数）。
export const RANGE_OPTIONS = [
  { key: 'month', label: '本月' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
]

// 类型：后端只出 platform_fee 这一类。
export const TYPE_META = {
  platform_fee: { label: '平台费', tone: 'primary' },
}

// 状态：后端按入账时长派生（>2 天=已入账，否则待结算）。
export const FEE_STATUS = {
  posted: { label: '已入账', tone: 'success' },
  pending: { label: '待结算', tone: 'warning' },
}
