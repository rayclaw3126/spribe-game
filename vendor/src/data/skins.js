// 换肤配置台假数据（纯前端，本单不接后端）。皮肤名复用 merchants 的 SKIN_OPTIONS。
// 主色预览块尽量用现有 token：深蓝→primary、足球绿→success、午夜黑金→warning。
// 电竞紫：vendor token 无紫，用仓库已有的紫（游戏头像同源 #7c3aed）作为该皮肤品牌色（属假数据，非新增设计 token）。
import { COLORS } from '../theme/tokens.js'
import { SKIN_OPTIONS } from './merchants.js'

export const SKIN_COLORS = {
  深蓝专业: COLORS.primary,
  电竞紫: '#7c3aed',
  足球绿: COLORS.success,
  午夜黑金: COLORS.warning,
}

export { SKIN_OPTIONS }
