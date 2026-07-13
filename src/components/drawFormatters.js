// 期号裁短：SG-YYYYMMDD-NNN → 末段 NNN（供顶栏/抽屉显示 #NNN，完整值留 title）。
// 三处（GameTopBar / HistoryDrawer / CommitRevealFairness）共用，禁各写各的 split。
// 无短横（数字 roundId / '连接中…' 占位 / null）时原样返回，不误伤。
export function shortRoundNo(roundNo) {
  if (roundNo == null || roundNo === '') return ''
  return String(roundNo).split('-').pop()
}

// 开奖历史·摘要 formatter —— key=backendId，输入 /round/history 的 drawResult，输出一行中文摘要串。
// 字段名严格以 rounds.result.drawResult 真实样本为准（禁猜）。缺字段/空对象兜底空串，防历史抽屉崩。
//
// 各款 drawResult 形状（样本实测）：
//   speedgrid  { n }
//   numberup   { num }
//   hattrick   { sum, dice:[a,b,c] }
//   goldenboot { ranking:[…10], champion, runnerUp, sprintSum }
//   halftime   { sum, balls:[…20], lowCount }
//   wuxing     { sum, balls:[…20], tiger, dragon }
//   lineup     { grid:[…25], total, rowSums:[…5] }
//   derbyday   { home20, away20, ftHome, ftAway, htHome, htAway, ftTotal, htTotal }
//   dominoduel { as, hs, tiles, gTotal, homeTiles, awayTiles }

const FORMATTERS = {
  speedgrid: (d) => (d?.n != null ? `${d.n}` : ''),
  numberup: (d) => (d?.num != null ? `${d.num}` : ''),
  hattrick: (d) => (Array.isArray(d?.dice) && d?.sum != null ? `${d.dice.join('+')}=${d.sum}` : ''),
  goldenboot: (d) => (d?.champion != null && d?.sprintSum != null ? `冠军${d.champion} 冠亚和${d.sprintSum}` : ''),
  halftime: (d) => (d?.sum != null && d?.lowCount != null ? `和值${d.sum}·小${d.lowCount}` : ''),
  wuxing: (d) => (d?.sum != null && d?.dragon != null && d?.tiger != null ? `和值${d.sum}·龙${d.dragon}虎${d.tiger}` : ''),
  lineup: (d) => (d?.total != null ? `总和${d.total}` : ''),
  derbyday: (d) =>
    d?.ftHome != null && d?.ftAway != null && d?.htHome != null && d?.htAway != null
      ? `主${d.ftHome}–${d.ftAway}客(半场${d.htHome}–${d.htAway})`
      : '',
  dominoduel: (d) => (d?.hs != null && d?.as != null ? `主${d.hs} 客${d.as}` : ''),
};

// 取某款 formatter；未知 key 或 drawResult 为空 → 返回空串（历史抽屉不显该行摘要）。
export function formatDraw(game, drawResult) {
  const fn = FORMATTERS[game];
  if (!fn || drawResult == null) return '';
  try {
    return fn(drawResult) || '';
  } catch {
    return '';
  }
}

// —— 展开卡·详情标签数组 formatDrawDetail(game, drawResult) → string[] ——
// 大小/单双/段位分界【严格照各引擎 MARKETS 真实边界，禁猜】：
//   speedgrid big n>=13 · numberup high num>=25 · hattrick big 11-17/small 4-10(豹子通杀)
//   goldenboot s-big sprintSum>=12 · halftime over sum>=811(og<=695/df/mf/at/gl>=924)
//   wuxing big sum>=811 龙dragon>tiger 上up>10 · lineup big total>=113(zone releg<=95..champ>=130)
//   derbyday ft-big ftTotal>=1621 ht-big htTotal>=811 主胜 ftHome>ftAway · dominoduel g-big gTotal>=9 主胜 hs>as
const num = (v) => (v == null ? null : Number(v))
const oe = (n) => (n % 2 === 1 ? '单' : '双')
const DETAIL = {
  speedgrid: (d) => {
    const n = num(d?.n); if (n == null) return []
    return [`号码 ${n}`, n >= 13 ? '大' : '小', oe(n)]
  },
  numberup: (d) => {
    const n = num(d?.num); if (n == null) return []
    return [`号码 ${String(n).padStart(2, '0')}`, n >= 25 ? '大' : '小', oe(n)]
  },
  hattrick: (d) => {
    const t = num(d?.sum); const dice = Array.isArray(d?.dice) ? d.dice : null
    if (t == null || !dice) return []
    const triple = dice[0] === dice[1] && dice[1] === dice[2]
    const out = [`骰 ${dice.join('+')}`, `和值 ${t}`]
    if (triple) out.push(`豹子 · 通杀`)
    else out.push(t >= 11 ? '大' : '小', oe(t))
    return out
  },
  goldenboot: (d) => {
    const c = num(d?.champion); const s = num(d?.sprintSum)
    if (c == null || s == null) return []
    return [`冠军 ${c}`, `冠亚和 ${s}`, s >= 12 ? '大' : '小', oe(s)]
  },
  halftime: (d) => {
    const s = num(d?.sum); const low = num(d?.lowCount)
    if (s == null) return []
    const band = s <= 695 ? 'og' : s <= 763 ? 'df' : s <= 855 ? 'mf' : s <= 923 ? 'at' : 'gl'
    const out = [`和值 ${s}`, s >= 811 ? '大' : '小', oe(s), `段位 ${band}`]
    if (low != null) out.push(low > 10 ? '上半多' : low === 10 ? '半场平' : '下半多')
    return out
  },
  wuxing: (d) => {
    const s = num(d?.sum); const dragon = num(d?.dragon); const tiger = num(d?.tiger)
    const balls = Array.isArray(d?.balls) ? d.balls : null
    if (s == null) return []
    const out = [`和值 ${s}`, s >= 811 ? '大' : '小', oe(s)]
    if (dragon != null && tiger != null) out.push(dragon > tiger ? '龙' : tiger > dragon ? '虎' : '龙虎和')
    if (balls) { const up = balls.filter((n) => n <= 40).length; out.push(up > 10 ? '上' : up < 10 ? '下' : '上下和') }
    return out
  },
  lineup: (d) => {
    const t = num(d?.total); if (t == null) return []
    const zone = t <= 95 ? '保级区' : t <= 112 ? '中游区' : t <= 129 ? '欧战区' : '争冠区'
    return [`总和 ${t}`, t >= 113 ? '大' : '小', oe(t), zone]
  },
  derbyday: (d) => {
    const fh = num(d?.ftHome); const fa = num(d?.ftAway); const hh = num(d?.htHome); const ha = num(d?.htAway); const ftT = num(d?.ftTotal)
    if (fh == null || fa == null) return []
    const out = [`全场 ${fh}–${fa}`]
    if (hh != null && ha != null) out.push(`半场 ${hh}–${ha}`)
    out.push(fh > fa ? '主胜' : fa > fh ? '客胜' : '平局')
    if (ftT != null) out.push(ftT >= 1621 ? '全场大' : '全场小')
    return out
  },
  dominoduel: (d) => {
    const hs = num(d?.hs); const as = num(d?.as); const g = num(d?.gTotal)
    if (hs == null || as == null) return []
    const out = [`主 ${hs} 客 ${as}`, hs > as ? '主胜' : as > hs ? '客胜' : '平局']
    if (g != null) out.push(g >= 9 ? '进球大' : '进球小', oe(g))
    return out
  },
}

// 展开卡详情标签数组；未知 game / 空 drawResult / 缺字段 → 空数组（卡片不显详情行）。
export function formatDrawDetail(game, drawResult) {
  const fn = DETAIL[game]
  if (!fn || drawResult == null) return []
  try {
    return fn(drawResult) || []
  } catch {
    return []
  }
}
