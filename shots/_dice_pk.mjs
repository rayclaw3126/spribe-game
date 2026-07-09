import pkg from '/home/userray/check-frontend-qa/node_modules/playwright-core/index.js'
const { chromium } = pkg
const EXEC = '/home/userray/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const URL = 'http://localhost:5173', OUT = '/home/userray/spribe-game/shots'
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []; page.on('pageerror', e => errs.push(String(e)))

// ---- 1. 进 Dice 触发玩家登录页 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '即时街机' }).click()
await page.waitForTimeout(300)
await page.getByText('总进球', { exact: true }).first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/dice-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice/alice123 ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill('alice123')
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/dice-02-play.png` })
async function bal() {
  const t = await page.locator('header >> text=/[0-9]+\\.[0-9]{2}/').first().textContent().catch(() => null)
  return t ? parseFloat(t.replace(/[^0-9.]/g, '')) : null
}
const before = await bal()
console.log('server balance before bet:', before)

// ---- 3. 下注 UNDER，等滚点结果 ----
await page.getByRole('button', { name: /UNDER/ }).click()
await page.waitForTimeout(1800) // ROLL_MS(1200) + 结算 buffer
await page.screenshot({ path: `${OUT}/dice-03-result.png` })
const after = await bal()
console.log('server balance after bet:', after)
console.log('proof visible:', await page.getByText(/可验证/).first().isVisible().catch(() => false))

console.log('page errors:', errs.length ? errs : 'none')
await browser.close()
console.log('DONE')
