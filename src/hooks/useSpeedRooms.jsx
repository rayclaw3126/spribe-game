import { useState, useRef, useEffect, useMemo } from 'react'
import { RADIUS, MONO } from '../components/shell/tokens'
import { useRoundRoom } from './useRoundRoom'

// 速度房（形态A）共享件（#42 单5）——把 5 款各自内联抄了一遍的多房骨架收成单一出处。
//
// 抽件口径：【5 款逐字节相同的才进来；哪怕差一个字的留在各款原地，经回调注入】。
//   这样迁移过程不需要任何「合并差异」的判断，也就没有引入行为差异的机会。
//   进来的：双订阅 / selectedRoomKey / betsByRoomRef / settledRoundsRef / settleInfoRef /
//           betsPlaced / hasLast / lastBetsRef / shownRoundRef / animatedRoundRef /
//           A0 各房换期清注 / D 段未选中房后台结算 / 44px tab 条 / commitSettle / resetRoomView
//   没进来的（逐款不同，留在游戏文件）：
//     · 按期累积状态 xxxByRoom —— 份数 2~3 份、字段与派生函数全不同
//       （号码王 .num/deriveNum、帽子戏法 .dice/deriveRoll、PK10 .ranking/deriveRace、
//        中场 .balls/deriveRound、极速方格 .n）
//     · E 段 未选中房追累积 —— body 完全按款
//     · A 段 选中房换期 UI 清盘 —— 各款要清的 UI 状态不同
//     · uiPhase 相位名 —— ⚠ PK10 是 'racing'，其余是 'drawing'
//     · 舞台 key 挂点 —— 挂点数 1~2 处不等，挂载形态三种（常驻 / 三元 / && 无待命分支）
//     · 切房 A1 effect 本身 —— 留在各款【原位置】（必须在 A 之后跑，见 resetRoomView 注释），
//       件内只出 resetRoomView 供其调用；演出态清理清单逐款不同（帽子戏法多达 4 份）
//
// ⚠ 本件【包着 useRoundRoom 用，不改它】。useRoundRoom / HistoryDrawer 是更底层的共享件，
//   本件与它们是调用关系，不是继承关系。
//
// ⚠ SpeedGrid 特例（后端标准房 room:'30s'，其余 4 款 room:null）在本件里【零特判】：
//   那是后端 rounds.room 列与 roomNameOf 的事。前端 5 款的 registry.rooms[0].key 一律 '30s'，
//   b508655 的 roomNameOf 兜底让两种后端形态都解析到各自标准房，故本件眼里 5 款完全同构。
export function useSpeedRooms({
  G,                    // 该款 registry 条目（读 G.rooms / G.backendId）
  playerToken,
  setServerBalance,     // 钱层，原样透传（D 段回写余额用）
  pushToast,            // 各款自己的 toast（D 段弹「<房名> 命中」用）
}) {
  // ---- 双订阅：两房各一条 WS（未选中的房也连——tab 上要显它的实时期号/倒计时）----
  // ⚠ Rules of Hooks：显式调两次而非 G.rooms.map(...)。房数由 registry 编译期定死，
  //   map 出来的 hook 数量看着可变，既触 eslint 也误导后来者以为能动态增减房。
  const ROOMS = G.rooms                                    // [{key:'30s',label},{key:'15s',label}]
  const [selectedRoomKey, setSelectedRoomKey] = useState(ROOMS[0].key)
  const roomA = useRoundRoom(playerToken, G.backendId, ROOMS[0].key)
  const roomB = useRoundRoom(playerToken, G.backendId, ROOMS[1].key)
  const roomsByKey = useMemo(() => ({ [ROOMS[0].key]: roomA, [ROOMS[1].key]: roomB }), [ROOMS, roomA, roomB])
  // 选中房 = 舞台/盘口/注栏/公平抽屉的唯一真相来源（各款所有 room.* 读的都是它）
  const room = roomsByKey[selectedRoomKey]

  // ---- 注单暂存按房：{roomKey: Map<key, 累计注额>} ----
  // 切走再切回【同一期】，已下的注还在 —— 注是真金白银下进那一房的，切个 tab 就抹掉，
  // 玩家会以为注没了。只在该房自己换期时清（见 A0），禁按 tab 切换一刀 clear。
  const betsByRoomRef = useRef(Object.fromEntries(ROOMS.map((r) => [r.key, new Map()])))
  const betsOf = (k) => betsByRoomRef.current[k] || new Map()
  const betsRef = { get current() { return betsOf(selectedRoomKey) }, set current(m) { betsByRoomRef.current[selectedRoomKey] = m } }

  const [betsPlaced, setBetsPlaced] = useState(() => new Map())
  const [hasLast, setHasLast] = useState(false)   // 是否有上局注单快照（重复钮亮灭）
  const lastBetsRef = useRef(new Map())           // 上局注单快照（重复投注用）

  const shownRoundRef = useRef(null)       // 已进入 betting 的当前期号（换期 reset 判定）
  const animatedRoundRef = useRef(null)    // 已启动开奖动画的期号（每期只演一次）

  // 「本期已处理」判定用 Set —— 两房各自出期号（如 NU- / NU15-，前缀不同天然不撞），
  // 选中房走 finishRound、未选中房走 D 段，两条路共用这一个 Set 防重。
  const settledRoundsRef = useRef(new Set())
  const settleInfoRef = useRef(null)       // 镜像【选中房】settleInfo，供动画结束时读取
  const betsResetRoundRef = useRef({})     // {roomKey: 已清过注单的期号}

  useEffect(() => { settleInfoRef.current = room.settleInfo }, [room.settleInfo])

  // ---- 余额回写的唯一出口（坑1 修正语义，原样搬入，禁"顺手优化"）----
  // ⚠ add 必须收在 hadBet 内：切房时旧房的动画定时器仍会到点跑到调用方的 finishRound，
  //   那时 settleInfoRef 已换成新房的 → hadBet=false → 本次并未消费这期；若仍 add，就把
  //   期号钉成「已处理」，D 段便会跳过它 → 该期余额回写与 toast 双双丢失。不 add 才能让 D 接住。
  //   无注期本就没有 settleInfo，D 的 !si 守卫自然静默，故不漏写；D 只处理非选中房、
  //   且共享 Set 的 has 守卫兜底，两房期号前缀不同天然不撞，故不双写。
  const commitSettle = (rnd, si, hadBet) => {
    if (!hadBet) return
    if (si.balanceAfter != null && !settledRoundsRef.current.has(rnd)) {
      setServerBalance(Number(si.balanceAfter))
    }
    settledRoundsRef.current.add(rnd)
  }

  // ---- A0. 各房换期清各房注单 —— 【两房都跑】，与当前选中哪个 tab 无关 ----
  // 未选中的房也在自转，它换期时它的注单就作废了；若只在选中房跑，切回去会看到上一期
  // （甚至几期前）的注单挂在新期上——比不显示更糟（假注单）。
  useEffect(() => {
    for (const r of ROOMS) {
      const rm = roomsByKey[r.key]
      if (rm.phase !== 'betting' || !rm.roundNo) continue
      if (betsResetRoundRef.current[r.key] === rm.roundNo) continue
      betsResetRoundRef.current[r.key] = rm.roundNo
      const m = betsOf(r.key)
      if (m.size) {
        // 「重复上期」只服务选中房（那是玩家眼前的盘）
        if (r.key === selectedRoomKey) { lastBetsRef.current = new Map(m); setHasLast(true) }
        betsByRoomRef.current[r.key] = new Map()
        if (r.key === selectedRoomKey) setBetsPlaced(new Map())
      }
    }
    // roomsByKey/betsOf 走 refs 与派生值，无需入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.phase, roomA.roundNo, roomB.phase, roomB.roundNo, selectedRoomKey])

  // ---- 切房时本件负责的复位（resetRoomView）----
  // ⚠ 这里【不注册 effect】，只导出一个函数，由各款在自己原来 A1 的位置调用。
  //   原因是执行【顺序】：原实现里 A1 声明在 A 之后，故 A 先跑（把 shownRoundRef 设成新房当期
  //   期号）、A1 后跑（再把它清成 null）。若把 A1 收进本件，本件的 effect 会先于各款所有 effect
  //   注册、从而先于 A 执行，shownRoundRef 的终值就从 null 变成了新房期号 —— 那是行为差异，
  //   在重构单里不许发生（哪怕新行为看着更合理，也该另开单显式改）。故顺序原样保留。
  const resetRoomView = () => {
    setBetsPlaced(new Map(betsOf(selectedRoomKey)))
    shownRoundRef.current = null       // 让各款的 A 对新房当期重新跑一遍（回 betting UI）
    animatedRoundRef.current = null
  }

  // ---- D. 未选中房的后台结算：余额 + WinToast，立即应用 ----
  //   · 不等动画：你没在看那一房，没有动画可等 —— settleInfo 一到就是终局。
  //   · 余额必须写：钱是真扣真派的，不能因为玩家切走了 tab 就不回写（切回来发现余额对不上
  //     会被当成吞钱）。服务端 balanceAfter 是权威快照；两房近同时结算 last-write 可接受，
  //     下一次任一房结算/刷新即自纠。
  //   · toast 文案带房名，否则玩家不知道是哪一房中的。
  //
  // ⚠ 执行顺序说明（单5 抽件时的判定，别当成疏忽）：抽件前 D 声明在各款的 C 之后；收进本件后，
  //   本件所有 effect 都先于各款 effect 注册，故 D 现在跑在各款 A/A1/B/C 之前。判定为【惰性】：
  //   D 只读【非选中房】的 settleInfo，只写余额 / toast / 共享 settledRoundsRef，而 A/A1/B/C
  //   只动选中房的 UI 与相位；两者无数据交叉。唯一的共享物 settledRoundsRef 另一个写入方是
  //   finishRound，它由 setTimeout 触发、不在同一轮 effect flush 内，故不存在竞争。
  //   对比 A1：A1 的顺序【不是】惰性的（它与 A 争 shownRoundRef 的终值），所以 A1 没有收进
  //   本件，只出 resetRoomView 由各款在原位置调用。两者处置不同，是分别判过的结果。
  //   若日后 D 需要读选中房状态、或各款 effect 开始写 settledRoundsRef，本判定即失效，
  //   届时应照 A1 的办法把 D 也交回各款调用。
  useEffect(() => {
    for (const r of ROOMS) {
      if (r.key === selectedRoomKey) continue          // 选中房走 finishRound（动画演完才回写）
      const rm = roomsByKey[r.key]
      const si = rm.settleInfo
      if (!si || !si.roundNo || settledRoundsRef.current.has(si.roundNo)) continue
      settledRoundsRef.current.add(si.roundNo)
      if (si.balanceAfter != null) setServerBalance(Number(si.balanceAfter))
      const win = Number(si.totalPayout || 0)
      if (win > 0) pushToast(`${r.label} 命中`, win)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomA.settleInfo, roomB.settleInfo, selectedRoomKey])

  // ---- 44px 速度 tab 条（形态A）：顶栏下一行，双端同构 ----
  // 每房显 label + 期号短号 + 【该房自己 hook 的】实时倒计时（未选中房也在连，秒数是真的）。
  // 各款放进自己的 topBar 片段；topBar 被 PC/手机两分支共用，故一处插入两端生效。
  // 44px 从中滚区扣，舞台一像素不动。色值由调用方传该款 tokens，本件零硬编码主题色。
  const renderRoomTabs = ({ tokens, isMobile }) => ROOMS.length > 1 && (
    <div style={{
      flex: '0 0 auto', display: 'flex', gap: 6, height: 44, alignItems: 'center',
      padding: isMobile ? '0 12px' : '0 18px', boxSizing: 'border-box',
    }}>
      {ROOMS.map((r) => {
        const rm = roomsByKey[r.key]
        const on = r.key === selectedRoomKey
        const sec = Math.max(0, Math.ceil((rm.countdownMs || 0) / 1000))
        const timed = rm.phase === 'betting' || rm.phase === 'locked' || rm.phase === 'idle'
        // 期号短号：NU-20260722-1604 → #1604（只取序号段，长串在 44px 里塞不下）
        const shortNo = rm.roundNo ? `#${String(rm.roundNo).split('-').pop()}` : '…'
        return (
          <button key={r.key} type="button" onClick={() => setSelectedRoomKey(r.key)} style={{
            flex: '1 1 0', minWidth: 0, height: 34, borderRadius: RADIUS.pill, cursor: 'pointer',
            background: on ? tokens.sel : tokens.strip,
            border: `1px solid ${on ? tokens.sel : tokens.tabBorder ?? 'rgba(255,255,255,0.16)'}`,
            color: on ? tokens.onSel ?? '#083a1b' : tokens.dim,
            fontSize: 12, fontWeight: 900, letterSpacing: 0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '0 8px', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
            <span style={{ fontFamily: MONO, opacity: on ? 0.75 : 0.6, flex: '0 0 auto' }}>{shortNo}</span>
            <span style={{
              fontFamily: MONO, flex: '0 0 auto',
              color: on ? tokens.onSel ?? '#083a1b' : (timed ? tokens.sel : tokens.dim),
            }}>{timed ? `${sec}s` : '—'}</span>
          </button>
        )
      })}
    </div>
  )

  return {
    ROOMS, selectedRoomKey, setSelectedRoomKey, roomsByKey, room, roomA, roomB,
    betsRef, betsOf, betsByRoomRef,
    betsPlaced, setBetsPlaced, hasLast, setHasLast, lastBetsRef,
    shownRoundRef, animatedRoundRef,
    settledRoundsRef, settleInfoRef,
    commitSettle, resetRoomView, renderRoomTabs,
  }
}
