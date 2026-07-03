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
import Balloon from './games/Balloon'
import Limbo from './games/Limbo'
import PenaltyWheel from './games/PenaltyWheel'
import StreakRoll from './games/StreakRoll'
import Tower from './games/Tower'

const GAMES = { Aviator, Dice, Plinko, Goal, HiLo, Mines, Keno, Balloon, Limbo, PenaltyWheel, StreakRoll, Tower }

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
