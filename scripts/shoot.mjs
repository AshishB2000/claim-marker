/**
 * Screenshot both demo tabs with their samples loaded, and assert the PNG that export()
 * would hand back is a rendered frame rather than a blank buffer.
 *
 *   npm run dev   # in another shell
 *   node scripts/shoot.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'

// the scenario shot is the README hero and shows the whole page; the other two crop to the
// demo block (#demo: stage plus sidebar) so the car is not a thumbnail
const TABS = [
  { tab: 'Accident scenario', out: 'docs/scenario.png', settle: 2500, full: true },
  { tab: 'Damage marker', out: 'docs/screenshot.png', settle: 1500, full: false },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

/** read back the pixels of what export() would return, to prove the buffer is not blank */
const inspectExport = (sel = 'canvas') =>
  page.evaluate(async (sel) => {
    const canvas = document.querySelector(sel)
    const dataUrl = canvas.toDataURL('image/png')
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const ctx = off.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, img.width, img.height).data
    const colors = new Set()
    for (let i = 0; i < px.length; i += 4 * 499) colors.add(`${px[i]},${px[i + 1]},${px[i + 2]}`)
    return { width: img.width, height: img.height, kb: Math.round(dataUrl.length / 1024), distinctColors: colors.size }
  }, sel)

/**
 * Wait for a real frame rather than a fixed time: three.js skips objects whose shader program
 * is still linking, and under software GL the lit materials can take seconds to come up.
 */
const settled = async (sel = 'canvas') => {
  for (let i = 0; i < 50; i++) {
    if ((await inspectExport(sel)).distinctColors >= 50) return
    await page.waitForTimeout(300)
  }
  throw new Error(`${sel} never rendered a frame`)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await settled()

const report = {}
for (const { tab, out, settle, full } of TABS) {
  await page.getByRole('button', { name: tab, exact: true }).click()
  await settled()
  await page.getByRole('button', { name: 'Sample', exact: true }).click()
  await page.waitForTimeout(settle)

  report[tab] = { png: await inspectExport(), json: JSON.parse(await page.textContent('pre')) }
  await (full ? page.screenshot({ path: out }) : page.locator('#demo').screenshot({ path: out }))
  console.log(`${out} — ${JSON.stringify(report[tab].png)}`)
}

// the integration shot: the damage marker open over the diagram
await page.getByRole('button', { name: 'Accident scenario', exact: true }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /^A ·/ }).click()
await page.getByRole('button', { name: /^Mark damage/ }).click()
await page.waitForSelector('.cm-overlay canvas')
await settled('.cm-overlay canvas')
await page.waitForTimeout(800)
await page.locator('#demo').screenshot({ path: 'docs/overlay.png' })
console.log('docs/overlay.png')

await browser.close()

const fail = (m) => {
  console.error(`FAIL: ${m}`)
  process.exit(1)
}
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)

const scenario = report['Accident scenario']
if (scenario.png.distinctColors < 50) fail(`scenario export looks blank (${scenario.png.distinctColors} colours)`)
if (scenario.json.vehicles?.length !== 2) fail(`expected 2 vehicles, got ${scenario.json.vehicles?.length}`)
if (!scenario.json.impact) fail('expected an impact point in the sample')
if (scenario.json.vehicles.reduce((n, v) => n + v.damages.length, 0) !== 2) fail('expected damage on both vehicles')

const damage = report['Damage marker']
if (damage.png.distinctColors < 50) fail(`damage export looks blank (${damage.png.distinctColors} colours)`)
if (damage.json.damages?.length !== 3) fail(`expected 3 damages, got ${damage.json.damages?.length}`)

console.log('\nok — both tabs render, both exports are real frames')
