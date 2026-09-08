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

// ── the impact badge: grabbable through its DOM layer, and no jump on grab ───
await page.getByRole('button', { name: '+ Impact point' }).click()
await page.waitForTimeout(900)
const badge = page.locator('.cm-impact')
if ((await badge.count()) !== 1) fail('the impact badge did not appear')

const box2 = await badge.boundingBox()
const centre = { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2 }
const impactNow = async () => (await json('pre')).impact
const before = await impactNow()

// press without moving. The badge floats, so the drag plane has to sit at its height —
// intersecting y=0 instead would snap it to the ground point under the cursor.
await page.mouse.move(centre.x, centre.y)
await page.mouse.down()
await page.waitForTimeout(500)
const held = await impactNow()
const jump = Math.hypot(held[0] - before[0], held[1] - before[1])
if (jump > 0.6) fail(`impact jumped ${jump.toFixed(2)} m on grab — the drag plane height is wrong`)

// drag right, straight under the selected-vehicle panel: the pointer leaves the canvas
// partway, which used to freeze the drag dead
await page.mouse.move(centre.x + 130, centre.y, { steps: 10 })
await page.waitForTimeout(500)
await page.mouse.up()
const after = await impactNow()
const moved = Math.hypot(after[0] - before[0], after[1] - before[1])
if (moved < 3) fail(`impact did not follow the drag under the panel (moved only ${moved.toFixed(2)} m)`)
console.log(`ok — impact badge drags: ${jump.toFixed(2)} m jump on grab, ${moved.toFixed(1)} m travelled under the panel`)

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
