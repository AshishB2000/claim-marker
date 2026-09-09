/**
 * Regenerate the README screenshots from a real run through the flow, and assert the PNG
 * the document carries is a rendered frame rather than a blank buffer.
 *
 *   npm run dev   # in another shell
 *   node scripts/shoot.mjs [origin]
 */
import { chromium } from 'playwright'

const origin = process.argv[2] ?? 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const fail = (m) => {
  console.error(`FAIL: ${m}`)
  process.exit(1)
}
const next = () => page.getByRole('button', { name: /^Continue/ }).click()
const shot = async (out) => {
  await page.screenshot({ path: out })
  console.log(out)
}

await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('[role=radiogroup][aria-label="What happened"]')
await shot('docs/kind.png')
await next()
await page.getByRole('combobox', { name: 'Where did it happen?' }).fill('Times Square New York')
await page.waitForSelector('[role=option]', { timeout: 20000 })
await page.locator('[role=option]').first().click()
// the fly-to takes 1.4 s and the vector tiles and glyphs come after it
await page.waitForTimeout(6500)
await shot('docs/where.png')

await next()
await page.waitForSelector('text=Your vehicle')
const groups = page.locator('[role=radiogroup][aria-label="Body type"]')
await page.getByRole('combobox', { name: 'Make' }).first().selectOption('Toyota')
await page.getByRole('combobox', { name: 'Year' }).first().selectOption('2022')
await page.waitForFunction(() => {
  const sel = document.querySelector('select[aria-label="Model"]')
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'Camry')
}, null, { timeout: 30000 })
await page.getByRole('combobox', { name: 'Model' }).first().selectOption('Camry')
await groups.nth(0).locator('..').locator('..').getByRole('radio', { name: 'Red' }).click()
await page.getByRole('combobox', { name: 'Make' }).nth(1).selectOption('Ford')
await page.getByRole('combobox', { name: 'Year' }).nth(1).selectOption('2020')
await page.waitForFunction(() => {
  const sel = document.querySelectorAll('select[aria-label="Model"]')[1]
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'F-150')
}, null, { timeout: 30000 })
await page.getByRole('combobox', { name: 'Model' }).nth(1).selectOption('F-150')
await page.waitForTimeout(5000)
await shot('docs/vehicles.png')

await next()
await page.waitForSelector('text=Who was driving?')
await page.getByRole('textbox', { name: 'Driver of B name' }).fill('Dana Quinn')
await page.getByRole('textbox', { name: 'Driver of B phone' }).fill('555 0199')
await page.getByRole('textbox', { name: 'Insurer of B' }).fill('Acme Mutual')
await page.locator('[role=radiogroup][aria-label="Was anyone hurt"]').getByRole('radio', { name: 'No', exact: true }).click()
await page.locator('[role=radiogroup][aria-label="Were the police called"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.getByRole('textbox', { name: 'Police department' }).fill('NYPD Midtown South')
await page.getByRole('textbox', { name: 'Police report number' }).fill('2026-0042')
await shot('docs/people.png')

await next()
await page.waitForSelector('.mk-car', { timeout: 20000 })
await page.waitForTimeout(8000)
// drag the pickup along its route and into the customer's car; the path and the point of
// impact both come out of that one gesture
const box = async (n) => {
  const b = await page.locator('.mk-car').nth(n).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const from = await box(1)
const to = await box(0)
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(from.x - 40, from.y - 90, { steps: 8 })
await page.mouse.move(to.x + 30, to.y - 30, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(2200)
await page.locator('.mk-car').first().click()
await page.waitForTimeout(1500)
await shot('docs/scene.png')

await next()
await page.waitForSelector('.cm-root canvas', { timeout: 20000 })
await page.waitForTimeout(6000)
const c = await page.locator('.cm-root canvas').boundingBox()
await page.mouse.click(c.x + c.width * 0.42, c.y + c.height * 0.55)
await page.waitForTimeout(500)
// force: the popover follows the 3D point, and OrbitControls' damping keeps it drifting by
// fractions of a pixel for seconds, which Playwright's exact-rect stability check never accepts
await page.getByRole('button', { name: 'dent', exact: true }).click({ force: true })
await page.waitForTimeout(1800)
await shot('docs/damage.png')

await next()
await page.waitForSelector('text=Send my report', { timeout: 20000 })
await page.waitForTimeout(8000)
await shot('docs/review.png')

await page.getByRole('textbox', { name: 'Your name' }).fill('Ashish B')
await page.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
await page.getByRole('textbox', { name: 'Signature' }).fill('Ashish B')
const submitted = page.evaluate(() => new Promise((r) => window.addEventListener('claim:submitted', (e) => r(e.detail), { once: true })))
await page.getByRole('button', { name: 'Send my report' }).click()
const doc = await submitted

/** decode a PNG data URL and count distinct colours, sampled sparsely */
const distinct = (dataUrl) =>
  page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const ctx = off.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, img.width, img.height).data
    const seen = new Set()
    for (let i = 0; i < px.length; i += 4 * 499) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`)
    return { width: img.width, height: img.height, colours: seen.size }
  }, dataUrl)

const scene = await distinct(doc.attachments.scene)
const damage = await distinct(doc.attachments.damage.a)
console.log(`scene attachment ${scene.width}×${scene.height}, ${scene.colours} colours; damage attachment ${damage.width}×${damage.height}, ${damage.colours} colours`)
if (scene.colours < 50) fail('the scene attachment looks blank')
if (damage.colours < 50) fail('the damage attachment looks blank')

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nok — screenshots regenerated, both attachments are real frames')
