import { memo, useEffect, useRef, useState } from 'react'
import { COLORS, RADIUS, SPACE, AVATAR_COLORS } from './tokens'

// Spribe-style bet feed for the crash games — All Bets / My Bets / Top.
// Pure presentation over the host's existing round data: fake rows never
// touch the balance, and their cash-out pacing rides the host's rAF loop
// (rows arrive already-settled through the `bets` prop).

function mask(name) {
  if (name.startsWith('你')) return name
  if (name.length <= 2) return name[0] + '***'
  return `${name[0]}***${name[name.length - 1]}`
}

function Avatar({ name, you }) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  const bg = you ? COLORS.green : AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
  return (
    <span style={{
      width: 18, height: 18, borderRadius: RADIUS.pill, background: bg,
      color: COLORS.white, fontSize: 10, fontWeight: 900,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      flex: '0 0 auto', textTransform: 'uppercase',
    }}>
      {name[0]}
    </span>
  )
}

const money = n => Number(n).toFixed(2)

function Row({ left, mid, right, you, dim }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SPACE.sm,
      padding: `5px ${SPACE.sm}px`,
      borderRadius: SPACE.sm,
      background: you ? COLORS.feedYouBg : COLORS.surface,
      border: `1px solid ${you ? COLORS.feedYouBorder : COLORS.border}`,
      opacity: dim ? 0.55 : 1,
      fontSize: 12, fontWeight: 700,
      minWidth: 0,
    }}>
      {left}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, color: COLORS.text, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{mid}</span>
      <span style={{ flex: '0 0 auto', textAlign: 'right' }}>{right}</span>
    </div>
  )
}

// fill=true: edge-flush full-height sidebar variant (no card chrome, the
// row list flex-grows and scrolls internally); otherwise a rounded card
// whose list scrolls within maxHeight.
function BetFeed({ bets, myBets, online, maxHeight, fill = false }) {
  const [tab, setTab] = useState('all')
  // Session-best wins accumulate as cashed rows stream through `bets`.
  const seenRef = useRef(new Set())
  const [topWins, setTopWins] = useState([])
  useEffect(() => {
    const fresh = bets.filter(b => b.status === 'cashed' && !seenRef.current.has(b.id))
    if (!fresh.length) return
    fresh.forEach(b => seenRef.current.add(b.id))
    setTopWins(t => [...t, ...fresh.map(b => ({ id: b.id, name: b.name, you: !!b.you, mult: b.target, win: b.payout }))]
      .sort((a, b) => b.win - a.win)
      .slice(0, 10))
  }, [bets])

  const tabs = [['all', 'All Bets'], ['my', 'My Bets'], ['top', 'Top']]
  return (
    <div style={{
      background: COLORS.panel,
      border: fill ? 'none' : `1.5px solid ${COLORS.borderLight}`,
      borderRadius: fill ? 0 : RADIUS.panel,
      padding: SPACE.md,
      boxSizing: 'border-box',
      minWidth: 0,
      ...(fill ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : {}),
    }}>
      <div style={{ display: 'flex', gap: SPACE.xs, background: COLORS.bg, border: `1px solid ${COLORS.borderLight}`, borderRadius: RADIUS.pill, padding: 3, marginBottom: SPACE.sm }}>
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} style={{
            flex: 1, padding: '4px 0', borderRadius: RADIUS.pill, border: 'none',
            fontSize: 12, fontWeight: 800,
            background: tab === key ? COLORS.surface : 'transparent',
            color: tab === key ? COLORS.text : COLORS.textFaint,
            cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', color: COLORS.textFaint, fontSize: 11, fontWeight: 700, margin: `0 2px ${SPACE.sm}px` }}>
        <span>本局总注数 {bets.length}</span>
        {online != null && <span style={{ color: COLORS.green }}>{online} 在线</span>}
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', scrollbarWidth: 'thin',
        ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight }),
      }}>
        {tab === 'all' && bets.map(b => (
          <Row key={b.id} you={b.you} dim={b.status === 'crashed'}
            left={<Avatar name={b.name} you={b.you} />}
            mid={<><span>{b.you ? '你' : mask(b.name)}</span><span style={{ color: COLORS.textFaint, fontWeight: 600 }}>${money(b.bet)}</span></>}
            right={b.status === 'cashed'
              ? <span style={{ color: COLORS.feedWin }}>{Number(b.target).toFixed(2)}×<div style={{ color: COLORS.greenSoft, fontWeight: 800 }}>+${money(b.payout)}</div></span>
              : b.status === 'crashed'
                ? <span style={{ color: COLORS.feedLose }}>爆</span>
                : <span style={{ color: COLORS.feedLive }}>进行中</span>}
          />
        ))}

        {tab === 'my' && (myBets.length ? myBets.map((m, i) => (
          <Row key={myBets.length - i} you={m.win > 0} dim={m.win <= 0}
            left={<Avatar name="你" you />}
            mid={<><span>${money(m.bet)}</span><span style={{ color: COLORS.textFaint, fontWeight: 600 }}>{m.mult > 0 ? `${Number(m.mult).toFixed(2)}×` : '—'}</span></>}
            right={m.win > 0
              ? <span style={{ color: COLORS.feedWin }}>+${money(m.win)}</span>
              : <span style={{ color: COLORS.feedLose }}>-${money(m.bet)}</span>}
          />
        )) : <Empty />)}

        {tab === 'top' && (topWins.length ? topWins.map((t, i) => (
          <Row key={t.id} you={t.you}
            left={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: COLORS.textFaint, fontSize: 10, width: 14 }}>{i + 1}</span>
              <Avatar name={t.name} you={t.you} />
            </span>}
            mid={<><span>{t.you ? '你' : mask(t.name)}</span><span style={{ color: COLORS.textFaint, fontWeight: 600 }}>{Number(t.mult).toFixed(2)}×</span></>}
            right={<span style={{ color: COLORS.feedWin }}>+${money(t.win)}</span>}
          />
        )) : <Empty />)}
      </div>
    </div>
  )
}

function Empty() {
  return <div style={{ color: COLORS.textFaint, fontSize: 12, textAlign: 'center', padding: '18px 0' }}>暂无记录</div>
}

export default memo(BetFeed)
