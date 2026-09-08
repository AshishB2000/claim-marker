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

/** distinct colours in a canvas, sampled sparsely — a blank buffer has one or two */
const colours = (sel) =>
  page.evaluate(async (sel) => {
    const c = document.querySelector(sel)
    if (!c) return 0
    const img = new Image()
    img.src = c.toDataURL('image/png')
    await img.decode()
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const ctx = off.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, img.width, img.height).data
    const seen = new Set()
    for (let i = 0; i < px.length; i += 4 * 499) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2])
    return seen.size
  }, sel)

/**
 * Wait for a real frame. three.js links shader programs in parallel and skips objects whose
 * program is not ready, and under software GL the lit materials can take seconds — a fixed
 * timeout was capturing frames with nothing but the unlit path lines on them.
 */
const settled = async (sel = 'canvas') => {
  for (let i = 0; i < 50; i++) {
    if ((await colours(sel)) >= 50) return
    await page.waitForTimeout(300)
  }
  fail(`${sel} never rendered a frame`)
}

// ── vanilla mount() for both widgets ─────────────────────────────────
await page.goto(`${origin}/demo/vanilla.html`, { waitUntil: 'networkidle' })
await page.waitForSelector('#damage canvas')
await page.waitForSelector('#scenario canvas')
await settled('#damage canvas')
await settled('#scenario canvas')

if ((await page.locator('.cm-root.cm-dark').count()) !== 2) fail('theme: "dark" did not put .cm-dark on both roots')

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
await settled()

const damagesOf = async (id) => (await json('pre')).vehicles.find((v) => v.id === id)?.damages ?? []
if ((await damagesOf('a')).length !== 0) fail('expected vehicle A to start undamaged')

// select vehicle A, open its damage marker, tap the car, choose a severity
await page.getByRole('button', { name: /^A ·/ }).click()
await page.getByRole('button', { name: /^Mark damage/ }).click()
await page.waitForSelector('.cm-overlay canvas')
await settled('.cm-overlay canvas')

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

// ── damage marker: hovering names the zone, committing a damage flies the camera to it ──
await page.getByRole('button', { name: 'Damage marker', exact: true }).click()
await page.waitForSelector('canvas')
await settled()

const stage = await page.locator('canvas').boundingBox()
const cx = stage.x + stage.width / 2
const cy = stage.y + stage.height / 2
// the orbit target is the middle of the body, so the centre of the canvas is always on the car
await page.mouse.move(cx, cy)
await page.waitForTimeout(400)
const zone = page.locator('.cm-zone')
if ((await zone.count()) !== 1) fail('hovering the body did not name a zone')
console.log(`ok — hover names the zone: ${await zone.textContent()}`)

// tap the body well off centre, commit a severity: the new damage is selected, and the
// camera should swing round until the point sits in the middle of the view
await page.mouse.click(cx + stage.width * 0.13, cy + stage.height * 0.04)
await page.waitForTimeout(500)
const pop = page.locator('.cm-pop')
if ((await pop.count()) !== 1) fail('tapping the body did not open the severity picker')
const popBefore = await pop.boundingBox()
await page.getByRole('button', { name: 'scratch', exact: true }).click()
await page.waitForTimeout(2200)
const popAfter = await pop.boundingBox()
const offBefore = Math.abs(popBefore.x + popBefore.width / 2 - cx) / stage.width
const offAfter = Math.abs(popAfter.x + popAfter.width / 2 - cx) / stage.width
if (offAfter > 0.06) fail(`fly-to left the damage ${(offAfter * 100).toFixed(0)}% off centre (was ${(offBefore * 100).toFixed(0)}%)`)
if (offBefore - offAfter < 0.04) fail(`fly-to did not move the camera (${(offBefore * 100).toFixed(0)}% → ${(offAfter * 100).toFixed(0)}%)`)
console.log(`ok — fly-to centred the damage: ${(offBefore * 100).toFixed(0)}% → ${(offAfter * 100).toFixed(0)}% off centre`)

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nall smoke checks passed')
