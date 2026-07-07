import { useState } from 'react'
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
  const [balance, setBalance] = useState(1000)
  const [activeGame, setActiveGame] = useState(null)
  // Aviator 专用：服务器权威余额（其它 20 款游戏继续用上面的本地 balance，不受影响）。
  const [serverBalance, setServerBalance] = useState(null)
  const [playerToken, setPlayerToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')

  const GameComponent = activeGame ? GAMES[activeGame] : null

  function handlePlayerLogin({ token, username }) {
    localStorage.setItem(TOKEN_KEY, token)
    if (username) localStorage.setItem(NAME_KEY, username)
    setPlayerToken(token)
  }

  function handlePlayerLogout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(NAME_KEY)
    setPlayerToken('')
    setServerBalance(null)
  }

  // 服务器接后端的即时游戏需要真实玩家登录、余额以服务器为准；
  // 其它游戏照旧免登录、本地模拟余额。
  const NEEDS_LOGIN = ['Aviator', 'Dice']
  const isServerGame = NEEDS_LOGIN.includes(activeGame)
  const needsLogin = isServerGame && !playerToken

  return (
    <div style={{ minHeight: '100vh', background: '#0e1520' }}>
      {!needsLogin && (
        <Header
          balance={isServerGame ? (serverBalance ?? 0) : balance}
          onHome={() => setActiveGame(null)}
          activeGame={activeGame}
        />
      )}
      <main style={{ paddingTop: needsLogin ? 0 : '60px' }}>
        {needsLogin ? (
          <GameLogin onLogin={handlePlayerLogin} onCancel={() => setActiveGame(null)} />
        ) : isServerGame ? (
          <GameComponent
            serverBalance={serverBalance}
            setServerBalance={setServerBalance}
            playerToken={playerToken}
            onLogout={handlePlayerLogout}
            onBack={() => setActiveGame(null)}
          />
        ) : GameComponent ? (
          <GameComponent balance={balance} setBalance={setBalance} onBack={() => setActiveGame(null)} />
        ) : (
          <Lobby onSelect={setActiveGame} balance={balance} />
        )}
      </main>
    </div>
  )
}
