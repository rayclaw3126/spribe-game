// 商家管理假数据（纯前端，本单不接后端、不建表）。
// 后端 tenant/merchant 表 + /tenants 接口尚未有，接线等后续单；本文件只供 UI 壳预览。

// 状态配色取自现有 token 语义：启用=success 绿，停用=中性灰。具体 hex 在页面里从 COLORS 取。
export const MERCHANT_STATUS = {
  active: { label: '启用', tone: 'success' },
  disabled: { label: '停用', tone: 'muted' },
}

// 皮肤下拉选项（假数据，与列表里出现的皮肤名同源）。
export const SKIN_OPTIONS = ['深蓝专业', '电竞紫', '足球绿', '午夜黑金']

export const MERCHANTS_FAKE = [
  { id: 1, name: 'GameHub', domain: 'gamehub.dad', skin: '深蓝专业', status: 'active', createdAt: '2025-11-02' },
  { id: 2, name: 'RedPlay', domain: 'redplay.gg', skin: '电竞紫', status: 'active', createdAt: '2026-01-15' },
  { id: 3, name: 'LuckyBet', domain: 'luckybet.io', skin: '足球绿', status: 'active', createdAt: '2026-03-08' },
  { id: 4, name: 'StarWin', domain: 'starwin.bet', skin: '午夜黑金', status: 'disabled', createdAt: '2026-04-21' },
  { id: 5, name: 'AceArena', domain: 'acearena.club', skin: '深蓝专业', status: 'active', createdAt: '2026-05-30' },
  { id: 6, name: 'NeoSpin', domain: 'neospin.vip', skin: '电竞紫', status: 'disabled', createdAt: '2026-06-12' },
]
