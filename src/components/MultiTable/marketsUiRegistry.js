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
}
