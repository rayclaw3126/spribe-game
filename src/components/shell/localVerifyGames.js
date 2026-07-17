// 单V2：支持「本地重算」的 backendId 白名单（轻量常量）。
// 两抽屉据此 gate「本地重算」钮的显隐——【不 import 引擎/rng】，故不会把重算 chunk 拖进主包；
// 实际重算逻辑在懒加载的 LocalVerify.jsx（其才 import roundSpins + seededRng + 6 款即时引擎）。
// ⚠ 轻量约束：本文件必须保持【零引擎 import】——一旦 import 引擎，主包就会被拖进 HMAC/引擎代码。
//   故白名单是手写字符串而非从注册表派生，与 LocalVerify.jsx 的 ROUND_SPINS/INSTANT_VERIFY 两处
//   需保持同步（新增游戏时改两处）。
//
// ⚠ 预埋（单V3b 查明）：本白名单只被 HistoryDrawer / CommitRevealFairness 消费，而这两个只挂在
//   【轮次彩 9 款】页面上；per-player 9 款（即时6+多步3）的页面只挂 SeedFairness，走
//   「验整局 by roundId」路径，不经过本白名单。故下方 per-player 9 条目前【不生效】，
//   是为「per-player 历史局抽屉」（待办池，方案1）预留 —— 那个抽屉接入后本表即自动生效。
//   保留不删：删了将来接抽屉还得再加一遍；不再扩：新增 per-player 款走注册表即可。
export const LOCAL_VERIFY_GAMES = new Set([
  // 排期器 9 款（单V2，走 ROUND_SPINS 路径）
  'speedgrid', 'numberup', 'derbyday', 'dominoduel', 'hattrick',
  'goldenboot', 'halftime', 'wuxing', 'lineup',
  // 即时 6 款（单V3a，走 INSTANT_VERIFY 注册表路径）
  'dice', 'plinko', 'limbo', 'keno', 'streak', 'roulette',
  // 多步 3 款（单V3b，同注册表；goal 老局无 bombRows 会显「缺要素」）
  'mines', 'hilo', 'goal',
  // crash 2 款（单V3c）—— 【本表对它俩是真放行，不是预埋】：
  //   CommitRevealFairness 确实挂在 Aviator.jsx:924 / Momentum.jsx:411 上，且本单已给两页
  //   补传 game + drawResult（原先只传 open/onClose/venue/round，canRecalc 第一个条件就短路）。
  'aviator', 'momentum',
]);

// 单V3b/V3c：per-player 款 —— 账单行显本局编号 #roundId 小字，供 SeedFairness「验整局」取用。
// crash 2 款（aviator/momentum）【不列】：共享局 player_id 恒 NULL，GET /:id 归属校验一律 404，
//   它们只能走 CommitRevealFairness 的 done reveal 路径，拿 roundId 没用。
// 与 instantVerify.js 的 INSTANT_VERIFY 键集同步；此处手写字符串而非从注册表派生，
// 是为了守住本文件【零引擎 import】的轻量约束（BillDrawer 引它，一旦拖进引擎就是主包增重）。
// 轮次彩不列：它们的本地重算走抽屉内的 LocalVerify，不需要玩家手动拿 roundId。
export const PER_PLAYER_VERIFY_GAMES = new Set([
  'dice', 'plinko', 'limbo', 'keno', 'streak', 'roulette', 'mines', 'hilo', 'goal',
  'rollingball',   // 单V3c：per-player 多球，rounds.player_id 非空 → GET /:id 可用
]);
