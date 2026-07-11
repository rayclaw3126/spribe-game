// 商家 UI 配置。商家数据走后端 /tenants；本文件只留状态配色 meta（皮肤配置见 data/skins.js）。

// 状态配色取自现有 token 语义：启用=success 绿，停用=中性灰。具体 hex 在页面里从 COLORS 取。
export const MERCHANT_STATUS = {
  active: { label: '启用', tone: 'success' },
  disabled: { label: '停用', tone: 'muted' },
}
