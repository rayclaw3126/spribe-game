// 跨商家风控 UI 配置（等级筛选选项 + 风险类型/等级/状态配色 meta）。数据走后端 /risk/list，本文件无假数据行。

// 风险等级筛选（segmented，传后端 level 参数）。all 特殊：不过滤。
export const LEVEL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'high', label: '高' },
  { key: 'mid', label: '中' },
  { key: 'low', label: '低' },
]

export const RISK_TYPE = {
  abnormal_bet: { label: '异常投注' },
  wash: { label: '对刷' },
  big_withdraw: { label: '大额提现' },
  multi_account: { label: '多账号' },
}
export const RISK_LEVEL = {
  high: { label: '高', tone: 'danger' },
  mid: { label: '中', tone: 'warning' },
  low: { label: '低', tone: 'muted' },
}
export const RISK_STATUS = {
  pending: { label: '待处理', tone: 'warning' },
  handled: { label: '已处理', tone: 'success' },
  ignored: { label: '已忽略', tone: 'muted' },
}
