// 平台费流水假数据（纯前端，本单不接后端）。接真那单改成聚合 commissions/ledger 按商家+时间。

export const FEE_MERCHANTS = ['GameHub', 'RedPlay', 'LuckyBet', 'StarWin', 'AceArena', 'NeoSpin']

// 时间范围（本单纯 UI，不真的过滤时间）。
export const RANGE_OPTIONS = [
  { key: 'month', label: '本月' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
]

// 汇总（本月，假）。
export const SUMMARY = { feeTotal: 42860, count: 128 }

// 类型 / 状态配色语义（具体 hex 页面里从 COLORS 取）。
export const TYPE_META = {
  commission: { label: '分成', tone: 'primary' },
  settle: { label: '结算', tone: 'muted' },
}
export const FEE_STATUS = {
  posted: { label: '已入账', tone: 'success' },
  pending: { label: '待结算', tone: 'warning' },
}

// 流水明细（假，13 条），时间倒序。
export const FEE_ROWS = [
  { id: 1, time: '07-11 14:32', merchant: 'GameHub', type: 'commission', turnover: 128400, fee: 3852, status: 'posted' },
  { id: 2, time: '07-11 11:07', merchant: 'RedPlay', type: 'commission', turnover: 90210, fee: 2706, status: 'posted' },
  { id: 3, time: '07-11 09:41', merchant: 'LuckyBet', type: 'settle', turnover: 73860, fee: 2216, status: 'pending' },
  { id: 4, time: '07-10 22:18', merchant: 'GameHub', type: 'commission', turnover: 61500, fee: 1845, status: 'posted' },
  { id: 5, time: '07-10 19:53', merchant: 'AceArena', type: 'commission', turnover: 51240, fee: 1537, status: 'posted' },
  { id: 6, time: '07-10 16:24', merchant: 'NeoSpin', type: 'settle', turnover: 28690, fee: 861, status: 'pending' },
  { id: 7, time: '07-10 13:02', merchant: 'RedPlay', type: 'commission', turnover: 44300, fee: 1329, status: 'posted' },
  { id: 8, time: '07-09 21:47', merchant: 'GameHub', type: 'commission', turnover: 82100, fee: 2463, status: 'posted' },
  { id: 9, time: '07-09 18:15', merchant: 'LuckyBet', type: 'commission', turnover: 39600, fee: 1188, status: 'posted' },
  { id: 10, time: '07-09 12:30', merchant: 'StarWin', type: 'settle', turnover: 21400, fee: 642, status: 'pending' },
  { id: 11, time: '07-08 20:09', merchant: 'AceArena', type: 'commission', turnover: 47800, fee: 1434, status: 'posted' },
  { id: 12, time: '07-08 15:52', merchant: 'RedPlay', type: 'commission', turnover: 55600, fee: 1668, status: 'posted' },
  { id: 13, time: '07-08 10:26', merchant: 'GameHub', type: 'settle', turnover: 96300, fee: 2889, status: 'pending' },
]
