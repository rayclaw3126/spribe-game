// #S3 盘口键→中文档位名 单一出处（MiniRoulette + RollingBall）。
// 【单一出处铁律】：这些静态档位中文名从两游戏页「搬家」至此，游戏页市场结构回引本模块的
//   label（judge/odds/range/bg 等逻辑仍留页内），全站不得存在第二份同文案。
// 数字类键（roulette n1-12 / rollingball num-1..75）页面仍显数字，账单人话由 helper 生成「N号」。
// BillDrawer 只 import 本模块（禁 import src/games/*，保 code-split）。

// —— MiniRoulette：外围盘口（key 即 red/black/odd/even/low/high）——
export const ROULETTE_LABEL = {
  red: '红', black: '黑', odd: '单', even: '双', low: '1-6', high: '7-12',
}
// roulette 单号键 n<1..12> → 「N号」
export function rouletteLabelOf(key) {
  if (Object.prototype.hasOwnProperty.call(ROULETTE_LABEL, key)) return ROULETTE_LABEL[key]
  const m = /^n(\d{1,2})$/.exec(key)
  if (m) return `${Number(m[1])}号`
  return key
}

// —— RollingBall：大小/单双/红蓝 + 组合 + 行注 + 列注（key 即 slot）——
export const ROLLINGBALL_LABEL = {
  big: '大', small: '小', odd: '单', even: '双', red: '红', blue: '蓝',
  'big-odd': '大单', 'small-odd': '小单', 'big-even': '大双', 'small-even': '小双',
  'row-t1': '>1行', 'row-t3': '>3行', 'row-t5': '>5行',
  'col-1': '列1', 'col-2': '列2', 'col-3': '列3', 'col-4': '列4', 'col-5': '列5',
}
// rollingball 单号键 num-<1..75> → 「N号」
export function rollingballLabelOf(key) {
  if (Object.prototype.hasOwnProperty.call(ROLLINGBALL_LABEL, key)) return ROLLINGBALL_LABEL[key]
  if (key.startsWith('num-')) { const n = Number(key.slice(4)); if (Number.isInteger(n)) return `${n}号` }
  return key
}

// BillDrawer 合并入口：backendId(roulette/rollingball) + key → 中文名（未知回落原 key）
export function extraLabelOf(backendId, key) {
  if (backendId === 'roulette') return rouletteLabelOf(key)
  if (backendId === 'rollingball') return rollingballLabelOf(key)
  return null
}
