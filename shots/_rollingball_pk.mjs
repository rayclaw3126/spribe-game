// RollingBall 端到端（bespoke 多步）：进滚球→登录→球0押大小→后端开球0→中奖认后端→续球1(剩余池74)→球2→回新局→⚖→移动。
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
// 押大 + 小（互补，每球必中其一），确认
const stageBigSmall = async () => {
  await page.locator('.rbCell').filter({ hasText: '大' }).first().click().catch(() => {})
  await page.locator('.rbCell').filter({ hasText: '小' }).first().click().catch(() => {})
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /下注\s*\d+\s*格/ }).click().catch(() => {})
  await page.waitForTimeout(300)
}
// 等余额变化（settle 入账）
const waitBalChange = async (before, maxS = 22) => {
  for (let i = 0; i < maxS; i++) { const b = await balOf(); if (b !== before) return b; await page.waitForTimeout(1000) }
  return await balOf()
}

// ---- 1. 进 滚球（轮次开奖 tab）触发登录 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '轮次开奖' }).click(); await page.waitForTimeout(300)
// 「滚球」在顶栏也是体育分类（撞名）→ 用游戏卡唯一 desc 定位游戏卡
await page.getByText('三球滚动，逐球押注！').first().click(); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/rollingball-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill(PW)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1000)
const before = await balOf()
console.log('server balance before:', before)

// ---- 3. 球0 押大+小（暂存不扣钱），等开球0 settle → 余额认后端 ----
// 若当前不在球0窗，等到 b1-bet
await page.waitForTimeout(500)
await stageBigSmall()
const afterStage = await balOf()
console.log('balance after staging (暂存不扣钱，应=before):', afterStage, before === afterStage ? '✓ 未扣' : '(可能已跨窗)')
await page.screenshot({ path: `${OUT}/rollingball-02-bet0.png` })
const afterBall0 = await waitBalChange(afterStage, 20)
console.log('balance after ball0 settle:', afterBall0, afterBall0 !== afterStage ? '✓ 余额认后端(球0即扣即结)' : '(未变?)')
await page.screenshot({ path: `${OUT}/rollingball-03-ball0.png` })

// ---- 4. 续球1：等到下一球押注窗，押大+小，看剩余池 74 / 已开 1 球 ----
// 等进入 b2-bet（押注 · 第2球）
await page.waitForFunction(() => /第2球|剩余池\s*74/.test(document.body.innerText), { timeout: 12000 }).catch(() => {})
await stageBigSmall()
await page.screenshot({ path: `${OUT}/rollingball-04-bet1.png` })
const poolTxt = await page.locator('body').innerText()
console.log('续球1：含"第2球":', /第2球/.test(poolTxt), ' 含"剩余池 74":', /剩余池\s*74/.test(poolTxt))
const afterBall1 = await waitBalChange(afterBall0, 20)
console.log('balance after ball1 settle:', afterBall1, afterBall1 !== afterBall0 ? '✓ 球1独立扣（多步）' : '(未变?)')
await page.screenshot({ path: `${OUT}/rollingball-05-ball1.png` })

// ---- 5. ⚖ 可验证公平抽屉 ----
await page.locator('button[title="可验证公平"]').first().click().catch(() => {})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/rollingball-06-fairness.png` })
console.log('fairness drawer text has 种子/哈希:', /种子|哈希|hash/i.test(await page.locator('body').innerText()))
await page.keyboard.press('Escape').catch(() => {})

// ---- 6. 移动视口 ----
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/rollingball-07-mobile.png` })

console.log('pageerrors:', errs.length ? errs : 'none')
await browser.close()
