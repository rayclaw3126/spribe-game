// #41 单8：中奖庆祝粒子引擎（纯 canvas，无 React、无引擎耦合）。
// 单实例喂给一块共享覆盖 canvas，host 单 rAF 驱动；播完即停（tick 返回 false → host 熄火）。
// 坐标全用 CSS 像素（host 每帧按 dpr 变换 + 清屏）。禁每桌开引擎——所有桌共用此一份。
const TAU = Math.PI * 2
const CONFETTI = ['#ffd54f', '#4ade80', '#35d07f', '#f28c17', '#ff5d8f', '#25b1f0', '#ffffff']
const GOLD = '#ffd54f'
const rand = (a, b) => a + Math.random() * (b - a)

export function createEngine() {
  let parts = []
  let last = 0

  // —— 小中：金币一迸（rect 上沿中心炸开，重力回落）——
  function coins(cx, cy, n = 15) {
    for (let i = 0; i < n; i++) parts.push({
      k: 'coin', x: cx, y: cy, vx: rand(-150, 150), vy: rand(-400, -210),
      g: 900, r: rand(5, 8), spin: rand(0, TAU), vspin: rand(6, 14), t: 0, ttl: rand(0.7, 1.05),
    })
  }
  // —— 金额滚字：$0→$X 上浮计数（roll 秒内数完，随后 hold+fade）——
  function amount(cx, cy, target) {
    parts.push({ k: 'amount', x: cx, y: cy, vy: -48, target: Number(target) || 0, t: 0, ttl: 1.5, roll: 0.6 })
  }
  // —— 大中：桌顶彩花喷发（向上炸开重力回落，彩色小旗）——
  function burst(cx, cy, n = 28) {
    for (let i = 0; i < n; i++) parts.push({
      k: 'flake', x: cx, y: cy, vx: rand(-170, 170), vy: rand(-430, -250),
      g: 720, w: rand(5, 9), h: rand(8, 13), c: CONFETTI[(Math.random() * CONFETTI.length) | 0],
      spin: rand(0, TAU), vspin: rand(-9, 9), t: 0, ttl: rand(0.9, 1.4),
    })
  }
  // —— 爆中：全屏彩带雨（顶沿横铺下落带摆动）——
  function rain(w, h, n = 90) {
    for (let i = 0; i < n; i++) parts.push({
      k: 'flake', x: rand(0, w), y: rand(-h * 0.5, -8), vx: rand(-35, 35), vy: rand(120, 240),
      g: 30, sway: rand(0.6, 1.4), swf: rand(1.5, 3), w: rand(5, 10), h: rand(8, 15),
      c: CONFETTI[(Math.random() * CONFETTI.length) | 0], spin: rand(0, TAU), vspin: rand(-7, 7),
      t: 0, ttl: rand(2.4, 3.6), _fs: 1,   // _fs=全屏标记（host 判全屏效果占用）
    })
  }
  // —— 爆中：BIG WIN 金字（中区 scale-in → hold → fade）——
  function bigWin(w, h) {
    parts.push({ k: 'bigwin', x: w / 2, y: h * 0.4, t: 0, ttl: 2.2, _fs: 1 })
  }

  function drawCoin(ctx, p, a) {
    ctx.globalAlpha = a
    ctx.fillStyle = GOLD
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, Math.max(1.2, p.r * Math.abs(Math.cos(p.spin))), p.r, 0, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = a * 0.9; ctx.lineWidth = 1; ctx.strokeStyle = '#b8860b'; ctx.stroke()
  }
  function drawFlake(ctx, p, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.spin)
    ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore()
  }
  function drawAmount(ctx, p, a) {
    const val = p.target * Math.min(1, p.t / p.roll)
    ctx.globalAlpha = a
    ctx.font = '900 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(`$${val.toFixed(2)}`, p.x, p.y)
    ctx.fillStyle = GOLD; ctx.fillText(`$${val.toFixed(2)}`, p.x, p.y)
  }
  function drawBigWin(ctx, p) {
    const sc = p.t < 0.28 ? p.t / 0.28 : 1
    const a = p.t > 1.6 ? Math.max(0, 1 - (p.t - 1.6) / 0.6) : 1
    ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.scale(sc, sc)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 76px system-ui, sans-serif'
    const grad = ctx.createLinearGradient(0, -40, 0, 40)
    grad.addColorStop(0, '#fff3c4'); grad.addColorStop(0.5, GOLD); grad.addColorStop(1, '#f28c17')
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText('BIG WIN', 0, 0)
    ctx.fillStyle = grad; ctx.fillText('BIG WIN', 0, 0)
    ctx.restore()
  }

  // host 每帧调用：now = rAF 时间戳（ms）。推进 + 绘制 + 剔除；返回是否仍有粒子。
  function tick(ctx, w, h, now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    ctx.clearRect(0, 0, w, h)
    const next = []
    for (const p of parts) {
      p.t += dt
      if (p.t >= p.ttl) continue
      if (p.k === 'coin' || p.k === 'flake') {
        p.vy += (p.g || 0) * dt
        if (p.sway) p.vx = Math.sin(p.t * p.swf) * p.sway * 40
        p.x += p.vx * dt; p.y += p.vy * dt; p.spin += p.vspin * dt
        if (p.k === 'flake' && p._fs && p.y > h + 20) continue   // 雨落屏外即除
      } else if (p.k === 'amount') {
        p.y += p.vy * dt
      }
      const fade = p.k === 'bigwin' ? 1 : (p.k === 'amount'
        ? (p.t > 1.0 ? Math.max(0, 1 - (p.t - 1.0) / 0.5) : 1)
        : Math.max(0, 1 - Math.max(0, p.t - p.ttl * 0.7) / (p.ttl * 0.3)))
      if (p.k === 'coin') drawCoin(ctx, p, fade)
      else if (p.k === 'flake') drawFlake(ctx, p, fade)
      else if (p.k === 'amount') drawAmount(ctx, p, fade)
      else if (p.k === 'bigwin') drawBigWin(ctx, p)
      next.push(p)
    }
    parts = next
    ctx.globalAlpha = 1
    return parts.length > 0
  }

  return {
    coins, amount, burst, rain, bigWin, tick,
    reset() { parts = []; last = 0 },
    get active() { return parts.length > 0 },
  }
}
