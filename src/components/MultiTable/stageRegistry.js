// #41 单6：多桌真舞台注册表 —— game id → 抽件 Stage 组件（同签名 {phase,roundNo,drawResult,width,height,muted}）。
// 未列款走 TableCard 文字舞台。逐款上桌即在此登记。
import SpeedGridStage from '../../games/stages/SpeedGridStage'
import NumberUpStage from '../../games/stages/NumberUpStage'
import HatTrickStage from '../../games/stages/HatTrickStage'
import HalfTimeStage from '../../games/stages/HalfTimeStage'
import GoldenBootStage from '../../games/stages/GoldenBootStage'

export const STAGE_BY_ID = {
  SpeedGrid: SpeedGridStage,
  NumberUp: NumberUpStage,
  HatTrick: HatTrickStage,
  HalfTime: HalfTimeStage,
  GoldenBoot: GoldenBootStage,
}
