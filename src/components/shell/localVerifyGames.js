// 单V2：支持「本地重算」的排期器 backendId 白名单（轻量常量）。
// 两抽屉据此 gate「本地重算」钮的显隐——【不 import 引擎/rng】，故不会把重算 chunk 拖进主包；
// 实际重算逻辑在懒加载的 LocalVerify.jsx（其才 import roundSpins + seededRng）。
export const LOCAL_VERIFY_GAMES = new Set([
  'speedgrid', 'numberup', 'derbyday', 'dominoduel', 'hattrick',
  'goldenboot', 'halftime', 'wuxing', 'lineup',
]);
