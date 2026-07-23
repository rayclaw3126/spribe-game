// #公期化 单2：滚球六段相位的【纯判定】单一出处（零 JSX、零 React —— 与 RollingBallPhaseBar.jsx
// 分家是为守 react-refresh「一个 .jsx 只导出组件」的既有约束，照 wuxingShared.js 先例）。
//
// 三个判定禁在调用方重写：窗号派生 / 复合 key 前缀 / 四态。原页、共用件、单3 多桌全引这一份。

// —— 窗号派生【单一出处】：已开球数 == 下一颗待开球的 ballIdx ——
// 与后端 /round/rollingball/bet 的相位闸同源判据（server/src/routes/round.js:
// `const ballIdx = rs.revealed.length`），也正是 oddsFor 第二参要的那个 ballIdx。
// 禁用 segIdx/2 之类反推——那等于在调用方手抄服务端段表布局。
export function ballWindowOf(revealed) {
  return Array.isArray(revealed) ? revealed.length : 0
}

// —— 复合 key（球序命名空间）【单一出处】：本窗盘口 key = b{ballIdx+1}:{裸key} ——
export const ballKeyOf = (ballIdx, marketKey) => `b${ballIdx + 1}:${marketKey}`
export const bareKeyOf = (k) => (/^b[123]:/.test(k) ? k.slice(3) : k)
export const ballIdxOfKey = (k) => (/^b[123]:/.test(k) ? Number(k[1]) - 1 : -1)

// —— 四态判定【单一出处】——
//   betting  该球加注窗开着        locked   窗关后的 lockedMs 锁帧缓冲
//   drawing  draw_N 段，球正在滚    done     已开出
//   wait     还没轮到（置灰不可投）
export function phaseStateOf(i, { phase, revealed, betsLocked }) {
  const rev = Array.isArray(revealed) ? revealed : []
  // ⚠ drawing 必须判在 done 之前：服务端 draw_N 帧【同时】把该球放进 revealed（闸1 逐球揭示），
  //   若先判 `i < rev.length` 就恒为 done，「开球中…」永远不可达（实测发现）。语义上这 5s 舞台
  //   还在滚号、球未定格，玩家看到的就该是「开球中…」。
  if (phase === `draw${i + 1}`) return 'drawing'
  if (i < rev.length) return 'done'
  if (phase === 'settle') return 'done'              // settle 段三颗必然全开
  if (phase === `bet${i + 1}`) return betsLocked ? 'locked' : 'betting'
  return 'wait'
}
