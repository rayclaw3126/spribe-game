# 滚球公期化 · 单1a 实施交接（roundHub 六段相位机）

> 状态：单0 只读盘点已完成、三裁已定、单1a 已开工（引擎 `drawThree` 已落地验证）。
> 本文件是单1a 剩余实施的完整规格，新会话可直接续。**禁改与本单无关的文件；全程简体中文。**

## 战役定案（Ray）
per-player 三球流 → 全服公期**六段制**（七帧）：
`bet1 15s → draw1 5s → bet2 8s → draw2 5s → bet3 8s → draw3 5s + settle 4s`（约 51s）。
期号全服统一、公共历史/路珠/多桌随之解锁、速度房不做。

## 按坑分步单（Ray 认定，本文件只做单1a）
| 单 | 范围 |
|---|---|
| **单1a（本文件）** | roundHub 六段相位机骨架：引擎一次生成三球 + segIdx 状态机 + 七帧广播 + locked 缓冲 + 闸1/闸2 + recoverOrphans 六段 + 残局退 void。**不含玩家下注结算的端点适配**（用现成 settleRound 占位跑通即可）。 |
| 单1b | 下注端点「三窗按球限盘口」（**新钱层逻辑非适配**，窗关球开后收错球注=风控事故级）。盘口白名单**从引擎 hitOf 口径派生**（bet2 窗合法集=只依赖 ball2/ball3 的 key），禁手抄清单。 |
| 单1c | 老局兼容双路径：result 带版本标（或按有无 round_no 前缀区分），历史抽屉/验公平老局走老口径、新局走新口径，老局 21/21 红线 smoke。 |

## 三裁（单1a 硬规格）
1. **① A+ 一次生成三球 + 承诺-揭示保真 + 两道防先知闸**
   - 建局一把 nonce 序列**一次生成整局三球** `[b1,b2,b3]`，只落 `result_hash`（serverSeedHash 承诺）**不落 result 全量**。
   - **闸1（WS 增量）**：`draw1` 帧只带 `ball1`、`draw2` 帧只带 `ball2`、`draw3`+settle 才给 `ball3`；**全量三球 + serverSeed 明文仅在 settle 帧落地**；bet2/bet3 帧 `revealed` 只累加**已开**球。
   - **闸2（GET/:id 最小暴露）**：局未终（status 非 terminal）**完全不返 result 字段**，terminal 后全返（供验公平）。
   - **settle 分段（裁 b）**：draw3 开球 5s + settle 结算展示 4s，**七帧但段仍六个**（settle 是 draw3 尾窗不是新段）。玩家语义「第3球开出→看结果→下局」。
2. **② locked 缓冲**：每加注窗（bet1/bet2/bet3）关后 **`DEFAULT_TIMINGS.lockedMs`(2000ms) 锁帧再开球**，防最后一毫秒注单撞开球。**引现有常量，禁新造数字**。
3. **③ recoverOrphans 六段语义**：bet 段孤儿**退注置 void**、draw/settle 段孤儿**补结**；补结必须走**「整局三球都在 result 里才补」断言**，缺球残局（断电正好卡在生成后写库前）**一律退注置 void，宁退不错结**。此断言进 smoke。
4. **④ 铁律（Ray 补）**：**六段状态机只对滚球房生效，其余 15 房走原三跳链一个字节不动**。smoke 必须有「**非滚球房回归全绿**」断言——改状态机最怕误伤全场。

## 已落地（引擎基础，已验证）
`server/src/game/rollingBall.js` 新增（未 commit）：
```js
// #公期化 A+：一把 rng 连抽整局三球（无放回），一次生成 [b1,b2,b3]。
export function drawThree(rng) {
  const balls = [];
  for (let i = 0; i < 3; i++) balls.push(drawBall(remainingPool(balls), rng));
  return balls;
}
```
验证：`makeSeededRng('testseed','testclient',1)` → `[31,7,43]`，无重复、范围 1-75、复算等价 ✓。
一把 rng 三次 `drawBall`（每次从当前剩余池），与逐球现派逐位等价，只是一次出全。验公平：玩家用同一 `(serverSeed,clientSeed,nonce)` 造同一把 rng 连抽三球即复现。

## roundHub.js 改点（全定位，server/src/ws/roundHub.js）
现状态机 = 固定三跳链：`runBetting(:315)→runLocked(:320,2s)→runDrawn(:335, 一次spin+settleRound+settled)→runIdle`。

1. **滚球 engine 适配对象**：现 engine 接口 `{prefix,MARKETS,isValidMarketKey,hasPush,spin(rng)}`（:58-128）是「一次 spin 返全 hits」。滚球要新接口，建议：
   `{ prefix:'RB', segMode:'triple', drawAll(rng)→[b1,b2,b3], hitsForBalls(balls,bets)→{hits,pushes} }`
   （`hitsForBalls` 复用引擎 `hitOf` 逐球判定，终局把三球所有注的命中汇总给 settleRound）。
2. **ROOM_CONFIGS 加一行**（:161）：
   ```js
   { key:'rollingball', gameName:'rollingball', room:null, prefix:'RB',
     segments:[
       {phase:'bet1',ms:15000,draw:null}, {phase:'draw1',ms:5000,draw:0},
       {phase:'bet2',ms:8000,draw:null},  {phase:'draw2',ms:5000,draw:1},
       {phase:'bet3',ms:8000,draw:null},  {phase:'draw3',ms:5000,draw:2,terminal:true}, // draw3 尾接 settle 4s
     ] }
   ```
   ⚠ 无 segments 的现有 16 房走原 `DEFAULT_TIMINGS` 三跳链，**向后零感**。
3. **makeRoom/建局**（:196-215 + runBetting :250-316）：滚球建局 `drawThree(makeSeededRng(serverSeed,clientSeed,nonce))` 生成三球存 `room.balls`（内存不落库）；INSERT rounds 只落 `result_hash`(=serverSeedHash) 承诺、result NULL。room 新增字段 `segIdx / balls[3]`。
4. **状态机 segIdx 分叉**（核心，:315 入口）：runBetting 入口按 `room.segments` 有无判定——有则走新 `runSegment(room, segIdx)`，无则走原 runLocked/runDrawn 三跳。`runSegment`：
   - bet 段（draw=null）：广播 bet 帧（bet1 带 serverSeedHash 承诺；bet2/bet3 带 `revealed` 累加）→ setTimeout lockedMs 锁帧 → 推 segIdx。
   - draw 段（draw=k 非 terminal）：广播 draw 帧只带 `balls[k]`，**不落 result** → setTimeout ms → 推 segIdx。
   - terminal 段（draw3）：开球 5s 后落全量 result `{revealed:[b1,b2,b3],balls,status:'settled'}` + `serverSeed` 明文 + `settleRound(room, hitsForBalls(...))` 结算全局所有注 + 广播 settle 帧带全量+serverSeed → 结算展示 4s → runIdle（nonce+1 下一期）。
5. **七帧广播 payload 草案**（闸1 体现在字段增量）：
   ```
   bet1:  {type:'phase',phase:'bet1',roundNo,roundId,endsAt,durationMs,serverSeedHash,clientSeed,nonce}  // 只承诺 hash
   draw1: {type:'phase',phase:'draw1',...,ball:b1}                    // 闸1：只 ball1
   bet2:  {type:'phase',phase:'bet2',...,revealed:[b1]}               // 累加已开
   draw2: {type:'phase',phase:'draw2',...,ball:b2}                    // 闸1：只 ball2
   bet3:  {type:'phase',phase:'bet3',...,revealed:[b1,b2]}
   draw3: {type:'phase',phase:'draw3',...,ball:b3}                    // 闸1：只 ball3（此帧尚不给全量/serverSeed）
   settle:{type:'phase',phase:'settle',...,result:{revealed:[b1,b2,b3],balls,status:'settled'},serverSeed}  // 全量+种子仅此帧
   result:{type:'result',roundNo,roundId,yourResult,totalPayout,balanceAfter}  // 定向给有注玩家
   ```
6. **locked 缓冲**（:318-332 runLocked 成例）：每 bet 段关后 lockedMs 锁帧，滚球复用同一 lockedMs 常量。
7. **snapshot 按段**（:524-543 buildSnapshot）：中途进场/重连按 `room.segIdx` **只给已开球**（draw1 后进场只给 `[b1]`），严守闸1——否则绕 WS 增量偷看未开球。
8. **recoverOrphans 六段**（:639-750）：现按 `status IN('betting','drawn')` 二分。六段中间态（前段已 draw 落库？——注意本方案 draw 段不落 result，只 settle 落全量，故 rounds 里滚球局要么 betting（未终）要么 settled（已终），**天然仍是二分**）。孤儿滚球局：betting 状态→退注 void；settled 不算孤儿。**残局断言**：若 result 存在但 `revealed.length < 3`（理论不该有，断电卡在生成后写库前）→ 退注 void。缺球一律退，宁退不错结。

## round.js 改点（server/src/routes/round.js）
- **GET /:id 闸2**（:3088-3105）：现返 `r.result`。改为 **status 非 terminal（betting/playing/drawn）不返 result 字段**，terminal（settled/cashed/bust/void）后全返。⚠ 老 per-player 局不受影响（它们逐球即落已开球，且本改动只影响「局未终时」的暴露；老局验公平走 GET/:id terminal 后全返照旧）——但**为稳妥单1c 再统一双路径**，单1a 只加「非终局捂 result」这一层。

## smoke 断言（单1a 交活 = 老四样 + 下列）
新增/扩 `server/scripts/_speedroom_smoke.mjs` 或新建 `_rollingball_gongqi_smoke.mjs`：
1. **闸1-WS**：签发 JWT 连滚球房 WS，抓 `draw1` 帧断言**无 ball2/ball3**；`bet2` 段进场拉 snapshot 断言**无未开球**。
2. **闸2-HTTP**：局中（非 terminal）GET `/round/:id` 断言**无 result 字段**；settle 后断言全返。
3. **残局退 void**：构造 result `revealed.length<3` 的孤儿局，跑 recoverOrphans 断言**置 void + 退注**。
4. **非滚球房回归全绿**：跑现有 16 房 smoke 断言**全绿**（六段改动未误伤全场）。
5. **六段完整走一局 WS 帧序录制**：连滚球房抓完整七帧序列（bet1→draw1→bet2→draw2→bet3→draw3→settle），贴帧序证明相位机跑通。

## 三个待你（Ray）单1b/1c 再定的点（单1a 不阻塞）
1. 一次生成的 nonce 用法：局级一把 seed+一 nonce（`drawThree` 内一把 rng，验公平最简）—— **本方案已按此落地**（drawThree 一把 rng）。
2. 老 per-player handler 去留：保留只服务老局重放，还是冻结不再新开 per-player 局（单1c 定）。
3. 版本标形式：result 加 `{v:2}` 还是靠 `round_no` 有无区分（单1c 定）。

## 交付格式（老四样 + 单1a 专属）
① git diff --stat ② 上述 5 条 smoke 证据 ③ lint 基线对比（git stash 前后）④ build ⑤ 待真机分层。
**禁 commit 直到 Ray 说收/已验收。** 钱层结算用现成 settleRound（单1a 不改钱层）。老局兼容红线在单1c，但单1a 的闸2 改动不得伤老局验公平（GET/:id terminal 后全返照旧）。
