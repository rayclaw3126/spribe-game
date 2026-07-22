import { useState, useEffect, lazy, Suspense } from 'react'
import Lobby from './components/Lobby'
import Header from './components/Header'
import GameLogin from './pages/GameLogin'
import BillDrawer from './components/BillDrawer'
import { COLORS } from './components/shell/tokens'
import { GameNavContext, BillNavContext } from './components/shell/navContexts'
import { usePlayerApi } from './lib/playerApi'
import { useMediaQuery } from './hooks/useMediaQuery'
// 单S4：桌面单游戏页右栏（今日大奖/近期开奖/换个游戏）。App 层一处挂载包全款，游戏内部文件零改。
import GameSideRail from './components/shell/GameSideRail'
// #44 我的最爱：前端 id ↔ backendId 反查单一数据源（禁手抄第二份映射）。
import { GAME_BY_ID, GAME_BY_BACKEND_ID } from './gameRegistry'
// 单2改：前台反馈钮暂隐藏（挪去代理后台）。组件文件保留，需要时取消注释即可恢复。
// import FeedbackWidget from './components/feedback/FeedbackWidget'
// 每款游戏按需加载（lazy）：进哪款才拉该款 chunk，大厅首屏不含任何游戏 JS/资产。
const Aviator = lazy(() => import('./games/Aviator'))
const Dice = lazy(() => import('./games/Dice'))
const Plinko = lazy(() => import('./games/Plinko'))
const Goal = lazy(() => import('./games/Goal'))
const HiLo = lazy(() => import('./games/HiLo'))
const Mines = lazy(() => import('./games/Mines'))
const Keno = lazy(() => import('./games/Keno'))
const Limbo = lazy(() => import('./games/Limbo'))
const StreakRoll = lazy(() => import('./games/StreakRoll'))
const MiniRoulette = lazy(() => import('./games/MiniRoulette'))
const Momentum = lazy(() => import('./games/Momentum'))
const HalfTime = lazy(() => import('./games/HalfTime'))
const GoldenBoot = lazy(() => import('./games/GoldenBoot'))
const NumberUp = lazy(() => import('./games/NumberUp'))
const HatTrick = lazy(() => import('./games/HatTrick'))
const DerbyDay = lazy(() => import('./games/DerbyDay'))
const LineUp = lazy(() => import('./games/LineUp'))
const SpeedGrid = lazy(() => import('./games/SpeedGrid'))
const WuXing = lazy(() => import('./games/WuXing'))
const RollingBall = lazy(() => import('./games/RollingBall'))
const DominoDuel = lazy(() => import('./games/DominoDuel'))
// #41 多桌专区（静态版）：与游戏同走 lazy，大厅首屏不含其 JS。
const MultiTablePage = lazy(() => import('./components/MultiTable/MultiTablePage'))

// id → 游戏组件映射（lazy 组件）。游戏元数据（名/封面/分类/backendId）单一数据源见
// src/gameRegistry.js —— 此处的键须与 GAME_REGISTRY 的 id 一一对应。
const GAMES = { Aviator, Dice, Plinko, Goal, HiLo, Mines, Keno, Limbo, StreakRoll, MiniRoulette, Momentum, HalfTime, GoldenBoot, NumberUp, HatTrick, DerbyDay, LineUp, SpeedGrid, WuXing, RollingBall, DominoDuel }

// 游戏 chunk 加载中的过渡态（一般一闪而过）：深色 chrome 底 + 绿点 + 加载中，色值走 tokens。
function GameLoading() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 10, background: COLORS.bg, color: COLORS.textMuted,
      fontSize: 15, fontWeight: 700, letterSpacing: 1,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%', background: COLORS.green,
        boxShadow: `0 0 12px ${COLORS.green}`, animation: 'fadeIn 0.8s ease-in-out infinite alternate',
      }} />
      加载中…
    </div>
  )
}

const TOKEN_KEY = 'spribe_player_token'
const NAME_KEY = 'spribe_player_username'

export default function App() {
  const [activeGame, setActiveGame] = useState(null)
  const [activeView, setActiveView] = useState(null)   // null | 'multi' —— 多桌专区（不复用 activeGame，避免 GAMES 映射查空崩）
  const [gameFrom, setGameFrom] = useState(null)       // 'multi' —— 记住游戏由多桌 ⤢ 进入，其「← 大厅」回多桌（游戏组件零改）
  // 全部 21 款游戏都由后端结算，余额一律以服务器为准。
  const [serverBalance, setServerBalance] = useState(null)
  const [caps, setCaps] = useState(null)   // 后端下发的全量风控 caps { [game]: { maxBet, maxPayout } }；旧后端未下发时保持 null，各游戏 fallback 兜底
  const [playerToken, setPlayerToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [billOpen, setBillOpen] = useState(false)     // #41 单13：账单抽屉 App 层单实例（大厅/游戏/多桌三态共用）
  const openBill = () => setBillOpen(true)
  // #44 我的最爱：收藏集，存前端 id（Set）。登录/刷新拉真源，点☆乐观翻转+回写。
  const [favIds, setFavIds] = useState(() => new Set())

  const GameComponent = activeGame ? GAMES[activeGame] : null
  // 单S4：右栏仅桌面宽（≥1280）+ 处于单游戏视图时渲染；1024-1279 及以下现状零变。
  const showSideRail = useMediaQuery('(min-width: 1280px)')

  // 收藏读/写收口到 playerApi（同鉴权/401 约定）；余额回写此处不需要，传现成 setter 满足签名即可。
  const playerApi = usePlayerApi({ playerToken, onLogout: handlePlayerLogout, setServerBalance })

  // #44 收藏切换：乐观翻转本地 → POST（发 backendId）→ 以后端返回全量为准回写；失败回滚 + console.warn。
  function toggleFav(frontId) {
    const entry = GAME_BY_ID[frontId]
    if (!entry) return
    const had = favIds.has(frontId)
    setFavIds((prev) => {
      const next = new Set(prev)
      if (had) next.delete(frontId); else next.add(frontId)
      return next
    })
    playerApi.toggleFavorite(entry.backendId)
      .then((data) => {
        // 后端返回 backendId 列表 → 反查回前端 id（未知/非多桌款一并保留，滤空）。
        const ids = (data?.favorites || []).map((be) => GAME_BY_BACKEND_ID[be]?.id).filter(Boolean)
        setFavIds(new Set(ids))
      })
      .catch((err) => {
        setFavIds((prev) => {
          const next = new Set(prev)
          if (had) next.add(frontId); else next.delete(frontId)   // 回滚到点击前
          return next
        })
        console.warn('收藏切换失败，已回滚：', err)
      })
  }

  function handlePlayerLogin({ token, username, balance }) {
    localStorage.setItem(TOKEN_KEY, token)
    if (username) localStorage.setItem(NAME_KEY, username)
    setPlayerToken(token)
    // 登录接口已带回玩家钱包余额：立即作为 serverBalance 初值，
    // 即时游戏（Dice/Aviator）首屏就能显示真实余额，不再是 0。
    if (balance != null) setServerBalance(Number(balance))
  }

  function handlePlayerLogout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(NAME_KEY)
    setPlayerToken('')
    setServerBalance(null)
    setFavIds(new Set())   // #44 登出清收藏，避免残留串号到下一位登录者
    // 不清 activeGame 的话，重新登录会直接弹回上一局的游戏里。
    setActiveGame(null)
    setActiveView(null)
    setGameFrom(null)
  }

  // 已登录（token 在 localStorage）刷新页面时，主动拉一次玩家余额作为 serverBalance 初值，
  // 让即时游戏（Dice/Aviator）首屏就能显示真实余额，不必等第一次下注。token 失效则登出。
  useEffect(() => {
    if (!playerToken) return
    let cancelled = false
    fetch('/player/me', { headers: { Authorization: `Bearer ${playerToken}` } })
      .then(async (resp) => {
        if (resp.status === 401) { handlePlayerLogout(); return }
        if (!resp.ok) return
        const data = await resp.json()
        if (!cancelled && data.balance != null) setServerBalance(Number(data.balance))
        if (!cancelled && data.caps) setCaps(data.caps)
      })
      .catch(() => {})
    // #44 顺拉收藏（独立接口，与 /me 并行）：backendId → 前端 id 反查后落 favIds。
    playerApi.getFavorites()
      .then((data) => {
        if (cancelled) return
        const ids = (data?.favorites || []).map((be) => GAME_BY_BACKEND_ID[be]?.id).filter(Boolean)
        setFavIds(new Set(ids))
      })
      .catch(() => {})
    return () => { cancelled = true }
    // playerApi 每渲染重建（依赖不稳定的 handlePlayerLogout），刻意不列入 deps：
    // 只想在 token 变化时拉一次，列入会导致每渲染重拉 /me+/favorites。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerToken])

  // 强制登录：没有 token 一律只给登录页，进不了大厅，也进不了任何游戏。
  const needsLogin = !playerToken

  if (needsLogin) {
    return <GameLogin onLogin={handlePlayerLogin} />
  }

  // 单2改：反馈悬浮入口暂隐藏（挪去代理后台）。恢复时取消下方两行 + 顶部 import 注释即可。
  // const username = localStorage.getItem(NAME_KEY) || ''
  // const feedback = <FeedbackWidget activeGame={activeGame} username={username} />

  // 三态视图择一（body）；BillDrawer 提 App 层单实例，包在 BillNavContext 外壳里 overlay 三态。
  let body
  if (activeView === 'multi') {
    // 多桌专区：全屏渲染，页面自绘暗黑底，onBack 清回大厅。
    body = (
      <Suspense fallback={<GameLoading />}>
        <MultiTablePage
          serverBalance={serverBalance}
          setServerBalance={setServerBalance}
          caps={caps}
          playerToken={playerToken}
          onLogout={handlePlayerLogout}
          onBack={() => setActiveView(null)}
          onOpenGame={(id) => { setGameFrom('multi'); setActiveView(null); setActiveGame(id) }}
          onOpenBill={openBill}
          favIds={favIds}
        />
      </Suspense>
    )
  } else if (GameComponent) {
    // 选了游戏：全屏铺满，不挂 Header。Context 下发 setActiveGame（切款不过大厅，游戏文件零改）。
    const gameView = (
      <div style={{ minHeight: '100vh', background: '#0e1520' }}>
        <GameNavContext.Provider value={setActiveGame}>
          <Suspense fallback={<GameLoading />}>
            <GameComponent
              serverBalance={serverBalance}
              setServerBalance={setServerBalance}
              caps={caps}
              playerToken={playerToken}
              onLogout={handlePlayerLogout}
              onBack={() => { setActiveGame(null); if (gameFrom === 'multi') setActiveView('multi'); setGameFrom(null) }}
            />
          </Suspense>
        </GameNavContext.Provider>
        {/* {feedback} */}
      </div>
    )
    // 单S4/S4b：≥1280 挂右栏。改前 flex 包裹把游戏套进 flex 上下文，游戏内 height:calc(100vh) 骨架
    // 下的 height:100% BetFeed 头部在真机 Chrome 被裁（S4b 回归）。改为「游戏留右 margin + 右栏 position:fixed」：
    // 游戏回到与 <1280 完全一致的普通块流（不再有 flex 上下文），仅靠 marginRight 让出 200px 给右栏。
    body = showSideRail ? (
      // 单S4c：跑马灯已移入 GameSideRail 顶部（顶横条方案废弃：其占位依赖游戏底部留白随窗口高度浮动、真机裁下注条）。
      // 游戏区回到 S4b 形态：普通块流 + marginRight 让出 200px 给右栏（fixed），零 paddingTop、零 overflow 改动。
      <div style={{ position: 'relative', minHeight: '100vh', background: '#0e1520' }}>
        {/* #46 单11：让位宽度必须 === GameSideRail 的 width（250）。改一处不改另一处即错位。 */}
        <div style={{ marginRight: 250 }}>{gameView}</div>
        <GameSideRail
          currentGameId={activeGame}
          playerToken={playerToken}
          onSelect={setActiveGame}
          onLogout={handlePlayerLogout}
        />
      </div>
    ) : gameView
  } else {
    // 未进游戏：Header + 大厅。大厅账单入口不回退（改调 App 单实例 openBill）。
    body = (
      <div style={{ minHeight: '100vh', background: '#0e1520' }}>
        <Header
          balance={serverBalance ?? 0}
          onHome={() => setActiveGame(null)}
          onLogout={handlePlayerLogout}
          playerToken={playerToken}
          onOpenBill={openBill}
        />
        <main style={{ paddingTop: '52px' }}>
          <Lobby onSelect={setActiveGame} balance={serverBalance ?? 0} onOpenMulti={() => setActiveView('multi')} favIds={favIds} onToggleFav={toggleFav} />
        </main>
        {/* {feedback} */}
      </div>
    )
  }

  // BillNavContext 下发 openBill 给 GameTopBar（21 games 零改）；BillDrawer 单实例 overlay 三态。
  return (
    <BillNavContext.Provider value={openBill}>
      {body}
      <BillDrawer open={billOpen} onClose={() => setBillOpen(false)} playerToken={playerToken} onLogout={handlePlayerLogout} />
    </BillNavContext.Provider>
  )
}
