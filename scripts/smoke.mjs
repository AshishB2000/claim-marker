/**
 * End-to-end checks for the things unit tests cannot reach: that both vanilla entry points
 * mount and hand back a working handle, and that the scenario's integrated damage marker
 * actually writes back into the scenario document.
 *
 *   npm run dev   # in another shell
 *   node scripts/smoke.mjs [origin]
 */
import { chromium } from 'playwright'

const origin = process.argv[2] ?? 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
const json = (sel) => page.textContent(sel).then(JSON.parse)

// ── vanilla mount() for both widgets ─────────────────────────────────
await page.goto(`${origin}/demo/vanilla.html`, { waitUntil: 'networkidle' })
await page.waitForSelector('#damage canvas')
await page.waitForSelector('#scenario canvas')
await page.waitForTimeout(4000)

const marker0 = await json('#out')
if (marker0.schema !== 'claim-marker/1') fail(`marker export() before interaction returned ${JSON.stringify(marker0)}`)
if (marker0.damages.length !== 0) fail('expected an empty marker on mount')

const scenario0 = await json('#scn-out')
if (scenario0.schema !== 'claim-scenario/1') fail(`scenario export() before interaction returned ${JSON.stringify(scenario0)}`)
if (scenario0.vehicles.length !== 2) fail('expected the scenario to seed two vehicles')

await page.getByRole('button', { name: 'load() a sample' }).first().click()
await page.getByRole('button', { name: 'load() a sample' }).nth(1).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'export()' }).first().click()
await page.getByRole('button', { name: 'export()' }).nth(1).click()
await page.waitForTimeout(600)

const marker1 = await json('#out')
if (marker1.damages?.[0]?.zone !== 'roof') fail(`marker load() did not restore: ${JSON.stringify(marker1.damages)}`)
if (!/^data:image\/png;base64/.test(marker1.png)) fail(`marker export() png was ${marker1.png}`)

const scenario1 = await json('#scn-out')
if (scenario1.layout !== 'parking_lot') fail(`scenario load() did not restore the layout: ${scenario1.layout}`)
if (scenario1.vehicles?.[0]?.body !== 'truck') fail('scenario load() did not restore the vehicles')
if (!/^data:image\/png;base64/.test(scenario1.png)) fail(`scenario export() png was ${scenario1.png}`)

console.log('ok — mount() and mountScenario(): export, load, png all work')

// ── the scenario's integrated damage marker writes back ──────────────
await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(4000)

const damagesOf = async (id) => (await json('pre')).vehicles.find((v) => v.id === id)?.damages ?? []
if ((await damagesOf('a')).length !== 0) fail('expected vehicle A to start undamaged')

// select vehicle A, open its damage marker, tap the car, choose a severity
await page.getByRole('button', { name: /^A ·/ }).click()
await page.getByRole('button', { name: /^Mark damage/ }).click()
await page.waitForTimeout(3500)

const overlay = page.locator('.cm-overlay canvas')
if ((await overlay.count()) !== 1) fail('the damage overlay did not open over the diagram')
const box = await overlay.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'dent', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Done' }).click()
await page.waitForTimeout(800)

const marked = await damagesOf('a')
if (marked.length !== 1) fail(`expected 1 damage on vehicle A, got ${marked.length}`)
if (marked[0].severity !== 'dent') fail(`expected a dent, got ${marked[0].severity}`)
if ((await page.locator('.cm-overlay').count()) !== 0) fail('the overlay did not close')

console.log(`ok — scenario damage marking wrote back: ${marked[0].zone} / ${marked[0].severity}`)

// changing the body must clear damages, since zone ids are per body
await page.selectOption('.cm-panel select >> nth=1', 'truck')
await page.waitForTimeout(600)
if ((await damagesOf('a')).length !== 0) fail('changing the body left stale damages behind')
console.log('ok — changing the body cleared its damages')

// every layout has to actually render; three of four are otherwise never looked at
for (const layout of ['T-junction', 'Straight road', 'Parking lot', 'Four-way intersection']) {
  await page.getByRole('button', { name: layout, exact: true }).click()
  await page.waitForTimeout(900)
  if ((await page.locator('canvas').count()) !== 1) fail(`layout ${layout} lost the canvas`)
}
console.log('ok — all four layouts render')

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nall smoke checks passed')
