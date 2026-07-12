import { useState, useRef, useEffect } from 'react'

// 轮次排期器房间 hook（#43 单2）——把服务器 /ws/rounds 的相位机镜像成 React 状态。
// 服务器权威：相位/期号/开奖结果/结算全由 WS 广播驱动，前端零本地时钟、零本地开奖。
//
// 连 /ws/rounds?token=&game=<backendId>（token 必 encodeURIComponent，拼法照 playerApi.wsUrl 收口模式）。
// 返回：
//   phase        'connecting' | 'betting' | 'locked' | 'drawn' | 'settled' | 'idle'
//   roundNo      服务器全局期号字符串（SG-YYYYMMDD-NNN）| null
//   countdownMs  倒计时（ms）——由 endsAt - Date.now() 本地插值（每 500ms 重算，绝不本地累加），
//                仅 betting/locked/idle 有意义；drawn/settled 归 0
//   drawResult   本期开奖 { n } | null（drawn 后 & 快照 reveal 态；betting/locked 为 null）
//   settleInfo   个人结算 { yourResult:[{key,outcome,payout}], totalPayout, balanceAfter, roundNo, roundId } | null
//                （仅本人有注才收到；【只存不动余额】——余额回写权在调用方动画层）
//   commit       本期承诺/揭晓 { roundNo, serverSeedHash, clientSeed, nonce, serverSeed:string|null }
//   connected    WS 是否 OPEN
//
// 断线自动重连（指数退避，上限 10s）；重连 onopen 主动 {type:'sync'} 拉快照恢复相位。

function buildRoundsWsUrl(token, game) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/rounds?token=${encodeURIComponent(token)}&game=${encodeURIComponent(game)}`
}

export function useRoundRoom(playerToken, game) {
  const [phase, setPhase] = useState('connecting')
  const [roundNo, setRoundNo] = useState(null)
  const [countdownMs, setCountdownMs] = useState(0)
  const [drawResult, setDrawResult] = useState(null)
  const [settleInfo, setSettleInfo] = useState(null)
  const [commit, setCommit] = useState(null)
  const [connected, setConnected] = useState(false)

  const wsRef = useRef(null)
  const endsAtRef = useRef(null)          // 当前 timed 相位的结束时间戳（服务器 ms）；非 timed 相位为 null
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const cdTimerRef = useRef(null)

  // 倒计时：单一 500ms 心跳，永远从 endsAt 重算剩余（不累加，避免漂移/后台节流误差）。
  useEffect(() => {
    cdTimerRef.current = setInterval(() => {
      const e = endsAtRef.current
      setCountdownMs(e ? Math.max(0, e - Date.now()) : 0)
    }, 500)
    return () => { if (cdTimerRef.current) { clearInterval(cdTimerRef.current); cdTimerRef.current = null } }
  }, [])

  useEffect(() => {
    if (!playerToken) return undefined
    let cancelled = false

    // 应用一条「相位帧」（phase 广播 / snapshot 共用）到状态。
    function applyPhaseFrame(p, msg) {
      setPhase(p)
      if (msg.roundNo !== undefined) setRoundNo(msg.roundNo)

      // 倒计时基准：timed 相位取 endsAt（快照可能只带 remainingMs，则由本地时钟折算）。
      if (p === 'betting' || p === 'locked' || p === 'idle') {
        const endsAt = msg.endsAt != null ? msg.endsAt
          : (msg.remainingMs != null ? Date.now() + msg.remainingMs : null)
        endsAtRef.current = endsAt
        setCountdownMs(endsAt ? Math.max(0, endsAt - Date.now()) : 0)
      } else {
        endsAtRef.current = null
        setCountdownMs(0)
      }

      // 开奖结果：betting 是新一期起点，清空上期开奖/结算；drawn/settled/idle 带 result 则填。
      if (p === 'betting') { setDrawResult(null); setSettleInfo(null) }
      if (msg.result != null) setDrawResult(msg.result)

      // 承诺/揭晓：betting 带 hash/clientSeed/nonce（承诺，无明文）；reveal 态带 serverSeed。
      if (p === 'betting') {
        setCommit({ roundNo: msg.roundNo, serverSeedHash: msg.serverSeedHash ?? null, clientSeed: msg.clientSeed ?? null, nonce: msg.nonce ?? null, serverSeed: null })
      } else if (msg.serverSeed || msg.serverSeedHash) {
        setCommit((c) => ({
          roundNo: msg.roundNo ?? c?.roundNo ?? null,
          serverSeedHash: msg.serverSeedHash ?? c?.serverSeedHash ?? null,
          clientSeed: msg.clientSeed ?? c?.clientSeed ?? null,
          nonce: msg.nonce ?? c?.nonce ?? null,
          serverSeed: msg.serverSeed ?? c?.serverSeed ?? null,
        }))
      }
    }

    function dispatch(msg) {
      switch (msg.type) {
        case 'hello':
          // hello 只带初始 balance；hook 不写余额（余额回写权在动画层/App 初值），忽略。
          break
        case 'snapshot':
          applyPhaseFrame(msg.phase, msg)
          break
        case 'phase':
          applyPhaseFrame(msg.phase, msg)
          break
        case 'result':
          // 个人结算：只存，绝不在此写 setServerBalance。
          setSettleInfo({
            roundNo: msg.roundNo, roundId: msg.roundId,
            yourResult: msg.yourResult || [], totalPayout: msg.totalPayout, balanceAfter: msg.balanceAfter,
          })
          break
        default:
          break
      }
    }

    function connect() {
      if (cancelled) return
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return
      const ws = new WebSocket(buildRoundsWsUrl(playerToken, game))
      wsRef.current = ws
      ws.onopen = () => {
        if (cancelled) return
        setConnected(true)
        const wasReconnect = reconnectAttemptRef.current > 0
        reconnectAttemptRef.current = 0
        if (wasReconnect) ws.send(JSON.stringify({ type: 'sync' }))   // 重连补快照
      }
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data) } catch { return } dispatch(m) }
      ws.onclose = () => {
        if (cancelled) return
        setConnected(false)
        const attempt = reconnectAttemptRef.current + 1
        reconnectAttemptRef.current = attempt
        reconnectTimerRef.current = setTimeout(connect, Math.min(10000, 1000 * Math.pow(2, attempt - 1)))
      }
      ws.onerror = () => {}
    }
    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.onmessage = null; wsRef.current.close() }
    }
    // 相位/数值全由 WS 分发；重连只依赖 token + game
  }, [playerToken, game])

  return { phase, roundNo, countdownMs, drawResult, settleInfo, commit, connected }
}
