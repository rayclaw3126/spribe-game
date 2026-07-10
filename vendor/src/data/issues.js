// 系统问题假数据 —— 全前端，不请求后端。列表 filter / 提交插入都在内存里做。
// 状态 status: new(新问题) / doing(处理中) / resolved(已解决) / ignored(已忽略)
// 优先级 priority: high(高) / mid(中) / low(低)

export const STATUS_META = {
  new: { label: '新问题', color: '#7f77dd', bg: 'rgba(127,119,221,0.16)' },
  doing: { label: '处理中', color: '#F5A623', bg: 'rgba(245,166,35,0.18)' },
  resolved: { label: '已解决', color: '#16C784', bg: 'rgba(22,199,132,0.16)' },
  ignored: { label: '已忽略', color: '#8a97a6', bg: '#1a2230' },
}

export const PRIORITY_META = {
  high: { label: '高', color: '#e2564a' },
  mid: { label: '中', color: '#F5A623' },
  low: { label: '低', color: '#8a97a6' },
}

// tab 顺序 + 计数依据。all 特殊：不过滤。
export const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '新问题' },
  { key: 'doing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'ignored', label: '已忽略' },
]

export const MERCHANTS = ['GameHub', 'RedPlay', 'LuckyBet', 'StarWin']

// 归属商家下拉选项（含"平台级"= 留空）
export const MERCHANT_OPTIONS = ['', ...MERCHANTS]

export const ISSUES = [
  {
    id: '0001',
    status: 'new',
    priority: 'mid',
    title: '测试',
    desc: '测试员冒烟：提交一条问题走通留档链路，验证列表置顶与搜索命中。',
    reporter: 'raymond3126@gmail.com',
    time: '07-10 15:33',
    source: { merchant: 'GameHub', game: '大厅', player: '—' },
  },
  {
    id: '0002',
    status: 'doing',
    priority: 'high',
    title: 'UG 体育启动偶发 token 过期，需重登',
    desc: '玩家从大厅进 UG 体育时约 5% 概率白屏，抓包显示 launch token 已过期；当前需退回大厅重新点开才能进。怀疑 token 预取与实际跳转间隔过长。',
    reporter: 'tester02',
    time: '07-09 18:44',
    source: { merchant: 'RedPlay', game: 'UG 体育', player: 'player_88231' },
  },
  {
    id: '0003',
    status: 'resolved',
    priority: 'mid',
    title: '玩家注册合成邮箱被远端 Auth 拒',
    desc: '注册时用 手机号@内部域 合成邮箱，远端 Auth 校验 MX 记录直接 400。已改为合成到已托管域名，回归通过。',
    reporter: 'tester01',
    time: '07-08 16:05',
    source: { merchant: 'LuckyBet', game: '注册流程', player: 'player_10007' },
  },
  {
    id: '0004',
    status: 'ignored',
    priority: 'low',
    title: '建议：大厅加深色/浅色切换',
    desc: '测试员主观建议大厅提供浅色主题。当前定位深色专业风，暂不排期，先留档。',
    reporter: 'tester03',
    time: '07-07 11:20',
    source: { merchant: '', game: '大厅', player: '—' },
  },
  {
    id: '0005',
    status: 'new',
    priority: 'mid',
    title: '换肤配置台预览图偶发不刷新',
    desc: '切换商家皮肤色板后，右侧预览缩略图有时仍显示上一套配色，强制刷新页面才更新。疑似预览组件未订阅色板变更。',
    reporter: 'tester02',
    time: '07-06 10:12',
    source: { merchant: 'StarWin', game: '换肤配置台', player: '—' },
  },
  {
    id: '0006',
    status: 'doing',
    priority: 'high',
    title: '平台费流水导出 CSV 金额串列',
    desc: '导出平台费流水时，含千分位逗号的金额未加引号，导致 CSV 串列错位。需在导出层对金额字段统一转义。',
    reporter: 'tester01',
    time: '07-05 14:27',
    source: { merchant: 'GameHub', game: '财务/平台费', player: '—' },
  },
]
