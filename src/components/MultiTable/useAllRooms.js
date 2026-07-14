import { useRoundRoom } from '../../hooks/useRoundRoom'

// #41 单3：多桌一次性起 9 条 /ws/rounds（每款一条，定案不改后端）。
// 9 个固定 useRoundRoom 调用（顺序/数量恒定，合规 rules-of-hooks），返回按 game id 键的 room 表。
// WS 常驻——滚出视口只停「渲染」（TableCard 内 IO gate），不断连接。
export function useAllRooms(token) {
  const GoldenBoot = useRoundRoom(token, 'goldenboot')
  const SpeedGrid  = useRoundRoom(token, 'speedgrid')
  const HalfTime   = useRoundRoom(token, 'halftime')
  const NumberUp   = useRoundRoom(token, 'numberup')
  const HatTrick   = useRoundRoom(token, 'hattrick')
  const WuXing     = useRoundRoom(token, 'wuxing')
  const LineUp     = useRoundRoom(token, 'lineup')
  const DerbyDay   = useRoundRoom(token, 'derbyday')
  const DominoDuel = useRoundRoom(token, 'dominoduel')
  return { GoldenBoot, SpeedGrid, HalfTime, NumberUp, HatTrick, WuXing, LineUp, DerbyDay, DominoDuel }
}
