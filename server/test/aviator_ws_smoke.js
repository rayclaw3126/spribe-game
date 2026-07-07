// Aviator WS 冒烟测试：连一次真实房间，走完一整局 betting -> flying -> crashed，
// 本地重算校验「可验证公平」的三件事：
//   1. sha256(revealed serverSeed) === betting 阶段广播的 commitHash
//      （证明 serverSeed 不是事后编的，跟开局承诺的是同一个）。
//   2. generateCrash(serverSeed, clientSeed, nonce) 本地重算 === 广播的 crashPoint
//      （证明崩盘点确实是由 seed 派生出来的，不是服务端临时拍脑袋定的）。
//   3. crashed 之前收到的所有消息里都不含 serverSeed 字段
//      （证明 reveal 之前私密种子没有泄露）。
// 另外顺带校验 tick 流单调上升、且最后一个 tick 的 multiplier <= crashPoint。
//
// 用法：先 `node src/index.js` 起服务，再 `node test/aviator_ws_smoke.js`。
import WebSocket from 'ws';
import crypto from 'crypto';
import { generateCrash } from '../src/game/aviator.js';

const WS_URL = 'ws://127.0.0.1:4000/ws/aviator';
const TIMEOUT_MS = 20000;

function fail(msg) {
  console.error(`❌ 断言失败：${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function main() {
  const ws = new WebSocket(WS_URL);

  let betting = null; // { roundId, nonce, clientSeed, commitHash, waitMs }
  const ticks = [];
  let crashed = null; // { roundId, crashPoint, serverSeed, clientSeed, nonce }
  let sawServerSeedBeforeCrash = false;

  const timeoutHandle = setTimeout(() => {
    fail(`超时（${TIMEOUT_MS}ms）：没能在限定时间内走完一整局`);
  }, TIMEOUT_MS);
  timeoutHandle.unref?.();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      fail(`收到的消息不是合法 JSON：${raw.toString()}`);
      return;
    }

    if (msg.type === 'crashed') {
      crashed = msg;
      finish();
      return;
    }

    // crashed 之前收到的任何消息都不应该带 serverSeed 字段。
    if (Object.prototype.hasOwnProperty.call(msg, 'serverSeed')) {
      sawServerSeedBeforeCrash = true;
    }

    if (msg.type === 'hello') {
      console.log(`[recv] hello phase=${msg.phase}`);
      return;
    }

    if (msg.type === 'betting') {
      // 只关心「下一句 betting」，跳过可能已经在飞行/开奖中的旧局，
      // 保证我们从头追踪的是完整一局。
      betting = msg;
      ticks.length = 0;
      console.log(
        `[recv] betting roundId=${msg.roundId} nonce=${msg.nonce} clientSeed=${msg.clientSeed} commitHash=${msg.commitHash}`,
      );
      return;
    }

    if (msg.type === 'tick') {
      if (!betting) return; // 还没追踪到这局的 betting，忽略
      ticks.push(msg.multiplier);
      return;
    }
  });

  ws.on('error', (err) => {
    fail(`WebSocket 连接错误：${err.message}`);
  });

  function finish() {
    clearTimeout(timeoutHandle);
    ws.close();

    assert(betting, '没有收到 betting 消息');
    assert(crashed, '没有收到 crashed 消息');
    assert(
      !Object.prototype.hasOwnProperty.call(betting, 'serverSeed'),
      'betting 消息里不应该出现 serverSeed 字段',
    );
    assert(!sawServerSeedBeforeCrash, 'crashed 之前的消息里出现了 serverSeed 字段（泄露！）');

    // 1) commitHash 校验：sha256(revealed serverSeed) 必须等于 betting 阶段广播的 commitHash
    const recomputedHash = crypto
      .createHash('sha256')
      .update(crashed.serverSeed)
      .digest('hex');
    assert(
      recomputedHash === betting.commitHash,
      `sha256(serverSeed) 重算结果 ${recomputedHash} 与 betting 阶段的 commitHash ${betting.commitHash} 不一致`,
    );
    console.log(
      `[verify] sha256(revealed serverSeed) === commitHash ✓ (${recomputedHash})`,
    );

    // 2) crashPoint 重算校验：用 reveal 的 serverSeed + clientSeed + nonce 本地重算
    const recomputedCrash = generateCrash(
      crashed.serverSeed,
      crashed.clientSeed,
      crashed.nonce,
    );
    assert(
      recomputedCrash === crashed.crashPoint,
      `本地 generateCrash 重算结果 ${recomputedCrash} 与广播的 crashPoint ${crashed.crashPoint} 不一致`,
    );
    console.log(
      `[verify] generateCrash(serverSeed, clientSeed, nonce) 本地重算 === crashPoint ✓ (${recomputedCrash})`,
    );

    // 3) tick 流单调上升 + 最后一个 tick <= crashPoint
    assert(ticks.length > 0, '没有收到任何 tick 消息');
    for (let i = 1; i < ticks.length; i += 1) {
      assert(
        ticks[i] >= ticks[i - 1],
        `tick 流不是单调上升：ticks[${i - 1}]=${ticks[i - 1]} -> ticks[${i}]=${ticks[i]}`,
      );
    }
    const lastTick = ticks[ticks.length - 1];
    assert(
      lastTick <= crashed.crashPoint,
      `最后一个 tick 的倍数 ${lastTick} 超过了 crashPoint ${crashed.crashPoint}`,
    );
    console.log(
      `[verify] tick 流单调上升 ✓，共 ${ticks.length} 个点，最后一个 tick=${lastTick} <= crashPoint=${crashed.crashPoint} ✓`,
    );

    console.log(
      `[recv] crashed roundId=${crashed.roundId} crashPoint=${crashed.crashPoint} nonce=${crashed.nonce} serverSeed(reveal)=${crashed.serverSeed}`,
    );

    console.log('✅ AVIATOR WS SMOKE 全绿');
    process.exit(0);
  }
}

main().catch((err) => {
  fail(`未捕获异常：${err.stack || err.message}`);
});
