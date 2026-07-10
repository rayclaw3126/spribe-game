// Momentum 端到端（实时 crash WS）：进Momentum→登录→连WS→betting(commitHash+倒计时)→下注(余额认后端)→running走势线(后端逐柱x)→cashout服务端结算→done reveal→移动。
import pkg from '/home/userray/check-frontend-qa/node_modules/playwright-core/index.js'
const { chromium } = pkg
const EXEC = '/home/userray/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const URL = 'http://localhost:5174', OUT = '/home/userray/spribe-game/shots'
const PW = process.env.ALICE_PW
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []; page.on('pageerror', e => errs.push(String(e)))
const balOf = async () => {
  const t = await page.locator('text=/[0-9]+\\.[0-9]{2}\\s*USD/').first().textContent().catch(() => null)
  return t ? parseFloat(t.replace(/[^0-9.]/g, '')) : null
}

// ---- 1. 进 Momentum（即时街机 tab）触发登录 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '即时街机' }).click(); await page.waitForTimeout(300)
await page.getByText('乘势而上，巅峰兑现！').first().click(); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/momentum-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill(PW)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1500)   // 连 WS + 收 hello/betting
const before = await balOf()
console.log('server balance before:', before)
await page.screenshot({ path: `${OUT}/momentum-02-betting.png` })
const bettingTxt = await page.locator('body').innerText()
console.log('betting 显 ⚖承诺(commitHash):', /⚖/.test(bettingTxt), ' 有倒计时圈:', /等待下一局/.test(bettingTxt))

// ---- 3. 下注（betting 阶段）→ 余额认后端 ----
// 等到 betting（下注按钮出现）；点下注
const betBtn = page.getByRole('button', { name: /下注\s*\$/ })
await betBtn.first().waitFor({ timeout: 12000 }).catch(() => {})
await betBtn.first().click().catch(() => {})
await page.waitForTimeout(600)
let afterBet = before
for (let i = 0; i < 12; i++) { afterBet = await balOf(); if (afterBet !== before) break; await page.waitForTimeout(500) }
console.log('balance after bet:', afterBet, afterBet !== before ? '✓ 余额认后端(下注扣)' : '(未变?)')
await page.screenshot({ path: `${OUT}/momentum-03-bet.png` })

// ---- 4. running 走势线（后端逐柱 x）+ cashout ----
await page.waitForFunction(() => /进行中/.test(document.body.innerText), { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)   // 攒几根柱
await page.screenshot({ path: `${OUT}/momentum-04-running.png` })
// 兑现（若还在 running 且有兑现钮）
const cashBtn = page.getByRole('button', { name: /兑现/ })
if (await cashBtn.first().isVisible().catch(() => false)) {
  await cashBtn.first().click().catch(() => {})
  await page.waitForTimeout(800)
}
let afterCash = afterBet
for (let i = 0; i < 8; i++) { afterCash = await balOf(); if (afterCash !== afterBet) break; await page.waitForTimeout(500) }
console.log('balance after cashout:', afterCash, afterCash !== afterBet ? '✓ 兑现认后端' : '(未兑或net0)')
await page.screenshot({ path: `${OUT}/momentum-05-cashout.png` })

// ---- 5. 等 done reveal serverSeed ----
await page.waitForFunction(() => /seed揭晓|完场|被绝杀/.test(document.body.innerText), { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/momentum-06-done.png` })
console.log('done reveal(seed揭晓):', /seed揭晓/.test(await page.locator('body').innerText()))

// ---- 6. 移动视口 ----
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/momentum-07-mobile.png` })

console.log('pageerrors:', errs.length ? errs : 'none')
await browser.close()
