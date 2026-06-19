# 💎 Spribe Gems

> A polished, single-page collection of **8 instant-play casino mini-games** built with React 19 + Vite. Everything runs entirely in the browser on a shared **demo balance** — no accounts, no backend, no real money.

<p align="center">
  <em>Aviator · Dice · Plinko · Goal · Hi-Lo · Mines · Keno · Balloon</em>
</p>

---

## ✨ Highlights

- **8 complete games**, each with its own mechanics, odds and animations.
- **Shared demo wallet** — you start with **$1,000.00** that carries across every game.
- **Zero setup, zero secrets** — purely client-side. No API keys, no database, no server.
- **Canvas + requestAnimationFrame** rendering for the live games (Aviator's flight curve, Plinko's bouncing ball).
- **Consistent ~97% RTP** (3% house edge) baked into the math of the skill/odds games.
- **Responsive, themeable UI** driven by CSS variables and the `Space Grotesk` typeface.
- **Fast dev loop** with Vite HMR and an opinionated ESLint config.

---

## 🎮 The Games

All games share a common shell: a **bet input** (with `½` and `2×` quick-adjust buttons, $1 minimum), a live **balance** in the header, and a result/cash-out panel. Bets are deducted on play and winnings credited on a win.

### ✈️ Aviator — *crash / cash-out*
A multiplier climbs from `1.00×` along an exponential curve (`e^(0.35·t)`) while a plane flies across a canvas graph. **Cash out before it flies away** to win `bet × multiplier`. Each round has a hidden crash point drawn from `1 / (1 − 0.97·r)` (with a ~1% instant-crash at `1.00×`), so higher targets are rarer. Includes a live **Recent Crashes** history strip.

### 🎲 Dice — *over / under*
Pick a target (1–6) and bet whether the roll lands **over** or **under** it. Win chance and payout update live; the multiplier is `0.97 / winChance`, so safer bets pay less. Animated dice-roll tumble before the result settles.

### 🔮 Plinko — *drop & bounce*
Drop a ball through **10 rows of pegs** into one of **13 buckets**, rendered on a live canvas. Edge buckets pay big (`10×`), the center pays least (`0.3×`):
`[10, 4, 2, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 2, 4, 10]`. Keeps a history of recent drops.

### ⚽ Goal — *advance & cash out*
Five columns, each hiding a goalkeeper in one of three cells. Pick a cell to **score** and advance; multipliers ramp up per column `[1.4, 2.0, 3.0, 5.0, 10.0]`. **Cash out** any time, or risk it for the full `10×`. Hit the keeper and you lose the bet.

### 🃏 Hi-Lo — *higher or lower*
Guess whether the next card is **higher or lower** than the current one. Each correct call extends your streak and bumps the multiplier `[1, 1.5, 2.5, 4, 6.5, 10, 16, 25]`. Cash out whenever you like — one wrong call ends the run.

### 💣 Mines — *risk grid*
A **5×5 grid** seeded with a chosen number of mines (`1, 3, 5, 10, 15, 20, 24`). Reveal gems to grow the multiplier (priced off true safe-tile probability with a 0.97 edge), and **cash out** before you tap a mine. Clear every safe tile for the max payout.

### 🎯 Keno — *pick & draw*
Choose up to **10 numbers** from a pool of **40** (or use **Quick Pick**); the game draws **20**. Payouts scale with how many of your picks hit, climbing all the way to **10,000×** for a perfect 10-of-10. Numbers are drawn one-by-one for suspense.

### 🎈 Balloon — *inflate & bank*
Pump a balloon as its multiplier accelerates (`1 + 0.6·t + 0.1·t²`). **Cash out before it pops** to bank `bet × multiplier`. The pop point is random and skewed toward lower values (~3% instant pop at `1.01×`). Recent pops are tracked in a history strip.

---

## 🛠️ Tech Stack

| Layer | Choice |
|-------|--------|
| UI library | **React 19** (function components + hooks) |
| Build tool | **Vite 8** (`@vitejs/plugin-react`) with HMR |
| Rendering | Inline styles + CSS variables; `<canvas>` for Aviator & Plinko |
| State | Local React state (`useState`/`useRef`/`useEffect`) — balance lifted to `App` |
| Linting | ESLint 9 with React Hooks + React Refresh plugins |
| Backend | **None** — fully static, client-side only |

---

## 📂 Project Structure

```
Spribe Game/
├─ index.html              # App entry + Google Fonts (Space Grotesk)
├─ vite.config.js          # Vite + React plugin
├─ eslint.config.js        # ESLint flat config
├─ public/                 # favicon, icons
└─ src/
   ├─ main.jsx             # React root
   ├─ App.jsx              # Routing between Lobby and the active game; holds shared balance
   ├─ index.css / App.css  # Theme tokens (CSS variables) + global styles
   ├─ components/
   │  ├─ Header.jsx        # Fixed top bar: logo, breadcrumb, live balance
   │  ├─ Lobby.jsx         # Game grid / landing page
   │  └─ GameLayout.jsx    # Shared layout + <Panel>, <BetInput>, <ActionButton>, <ResultBadge>
   └─ games/
      ├─ Aviator.jsx  ├─ Dice.jsx   ├─ Plinko.jsx ├─ Goal.jsx
      ├─ HiLo.jsx     ├─ Mines.jsx  ├─ Keno.jsx   └─ Balloon.jsx
```

---

## 🚀 Getting Started

**Prerequisites:** Node.js 18+ and npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (default Vite port 5173)
npm run dev

# …or pin it to a specific port
npm run dev -- --port 6688 --strictPort
```

Then open the URL printed in the terminal (e.g. **http://localhost:6688**).

### Available scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Vite dev server with hot-module reload |
| `npm run build` | Produce an optimized production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint across the project |

---

## 🔐 Security & Configuration

This project has **no secrets and no environment variables** — it never talks to an external service, so there are no API keys or tokens to manage.

The repository's `.gitignore` is hardened to keep it that way: `.env` / `.env.*`, `*.pem`, `*.key`, and local editor/OS files are all excluded. If you later add a backend, put credentials in a git-ignored `.env` and commit a documented `.env.example` instead.

---

## ⚠️ Disclaimer

Spribe Gems is a **demo / educational project**. All balances are fake, results are generated locally with `Math.random()`, and nothing involves real currency. It is not affiliated with any real gaming operator. Play responsibly. 🎮
