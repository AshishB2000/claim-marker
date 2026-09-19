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
 *
 * Three of the shots are taken only on the English run, because there is not a word of the page
 * in any of them and a second copy would say nothing a Spanish reader does not already have:
 * `replay.png` (the cinematic chase, held on the frame the shockwave is on), `marked-car.png`
 * (the damage drawn on the paint, with a photograph standing beside its panel) and `night.png`
 * (the same junction with the hour moved after dark). Each is asserted before it is written —
 * the tilt and the ring, the card's place in the scene, the sun under the horizon — and none of
 * them is saved unless the frame behind it has more than fifty colours in it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
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
  watch: t('scene.play.watch'),
  addPhotos: t('damage.addPhotos'),
  photoShows: t('damage.pinned.shows', { n: 1 }),
  closeUp: t('damage.shot.close'),
  add: t('damage.suggest.add', { panel: '' }).trim(),
  photosShow: t('damage.seen.aria'),
  send: t('scene.send.send'),
  yourName: t('scene.contact.name'),
  agree: t('scene.send.agreeAria'),
  sign: t('scene.send.signAria'),
}

/** the damage marker's canvas: the studio's DEV `__probe` hangs off this element */
const MARKER = '.cm-root canvas'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
// the road comes from the same recorded Overpass answer the smoke uses: a public mirror that
// hangs one request in three is no way to make a README picture (see scripts/smoke.mjs)
const OVERPASS_FIXTURE = readFileSync(new URL('./fixtures/overpass-times-square.json', import.meta.url), 'utf8')
await page.route('**://overpass.kumi.systems/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: OVERPASS_FIXTURE }),
)
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
/**
 * A picture of one part of the page — the map, the marker's card — written only once the frame
 * behind it has been proved to be a rendered one. A screenshot that looks right is not evidence:
 * the same shaders that take seconds to link under software GL hand back a flat rectangle, and a
 * flat rectangle is exactly what the README must never carry.
 */
const shotOf = async (name, locator) => {
  const out = named(name)
  const buf = await locator.screenshot()
  const { width, height, colours } = await distinct(`data:image/png;base64,${buf.toString('base64')}`)
  if (colours < 50) fail(`${out} is a blank frame: ${colours} colours in ${width}×${height}`)
  writeFileSync(new URL(`../${out}`, import.meta.url), buf)
  console.log(`${out} (${width}×${height}, ${colours} colours)`)
}

if (lang === 'es') await page.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
await page.waitForSelector(`[role=radiogroup][aria-label="${N.kindGroup}"]`)
await shot('kind')
await next()
await page.getByRole('combobox', { name: N.where }).fill('Times Square New York')
await page.waitForSelector('[role=option]', { timeout: 20000 })
await page.locator('[role=option]').first().click()
// the fly-to takes 1.4 s and the vector tiles and glyphs come after it; the picture is of the
// finished "we looked this up" card, not of it still looking
await page.waitForSelector('[data-looked-lines] li', { timeout: 30000 }).catch(() => fail('the looked-up card never finished'))
await page.waitForTimeout(4000)
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

// ── "Watch it": the tilted chase, the city standing, the shockwave ring ──
// Nothing here races the animation. The replay's own clock is driven from the page (DEV only,
// `window.__play`, the same handle scripts/smoke.mjs uses): the frame is seeked to a moment
// inside the ring's 600 ms and held there, so the picture is of the moment it means to be of,
// and the ring is measured against the same shot once it has gone rather than sampled for.
// Only the English run takes it: there is not a word of the page in the frame.
if (lang === 'en') {
  await page.getByRole('button', { name: N.watch }).click()
  await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 5000 }).catch(() => fail('"Watch it" did not start'))
  const watched = await page.evaluate(async (impact) => {
    const map = window.__map
    const play = window.__play
    if (!play?.timeline) return { error: 'the diagram step did not expose the replay clock on window.__play' }
    const RING_MS = 600 // src/map/playback.ts
    const size = 160
    const off = document.createElement('canvas')
    off.width = off.height = size
    const ctx = off.getContext('2d', { willReadFrequently: true })
    /** the box around the impact, wherever the camera has put it, on a settled frame */
    const at = async (ms) => {
      play.seek(ms)
      await new Promise((r) => setTimeout(r, 250))
      for (let i = 0; i < 2; i++)
        await new Promise((r) => {
          map.once('render', () => requestAnimationFrame(r))
          map.triggerRepaint()
        })
      const src = map.getCanvas()
      const p = map.project(impact)
      const dpr = src.width / src.clientWidth
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(src, (p.x - size / 2) * dpr, (p.y - size / 2) * dpr, size * dpr, size * dpr, 0, 0, size, size)
      return ctx.getImageData(0, 0, size, size).data
    }
    // the reference first, then the frame the picture is taken of — so the clock is left where
    // the ring is and the screenshot below is that frame, not a hunt for it
    const gone = await at(play.timeline.impactMs + RING_MS + 50)
    const ringing = await at(play.timeline.impactMs + 0.7 * RING_MS)
    let lit = 0
    for (let i = 0; i < ringing.length; i += 4) if (ringing[i] - gone[i] > 25 && ringing[i + 1] - gone[i + 1] > 25) lit++
    return { lit: lit / (ringing.length / 4), pitch: map.getPitch(), city: map.getPaintProperty('buildings', 'fill-extrusion-opacity') }
  }, (await page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim)).impact)
  if (watched.error) fail(watched.error)
  if (watched.pitch < 40) fail(`the cinematic frame is not tilted: pitch ${watched.pitch.toFixed(0)}°`)
  if (!(watched.city > 0)) fail(`no city is standing in the cinematic frame: extrusion opacity ${watched.city}`)
  if (watched.lit < 0.001) fail(`no shockwave in the cinematic frame: it lit ${(watched.lit * 100).toFixed(2)}% of the box around the impact`)
  await shotOf('replay', page.locator('.maplibregl-map').first())
  console.log(`  tilted to ${watched.pitch.toFixed(0)}°, city at opacity ${watched.city}, the ring lit ${(watched.lit * 100).toFixed(1)}% of the box around the impact`)
  await page.evaluate(() => window.__play.stop())
  await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
  await page.waitForTimeout(1200)
}

await next()
await page.waitForSelector(MARKER, { timeout: 20000 })
await page.waitForTimeout(6000)
// the car as the marker drew it, before the picker opens over it: the phone shot below uses it
// as the customer's photograph, so the tile is a real frame and not a white square
const carShot = await page.locator(MARKER).screenshot()
const c = await page.locator(MARKER).boundingBox()
await page.mouse.click(c.x + c.width * 0.42, c.y + c.height * 0.55)
await page.waitForTimeout(500)
// force: the popover follows the 3D point, and OrbitControls' damping keeps it drifting by
// fractions of a pixel for seconds, which Playwright's exact-rect stability check never accepts
await page.getByRole('button', { name: N.dent, exact: true }).click({ force: true })
await page.waitForTimeout(1800)
await shot('damage')

// ── the car with the damage drawn on it, and a photograph standing beside its panel ──
// The picker is closed through the marker's own store (the DEV `__probe`), which also clears
// the panel the camera is facing — a card on the faced panel stands aside so it cannot cover
// its own pin — and shrinks the selected mark's pin back to the dot the shader leaves under it,
// so what is left on the paint is the damage itself. The photograph is tagged to the front
// bumper, one panel round from the marked hood the camera is looking at, so the card stands
// clear of the mark instead of over it. The card is waited for in the scene rather than timed
// for: `__probe.card(i)` is null until it is there, and it is then held to standing well inside
// the frame — which is what makes this picture proof that the card is drawn where a reader can
// see it, and not merely tagged.
if (lang === 'en') {
  const MARGIN = 80
  await page.evaluate((sel) => document.querySelector(sel).__probe.store.getState().select(null), MARKER)
  await page.getByLabel(N.addPhotos).first().setInputFiles({ name: 'damage.png', mimeType: 'image/png', buffer: carShot })
  const shows = page.getByRole('combobox', { name: N.photoShows })
  await shows.waitFor({ timeout: 20000 }).catch(() => fail('the photograph never reached the pinned list'))
  await shows.selectOption('right_front_door')
  let card = null
  for (let i = 0; i < 40 && !card; i++) {
    await page.waitForTimeout(250)
    card = await page.evaluate((sel) => {
      const c = document.querySelector(sel)
      const at = c.__probe.card(0)
      return at && { at, size: [c.width, c.height] }
    }, MARKER)
  }
  if (!card) fail('the photograph tagged to the right front door never stood beside it on the car')
  const [x, y] = card.at
  const [w, h] = card.size
  if (x < MARGIN || y < MARGIN || x > w - MARGIN || y > h - MARGIN) fail(`the photograph's card is at the edge of the frame: ${Math.round(x)}, ${Math.round(y)} of ${w}×${h}`)
  await page.waitForTimeout(1500)
  await shotOf('marked-car', page.locator('.card:has(.cm-root)').first())
  console.log(`  the photograph's card stands at ${Math.round(x)}, ${Math.round(y)} of ${w}×${h} on the marker's canvas`)
}

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
// The README picture wants a photograph of a car in the tile, not a camera's test pattern, so
// this phone has no camera: the guided tiles then take the file-input path they always had
// (the live camera sheet is walked, and its release checked, by assist-smoke.mjs)
await phone.addInitScript(() => {
  if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: undefined })
})
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

// ── the same junction after dark ──────────────────────────────────────
// Nothing about the light is faked here: only the hour of the incident is moved, and the page
// looks that hour up for itself — `contextKey` is not persisted, so a reload re-runs the
// lookup — and the sun's altitude in the record is what `lightingFor` reads to put the
// headlights on. The picture waits for the record to say the sun is under the horizon by the
// same −6° `lightingFor` calls night, so a lookup that quietly answered nothing fails here
// rather than shipping a daylit frame captioned "at night".
if (lang === 'en') {
  const pad = (n) => String(n).padStart(2, '0')
  const yesterday = new Date(Date.now() - 86_400_000)
  const dark = JSON.parse(await page.evaluate(() => localStorage.getItem('claim-marker/draft')))
  // the lookup belongs to the Where step, which is where the hour is asked for: this walk lands
  // there, waits for the record, and then continues to the diagram the picture is of
  dark.state.step = 'where'
  dark.state.claim.incident = {
    ...dark.state.claim.incident,
    at: `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T21:30`,
    context: null,
    utcOffset: null,
  }
  const nightCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 })
  const nightPage = await nightCtx.newPage()
  await nightPage.route('**://overpass.kumi.systems/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: OVERPASS_FIXTURE }),
  )
  await nightPage.goto(`${origin}/`, { waitUntil: 'networkidle' })
  await nightPage.evaluate((s) => localStorage.setItem('claim-marker/draft', s), JSON.stringify(dark))
  await nightPage.reload({ waitUntil: 'networkidle' })
  await nightPage.waitForSelector('[data-looked-lines] li', { timeout: 40000 }).catch(() => fail('the looked-up card never finished for the night hour'))
  let sun = null
  for (let i = 0; i < 60 && !sun; i++) {
    await nightPage.waitForTimeout(500)
    sun = await nightPage.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.incident.context?.sun ?? null)
  }
  if (!sun) fail('the scene never looked the night hour up')
  if (sun.altitude > -6) fail(`21:30 is not after dark in the record: the sun stands ${sun.altitude.toFixed(1)}° above the horizon`)
  for (let i = 0; i < 3; i++) {
    await nightPage.getByRole('button', { name: new RegExp(`^${N.continue}`) }).click()
    await nightPage.waitForTimeout(600)
  }
  await nightPage.waitForSelector('.mk-car', { timeout: 30000 })
  await nightPage.waitForTimeout(9000)
  // taken from inside the chase, for the same reason the day one is: the DOM markers and their
  // pills stand down for a playback, so what is left in the frame is the scene's own light —
  // the headlights leading the car, the sky and ground colours the hour gives it
  await nightPage.getByRole('button', { name: N.watch }).click()
  await nightPage.waitForSelector('.maplibregl-map.mk-playing', { timeout: 5000 }).catch(() => fail('"Watch it" did not start on the night scene'))
  const drivingAt = await nightPage.evaluate(async () => {
    const map = window.__map
    const play = window.__play
    if (!play?.timeline) return { error: 'the night diagram did not expose the replay clock on window.__play' }
    play.seek(Math.max(0, play.timeline.impactMs - 900))
    await new Promise((r) => setTimeout(r, 400))
    for (let i = 0; i < 2; i++)
      await new Promise((r) => {
        map.once('render', () => requestAnimationFrame(r))
        map.triggerRepaint()
      })
    return { pitch: map.getPitch() }
  })
  if (drivingAt.error) fail(drivingAt.error)
  if (drivingAt.pitch < 40) fail(`the night frame is not inside the chase: pitch ${drivingAt.pitch.toFixed(0)}°`)
  await shotOf('night', nightPage.locator('.maplibregl-map').first())
  console.log(`  the record puts the sun ${sun.altitude.toFixed(1)}° below the horizon at ${dark.state.claim.incident.at}, chased at ${drivingAt.pitch.toFixed(0)}°`)
  await nightCtx.close()
}

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

const scene = await distinct(doc.attachments.scene)
const damage = await distinct(doc.attachments.damage.a)
console.log(`scene attachment ${scene.width}×${scene.height}, ${scene.colours} colours; damage attachment ${damage.width}×${damage.height}, ${damage.colours} colours`)
if (scene.colours < 50) fail('the scene attachment looks blank')
if (damage.colours < 50) fail('the damage attachment looks blank')

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log(`\nok — screenshots regenerated${lang === 'es' ? ' in Spanish (docs/es-*.png)' : ''}, both attachments are real frames`)
