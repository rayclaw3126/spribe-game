// DerbyDay 端到端：进德比大战→登录→暂存多注(大+小 互补必中)→后端开奖→主客20球停后端→HT/FT对→中奖高亮→⚖抽屉→移动截图。
// push 视觉：另用 __DD_FORCE 注入一局平局(HT home==away)无注展示（退注文案/平局视觉）；push 账已在批2真跑验准。
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

// ---- 1. 进 德比大战（轮次开奖 tab）触发登录 ----
await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
await page.getByRole('button', { name: '轮次开奖' }).click(); await page.waitForTimeout(300)
await page.getByText('德比大战', { exact: true }).first().click(); await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/derbyday-01-login.png` })
console.log('login page visible:', await page.getByText('玩家登录').first().isVisible().catch(() => false))

// ---- 2. 登录 alice ----
await page.getByPlaceholder('请输入用户名').fill('alice')
await page.getByPlaceholder('请输入密码').fill(PW)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1000)
const before = await balOf()
console.log('server balance before:', before)

// ---- 3. 暂存多注：大 + 小（全场大小互补必中其一 → 部分赢），暂存不扣钱 ----
await page.locator('.ddCell').filter({ hasText: '大' }).first().click()
await page.locator('.ddCell').filter({ hasText: '小' }).first().click()
await page.waitForTimeout(300)
const afterStage = await balOf()
console.log('balance after staging (暂存不扣钱，应=before):', afterStage, before === afterStage ? '✓ 未扣' : '✗ 变动')
await page.getByRole('button', { name: /下注\s*\d+\s*格/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/derbyday-02-betting.png` })

// ---- 4. 等 betting 走完 → 开奖各相 → settled 结算（DerbyDay 一轮 ~45-50s：betting 24s + HT/FT 各阶段）----
// 轮询余额变化确认 settle 已入账（比固定 sleep 稳）
await page.waitForTimeout(12000)
await page.screenshot({ path: `${OUT}/derbyday-03-drawing.png` })
let after = before
for (let i = 0; i < 50; i++) {   // 最多 ~50s 等 settle
  after = await balOf()
  if (after !== before) break
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/derbyday-04-result.png` })
console.log('server balance after settle:', after, '(部分赢：命中侧 10×赔率；≠before 表示 settle 已入账)')

// ---- 5. ⚖ 可验证公平抽屉 ----
await page.locator('button[title="可验证公平"]').first().click().catch(() => {})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/derbyday-05-fairness.png` })
console.log('fairness drawer text has 种子/哈希:', /种子|哈希|hash/i.test(await page.locator('body').innerText()))
await page.keyboard.press('Escape').catch(() => {})

// ---- 6. push 视觉：注入一局平局(HT home==away sum) 无注展示，看开奖区平局态 ----
// 造两组前10和相等的球：home 前10 = away 前10 的同和（如都用 1..10，和均 55），后10 任意
const forced = await page.evaluate(() => {
  const eq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]   // 前10 和 = 55（HT 主客相等 → HT 平局）
  const home20 = [...eq, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  const away20 = [...eq, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
  window.__DD_FORCE = { home20, away20 }
  return { htHome: 55, htAway: 55 }
})
console.log('injected HT-tie match:', JSON.stringify(forced))
// 等这局无注开奖跑到 HT 展示相（前10 主客和 55==55 平局态），一整轮 ~46s；抓半场平局定格
await page.waitForTimeout(46000)
await page.screenshot({ path: `${OUT}/derbyday-06-push-tie.png` })
const tieTxt = await page.locator('body').innerText()
console.log('tie screenshot 含 55（HT 主客和相等）:', tieTxt.includes('55'))

// ---- 7. 移动视口 ----
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/derbyday-07-mobile.png` })

console.log('pageerrors:', errs.length ? errs : 'none')
await browser.close()
