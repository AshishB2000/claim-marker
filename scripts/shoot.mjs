/**
 * Screenshot both demo tabs with their samples loaded, and assert the PNG that export()
 * would hand back is a rendered frame rather than a blank buffer.
 *
 *   npm run dev   # in another shell
 *   node scripts/shoot.mjs [url]
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'

const TABS = [
  { tab: 'Accident scenario', out: 'docs/scenario.png', settle: 2500 },
  { tab: 'Damage marker', out: 'docs/screenshot.png', settle: 1500 },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(3500)

/** read back the pixels of what export() would return, to prove the buffer is not blank */
const inspectExport = () =>
  page.evaluate(async () => {
    const canvas = document.querySelector('canvas')
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
  })

const report = {}
for (const { tab, out, settle } of TABS) {
  await page.getByRole('button', { name: tab, exact: true }).click()
  await page.waitForTimeout(settle)
  await page.getByRole('button', { name: 'Sample' }).click()
  await page.waitForTimeout(settle)

  report[tab] = { png: await inspectExport(), json: JSON.parse(await page.textContent('pre')) }
  await page.screenshot({ path: out })
  console.log(`${out} — ${JSON.stringify(report[tab].png)}`)
}

// the integration shot: the damage marker open over the diagram
await page.getByRole('button', { name: 'Accident scenario', exact: true }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /^A ·/ }).click()
await page.getByRole('button', { name: /^Mark damage/ }).click()
await page.waitForTimeout(3500)
await page.screenshot({ path: 'docs/overlay.png' })
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
if (damage.json.damages?.length !== 2) fail(`expected 2 damages, got ${damage.json.damages?.length}`)

console.log('\nok — both tabs render, both exports are real frames')
