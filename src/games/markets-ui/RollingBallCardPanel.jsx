// #公期化 单3 (c)：滚球【多桌只读卡体】——四态相位条 + 三球槽 + settle 三态；点盘口只出轻提示。
//
// ⚠ 只读（裁定①）：本件【不接任何钱路】—— 不调 onPick、不碰 onQuickBet/onAddBet、不发任何请求。
//   点击只弹一条 1.6s 的「请进单页投注」轻提示。卡内可投（三窗限盘/死键/即扣/幂等）归单4，
//   那单要先建 markets/rollingball.js 引擎 + RollingBallMarkets 盘口切片 + 多桌钱路与相位判据分叉。
//
// 相位/球槽/四态/持注/settle 三态【全部复用单页同一件】RollingBallPhaseBar（compact 档），
//   判定复用 rollingBallPhase.js 的 phaseStateOf/ballWindowOf —— 与单页零二写、逐态同源。
import { useState } from 'react'
import { RADIUS, COLORS, DERBY } from '../../components/shell/tokens'
import RollingBallPhaseBar from './RollingBallPhaseBar'
import { isBetsLocked } from './rollingBallPhase'

export default function RollingBallCardPanel({ room }) {
  const [hint, setHint] = useState(false)
  const ph = room?.phase ?? 'connecting'
  const revealed = Array.isArray(room?.revealed) ? room.revealed : []
  const isSeg = /^(bet|draw)[123]$/.test(ph) || ph === 'settle'
  const ready = !!room?.connected && !!room?.roundNo && isSeg
  const si = room?.settleInfo?.roundNo === room?.roundNo ? room?.settleInfo : null
  const poke = () => { setHint(true); setTimeout(() => setHint(false), 1600) }

  return (
    <div onClick={poke} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', cursor: 'default', position: 'relative' }}>
      {/* 四态相位条（与单页同一件；compact 去掉剩余池/提示，只留三颗 pill） */}
      <RollingBallPhaseBar
        phase={ready ? ph : 'connecting'} revealed={ready ? revealed : []}
        betsLocked={isBetsLocked(room)} countdownMs={ready ? room?.countdownMs : 0}
        stakedByKey={null} settleResult={si?.yourResult} totalPayout={si?.totalPayout}
        isMobile hasRail={false} compact
      />
      {/* 三球槽（逐球揭示；未开显 ?） */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
        {[0, 1, 2].map((i) => {
          const n = revealed[i]
          const lit = ready && n != null
          return (
            <span key={i} data-card-slot={i} style={{
              width: 34, height: 34, borderRadius: '50%',
              background: lit ? (((n - 1) % 4) < 2 ? DERBY.away : DERBY.home) : 'rgba(255,255,255,0.08)',
              border: lit ? `2px solid ${DERBY.gold}` : '1px dashed rgba(255,255,255,0.3)',
              color: lit ? COLORS.white : DERBY.dim, fontSize: 13, fontWeight: 900,
              fontFamily: "'Space Grotesk', sans-serif",
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
            }}>{lit ? String(n).padStart(2, '0') : '?'}</span>
          )
        })}
      </div>
      {/* 只读说明：常驻一行，点任意处出轻提示 */}
      <div style={{
        textAlign: 'center', padding: '4px 8px', borderRadius: RADIUS.pill,
        background: hint ? 'rgba(255,213,79,0.18)' : 'rgba(0,0,0,0.3)',
        border: `1px solid ${hint ? DERBY.gold : 'rgba(255,255,255,0.14)'}`,
        color: hint ? DERBY.gold : DERBY.dim, fontSize: 10, fontWeight: 800,
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
      }}>{hint ? '请进单页投注' : '本卡只读 · 投注请进单页'}</div>
    </div>
  )
}
