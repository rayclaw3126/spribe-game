// 单V2：支持「本地重算」的 backendId 白名单（轻量常量）。
// 两抽屉据此 gate「本地重算」钮的显隐——【不 import 引擎/rng】，故不会把重算 chunk 拖进主包；
// 实际重算逻辑在懒加载的 LocalVerify.jsx（其才 import roundSpins + seededRng + 6 款即时引擎）。
// ⚠ 轻量约束：本文件必须保持【零引擎 import】——一旦 import 引擎，主包就会被拖进 HMAC/引擎代码。
//   故白名单是手写字符串而非从注册表派生，与 LocalVerify.jsx 的 ROUND_SPINS/INSTANT_VERIFY 两处
//   需保持同步（新增游戏时改两处）。
export const LOCAL_VERIFY_GAMES = new Set([
  // 排期器 9 款（单V2，走 ROUND_SPINS 路径）
  'speedgrid', 'numberup', 'derbyday', 'dominoduel', 'hattrick',
  'goldenboot', 'halftime', 'wuxing', 'lineup',
  // 即时 6 款（单V3a，走 INSTANT_VERIFY 注册表路径）
  'dice', 'plinko', 'limbo', 'keno', 'streak', 'roulette',
]);
