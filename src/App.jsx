import { useState, useEffect } from 'react'
import Lobby from './components/Lobby'
import Header from './components/Header'
import GameLogin from './pages/GameLogin'
import Aviator from './games/Aviator'
import Dice from './games/Dice'
import Plinko from './games/Plinko'
import Goal from './games/Goal'
import HiLo from './games/HiLo'
import Mines from './games/Mines'
import Keno from './games/Keno'
import Limbo from './games/Limbo'
import StreakRoll from './games/StreakRoll'
import MiniRoulette from './games/MiniRoulette'
import Momentum from './games/Momentum'
import HalfTime from './games/HalfTime'
import GoldenBoot from './games/GoldenBoot'
import NumberUp from './games/NumberUp'
import HatTrick from './games/HatTrick'
import DerbyDay from './games/DerbyDay'
import LineUp from './games/LineUp'
import SpeedGrid from './games/SpeedGrid'
import WuXing from './games/WuXing'
import RollingBall from './games/RollingBall'
import DominoDuel from './games/DominoDuel'

const GAMES = { Aviator, Dice, Plinko, Goal, HiLo, Mines, Keno, Limbo, StreakRoll, MiniRoulette, Momentum, HalfTime, GoldenBoot, NumberUp, HatTrick, DerbyDay, LineUp, SpeedGrid, WuXing, RollingBall, DominoDuel }

const TOKEN_KEY = 'spribe_player_token'
const NAME_KEY = 'spribe_player_username'

export default function App() {
  const [activeGame, setActiveGame] = useState(null)
  // 全部 21 款游戏都由后端结算，余额一律以服务器为准。
  const [serverBalance, setServerBalance] = useState(null)
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
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [playerToken])

  // 强制登录：没有 token 一律只给登录页，进不了大厅，也进不了任何游戏。
  const needsLogin = !playerToken

  if (needsLogin) {
    return <GameLogin onLogin={handlePlayerLogin} />
  }

  // 已登录且选了游戏：全屏铺满，不挂 Header，也不留顶部留白。
  if (GameComponent) {
    return (
      <div style={{ minHeight: '100vh', background: '#0e1520' }}>
        <GameComponent
          serverBalance={serverBalance}
          setServerBalance={setServerBalance}
          playerToken={playerToken}
          onLogout={handlePlayerLogout}
          onBack={() => setActiveGame(null)}
        />
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
      />
      <main style={{ paddingTop: '52px' }}>
        <Lobby onSelect={setActiveGame} balance={serverBalance ?? 0} />
      </main>
    </div>
  )
}
