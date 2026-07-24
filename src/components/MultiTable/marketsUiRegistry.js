// #41 单15：多桌「原版盘口件」总表——按 game id 映射 {Markets, Road, Podium?, rules + 引擎派生 fn}。
// 判定一律走各自 markets 引擎（禁二份表）。TableCard 据此渲染整卡；新增游戏只在此加一项，卡渲染零改。
// 派生 fn 契约（入参 = 一局 drawResult，可能缺字段 → 需自守空返 undefined/null）：
//   hitsOf(dr)      → Set<键> | undefined   开奖相位命中键（中奖高亮源，与原页同判定源）
//   roadItem(dr)    → 珠盘 history 单元 | null   （沿用 /round/history 播种+result 追加管道）
//   信息条(仅有 Podium 的款)：门控值 + 组件 props 映射器（各款 Podium 形态不同，故用适配器）：
//   podiumValue(dr) → 门控值 | null   （宣布时机门控用；null=无效局）
//   podiumProps(value, {animated, animKey, roadHistory}) → 传给 Podium 的 props 对象
import GoldenBootMarkets from '../../games/markets-ui/GoldenBootMarkets'
import GoldenBootRoad from '../../games/markets-ui/GoldenBootRoad'
import GoldenBootPodium from '../../games/markets-ui/GoldenBootPodium'
import { RULES as GOLDENBOOT_RULES } from '../../games/markets-ui/goldenbootRules'
import { deriveRace } from '../../games/markets/goldenboot'
import SpeedGridMarkets from '../../games/markets-ui/SpeedGridMarkets'
import SpeedGridRoad from '../../games/markets-ui/SpeedGridRoad'
import { RULES as SPEEDGRID_RULES } from '../../games/markets-ui/speedgridRules'
import { hitsOf as hitsOfSpeedGrid } from '../../games/markets/speedgrid'
import NumberUpMarkets from '../../games/markets-ui/NumberUpMarkets'
import NumberUpRoad from '../../games/markets-ui/NumberUpRoad'
import NumberUpPodium from '../../games/markets-ui/NumberUpPodium'
import { RULES as NUMBERUP_RULES } from '../../games/markets-ui/numberupRules'
import { hitsOf as hitsOfNumberUp, deriveNum } from '../../games/markets/numberup'
import HatTrickMarkets from '../../games/markets-ui/HatTrickMarkets'
import HatTrickRoad from '../../games/markets-ui/HatTrickRoad'
import HatTrickPodium from '../../games/markets-ui/HatTrickPodium'
import { RULES as HATTRICK_RULES } from '../../games/markets-ui/hattrickRules'
import { hitsOf as hitsOfHatTrick, deriveRoll } from '../../games/markets/hattrick'
import HalfTimeMarkets from '../../games/markets-ui/HalfTimeMarkets'
import HalfTimeRoad from '../../games/markets-ui/HalfTimeRoad'
import HalfTimePodium from '../../games/markets-ui/HalfTimePodium'
import { RULES as HALFTIME_RULES } from '../../games/markets-ui/halftimeRules'
import { hitsOf as hitsOfHalfTime, deriveRound, halfOf } from '../../games/markets/halftime'
import WuXingMarkets from '../../games/markets-ui/WuXingMarkets'
import WuXingRoad from '../../games/markets-ui/WuXingRoad'
import { RULES as WUXING_RULES } from '../../games/markets-ui/wuxingRules'
import { hitsOf as hitsOfWuXing, deriveRound as deriveRoundWuXing } from '../../games/markets/wuxing'
import LineUpMarkets from '../../games/markets-ui/LineUpMarkets'
import LineUpRoad from '../../games/markets-ui/LineUpRoad'
import { RULES as LINEUP_RULES } from '../../games/markets-ui/lineupRules'
import { hitsOf as hitsOfLineUp, deriveRound as deriveRoundLineUp } from '../../games/markets/lineup'
import DominoDuelMarkets from '../../games/markets-ui/DominoDuelMarkets'
import DominoDuelRoad from '../../games/markets-ui/DominoDuelRoad'
import { RULES as DOMINODUEL_RULES } from '../../games/markets-ui/dominoduelRules'
import { hitsOf as hitsOfDomino, deriveRound as deriveRoundDomino } from '../../games/markets/dominoduel'
import DerbyDayMarkets from '../../games/markets-ui/DerbyDayMarkets'
import DerbyDayRoad from '../../games/markets-ui/DerbyDayRoad'
import { RULES as DERBYDAY_RULES } from '../../games/markets-ui/derbydayRules'
import { hitsOf as hitsOfDerby, deriveMatch as deriveMatchDerby } from '../../games/markets/derbyday'
// #公期化 单3：滚球【只读卡】—— Markets 位放的是只读卡体（不接钱路），Road 位放迷你路珠。
import RollingBallCardPanel from '../../games/markets-ui/RollingBallCardPanel'
import RollingBallRoad from '../../games/markets-ui/RollingBallRoad'

export const MARKETS_UI = {
  GoldenBoot: {
    Markets: GoldenBootMarkets,
    Road: GoldenBootRoad,
    Podium: GoldenBootPodium,     // 有上局前三名信息条
    rules: GOLDENBOOT_RULES,
    roadTab0: 'WINNER',
    roadCols: 12,
    hitsOf: (dr) => (dr?.ranking ? deriveRace(dr.ranking).hits : undefined),
    roadItem: (dr) => { if (!dr?.ranking) return null; const r = deriveRace(dr.ranking); return { winner: r.winner, sum: r.sprintSum } },
    podiumValue: (dr) => (dr?.ranking ? deriveRace(dr.ranking).order : null),
    podiumProps: (order, { animated, animKey }) => ({ order, inline: true, animate: animated, animKey }),
  },
  SpeedGrid: {
    Markets: SpeedGridMarkets,
    Road: SpeedGridRoad,
    Podium: null,               // 原页无独立信息条（drawZone 在页内，不造）
    rules: SPEEDGRID_RULES,
    roadTab0: 'BS',
    roadCols: 12,
    // drawResult.n = 上局冠军车号(1-24)；命中键走引擎 hitsOf(禁二份表)
    hitsOf: (dr) => (dr && typeof dr.n === 'number' ? hitsOfSpeedGrid(dr.n) : undefined),
    roadItem: (dr) => (dr && typeof dr.n === 'number' ? dr.n : null),   // 珠盘存整值 champ
    // 无 Podium → 不需 podiumValue/podiumProps
  },
  NumberUp: {
    Markets: NumberUpMarkets,
    Road: NumberUpRoad,
    Podium: NumberUpPodium,      // 上局号码信息条（球衣卡 + 金牌）
    rules: NUMBERUP_RULES,
    roadTab0: 'NUMBER',
    roadCols: 12,
    // drawResult.num = 上局开出号码(0-49)；命中键 = hitsOf(deriveNum(num))（走引擎，禁二份表）
    hitsOf: (dr) => (dr && typeof dr.num === 'number' ? hitsOfNumberUp(deriveNum(dr.num)) : undefined),
    roadItem: (dr) => (dr && typeof dr.num === 'number' ? dr.num : null),   // 珠盘存整值号码
    podiumValue: (dr) => (dr && typeof dr.num === 'number' ? dr.num : null),
    // 卡头行内只显门控的号码卡+金牌（近期串留给底部路子墙，避免头行拥挤+门控不一致）
    podiumProps: (num) => ({ last: num, recent: [], inline: true }),
  },
  HatTrick: {
    Markets: HatTrickMarkets,   // richFx 缺省 false → 多桌吃 .htWin 金边脉冲；settleFx 类 props 缺省惰性
    Road: HatTrickRoad,
    Podium: HatTrickPodium,     // 上局骰子信息条（3 骰面 + 总点/豹子）
    rules: HATTRICK_RULES,
    roadTab0: 'TOTAL',
    roadCols: 12,
    // drawResult.dice = 上局三骰面[1-6]×3；命中键 = hitsOf(deriveRoll(dice))（走引擎）
    hitsOf: (dr) => (Array.isArray(dr?.dice) && dr.dice.length === 3 ? hitsOfHatTrick(deriveRoll(dr.dice)) : undefined),
    roadItem: (dr) => (Array.isArray(dr?.dice) && dr.dice.length === 3 ? dr.dice : null),   // 珠盘存整局骰组
    // Podium 需 deriveRoll 派生对象（.dice/.isTriple/.tripleFace/.total），非裸骰组
    podiumValue: (dr) => (Array.isArray(dr?.dice) && dr.dice.length === 3 ? deriveRoll(dr.dice) : null),
    podiumProps: (roll) => ({ lastRoll: roll, recent: [], inline: true }),
  },
  HalfTime: {
    Markets: HalfTimeMarkets,   // 多桌 isMobile=true & 无 section → titled groupBox + ▾/▸ + chipMode
    Road: HalfTimeRoad,
    Podium: HalfTimePodium,     // 上局信息条（inline 只显和值 pill，20 球留舞台/路子墙）
    rules: HALFTIME_RULES,
    roadTab0: 'O/U',
    roadCols: 12,
    // drawResult.balls = 上局 20 球；sum/lowCount 由 deriveRound 派生；命中键走引擎 hitsOf
    hitsOf: (dr) => (Array.isArray(dr?.balls) ? hitsOfHalfTime(deriveRound(dr.balls)) : undefined),
    roadItem: (dr) => { if (!Array.isArray(dr?.balls)) return null; const r = deriveRound(dr.balls); return { sum: r.sum, half: halfOf(r) } },
    podiumValue: (dr) => (Array.isArray(dr?.balls) ? { balls: dr.balls, sum: deriveRound(dr.balls).sum } : null),
    podiumProps: (v) => ({ lastDraw: v, inline: true }),
  },
  WuXing: {
    Markets: WuXingMarkets,     // 含 isDesk（多桌传 false，窄卡单列）
    Road: WuXingRoad,
    Podium: null,               // 无独立信息条（上局在舞台内）
    rules: WUXING_RULES,
    roadTab0: 'bs',
    roadCols: 12,
    // drawResult.balls = 上局 20 球；命中键 = hitsOf(deriveRound(balls))；珠盘存整值总和 sum
    hitsOf: (dr) => (Array.isArray(dr?.balls) ? hitsOfWuXing(deriveRoundWuXing(dr.balls)) : undefined),
    roadItem: (dr) => { if (!Array.isArray(dr?.balls)) return null; const d = deriveRoundWuXing(dr.balls); return { sum: d.sum, up: d.up } },   // #Ray 6 路：{sum,up}（上下路 sum 推不出）
  },
  LineUp: {
    Markets: LineUpMarkets,     // 无折叠组（内建 A/B 视图 + dim）；openMode/isDesk 传了被忽略
    Road: LineUpRoad,
    Podium: null,               // 无独立信息条（上局在舞台内）
    rules: LINEUP_RULES,
    roadTab0: 'bs',
    roadCols: 12,
    // drawResult.grid = 上局 25 格数字；命中键 = hitsOf(deriveRound(grid))；珠盘存整局 total
    hitsOf: (dr) => (Array.isArray(dr?.grid) && dr.grid.length === 25 ? hitsOfLineUp(deriveRoundLineUp(dr.grid)) : undefined),
    roadItem: (dr) => (Array.isArray(dr?.grid) && dr.grid.length === 25 ? deriveRoundLineUp(dr.grid).total : null),
  },
  DominoDuel: {
    Markets: DominoDuelMarkets,   // 多桌 isMobile & 无 section → 4 组手风琴，波胆 cs-* 默认收
    Road: DominoDuelRoad,
    Podium: null,                 // 无独立信息条（对决区在页内，不碰舞台）
    rules: DOMINODUEL_RULES,
    roadTab0: 'H/A',
    roadCols: 12,
    // drawResult.tiles = 上局 4 骨牌对；命中键 = hitsOf(deriveRound(tiles))；珠盘存整局 [hs,as]
    hitsOf: (dr) => (Array.isArray(dr?.tiles) && dr.tiles.length === 4 ? hitsOfDomino(deriveRoundDomino(dr.tiles)) : undefined),
    roadItem: (dr) => { if (!Array.isArray(dr?.tiles) || dr.tiles.length !== 4) return null; const r = deriveRoundDomino(dr.tiles); return [r.hs, r.as] },
  },
  DerbyDay: {
    Markets: DerbyDayMarkets,   // 多桌 isMobile & 无 section → 3 组手风琴（半场/全场/半全场）
    Road: DerbyDayRoad,
    Podium: null,               // 无独立信息条（全场·上局在舞台内）
    rules: DERBYDAY_RULES,
    roadTab0: 'HT-H/A',
    roadCols: 12,
    // drawResult.home20/away20 = 上局两队 20 球；命中键 = hitsOf(deriveMatch({home20,away20}))
    hitsOf: (dr) => (Array.isArray(dr?.home20) && Array.isArray(dr?.away20) ? hitsOfDerby(deriveMatchDerby({ home20: dr.home20, away20: dr.away20 })) : undefined),
    // 珠盘存整局 [htHome,htAway,ftHome,ftAway]（beadFor 解构用）
    roadItem: (dr) => { if (!Array.isArray(dr?.home20) || !Array.isArray(dr?.away20)) return null; const m = deriveMatchDerby({ home20: dr.home20, away20: dr.away20 }); return [m.htHome, m.htAway, m.ftHome, m.ftAway] },
  },
  // —— #公期化 单3：滚球【只读卡】（裁定①：卡内可投归单4）——
  //   Markets 位 = RollingBallCardPanel（四态相位条 + 三球槽 + 「请进单页投注」轻提示，零钱路）；
  //   Road   位 = RollingBallRoad（迷你路珠，单视角大小，播种同 /round/history 管道）；
  //   hitsOf 不给（只读卡无中奖高亮需求，卡内也点不了盘口）；
  //   roadItem 直取 drawResult.revealed（后端单3 已把公期三球包成 {revealed}），一局 3 珠由 Road 件展开。
  RollingBall: {
    Markets: RollingBallCardPanel,
    Road: RollingBallRoad,
    Podium: null,
    rules: [],
    roadTab0: 'BS',
    roadCols: 12,
    roadItem: (dr) => (Array.isArray(dr?.revealed) && dr.revealed.length === 3 ? dr.revealed : null),
  },
}
