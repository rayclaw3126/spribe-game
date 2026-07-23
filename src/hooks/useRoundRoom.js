import { useState, useRef, useEffect } from 'react'

// 轮次排期器房间 hook（#43 单2）——把服务器 /ws/rounds 的相位机镜像成 React 状态。
// 服务器权威：相位/期号/开奖结果/结算全由 WS 广播驱动，前端零本地时钟、零本地开奖。
//
// 连 /ws/rounds?token=&game=<backendId>[&room=<房段>]（token 必 encodeURIComponent，拼法照 playerApi.wsUrl 收口模式）。
// #42 单2：第三参 room —— 空/未传 = 该款【标准房】（与房化前同行为）；'15s' 等 = 该房。
//   room 一变即断旧连新，且【同 tick 清空全部房相关状态】（防切房脏帧，见下方 effect 注释）。
// 返回：
//   phase        'connecting' | 'betting' | 'locked' | 'drawn' | 'settled' | 'idle'
//   roundNo      服务器全局期号字符串（SG-YYYYMMDD-NNN / 快房 SG15-…）| null
//   roundId      当期共享轮 id | null —— #42 下注时当【房凭证】传后端（后端据它定位该款哪个房）
//   countdownMs  倒计时（ms）——由 endsAt - Date.now() 本地插值（每 500ms 重算，绝不本地累加），
//                仅 betting/locked/idle 有意义；drawn/settled 归 0
//   drawResult   本期开奖 { n } | null（drawn 后 & 快照 reveal 态；betting/locked 为 null）
//   settleInfo   个人结算 { yourResult:[{key,outcome,payout}], totalPayout, balanceAfter, roundNo, roundId } | null
//                （仅本人有注才收到；【只存不动余额】——余额回写权在调用方动画层）
//   commit       本期承诺/揭晓 { roundNo, serverSeedHash, clientSeed, nonce, serverSeed:string|null }
//   connected    WS 是否 OPEN
//   roomError    'invalid_room' | null —— 服务端 1008 拒房（?room= 认不出）；此时【不重连】，phase='error'
//
// 断线自动重连（指数退避，上限 10s）；重连 onopen 主动 {type:'sync'} 拉快照恢复相位。

// #42 单2：room 为空/未传 → 不拼 &room=，服务端落该款【标准房】（与房化前逐字节同行为）。
// ============ #公期化 单2：六段房（滚球）相位名表 —— 纯加法，其余 9 款永不命中 ============
//
// 滚球标准房是全仓【唯一】的六段房（服务端 roundHub RB_SEGMENTS）：一局七帧
//   bet1 → draw1 → bet2 → draw2 → bet3 → draw3 → settle
// 它的相位名与三跳链（betting/locked/drawn/settled/idle）【零交集】，所以下面两处并入
// 只是给这套新名字开路，9 款的相位名一个都不会落进新分支——行为逐字节不变。
// 同理，segIdx/revealed/betsLocked/ball 四个字段只有六段房的帧才带，9 款的帧里根本没有
// （服务端不发），故对应的 setState 在 9 款上永不触发，连一次多余渲染都不会多。
const SEG_BET_PHASES = new Set(['bet1', 'bet2', 'bet3'])
const SEG_TIMED_PHASES = new Set(['bet1', 'draw1', 'bet2', 'draw2', 'bet3', 'draw3', 'settle'])
const EMPTY_REVEALED = []   // 模块级稳定引用：避免每次重置都造新数组触发下游 effect

function buildRoundsWsUrl(token, game, room) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const base = `${proto}://${window.location.host}/ws/rounds?token=${encodeURIComponent(token)}&game=${encodeURIComponent(game)}`
  return room ? `${base}&room=${encodeURIComponent(room)}` : base
}

export function useRoundRoom(playerToken, game, room) {
  const [phase, setPhase] = useState('connecting')
  const [roundNo, setRoundNo] = useState(null)
  const [roundId, setRoundId] = useState(null)   // #42：当期轮 id —— 下注时当【房凭证】传给后端
  const [countdownMs, setCountdownMs] = useState(0)
  const [drawResult, setDrawResult] = useState(null)
  const [settleInfo, setSettleInfo] = useState(null)
  const [commit, setCommit] = useState(null)
  const [connected, setConnected] = useState(false)
  const [roomError, setRoomError] = useState(null)   // #42：'invalid_room' —— 服务端 1008 拒房，禁重连
  // #公期化 单2：六段房专属（9 款恒为初值，其帧不带这些字段 → setState 永不触发）
  const [segIdx, setSegIdx] = useState(0)            // 当前段下标 0-5
  const [revealed, setRevealed] = useState(EMPTY_REVEALED)   // 已揭示球（闸1：服务端只发已开的）
  const [betsLocked, setBetsLocked] = useState(false)        // bet 窗关后的锁帧缓冲期
  const [lastBall, setLastBall] = useState(null)             // 最近一帧 draw 的球号（舞台定格用）

  const wsRef = useRef(null)
  const endsAtRef = useRef(null)          // 当前 timed 相位的结束时间戳（服务器 ms）；非 timed 相位为 null
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const cdTimerRef = useRef(null)

  // ============ #42 切房零脏帧：房一变就【在渲染中】重置房相关状态 ============
  //
  // 为什么必须在渲染中、而不是在 effect 里：
  //   effect 版的时序是「房变 → 用【旧房状态】渲染 → paint（这一帧就是脏帧）→ effect 跑 → 重置 → 再渲染」。
  //   也就是说 effect 里重置【必然先闪一帧旧房数据】——正是要防的东西。
  //   渲染中 set 是 React 官方的「prop 变化时调整 state」范式：React 立刻重渲染且【不提交中间帧】，零脏帧。
  //
  // 要清的四处（D 段查证）：
  //   · roundNo/roundId/drawResult/settleInfo/commit → 不清则新 tab 下挂着旧房的期号与开奖
  //   · countdownMs → 不清则新 tab 上显示旧房的剩余秒
  //   · endsAtRef（倒计时基准）→ 心跳是【独立 effect】（[] deps，永不随房重建），只读 endsAtRef；
  //     不清就会拿旧房 endsAt 一直倒数（15s 房 tab 上跳 30s 房的秒），且【不会自愈】——最阴的一处。
  //     ⚠ 它是 ref，React 禁止渲染期访问 → 放在下方 WS effect 顶部清（effect 紧跟 paint 执行，
  //       而心跳 500ms 才跳一次，够不着这个窗口；渲染期的 setCountdownMs(0) 已保住首帧干净）。
  //
  // 与 BillDrawer 切 tab 脏帧同族，但处置相反：那边是「防御回落」，这边必须【显式清空】——
  // 旧房数据看着完全合法，只是属于另一个房，回落防不住。
  const roomSig = `${game}|${room ?? ''}`
  const [prevRoomSig, setPrevRoomSig] = useState(roomSig)
  if (prevRoomSig !== roomSig) {
    setPrevRoomSig(roomSig)
    setPhase('connecting')
    setRoundNo(null); setRoundId(null)
    setDrawResult(null); setSettleInfo(null); setCommit(null)
    setRoomError(null); setConnected(false)
    setCountdownMs(0)
    setSegIdx(0); setRevealed(EMPTY_REVEALED); setBetsLocked(false); setLastBall(null)
  }

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
    // #42 切房：清倒计时基准（ref 不能在渲染期碰，故落这里）。不清则心跳会拿旧房 endsAt 继续倒数。
    endsAtRef.current = null

    // 应用一条「相位帧」（phase 广播 / snapshot 共用）到状态。
    function applyPhaseFrame(p, msg) {
      setPhase(p)
      if (msg.roundNo !== undefined) setRoundNo(msg.roundNo)
      // #42：服务端 snapshot/phase 一直都带 roundId（buildSnapshot / runBetting 广播），
      // 房化前没人用故一直被丢掉。现在它是下注的房凭证——后端按它在该款所有房里定位当期房。
      if (msg.roundId !== undefined) setRoundId(msg.roundId)

      // #公期化 单2：六段房字段透传（只在帧真带时 set；9 款的帧不带 → 一次都不触发）。
      //   revealed 是闸1 的唯一出口：服务端只发已开球，前端照单全收即天然不含未开球。
      if (msg.segIdx !== undefined) setSegIdx(msg.segIdx)
      if (Array.isArray(msg.revealed)) setRevealed(msg.revealed)
      if (msg.betsLocked !== undefined) setBetsLocked(!!msg.betsLocked)
      else if (SEG_BET_PHASES.has(p)) setBetsLocked(false)   // bet 帧到达即开窗（锁定由本地倒计时接管）
      if (msg.ball !== undefined) setLastBall(msg.ball)

      // 倒计时基准：timed 相位取 endsAt（快照可能只带 remainingMs，则由本地时钟折算）。
      // 六段房【每一段】都是 timed（含 settle 的 4s 展示窗），故整表并入。
      if (p === 'betting' || p === 'locked' || p === 'idle' || SEG_TIMED_PHASES.has(p)) {
        const endsAt = msg.endsAt != null ? msg.endsAt
          : (msg.remainingMs != null ? Date.now() + msg.remainingMs : null)
        endsAtRef.current = endsAt
        setCountdownMs(endsAt ? Math.max(0, endsAt - Date.now()) : 0)
      } else {
        endsAtRef.current = null
        setCountdownMs(0)
      }

      // 开奖结果：betting（六段房是 bet1）是新一期起点，清空上期开奖/结算；带 result 的帧则填。
      // 六段房：bet1 同时把上一局的球/段号清干净（服务端 bet1 帧带 revealed:[] 已覆盖，此处兜底）。
      if (p === 'betting' || p === 'bet1') {
        setDrawResult(null); setSettleInfo(null)
        if (p === 'bet1') setLastBall(null)
      }
      if (msg.result != null) setDrawResult(msg.result)

      // 承诺/揭晓：betting（六段房 bet1）带 hash/clientSeed/nonce（承诺，无明文）；reveal 态带 serverSeed。
      if (p === 'betting' || p === 'bet1') {
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
      const ws = new WebSocket(buildRoundsWsUrl(playerToken, game, room))
      wsRef.current = ws
      ws.onopen = () => {
        if (cancelled) return
        setConnected(true)
        const wasReconnect = reconnectAttemptRef.current > 0
        reconnectAttemptRef.current = 0
        if (wasReconnect) ws.send(JSON.stringify({ type: 'sync' }))   // 重连补快照
      }
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data) } catch { return } dispatch(m) }
      ws.onclose = (e) => {
        if (cancelled) return
        setConnected(false)
        // #42：1008 = 服务端显式拒房（roomNameOf 认不出 ?room= → close(1008,'invalid_room')）。
        // 这是【永久性】拒绝，重连必然再被踢 → 无条件退避会陷入「连上就踢、退避、再连」死循环，
        // 既刷爆服务端也永远不给用户任何反馈。故认死它：不重连，置 error 态让 UI 说话。
        if (e?.code === 1008) { setRoomError('invalid_room'); setPhase('error'); return }
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
    // 相位/数值全由 WS 分发；重连只依赖 token + game + room（#42：room 一变即断旧连新）
  }, [playerToken, game, room])

  return {
    phase, roundNo, roundId, countdownMs, drawResult, settleInfo, commit, connected, roomError,
    // #公期化 单2 六段房专属（9 款恒 0/[]/false/null，读了也无害）
    segIdx, revealed, betsLocked, lastBall,
  }
}
