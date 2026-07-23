import { useRoundRoom } from '../../hooks/useRoundRoom'

// #41 单3：多桌一次性起 9 条 /ws/rounds（每款一条，定案不改后端）。
// #42 单9：再加 7 条 15s 快房 → 16 条；#公期化 单3 再加滚球标准房 → 共 17 条，返回表按【复合桌键】（见 mockData 的 gameIdOf/roomOf）。
// 固定条数的 useRoundRoom 调用（顺序/数量恒定，合规 rules-of-hooks），返回按桌键的 room 表。
// WS 常驻——滚出视口只停「渲染」（TableCard 内 IO gate），不断连接。
//
// ⚠ 标准房 9 条【不传第三参】，与 #42 单9 前逐字节相同：虽然 b508655 的 roomNameOf 兜底让
//   ?room=30s 与不传都能解析到标准房，但「不传」是 prod 正在跑的路径，零行为变化；主动改成
//   传 '30s' 等于把 9 条已验证的连接换到另一条代码路径上，收益为零、风险非零。
// ⚠ 快房 7 条传 '15s'，命中 roomNameOf 的 rooms.has(`${game}:15s`) 第一条分支，不依赖兜底。
// ⚠ derbyday / dominoduel 无快房：产品裁定（两阶段/翻牌节奏与 15s 冲突），见后端 ROOM_CONFIGS 注释。
export function useAllRooms(token) {
  // —— 标准房 9 条（键 = 裸 registry id）——
  const GoldenBoot = useRoundRoom(token, 'goldenboot')
  const SpeedGrid  = useRoundRoom(token, 'speedgrid')
  const HalfTime   = useRoundRoom(token, 'halftime')
  const NumberUp   = useRoundRoom(token, 'numberup')
  const HatTrick   = useRoundRoom(token, 'hattrick')
  const WuXing     = useRoundRoom(token, 'wuxing')
  const LineUp     = useRoundRoom(token, 'lineup')
  const DerbyDay   = useRoundRoom(token, 'derbyday')
  const DominoDuel = useRoundRoom(token, 'dominoduel')
  // #公期化 单3：滚球标准房（六段房）。useRoundRoom 单2 已做纯加法改造，seg 字段随帧透传；
  //   本款无快房（registry rooms:[]），故只此一条。16 → 17 条常驻 WS。
  const RollingBall = useRoundRoom(token, 'rollingball')
  // —— 快房 7 条（键 = `${id}@15s`）——
  const GoldenBoot15 = useRoundRoom(token, 'goldenboot', '15s')
  const SpeedGrid15  = useRoundRoom(token, 'speedgrid', '15s')
  const HalfTime15   = useRoundRoom(token, 'halftime', '15s')
  const NumberUp15   = useRoundRoom(token, 'numberup', '15s')
  const HatTrick15   = useRoundRoom(token, 'hattrick', '15s')
  const WuXing15     = useRoundRoom(token, 'wuxing', '15s')
  const LineUp15     = useRoundRoom(token, 'lineup', '15s')
  return {
    GoldenBoot, SpeedGrid, HalfTime, NumberUp, HatTrick, WuXing, LineUp, DerbyDay, DominoDuel, RollingBall,
    'GoldenBoot@15s': GoldenBoot15,
    'SpeedGrid@15s': SpeedGrid15,
    'HalfTime@15s': HalfTime15,
    'NumberUp@15s': NumberUp15,
    'HatTrick@15s': HatTrick15,
    'WuXing@15s': WuXing15,
    'LineUp@15s': LineUp15,
  }
}
