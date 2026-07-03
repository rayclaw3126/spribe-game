import pkg from '/home/userray/check-frontend-qa/node_modules/playwright-core/index.js'
const { chromium } = pkg
const EXEC='/home/userray/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const URL='http://localhost:5173', OUT='/home/userray/spribe-game/shots'
const browser=await chromium.launch({executablePath:EXEC,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']})
const page=await browser.newPage({viewport:{width:1280,height:900}})
const errs=[]; page.on('pageerror',e=>errs.push(String(e)))
async function bal(){ return parseFloat((await page.locator('header >> text=/\\$[0-9]/').first().textContent()).replace(/[^0-9.]/g,'')) }
await page.goto(URL,{waitUntil:'networkidle'}); await page.waitForTimeout(500)
await page.getByText('Total Goals',{exact:true}).first().click(); await page.waitForTimeout(500)
const before=await bal()
await page.getByRole('button',{name:/下注开踢/}).click()
await page.waitForTimeout(500)
const afterBet=await bal()
const dirBtns=await page.getByRole('button',{name:/左上|右上|中路|左下|右下/}).count()
const cd=await page.locator('div').filter({hasText:/^[0-5]$/}).count()
console.log('afterBet bal:', afterBet, '(before', before, ') | dir buttons:', dirBtns)
// pick a direction, screenshot mid-kick
await page.getByRole('button',{name:/左上/}).click()
await page.waitForTimeout(360)
await page.screenshot({path:`${OUT}/penalty-shot.png`})
// wait for next aim, then skip to finish
await page.waitForTimeout(1700)
await page.getByRole('button',{name:/一键罚完/}).click().catch(()=>{})
await page.locator('text=/5 罚进/').first().waitFor({timeout:8000})
await page.waitForTimeout(300)
await page.screenshot({path:`${OUT}/penalty-result.png`})
const banner=(await page.locator('text=/5 罚进/').first().textContent()).trim()
const after=await bal()
console.log('banner:', banner, '| final bal:', after)
// mobile
await page.setViewportSize({width:375,height:812})
await page.goto(URL,{waitUntil:'networkidle'}); await page.waitForTimeout(400)
await page.getByText('Total Goals',{exact:true}).first().click(); await page.waitForTimeout(400)
await page.getByRole('button',{name:/下注开踢/}).click().catch(()=>{})
await page.waitForTimeout(400)
const ov=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}))
console.log('mobile overflow:',JSON.stringify(ov))
await browser.close()
console.log('page errors:', errs.length?errs:'none'); console.log('DONE')
