// 全平台看板假数据（纯前端，本单不接后端）。接真那单改成聚合 players/rounds/ledger/commissions/tenants。

export const KPIS = [
  { label: '商家总数', value: '6' },
  { label: '启用商家', value: '4' },
  { label: '总玩家数', value: '12,840' },
  { label: '平台费累计', value: '¥86,420.00' },
]

// 近 30 天平台费（假），单位元。整体走高、带波动。
export const FEE_TREND = [
  1820, 2010, 1760, 2240, 2380, 2050, 2620, 2410, 2780, 2560,
  2900, 3120, 2870, 3340, 3180, 3560, 3410, 3020, 3680, 3520,
  3890, 4120, 3760, 4240, 4380, 4050, 4620, 4410, 4780, 4990,
]

// 商家排行榜（Top 5，假）。turnover=流水，fee=平台费，单位元。
export const RANKING = [
  { name: 'GameHub', players: 4210, turnover: 1284300, fee: 38529 },
  { name: 'RedPlay', players: 3180, turnover: 902100, fee: 27063 },
  { name: 'LuckyBet', players: 2540, turnover: 738600, fee: 22158 },
  { name: 'AceArena', players: 1890, turnover: 512400, fee: 15372 },
  { name: 'NeoSpin', players: 1020, turnover: 286900, fee: 8607 },
]
