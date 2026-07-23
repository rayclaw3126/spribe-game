// #公期化 单4 (b)：多桌【相位判据单一出处】。
//
// 病因：多桌全站原本硬判 `room.phase === 'betting'`（8 处：GameRail 3 / TableCard 2 / MultiTablePage 3）。
//   滚球是六段房（bet1/draw1/bet2/draw2/bet3/draw3/settle），这些判据对它【恒为假】——
//   卡内永远投不了、相位点永远不亮、倒计时永远显 '—'、状态胶囊永远落 default「连接中」。
//   本文件把判据收成一份，两种房型各走各的分支，调用方只认 isBetting/phaseLabelOf/countdownOf。
import { isBetsLocked } from '../../games/markets-ui/rollingBallPhase'

// 是否六段房（滚球）：靠相位名识别，不靠 game id —— 将来再有六段房自动适配。
export const SEG_BET = /^bet[123]$/
export const SEG_DRAW = /^draw[123]$/
export const isSegRoom = (room) => {
  const p = room?.phase
  return !!p && (SEG_BET.test(p) || SEG_DRAW.test(p) || p === 'settle')
}

/**
 * 可否收注【唯一判据】。
 *   · 三跳链房（16 桌）：phase === 'betting'（与改动前逐字节同义）
 *   · 六段房（滚球）：处在 bet 段 且 未进 lockedMs 封盘缓冲（复用 rollingBallPhase.isBetsLocked）
 * 服务端 400/409 仍是最终闸，本判据只做前置拦截。
 */
export function isBetting(room) {
  if (!room) return false
  if (SEG_BET.test(room.phase || '')) return !isBetsLocked(room)
  return room.phase === 'betting'
}

// 相位是否「有倒计时可显」：三跳链的 betting/idle + 六段房的每一段（含 settle 展示窗）
export function isTimedPhase(room) {
  const p = room?.phase
  if (!p) return false
  if (isSegRoom(room)) return true
  return p === 'betting' || p === 'idle'
}

// 相位归一成 4 种语义色/文案档，供卡头胶囊与左栏相位点共用（各自映射到自己的色板）。
//   'betting' 可投 | 'locked' 封盘 | 'drawing' 开奖中 | 'settled' 已结算 | 'idle' 等待 | 'connecting'
export function phaseKindOf(room) {
  const p = room?.phase
  if (!p || p === 'connecting') return 'connecting'
  if (SEG_BET.test(p)) return isBetsLocked(room) ? 'locked' : 'betting'
  if (SEG_DRAW.test(p)) return 'drawing'
  if (p === 'settle') return 'settled'
  if (p === 'betting') return 'betting'
  if (p === 'locked') return 'locked'
  if (p === 'drawn') return 'drawing'
  if (p === 'settled') return 'settled'
  if (p === 'idle') return 'idle'
  return 'connecting'
}
