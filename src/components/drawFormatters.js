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
