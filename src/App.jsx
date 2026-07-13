import { useState, useEffect, lazy, Suspense } from 'react'
import Lobby from './components/Lobby'
import Header from './components/Header'
import GameLogin from './pages/GameLogin'
import { COLORS } from './components/shell/tokens'
import { GameNavContext } from './components/shell/GameTopBar'
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
  // 全部 21 款游戏都由后端结算，余额一律以服务器为准。
  const [serverBalance, setServerBalance] = useState(null)
  const [caps, setCaps] = useState(null)   // 后端下发的全量风控 caps { [game]: { maxBet, maxPayout } }；旧后端未下发时保持 null，各游戏 fallback 兜底
  const [playerToken, setPlayerToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')

  const GameComponent = activeGame ? GAMES[activeGame] : null

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
    // 不清 activeGame 的话，重新登录会直接弹回上一局的游戏里。
    setActiveGame(null)
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
    return () => { cancelled = true }
  }, [playerToken])

  // 强制登录：没有 token 一律只给登录页，进不了大厅，也进不了任何游戏。
  const needsLogin = !playerToken

  if (needsLogin) {
    return <GameLogin onLogin={handlePlayerLogin} />
  }

  // 单2改：反馈悬浮入口暂隐藏（挪去代理后台）。恢复时取消下方两行 + 顶部 import 注释即可。
  // const username = localStorage.getItem(NAME_KEY) || ''
  // const feedback = <FeedbackWidget activeGame={activeGame} username={username} />

  // 已登录且选了游戏：全屏铺满，不挂 Header，也不留顶部留白。
  if (GameComponent) {
    return (
      <div style={{ minHeight: '100vh', background: '#0e1520' }}>
        {/* Context 下发 setActiveGame(id|null)：GameTopBar 内的 GameSwitcher 切换游戏走它，
            切款=直接换 activeGame 不过大厅；游戏文件零改（Context 隐形穿透）。 */}
        <GameNavContext.Provider value={setActiveGame}>
          <Suspense fallback={<GameLoading />}>
            <GameComponent
              serverBalance={serverBalance}
              setServerBalance={setServerBalance}
              caps={caps}
              playerToken={playerToken}
              onLogout={handlePlayerLogout}
              onBack={() => setActiveGame(null)}
            />
          </Suspense>
        </GameNavContext.Provider>
        {/* {feedback} */}
      </div>
    )
  }

  // 已登录、未进游戏：Header + 大厅。
  return (
    <div style={{ minHeight: '100vh', background: '#0e1520' }}>
      <Header
        balance={serverBalance ?? 0}
        onHome={() => setActiveGame(null)}
        onLogout={handlePlayerLogout}
        playerToken={playerToken}
      />
      <main style={{ paddingTop: '52px' }}>
        <Lobby onSelect={setActiveGame} balance={serverBalance ?? 0} />
      </main>
      {/* {feedback} */}
    </div>
  )
}
