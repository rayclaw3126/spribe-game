import { useState } from 'react'
import Lobby from './components/Lobby'
import Header from './components/Header'
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

const GAMES = { Aviator, Dice, Plinko, Goal, HiLo, Mines, Keno, Limbo, StreakRoll, MiniRoulette, Momentum, HalfTime, GoldenBoot, NumberUp }

export default function App() {
  const [balance, setBalance] = useState(1000)
  const [activeGame, setActiveGame] = useState(null)

  const GameComponent = activeGame ? GAMES[activeGame] : null

  return (
    <div style={{ minHeight: '100vh', background: '#0e1520' }}>
      <Header balance={balance} onHome={() => setActiveGame(null)} activeGame={activeGame} />
      <main style={{ paddingTop: '60px' }}>
        {GameComponent ? (
          <GameComponent balance={balance} setBalance={setBalance} onBack={() => setActiveGame(null)} />
        ) : (
          <Lobby onSelect={setActiveGame} balance={balance} />
        )}
      </main>
    </div>
  )
}
