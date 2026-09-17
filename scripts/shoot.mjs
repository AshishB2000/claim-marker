/**
 * Regenerate the README screenshots from a real run through the flow, and assert the PNG
 * the document carries is a rendered frame rather than a blank buffer.
 *
 *   npm run dev   # in another shell
 *   node scripts/shoot.mjs [origin] [--lang=es]
 *
 * With `--lang=es` the same walk is driven in Spanish and the shots land as `docs/es-*.png`,
 * beside the English ones rather than over them. Every name comes from the dictionaries the
 * build emits beside the parser (`dist/lib/messages.json`).
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const origin = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173'
const lang = args.includes('--lang=es') ? 'es' : 'en'

const DICT = JSON.parse(readFileSync(new URL('../dist/lib/messages.json', import.meta.url), 'utf8'))
const t = (key, vars = {}) => String(DICT[lang][key] ?? DICT.en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? vars[name] : whole))
/** the names this walk clicks by, in the language it is shooting */
const N = {
  kindGroup: t('start.kind.group'),
  continue: t('common.continue'),
  where: t('start.where.label'),
  yourVehicle: lang === 'es' ? 'Tu vehículo' : 'Your vehicle',
  bodyType: t('start.vehicles.bodyType'),
  make: t('start.vehicles.make'),
  year: t('start.vehicles.year'),
  model: t('start.vehicles.model'),
  red: t('paint.red'),
  whoDriving: t('start.people.drivingTitle'),
  driverBName: t('start.people.nameOf', { who: t('start.people.whoDriverOf', { id: 'B' }) }),
  driverBPhone: t('start.people.phoneOf', { who: t('start.people.whoDriverOf', { id: 'B' }) }),
  insurerB: t('start.people.insurerOf', { id: 'B' }),
  hurtGroup: t('start.people.hurtGroup'),
  policeGroup: t('start.people.policeGroup'),
  department: t('start.people.department'),
  reportNumber: t('start.people.reportNumberOf'),
  yes: t('common.yes'),
  no: t('common.no'),
  dent: t('severity.dent'),
  closeUp: t('damage.shot.close'),
  add: t('damage.suggest.add', { panel: '' }).trim(),
  photosShow: t('damage.seen.aria'),
  send: t('scene.send.send'),
  yourName: t('scene.contact.name'),
  agree: t('scene.send.agreeAria'),
  sign: t('scene.send.signAria'),
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const fail = (m) => {
  console.error(`FAIL: ${m}`)
  process.exit(1)
}
const next = () => page.getByRole('button', { name: new RegExp(`^${N.continue}`) }).click()
/** the Spanish run writes beside the English shots, never over them */
const named = (name) => `docs/${lang === 'es' ? 'es-' : ''}${name}.png`
const shot = async (name) => {
  const out = named(name)
  await page.screenshot({ path: out })
  console.log(out)
}

if (lang === 'es') await page.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
await page.waitForSelector(`[role=radiogroup][aria-label="${N.kindGroup}"]`)
await shot('kind')
await next()
await page.getByRole('combobox', { name: N.where }).fill('Times Square New York')
await page.waitForSelector('[role=option]', { timeout: 20000 })
await page.locator('[role=option]').first().click()
// the fly-to takes 1.4 s and the vector tiles and glyphs come after it
await page.waitForTimeout(6500)
await shot('where')

await next()
await page.waitForSelector(`text=${N.yourVehicle}`)
const groups = page.locator(`[role=radiogroup][aria-label="${N.bodyType}"]`)
await page.getByRole('combobox', { name: N.make }).first().selectOption('Toyota')
await page.getByRole('combobox', { name: N.year }).first().selectOption('2022')
await page.waitForFunction((label) => {
  const sel = document.querySelector(`select[aria-label="${label}"]`)
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'Camry')
}, N.model, { timeout: 30000 })
await page.getByRole('combobox', { name: N.model }).first().selectOption('Camry')
await groups.nth(0).locator('..').locator('..').getByRole('radio', { name: N.red }).click()
await page.getByRole('combobox', { name: N.make }).nth(1).selectOption('Ford')
await page.getByRole('combobox', { name: N.year }).nth(1).selectOption('2020')
await page.waitForFunction((label) => {
  const sel = document.querySelectorAll(`select[aria-label="${label}"]`)[1]
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'F-150')
}, N.model, { timeout: 30000 })
await page.getByRole('combobox', { name: N.model }).nth(1).selectOption('F-150')
await page.waitForTimeout(5000)
await shot('vehicles')

await next()
await page.waitForSelector(`text=${N.whoDriving}`)
await page.getByRole('textbox', { name: N.driverBName }).fill('Dana Quinn')
await page.getByRole('textbox', { name: N.driverBPhone }).fill('555 0199')
await page.getByRole('textbox', { name: N.insurerB }).fill('Acme Mutual')
await page.locator(`[role=radiogroup][aria-label="${N.hurtGroup}"]`).getByRole('radio', { name: N.no, exact: true }).click()
await page.locator(`[role=radiogroup][aria-label="${N.policeGroup}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.getByRole('textbox', { name: N.department }).fill('NYPD Midtown South')
await page.getByRole('textbox', { name: N.reportNumber }).fill('2026-0042')
await shot('people')

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
await shot('scene')

await next()
await page.waitForSelector('.cm-root canvas', { timeout: 20000 })
await page.waitForTimeout(6000)
// the car as the marker drew it, before the picker opens over it: the phone shot below uses it
// as the customer's photograph, so the tile is a real frame and not a white square
const carShot = await page.locator('.cm-root canvas').screenshot()
const c = await page.locator('.cm-root canvas').boundingBox()
await page.mouse.click(c.x + c.width * 0.42, c.y + c.height * 0.55)
await page.waitForTimeout(500)
// force: the popover follows the 3D point, and OrbitControls' damping keeps it drifting by
// fractions of a pixel for seconds, which Playwright's exact-rect stability check never accepts
await page.getByRole('button', { name: N.dent, exact: true }).click({ force: true })
await page.waitForTimeout(1800)
await shot('damage')

// ── the same step on a phone, with the assistant on: photos first ──────
// The stub answers for the endpoint the insurer would run, and the "photograph" is the car as
// the marker drew it — a real frame, so the tile is not a white square in the README.
const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('claim-marker/draft')))
// from the top of the step: no marks yet, no photos, so the walk is the one a customer sees
saved.state.claim.vehicles[0].damages = []
saved.state.claim.attachments.photos = []
saved.state.autoDamage = {}
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const phone = await phoneCtx.newPage()
await phone.addInitScript((l) => {
  window.CLAIM_MARKER = { assistUrl: 'https://assist.example/read', ...(l === 'es' ? { lang: 'es' } : {}) }
}, lang)
await phone.route('https://assist.example/read', (r) =>
  r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      schema: 'claim-assist/1',
      task: 'damage',
      // the stub stands in for the insurer's endpoint, which is told the language and answers
      // in it, so the shot shows what a Spanish-speaking customer would actually read
      damages:
        lang === 'es'
          ? [
              { zone: 'front_bumper', severity: 'crack', note: 'Partido debajo de la placa' },
              { zone: 'hood', severity: 'dent', note: 'Hundido en el borde delantero' },
            ]
          : [
              { zone: 'front_bumper', severity: 'crack', note: 'Split below the number plate' },
              { zone: 'hood', severity: 'dent', note: 'Creased along the front edge' },
            ],
    }),
  }),
)
await phone.goto(`${origin}/`, { waitUntil: 'networkidle' })
await phone.evaluate((s) => localStorage.setItem('claim-marker/draft', s), JSON.stringify(saved))
await phone.reload({ waitUntil: 'networkidle' })
await phone.getByRole('button', { name: N.closeUp }).waitFor({ timeout: 20000 })
const [chooser] = await Promise.all([phone.waitForEvent('filechooser'), phone.getByRole('button', { name: N.closeUp }).click()])
await chooser.setFiles({ name: 'damage.png', mimeType: 'image/png', buffer: carShot })
await phone.getByRole('button', { name: new RegExp(`^${N.add} `) }).first().waitFor({ timeout: 20000 })
await phone.waitForTimeout(500)
await phone.locator(`section[aria-label="${N.photosShow}"]`).scrollIntoViewIfNeeded()
await phone.mouse.wheel(0, -280)
await phone.waitForTimeout(400)
await phone.screenshot({ path: named('damage-phone') })
console.log(named('damage-phone'))
await phoneCtx.close()

await next()
await page.waitForSelector(`text=${N.send}`, { timeout: 20000 })
await page.waitForTimeout(8000)
await shot('review')

await page.getByRole('textbox', { name: N.yourName }).fill('Ashish B')
await page.getByRole('checkbox', { name: N.agree }).check()
await page.getByRole('textbox', { name: N.sign }).fill('Ashish B')
const submitted = page.evaluate(() => new Promise((r) => window.addEventListener('claim:submitted', (e) => r(e.detail), { once: true })))
await page.getByRole('button', { name: N.send }).click()
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
console.log(`\nok — screenshots regenerated${lang === 'es' ? ' in Spanish (docs/es-*.png)' : ''}, both attachments are real frames`)
