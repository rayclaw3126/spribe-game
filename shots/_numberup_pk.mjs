// NumberUp 端到端：进号码王→登录→暂存多注(大+小 互补必中)→后端开奖→号停后端 num→中奖高亮→⚖抽屉→移动截图。
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

// ---- 1. 进 号码王（轮次开奖 tab）触发登录 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '轮次开奖' }).click(); await page.waitForTimeout(300)
await page.getByText('号码王', { exact: true }).first().click(); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/numberup-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill(PW)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1000)
const before = await balOf()
console.log('server balance before:', before)

// ---- 3. 暂存多注：大 + 小（互补，必中其一 → 部分赢），暂存不扣钱 ----
await page.locator('.nuCell').filter({ hasText: '大' }).first().click()
await page.locator('.nuCell').filter({ hasText: '小' }).first().click()
await page.waitForTimeout(300)
const afterStage = await balOf()
console.log('balance after staging (暂存不扣钱，应=before):', afterStage, before === afterStage ? '✓ 未扣' : '✗ 变动')
await page.getByRole('button', { name: /下注\s*2\s*格/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/numberup-02-betting.png` })

// ---- 4. 等 betting 倒计时走完 → reveal 开牌 → settled 结算（BETTING_T 24s + REVEAL 6s）----
// 轮询相位牌：出现「开牌中…」抓 reveal，出现「已开奖」或 +$ 抓 settled
await page.waitForFunction(() => document.body.innerText.includes('开牌中'), { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/numberup-03-reveal.png` })
await page.waitForFunction(() => /已开奖|\+\$/.test(document.body.innerText), { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/numberup-04-result.png` })
const after = await balOf()
console.log('server balance after settle:', after, '(部分赢：命中侧 10×1.91=19.10，净 -0.90/期)')

// 抓开出号码 + 命中侧
const drawn = await page.locator('[style*="号码"]').first().textContent().catch(() => null)
console.log('drawn label:', drawn)

// ---- 5. ⚖ 可验证公平抽屉 ----
await page.locator('button[title="可验证公平"]').first().click().catch(() => {})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/numberup-05-fairness.png` })
console.log('fairness drawer text has 服务端种子/哈希:', /种子|哈希|hash/i.test(await page.locator('body').innerText()))
await page.keyboard.press('Escape').catch(() => {})

// ---- 6. 移动视口 ----
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/numberup-06-mobile.png` })

console.log('pageerrors:', errs.length ? errs : 'none')
await browser.close()
