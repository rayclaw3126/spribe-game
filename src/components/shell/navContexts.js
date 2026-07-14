import { createContext } from 'react'

// #41：顶栏共享件的 App→组件 注入通道，独立成文件（避免 react-refresh/only-export-components；
// 组件文件只导出组件）。App 提供 value，GameTopBar/子件 useContext 取用，21 款游戏文件零改。
export const GameNavContext = createContext(null)   // 下发 setActiveGame(id|null)：GameSwitcher 游戏内切款
export const BillNavContext = createContext(null)   // 单13：下发 openBill()：账单入口全站化（缺省 null 即不显账单，死钮铁律）
