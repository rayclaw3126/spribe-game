// 跨商家风控假数据（纯前端，本单不接后端）。接真那单改成聚合下注/提现/多账号等风控信号。

export const RISK_MERCHANTS = ['GameHub', 'RedPlay', 'LuckyBet', 'StarWin', 'AceArena', 'NeoSpin']

// 风险等级筛选（segmented）。all 特殊：不过滤。
export const LEVEL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'high', label: '高' },
  { key: 'mid', label: '中' },
  { key: 'low', label: '低' },
]

// 概览（假）。
export const OVERVIEW = [
  { label: '待处理告警', value: '7' },
  { label: '高风险商家数', value: '2' },
  { label: '今日拦截', value: '34' },
]

// 风险类型 / 等级 / 状态配色语义（具体 hex 页面里从 COLORS 取）。
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

// 告警明细（假，13 条），时间倒序。
export const RISK_ROWS = [
  { id: 1, time: '07-11 15:02', merchant: 'GameHub', type: 'wash', level: 'high', status: 'pending' },
  { id: 2, time: '07-11 13:48', merchant: 'RedPlay', type: 'big_withdraw', level: 'high', status: 'pending' },
  { id: 3, time: '07-11 11:20', merchant: 'LuckyBet', type: 'abnormal_bet', level: 'mid', status: 'pending' },
  { id: 4, time: '07-11 09:33', merchant: 'NeoSpin', type: 'multi_account', level: 'mid', status: 'handled' },
  { id: 5, time: '07-10 22:41', merchant: 'GameHub', type: 'abnormal_bet', level: 'low', status: 'ignored' },
  { id: 6, time: '07-10 20:15', merchant: 'StarWin', type: 'wash', level: 'high', status: 'handled' },
  { id: 7, time: '07-10 17:52', merchant: 'AceArena', type: 'big_withdraw', level: 'mid', status: 'pending' },
  { id: 8, time: '07-10 14:09', merchant: 'RedPlay', type: 'multi_account', level: 'low', status: 'handled' },
  { id: 9, time: '07-10 10:27', merchant: 'LuckyBet', type: 'abnormal_bet', level: 'mid', status: 'ignored' },
  { id: 10, time: '07-09 23:18', merchant: 'GameHub', type: 'big_withdraw', level: 'high', status: 'handled' },
  { id: 11, time: '07-09 19:44', merchant: 'NeoSpin', type: 'wash', level: 'mid', status: 'pending' },
  { id: 12, time: '07-09 15:36', merchant: 'AceArena', type: 'multi_account', level: 'low', status: 'ignored' },
  { id: 13, time: '07-09 11:02', merchant: 'StarWin', type: 'abnormal_bet', level: 'low', status: 'handled' },
]
