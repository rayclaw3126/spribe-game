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

const GAMES = { Aviator, Dice, Plinko, Goal, HiLo, Mines, Keno, Balloon }

export default function App() {
  const [balance, setBalance] = useState(1000)
  const [activeGame, setActiveGame] = useState(null)

  const GameComponent = activeGame ? GAMES[activeGame] : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Header balance={balance} onHome={() => setActiveGame(null)} activeGame={activeGame} />
      <main style={{ paddingTop: '72px' }}>
        {GameComponent ? (
          <GameComponent balance={balance} setBalance={setBalance} onBack={() => setActiveGame(null)} />
        ) : (
          <Lobby onSelect={setActiveGame} balance={balance} />
        )}
      </main>
    </div>
  )
}
