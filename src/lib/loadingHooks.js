// #22 加载页广告位文案表（单一出处）。key = backendId。
// ⚠ 铁律：所有数字一律引擎/风控【真源】，禁编造；卖点通例 = 标「玩家实际可得」的数
//   —— 触 cap 标 cap、无上限标 cap、不触 cap 才标倍数（Ray #22 定例）。

// 场景1（熟客推新）钩子句：每款一句，基于 gameRegistry.desc 强化。
export const LOADING_HOOKS = {
  aviator: '抢在被扑倒前兑现，晚一秒全归零',
  dice: '一注押中全场进球数',
  plinko: '弧线绕过人墙，直挂死角',
  goal: '一脚定江山，射穿门将',
  hilo: '连猜连翻，见好就收',                 // Ray 改：翻倍与浮动赔率不符 → 连猜连翻
  mines: '步步过人，见好就收',
  keno: '圈住冷门球队，赔率翻番',
  limbo: '目标赔率越狂，兑现越爽',
  streak: '转盘停在倍数上，就是你的',
  roulette: '一转定胜负，12 格见真章',        // Ray 改：格数按引擎真数（miniRoulette 12 格）
  momentum: '乘势而上，巅峰一键兑现',
  halftime: '押基诺总和，大小区间任选',
  goldenboot: '十车冲线，押中名次',
  numberup: '押中球衣号，00 到 49',
  hattrick: '三骰同开，押总点数',
  derbyday: '主客死磕，押你的一方',
  lineup: '五行 25 号，押各行之和',
  speedgrid: '24 车争先，15 秒一局',
  wuxing: '二十球归五行，一网打尽',
  rollingball: '三球滚动，逐球押注',
  dominoduel: '主客对决，骨牌定胜负',
};

// 场景2（新客固期待）卖点·金色高亮。仅列【玩家实际可得】的硬数字款；
//   其余款由 LoadingAd 回落：有 15s 速度房 → '15 秒一局'（rooms label 真源）；再无 → g.desc。
export const LOADING_SELL = {
  plinko: '最高 425×',            // 引擎 multsFor(red/16行) 实测极值，bet≤117 不触 cap → 真倍数可标
  aviator: '单局封顶可赢 $50,000',  // crash 无 BUST 上限（0.99/(1-r)→∞），风控 maxPayout 即玩家天花板
  momentum: '单局封顶可赢 $50,000', // 同 crash 双雄
  mines: '单局封顶可赢 $50,000',    // 理论 360 万×触 cap，永久禁标；标玩家真可得的 cap
};

// 底条平台事件（静态真事实轮播；派彩战报涉真数暂不做——禁假数据）。
export const LOADING_EVENTS = [
  '极速房已开 7 款 · 15 秒一局',
  '21 款全服务器化结算',
  '每局可验证公平 · 账单一键重算',
];
