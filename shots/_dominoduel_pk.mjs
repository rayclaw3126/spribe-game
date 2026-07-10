// DominoDuel 端到端：进骨牌对决→登录→暂存主客胜→后端开奖→4骨牌停后端→hs/as对→中奖高亮→⚖抽屉→push平局注入→移动。
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

// ---- 1. 进 骨牌对决（轮次开奖 tab）触发登录 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '轮次开奖' }).click(); await page.waitForTimeout(300)
await page.getByText('骨牌对决', { exact: true }).first().click(); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/dominoduel-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill(PW)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1000)
const before = await balOf()
console.log('server balance before:', before)

// ---- 3. 暂存主队胜 + 客队胜（除平局外必中其一 → 部分赢），暂存不扣钱 ----
await page.getByText('主队胜', { exact: true }).first().click()
await page.getByText('客队胜', { exact: true }).first().click()
await page.waitForTimeout(300)
const afterStage = await balOf()
console.log('balance after staging (暂存不扣钱，应=before):', afterStage, before === afterStage ? '✓ 未扣' : '✗ 变动')
await page.getByRole('button', { name: /下注\s*\d+\s*格/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/dominoduel-02-betting.png` })

// ---- 4. 等 settle（DominoDuel 一轮 ~23s：betting 12s + 开牌 7s + 结算 4s）：轮询余额变化 ----
await page.waitForTimeout(9000)
await page.screenshot({ path: `${OUT}/dominoduel-03-drawing.png` })
let after = before
for (let i = 0; i < 30; i++) { after = await balOf(); if (after !== before) break; await page.waitForTimeout(1000) }
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/dominoduel-04-result.png` })
console.log('server balance after settle:', after, '(部分赢/平局退：≠before 表示 settle 已入账)')

// ---- 5. ⚖ 可验证公平抽屉 ----
await page.locator('button[title="可验证公平"]').first().click().catch(() => {})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/dominoduel-05-fairness.png` })
console.log('fairness drawer text has 种子/哈希:', /种子|哈希|hash/i.test(await page.locator('body').innerText()))
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(500)

// ---- 6. push 视觉：注入一局平局（主客同分 hs==as）无注展示，看开牌区平局态 ----
// 主 [3-3]+[0-1]=6+1=7 mod10=7；客 [2-2]+[1-2]=4+3=7 mod10=7 → 平局
await page.evaluate(() => { window.__DOM_FORCE = [[3, 3], [0, 1], [2, 2], [1, 2]] })
console.log('injected tie tiles: 主[3-3][0-1]=7 客[2-2][1-2]=7')
for (let i = 0; i < 30; i++) { const t = await page.locator('body').innerText(); if (/平局|平\b/.test(t) && /7/.test(t)) break; await page.waitForTimeout(1000) }
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/dominoduel-06-push-tie.png` })

// ---- 7. 移动视口 ----
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/dominoduel-07-mobile.png` })

console.log('pageerrors:', errs.length ? errs : 'none')
await browser.close()
