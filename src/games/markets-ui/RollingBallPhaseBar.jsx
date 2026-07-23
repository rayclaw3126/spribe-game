// #公期化 单2：滚球六段相位共用件（球次条四态 + 跨窗持注 + settle 逐键三态/派彩）——单一出处。
//
// 从 RollingBall.jsx 的 `ballSwitch` 机械切片：三颗球 pill + 剩余池徽标 + 「赔率已按剩余池重算」
// 提示，容器/内边距/字号/圆角/配色【逐字节照搬】，只把状态派生从「本地相位机」换成「服务端六段帧」。
// 桌面/手机两分支各自 import 本件（原页里 ballSwitch 就是双分支共引的同一个 const，抽件后升级为
// 跨文件单一出处）；单3 多桌 TableCard 直接 import 同一件，传 compact 即可，禁二写。
//
// 纯数据驱动：零 hook、零 API、零 ref、零副作用。所有状态由 props 喂进来。
//
// 四态（裁定：判定只在 phaseStateOf 一处）：
//   betting  第N球 ◀ 押注中 Ns   —— 该球的加注窗开着
//   locked   第N球 封盘           —— 窗关后的 lockedMs 缓冲（服务端 betsLocked=true）
//   drawing  第N球 开球中…        —— draw_N 段，球正在滚
//   done     第N球 NN            —— 已开出（settle 段三颗全 done）
//   wait     第N球               —— 还没轮到，置灰不可投
import { RADIUS, DERBY } from '../../components/shell/tokens'
// 三个判定（窗号派生 / 复合 key / 四态）在 rollingBallPhase.js 单一出处，本件只负责画。
import { ballWindowOf, ballIdxOfKey, phaseStateOf } from './rollingBallPhase'

// pill 配色：done=绿、betting/locked=选中金、drawing=橙、wait=灰
function pillStyle(state, hasRail) {
  const active = state === 'betting' || state === 'locked'
  const drawing = state === 'drawing'
  const done = state === 'done'
  return {
    padding: '4px 12px', borderRadius: RADIUS.pill,
    background: active ? DERBY.sel : drawing ? 'rgba(242,140,23,0.16)' : done ? 'rgba(53,208,127,0.14)' : 'rgba(0,0,0,0.35)',
    color: active ? '#083a1b' : drawing ? DERBY.orange : done ? DERBY.sel : DERBY.dim,
    border: `1px solid ${active ? DERBY.sel : drawing ? DERBY.orange : done ? 'rgba(53,208,127,0.45)' : 'rgba(255,255,255,0.2)'}`,
    fontSize: hasRail ? 13 : 11, fontWeight: 900, letterSpacing: 0.3, whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 3,
  }
}

/**
 * @param {string}   phase        服务端相位名 bet1/draw1/…/settle（连接中传 'connecting'）
 * @param {number[]} revealed     已开球（服务端只发已开的，闸1 的唯一出口）
 * @param {boolean}  betsLocked   bet 窗关后的锁帧缓冲
 * @param {number}   countdownMs  当前段剩余（hook 由 endsAt 插值）
 * @param {Map}      stakedByKey  本局已投：Map<复合key, 注额>（跨窗保留整局）
 * @param {Array}    settleResult settle 段个人三态明细 [{key,outcome,payout}]
 * @param {number}   totalPayout  settle 段本人总派彩
 * @param {boolean}  isMobile/hasRail  尺寸档（与原页同门控）
 * @param {boolean}  compact      多桌 TableCard 用（去掉剩余池/提示，只留三颗 pill）
 */
export default function RollingBallPhaseBar({
  phase, revealed, betsLocked, countdownMs,
  stakedByKey, settleResult, totalPayout,
  isMobile, hasRail, compact = false,
}) {
  const rev = Array.isArray(revealed) ? revealed : []
  const cur = ballWindowOf(rev)
  const secs = Math.max(0, Math.ceil((countdownMs || 0) / 1000))
  const settled = phase === 'settle'
  // settle 段：把个人三态明细按球分组（key 形如 b2:red），供 pill 上贴本球派彩
  const payByBall = [0, 0, 0]
  const hitByBall = [0, 0, 0]
  if (settled && Array.isArray(settleResult)) {
    for (const r of settleResult) {
      const bi = ballIdxOfKey(r.key)
      if (bi < 0 || bi > 2) continue
      payByBall[bi] = Math.round((payByBall[bi] + Number(r.payout || 0)) * 100) / 100
      if (r.outcome && r.outcome !== 'lose') hitByBall[bi] += 1
    }
  }
  // 本局已投：按球汇总（跨窗持注的可视化——bet1 投过的注在 bet2/bet3 窗里仍看得见）
  const stakeByBall = [0, 0, 0]
  if (stakedByKey && typeof stakedByKey.forEach === 'function') {
    stakedByKey.forEach((amt, k) => {
      const bi = ballIdxOfKey(k)
      if (bi >= 0 && bi <= 2) stakeByBall[bi] = Math.round((stakeByBall[bi] + Number(amt || 0)) * 100) / 100
    })
  }

  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: isMobile ? 5 : 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => {
        const st = phaseStateOf(i, { phase, revealed: rev, betsLocked })
        const n = rev[i]
        const tail = st === 'done' && n != null ? ` ${String(n).padStart(2, '0')}`
          : st === 'betting' ? ' ◀ 押注中'
            : st === 'locked' ? ' 封盘'
              : st === 'drawing' ? ' 开球中…'
                : ''
        return (
          <span key={i} data-ball={i} data-state={st} style={pillStyle(st, hasRail)}>
            第{i + 1}球{tail}
            {/* 押注中：秒数定宽（tabular 等宽 + minWidth），13→9→1 秒不抖，pill 宽度恒定 */}
            {st === 'betting' && (
              <span data-cd style={{
                fontFamily: "'Space Grotesk', sans-serif", fontVariantNumeric: 'tabular-nums',
                display: 'inline-block', minWidth: hasRail ? 20 : 17, textAlign: 'right',
              }}>{secs}s</span>
            )}
            {/* 跨窗持注：该球已投额（未 settle 时显示，settle 后让位给派彩） */}
            {!settled && stakeByBall[i] > 0 && (
              <span data-staked={i} style={{
                padding: '0 5px', borderRadius: RADIUS.pill, fontSize: hasRail ? 10 : 9, fontWeight: 900,
                background: st === 'betting' || st === 'locked' ? 'rgba(0,0,0,0.28)' : 'rgba(255,213,79,0.18)',
                color: st === 'betting' || st === 'locked' ? '#083a1b' : DERBY.gold,
              }}>${stakeByBall[i]}</span>
            )}
            {/* settle 逐球三态：命中贴 +派彩（绿），有注未中贴 —（暗） */}
            {settled && stakeByBall[i] > 0 && (
              <span data-settle={i} style={{
                padding: '0 5px', borderRadius: RADIUS.pill, fontSize: hasRail ? 10 : 9, fontWeight: 900,
                background: hitByBall[i] > 0 ? 'rgba(53,208,127,0.22)' : 'rgba(0,0,0,0.3)',
                color: hitByBall[i] > 0 ? DERBY.sel : DERBY.dim,
              }}>{hitByBall[i] > 0 ? `+$${payByBall[i]}` : '—'}</span>
            )}
          </span>
        )
      })}

      {compact ? null : (
        <>
          {/* 剩余池收缩可视化：75→74→73 每球定后跳动（key 由值驱动，CSS 无 rAF）
              #47 刀1：桌面放大档改挂主盘【组头】行（见原页 poolBadge）；手机仍留在球次条内，逐位不动。 */}
          {!hasRail && <PoolBadge cur={cur} />}
          {settled && totalPayout > 0 ? (
            <span style={{ marginLeft: 4, color: DERBY.sel, fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap' }}>
              本局派彩 ${Number(totalPayout).toFixed(2)}
            </span>
          ) : cur > 0 && !settled ? (
            <span style={{ color: DERBY.orange, fontSize: 9, fontWeight: 800, whiteSpace: 'nowrap' }}>
              赔率已按剩余池重算
            </span>
          ) : null}
        </>
      )}
    </div>
  )
}

// 剩余池徽标（桌面放大档由原页挂到组头，故单独导出）
export function PoolBadge({ cur }) {
  return (
    <span style={{
      marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: RADIUS.pill,
      background: 'rgba(0,0,0,0.35)', border: `1px solid ${DERBY.gold}`,
      color: DERBY.gold, fontSize: 10, fontWeight: 900, whiteSpace: 'nowrap',
    }}>剩余池 <span key={75 - cur} style={{ display: 'inline-block', animation: 'rbPoolBump 0.4s ease-out', fontFamily: "'Space Grotesk', sans-serif", fontSize: 12 }}>{75 - cur}</span></span>
  )
}
