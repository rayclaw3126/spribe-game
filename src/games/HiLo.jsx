import { useState, useRef, useEffect } from 'react'
import GameLayout, { Panel } from '../components/GameLayout'
import { COLORS, RADIUS, LAYOUT, HILO } from '../components/shell/tokens'
import { useIsMobile, useMediaQuery } from '../hooks/useMediaQuery'
import BetFeed from '../components/shell/BetFeed'
import { makeFeedBots } from '../components/shell/arenaFx'
import { useBgm } from '../components/shell/bgmManager'
import { MusicNoteIcon, SpeakerIcon } from '../components/shell/AudioIcons'
import ballUrl from '../assets/covers/ball-3d.png'

// 单HL2: Rating Hi-Lo gameplay — 1–13 probability multipliers, skip, streak
// cashout (Spribe Hi Lo model).
//
// 倍数推导: 号码 1–13 均匀抽（同号可重复）。当前明牌 n:
//   HIGH OR SAME 赢 ⟺ 下一张 m ≥ n，共 14−n 个号码 → P(high) = (14−n)/13
//   LOW  OR SAME 赢 ⟺ m ≤ n，共 n 个号码       → P(low)  = n/13
//   倍数 = RTP / P（RTP = 0.97）。边界 n=13: HIGH P=1/13 → 12.61×，
//   LOW P=1 → 0.97× —— 两钮都正常可押。
//   猜对倍数累乘（内部保留全精度，显示才 round2），CASHOUT = 注金 × 累乘。
const RTP = 0.97
const SKIPS_PER_ROUND = 3   // 每局 skip 限次（可调）
const round2 = x => Math.round(x * 100) / 100
const pHigh = n => (14 - n) / 13
const pLow = n => n / 13
// uniform 1..13 draw (module-level: event-time randomness only)
const drawCard = () => 1 + Math.floor(Math.random() * 13)

// flat block-style football jersey: body + sleeves + collar, deep green,
// big squad number (1–13) on the chest
const JERSEY_PATH = 'M35 6 L20 14 L6 30 L16 42 L26 34 L26 84 L74 84 L74 34 L84 42 L94 30 L80 14 L65 6 C 55 16, 45 16, 35 6 Z'
function Jersey({ num, w, outline = false }) {
  return (
    <svg width={w} height={w * 0.9} viewBox="0 0 100 90" style={{ display: 'block' }}>
      <path d={JERSEY_PATH}
        fill={outline ? 'none' : '#14803c'}
        stroke={outline ? HILO.outline : 'rgba(0,0,0,0.3)'}
        strokeWidth={outline ? 3 : 2} strokeLinejoin="round" />
      {num != null && (
        <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="900"
          fill={outline ? HILO.outline : '#ffffff'}
          fontFamily="'Space Grotesk', sans-serif">{num}</text>
      )}
    </svg>
  )
}
// white card with the jersey + chest number
function JerseyCard({ num, w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10,
      background: '#ffffff', border: '1px solid rgba(0,0,0,0.25)',
      boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Jersey num={num} w={w * 0.74} />
    </div>
  )
}

// dark football-pattern card back
function CardBack({ w, h }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 10, boxSizing: 'border-box',
      background: `repeating-linear-gradient(45deg, ${HILO.back} 0px, ${HILO.back} 8px, ${HILO.backLine} 8px, ${HILO.backLine} 10px)`,
      border: '4px solid #ffffff', boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src={ballUrl} alt="" draggable={false} style={{
        width: w * 0.3, height: w * 0.3, opacity: 0.55, pointerEvents: 'none', display: 'block',
      }} />
    </div>
  )
}

export default function HiLo({ balance, setBalance }) {
  const isMobile = useIsMobile()
  const [bet, setBet] = useState(10)
  const [phase, setPhase] = useState('idle')   // idle | playing | done
  const [card, setCard] = useState(null)       // current face-up number 1..13
  const [flipping, setFlipping] = useState(false)
  const [skips, setSkips] = useState(SKIPS_PER_ROUND)
  const [cum, setCum] = useState(1)            // display copy of the running product
  const [steps, setSteps] = useState([])       // this round's flips {n, dir, correct}
  const [cardFlash, setCardFlash] = useState(null)   // 'win' | 'lose' | null
  const [feedBets, setFeedBets] = useState(() => makeFeedBots())   // fake feed rows (display only)
  const [muted, setMuted] = useState(false)
  const [bgmOn, toggleBgm] = useBgm()

  const cumRef = useRef(1)                     // full-precision running product
  const audioRef = useRef({ ctx: null, muted: false })
  const timersRef = useRef([])

  useEffect(() => { audioRef.current.muted = muted }, [muted])
  function later(fn, ms) { const id = setTimeout(fn, ms); timersRef.current.push(id); return id }

  // ---------- audio ----------
  function ensureAudio() {
    if (audioRef.current.ctx) return audioRef.current.ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC(); if (ctx.state === 'suspended') ctx.resume()
    audioRef.current.ctx = ctx; return ctx
  }
  function playFlip() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate)
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const ns = ctx.createBufferSource(); ns.buffer = nb
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400
    const g = ctx.createGain(); g.gain.value = 0.05
    ns.connect(bp); bp.connect(g); g.connect(ctx.destination); ns.start(t); ns.stop(t + 0.1)
  }
  function playCorrect() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    ;[720, 960, 1280].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f
      const s = t + i * 0.07
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.12, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.24)
      o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.26)
    })
  }
  function playWrong() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'triangle'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44)
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.46)
  }
  function playCash() {
    const ctx = ensureAudio(); if (!ctx || audioRef.current.muted) return
    const t = ctx.currentTime
    const g = ctx.createGain(); g.gain.value = 0.001; g.connect(ctx.destination)
    ;[880, 1320].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t + i * 0.05); o.stop(t + 0.28 + i * 0.05) })
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
  }

  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  // ---------- game ----------
  function startGame() {
    if (phase === 'playing' || bet > balance || bet < 1) return
    const first = drawCard()   // draw first — SFX noise randoms must not sit ahead
    setFeedBets(makeFeedBots())   // fresh fake round rides along (display only)
    ensureAudio()
    setBalance(b => round2(b - bet))
    cumRef.current = 1
    setCum(1)
    setCard(first)
    setSteps([])
    setSkips(SKIPS_PER_ROUND)
    setCardFlash(null)
    setFlipping(false)
    setPhase('playing')
    playFlip()
  }

  function guess(dir) {   // dir: 'high' | 'low' — both include SAME
    if (phase !== 'playing' || flipping) return
    const next = drawCard()
    const p = dir === 'high' ? pHigh(card) : pLow(card)
    const correct = dir === 'high' ? next >= card : next <= card
    setFlipping(true)
    playFlip()

    later(() => {
      setSteps(s => [...s, { n: next, dir, correct }].slice(-10))
      setCard(next)
      if (correct) {
        cumRef.current *= RTP / p        // full precision; round only at display/settle
        setCum(cumRef.current)
        setCardFlash('win')
        playCorrect()
      } else {
        setCardFlash('lose')
        setPhase('done')                 // stake already deducted — round over
        settleFeed()
        playWrong()
      }
      setFlipping(false)
      later(() => setCardFlash(null), 700)
    }, 620)
  }

  function skip() {   // swap the face card, no settle, streak keeps (limited per round)
    if (phase !== 'playing' || flipping || skips <= 0) return
    const next = drawCard()
    setSkips(k => k - 1)
    setCard(next)
    playFlip()
  }

  // fake feed rows settle for the round: ~45% cash green, the rest grey out
  function settleFeed() {
    setFeedBets(list => list.map(b => Math.random() < 0.45
      ? { ...b, status: 'cashed', target: Number(b.target.toFixed(2)), payout: Number((b.bet * b.target).toFixed(2)) }
      : { ...b, status: 'crashed' }))
  }

  // single money path: every payout goes through here
  function cashOut() {
    if (phase !== 'playing' || flipping) return
    const payout = round2(bet * cumRef.current)
    setBalance(b => round2(b + payout))
    setPhase('done')
    settleFeed()
    playCash()
  }

  // ---------- visual layer (Spribe Hi Lo 1:1, pitch green) ----------
  const navPill = {
    padding: '5px 16px', borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
    color: COLORS.white, fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
  }
  const circleBtn = {
    width: 30, height: 30, borderRadius: RADIUS.pill,
    background: 'rgba(0,0,0,0.35)', color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: 15, fontWeight: 900, cursor: 'pointer', lineHeight: 1,
  }
  const CW = isMobile ? 96 : 118
  const CH = isMobile ? 126 : 155
  const choicePill = (bg, locked) => ({
    minWidth: isMobile ? 130 : 156, padding: '9px 0', borderRadius: RADIUS.pill,
    background: bg, color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.45)',
    fontSize: 12, fontWeight: 900, letterSpacing: 0.5,
    cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
  })
  const isDesk = useMediaQuery(`(min-width: ${LAYOUT.breakpoint}px)`)

  // flip-history minis + count/multiplier badge — desktop renders it in the
  // 34px skeleton row, mobile keeps it inside the card (never both)
  const historyStrip = (
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div style={{
            flex: 1, minWidth: 0, background: HILO.band, borderRadius: 8,
            padding: '6px 8px', display: 'flex', gap: 6, alignItems: 'center', overflow: 'hidden',
          }}>
            {(isMobile ? steps.slice(-4) : steps).map((h, i) => (
              <div key={steps.length - i} style={{
                position: 'relative', width: 34, height: 46, borderRadius: 5, flex: '0 0 auto',
                background: '#ffffff',
                border: `2px solid ${h.correct ? HILO.green : '#e04b3a'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Jersey num={h.n} w={26} />
                <span style={{
                  position: 'absolute', top: -5, left: -5, width: 15, height: 15, borderRadius: '50%',
                  background: h.dir === 'high' ? HILO.badgeUp : HILO.badgeDown, color: COLORS.white,
                  fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.6)',
                }}>{h.dir === 'high' ? '↑' : '↓'}</span>
              </div>
            ))}
          </div>
          <div style={{
            flex: '0 0 auto', background: HILO.band, borderRadius: 8,
            padding: '6px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
              <span style={{ width: 11, height: 15, borderRadius: 2, background: '#ffffff', border: '1px solid rgba(0,0,0,0.4)', display: 'inline-block' }} />
              {steps.length}
            </span>
            <span style={{
              padding: '2px 10px', borderRadius: 4,
              background: HILO.green, color: '#083a1b',
              fontSize: 12, fontWeight: 900,
            }}>{round2(cum).toFixed(2)}x</span>
          </div>
        </div>
  )

  const gameCard = (
      <Panel style={{
        background: `radial-gradient(circle at 50% 34%, ${HILO.bgCenter}, ${HILO.bgOuter})`,
        borderColor: COLORS.border, padding: isMobile ? 12 : 18, overflow: 'hidden',
        position: 'relative',
        ...(isDesk ? { height: '100%', boxSizing: 'border-box' } : {}),
      }}>
        {/* giant corner rating-card line art (ref A/K positions) */}
        <div style={{
          position: 'absolute', left: -50, top: '32%', width: 170, height: 240,
          border: `3px solid ${HILO.outline}`, borderRadius: 18,
          transform: 'rotate(-14deg)', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Jersey num={13} w={120} outline />
        </div>
        <div style={{
          position: 'absolute', right: -50, bottom: '10%', width: 170, height: 240,
          border: `3px solid ${HILO.outline}`, borderRadius: 18,
          transform: 'rotate(14deg)', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Jersey num={1} w={120} outline />
        </div>

        {/* ---- top bar ---- */}
        <div style={{
          margin: isMobile ? '-12px -12px 12px' : '-18px -18px 14px',
          padding: '8px 14px',
          background: HILO.band,
          display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 2,
        }}>
          <span style={navPill}>RATING HI-LO ▾</span>
          <span style={{
            padding: '5px 14px', borderRadius: RADIUS.pill,
            background: HILO.orange, color: COLORS.white,
            fontSize: 12, fontWeight: 900,
          }}>? How to Play?</span>
          {!isMobile && (
            <span style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              padding: '4px 18px', borderRadius: RADIUS.pill,
              border: `1px solid ${HILO.gold}`, color: HILO.gold,
              fontSize: 11, fontWeight: 900, letterSpacing: 2,
            }}>DEMO MODE</span>
          )}
          <span style={{ marginLeft: 'auto', color: COLORS.white, fontSize: 14, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ opacity: 0.7, fontSize: 11 }}>USD</span>
          </span>
          <button type="button" onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '开启背景音乐'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: bgmOn ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.3)',
            color: bgmOn ? COLORS.white : COLORS.textMuted,
            border: `1px solid rgba(255,255,255,${bgmOn ? 0.6 : 0.25})`,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><MusicNoteIcon on={bgmOn} /></button>
          <button type="button" onClick={() => setMuted(v => !v)} title={muted ? '取消静音' : '静音'} style={{
            width: 30, height: 30, borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.3)', color: muted ? COLORS.textMuted : COLORS.white,
            border: '1px solid rgba(255,255,255,0.25)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}><SpeakerIcon on={!muted} /></button>
        </div>

        {/* ---- upper region (mobile only — desktop 34px row has it) ---- */}
        {!isDesk && <div style={{ marginBottom: isMobile ? 16 : 22, position: 'relative', zIndex: 1 }}>{historyStrip}</div>}

        {/* ---- center: hi/lo minis + face card + deck + skip ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: isMobile ? 12 : 22, marginBottom: isMobile ? 16 : 22, position: 'relative', zIndex: 1,
        }}>
          {/* mini hi/lo indicators — up = higher rating, down = lower rating */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <button type="button" disabled onClick={() => guess('higher')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={13} w={20} />
              <span style={{ color: HILO.badgeUp, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↑</span>
            </button>
            <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 900 }}>∨</span>
            <button type="button" disabled onClick={() => guess('lower')} style={{
              width: 30, height: 42, borderRadius: 5, background: '#ffffff',
              border: '1px solid rgba(0,0,0,0.3)', cursor: 'not-allowed', padding: '2px 0 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            }}>
              <Jersey num={1} w={20} />
              <span style={{ color: HILO.badgeDown, fontSize: 11, fontWeight: 900, lineHeight: 1 }}>↓</span>
            </button>
          </div>

          {/* face-up jersey number card — flashes green/red on settle */}
          <div style={{
            borderRadius: 12, transition: 'box-shadow 0.15s',
            boxShadow: cardFlash === 'win' ? `0 0 18px ${HILO.green}` : cardFlash === 'lose' ? '0 0 18px #e04b3a' : 'none',
          }}>
            <JerseyCard num={card ?? 9} w={CW} h={CH} />
          </div>

          {/* face-down deck: 3 offset backs + skip button below */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: CW + 10, height: CH + 8 }}>
              <div style={{ position: 'absolute', left: 10, top: 8 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 5, top: 4 }}><CardBack w={CW} h={CH} /></div>
              <div style={{ position: 'absolute', left: 0, top: 0 }}><CardBack w={CW} h={CH} /></div>
            </div>
            <button type="button" onClick={skip}
              disabled={phase !== 'playing' || flipping || skips <= 0}
              title={`换一张（剩 ${skips} 次）`} style={{
                minWidth: 48, height: 36, borderRadius: RADIUS.pill,
                background: 'rgba(0,0,0,0.35)', color: COLORS.white,
                border: '1px solid rgba(255,255,255,0.35)',
                fontSize: 13, fontWeight: 900,
                cursor: phase === 'playing' && skips > 0 && !flipping ? 'pointer' : 'not-allowed',
                opacity: phase === 'playing' && skips > 0 ? 1 : 0.5,
              }}>⟲ {skips}</button>
          </div>
        </div>

        {/* ---- choice pills + static payout labels ---- */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: isMobile ? 12 : 26,
          marginBottom: 4, position: 'relative', zIndex: 1, flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'center' }}>
            <button type="button" onClick={() => guess('low')} disabled={phase !== 'playing' || flipping}
              style={choicePill(HILO.low, phase !== 'playing' || flipping)}>⌄ LOW OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
              {round2(RTP / pLow(card ?? 9)).toFixed(2)}x
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button type="button" onClick={() => guess('high')} disabled={phase !== 'playing' || flipping}
              style={choicePill(HILO.high, phase !== 'playing' || flipping)}>⌃ HIGH OR SAME</button>
            <div style={{ marginTop: 6, color: COLORS.white, fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
              {round2(RTP / pHigh(card ?? 9)).toFixed(2)}x
            </div>
          </div>
        </div>

        {/* ---- bottom bet band ---- */}
        <div style={{
          margin: isMobile ? '12px -12px -12px' : '14px -18px -18px',
          padding: '12px 14px',
          background: HILO.band,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, flexWrap: 'wrap', position: 'relative', zIndex: 1,
        }}>
          <div style={{
            padding: '5px 18px', borderRadius: RADIUS.pill,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
            textAlign: 'center', lineHeight: 1.2,
          }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: 700 }}>Bet, USD</div>
            <input
              value={bet}
              disabled={phase === 'playing'}
              onChange={e => setBet(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{
                width: 56, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none',
                color: COLORS.white, fontSize: 15, fontWeight: 900,
              }}
            />
          </div>
          <button type="button" disabled={phase === 'playing'} onClick={() => setBet(b => Math.max(1, b - 10))} style={{ ...circleBtn, opacity: phase === 'playing' ? 0.5 : 1, cursor: phase === 'playing' ? 'not-allowed' : 'pointer' }}>−</button>
          <button type="button" style={{ ...circleBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} title="筹码">
            {/* chip-stack icon drawn in CSS — the ≡ glyph renders as a dash in this font */}
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
              <span style={{ width: 12, height: 2.5, borderRadius: 2, background: COLORS.white, display: 'block' }} />
            </span>
          </button>
          <button type="button" disabled={phase === 'playing'} onClick={() => setBet(b => b + 10)} style={{ ...circleBtn, opacity: phase === 'playing' ? 0.5 : 1, cursor: phase === 'playing' ? 'not-allowed' : 'pointer' }}>+</button>
          {phase === 'playing' ? (
            <button type="button" onClick={cashOut} disabled={flipping} style={{
              minWidth: isMobile ? 170 : 230, padding: '7px 0', borderRadius: RADIUS.pill,
              background: HILO.cashout, color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.3,
              cursor: flipping ? 'not-allowed' : 'pointer', opacity: flipping ? 0.6 : 1,
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <span>CASHOUT</span>
              <span style={{ fontSize: 12, opacity: 0.92 }}>{round2(bet * cum).toFixed(2)} USD</span>
            </button>
          ) : (
            <button type="button" onClick={startGame} disabled={bet > balance || bet < 1} style={{
              minWidth: isMobile ? 170 : 230, padding: '11px 0', borderRadius: RADIUS.pill,
              background: HILO.bet, color: COLORS.white,
              border: '1px solid rgba(255,255,255,0.35)',
              fontSize: 14, fontWeight: 900, letterSpacing: 1,
              cursor: bet > balance || bet < 1 ? 'not-allowed' : 'pointer',
              opacity: bet > balance || bet < 1 ? 0.55 : 1,
            }}>▷ BET</button>
          )}
        </div>
      </Panel>
  )

  // ---- Spribe-parity desktop skeleton (≥1024), same bones as Free Kick ----
  if (isDesk) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: `calc(100vh - ${LAYOUT.siteHeaderH}px)`, minHeight: 640,
        background: COLORS.bg,
      }}>
        <div style={{
          height: LAYOUT.headerH, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', background: COLORS.panel,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <strong style={{ color: COLORS.text, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>Rating Hi-Lo</strong>
          <span style={{ color: COLORS.green, fontSize: 15, fontWeight: 900 }}>
            {Number(balance ?? 0).toFixed(2)} <span style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 700 }}>USD</span>
          </span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: LAYOUT.feedW, flex: '0 0 auto', minHeight: 0, borderRight: `1px solid ${COLORS.border}` }}>
            <BetFeed bets={feedBets} myBets={[]} online={914} fill />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
            {/* history minis are 46px tall — row grows past 34px, still capped tight */}
            <div style={{ flex: '0 0 auto', minHeight: LAYOUT.historyH }}>
              {historyStrip}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {gameCard}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- stacked layout (<1024): unchanged ----
  return (
    <GameLayout title="Rating Hi-Lo" color={HILO.green}>
      {gameCard}
    </GameLayout>
  )
}
