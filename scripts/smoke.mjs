/**
 * The whole flow, end to end, in a headless browser: search an address, pick vehicles, drag
 * a car and its heading on the real map, mark a damage, send the report, and check the
 * document that came out. Unit tests cover the maths; this covers the product.
 *
 *   npm run dev   # in another shell
 *   node scripts/smoke.mjs [origin] [--lang=es]
 *
 * With `--lang=es` the same walk is driven in Spanish. It clicks nothing by an English word:
 * every name comes from `names()`, which reads the dictionaries the build emits beside the
 * parser (`dist/lib/messages.json`), so a step that forgets to translate something fails here
 * rather than in front of a customer. Each step also checks that no English sentence from the
 * dictionary is still on the page.
 */
import { readFileSync } from 'node:fs'
import { stampExif } from './exif-write.mjs'
import { describeVideo, readVideo, videoProblem } from './video-check.mjs'
import { chromium } from 'playwright'
import { zoneById } from '../src/zones.ts'

const args = process.argv.slice(2)
const origin = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173'
const lang = args.includes('--lang=es') ? 'es' : 'en'

const DICT = JSON.parse(readFileSync(new URL('../dist/lib/messages.json', import.meta.url), 'utf8'))
/** one message, in the language this run is driving, with its placeholders filled */
const t = (key, vars = {}) => String(DICT[lang][key] ?? DICT.en[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? vars[name] : whole))
/** a vehicle as the page names it: the year goes last in Spanish */
const named = (year, make, model) => (lang === 'es' ? `${make} ${model} ${year}` : `${year} ${make} ${model}`)
const starts = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

/**
 * Every name this walk clicks, types into or waits for, in the language it is driving.
 * Almost all of it is the dictionary; the three sentences at the end are composed by
 * `src/claim/describe.ts`, which builds them rather than looking one key up.
 */
const names = (lang) => ({
  kindGroup: t('start.kind.group'),
  weather: t('kind.weather.label'),
  collision: t('kind.collision.label'),
  continue: t('common.continue'),
  yes: t('common.yes'),
  no: t('common.no'),

  where: t('start.where.label'),
  fromPhoto: t('start.where.photo.start'),
  usePhoto: t('start.where.photo.use'),
  lookedUp: t('start.where.looked.title'),
  when: t('start.where.when'),
  weatherSel: t('start.where.weather'),
  roadSel: t('start.where.road'),
  lightSel: t('start.where.light'),

  addVehicle: t('start.vehicles.add'),
  bodyType: t('start.vehicles.bodyType'),
  make: t('start.vehicles.make'),
  year: t('start.vehicles.year'),
  model: t('start.vehicles.model'),
  plateState: t('start.vehicles.plateState'),
  van: t('body.van'),
  red: t('paint.red'),
  credit: t('start.photo.credit'),
  vinDiffers: t('start.vehicles.vinDiffers', { found: named(2003, 'Honda', 'Accord'), chosen: named(2021, 'Honda', 'CR-V') }),

  whoDriving: t('start.people.drivingTitle'),
  driverBName: t('start.people.nameOf', { who: t('start.people.whoDriverOf', { id: 'B' }) }),
  driverBPhone: t('start.people.phoneOf', { who: t('start.people.whoDriverOf', { id: 'B' }) }),
  insurerB: t('start.people.insurerOf', { id: 'B' }),
  policyB: t('start.people.policyOf', { id: 'B' }),
  addPassenger: t('start.people.addPassenger'),
  passengerName: t('start.people.nameOf', { who: t('role.passenger') }),
  hurtGroup: t('start.people.hurtGroup'),
  injurySam: t('start.people.injuryOf', { who: 'Sam Lee' }),
  policeGroup: t('start.people.policeGroup'),
  reportNumber: t('start.people.reportNumberOf'),
  addWitness: t('start.people.addWitness'),
  witnessName: t('start.people.nameOf', { who: t('role.witness') }),

  facingA: t('scene.facing.aria', { id: 'A' }),
  addBend: t('scene.path.bend'),
  tapMap: t('scene.path.tap'),
  done: t('scene.banner.done'),
  playBack: t('scene.play.start'),
  watch: t('scene.play.watch'),
  lot: t('surface.lot'),
  satellite: t('surface.satellite'),
  describeLabel: t('shell.describe.label'),
  hitOnBumper: t('scene.vehicle.hit', { panel: t('zone.front_bumper').toLowerCase() }).replace(/^\s*·\s*/, ''),

  dent: t('severity.dent'),
  missing: t('severity.missing'),
  addPhotos: t('damage.addPhotos'),
  // the scene photograph from the Where step is already photo 1, so the damage shot is photo 2
  photo2: t('damage.photo.alt', { n: 2 }),
  caption2: t('damage.photo.captionAria', { n: 2 }),
  markedForYou: t('damage.auto.title', { panel: t('zone.front_bumper').toLowerCase() }),
  drivable: t('damage.now.drivableAria'),
  airbags: t('damage.now.airbagsAria'),
  towed: t('damage.now.towedAria'),
  whereNow: t('damage.now.whereAria'),
  otherProperty: t('damage.property.whatAria'),

  send: t('scene.send.send'),
  yourName: t('scene.contact.name'),
  yourPhone: t('scene.contact.phoneAria'),
  yourEmail: t('scene.contact.emailAria'),
  policyholder: t('scene.contact.policyholderAria'),
  agree: t('scene.send.agreeAria'),
  sign: t('scene.send.signAria'),
  reportIn: t('shell.done.sent.title'),
  plain: t('scene.plain'),

  // composed by describe.ts, not looked up: the tag on a vehicle card, and one person's line
  yourVehicle: lang === 'es' ? 'Tu vehículo' : 'Your vehicle',
  samLine: lang === 'es' ? 'Sam Lee, viajaba en tu' : 'Sam Lee, passenger in your',
})
const N = names(lang)

/**
 * The English sentences the dictionary has a different Spanish one for, in fragments so that
 * a message with a placeholder in the middle still counts. Four words or more: shorter than
 * that and a label like "Model" or "VIN" is the same word in both.
 */
const ENGLISH = Object.keys(DICT.en).flatMap((key) =>
  DICT.es[key] === DICT.en[key]
    ? []
    : String(DICT.en[key])
        .split(/\{\w+\}/)
        .map((f) => f.trim())
        .filter((f) => f.split(/\s+/).length >= 4)
        .map((f) => [key, f]),
)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })

/**
 * Overpass answers from a recorded fixture, not from the internet.
 *
 * The weather stays live — Open-Meteo is reliable and generous — but every public Overpass
 * mirror throttles by IP, and under load it does not answer with an error, it simply does not
 * answer: measured from here, one request in three hangs past thirty seconds. A build gate
 * that depends on somebody else's spare capacity is not a gate. The fixture below is a real
 * answer, recorded from the live mirror for the coordinates this walk uses, so everything the
 * page does with it — the parse, the store, the layers, the words in the document — is proved
 * against real data, the roads and the building footprints alike (the file says which half was
 * recorded when). The live endpoint itself is proved by the page and by live-check.
 */
const OVERPASS_FIXTURE = readFileSync(new URL('./fixtures/overpass-times-square.json', import.meta.url), 'utf8')
let overpassHits = 0
await page.route('**://overpass.kumi.systems/**', (route) => {
  overpassHits++
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: OVERPASS_FIXTURE })
})
/** every reverse-geocoder request, with its query: a raw position must not leave before the customer agrees */
const reverseAsks = []
page.on('request', (r) => /\/reverse\?/.test(r.url()) && reverseAsks.push(r.url()))
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  if (errors.length) console.error(`console said:\n  ${errors.join('\n  ')}`)
  process.exit(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

/** the claim as the page has saved it */
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim)
/** the persisted state around the claim: which selects the lookup owns, where the flow is */
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state)

/** distinct colours in a data URL or canvas, sampled sparsely — a blank frame has one or two */
const colours = (sel, p = page) =>
  p.evaluate(async (sel) => {
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

/** wait for a real frame: three.js skips objects whose shaders are still linking */
const settled = async (sel, p = page) => {
  for (let i = 0; i < 60; i++) {
    if ((await colours(sel, p)) >= 50) return
    await p.waitForTimeout(300)
  }
  fail(`${sel} never rendered a frame`)
}

/**
 * The marker's canvas, read back: the mean luminance of the upper half of a ring 8–16 px round
 * where a point in the kit's units lands — outside the pin's own dot, and above the mark, where
 * a dent's wall is in shadow (its lower rim catches the key light and is not what is asserted) —
 * the colour of a 6-px spot `dy` below it, and the frame as a PNG. `n` picks the marker when a
 * page has several.
 */
const markerSample = (point, dy = 0, n = 0, p = page) =>
  p.evaluate(
    ([point, dy, n]) => {
      const c = document.querySelectorAll('.cm-root canvas')[n]
      const [x, y] = c.__probe.project(point)
      const off = document.createElement('canvas')
      off.width = c.width
      off.height = c.height
      const ctx = off.getContext('2d')
      ctx.drawImage(c, 0, 0)
      const ring = ctx.getImageData(x - 20, y - 20, 40, 40).data
      let sum = 0
      let count = 0
      for (let j = 0; j < 40; j++)
        for (let i = 0; i < 40; i++) {
          const r = Math.hypot(i - 20, j - 20)
          if (r < 8 || r > 16 || j >= 20) continue
          const k = (j * 40 + i) * 4
          sum += 0.299 * ring[k] + 0.587 * ring[k + 1] + 0.114 * ring[k + 2]
          count++
        }
      const spot = ctx.getImageData(x - 3, y + dy - 3, 6, 6).data
      const rgb = [0, 0, 0]
      for (let k = 0; k < spot.length; k += 4) for (let ch = 0; ch < 3; ch++) rgb[ch] += spot[k + ch] / 36
      return { x, y, mean: sum / count, spot: rgb.map(Math.round), png: c.toDataURL('image/png') }
    },
    [point, dy, n],
  )
/** how many pixels differ between two PNGs of the same size by more than a little in any channel */
const pixelsDiffering = (a, b, p = page) =>
  p.evaluate(
    async ([a, b]) => {
      const load = async (src) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height).data
      }
      const [pa, pb] = await Promise.all([load(a), load(b)])
      let n = 0
      for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) > 20 || Math.abs(pa[i + 1] - pb[i + 1]) > 20 || Math.abs(pa[i + 2] - pb[i + 2]) > 20) n++
      return n
    },
    [a, b],
  )
/**
 * How many pixels of the nth marker canvas are the cavity a missing part shows — dark, and a
 * shade warmer than the neutral of a tyre or the blue-black of glass — with the damage blended
 * in by `strength`. Set through the store behind the canvas: the review page has no slider.
 */
const cavityPixels = (strength, n = 0, p = page) =>
  p.evaluate(
    async ([strength, n]) => {
      const c = document.querySelectorAll('.cm-root canvas')[n]
      c.__probe.store.getState().setStrength(strength)
      await new Promise((r) => setTimeout(r, 500))
      const off = document.createElement('canvas')
      off.width = c.width
      off.height = c.height
      const ctx = off.getContext('2d')
      ctx.drawImage(c, 0, 0)
      const px = ctx.getImageData(0, 0, c.width, c.height).data
      let count = 0
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
        if (r >= 12 && r < 60 && g <= r && b < g && r - b >= 2 && r - b <= 10) count++
      }
      return count
    },
    [strength, n],
  )

const centre = async (locator) => {
  const b = await locator.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const drag = async (from, dx, dy) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}
const next = () => page.getByRole('button', { name: starts(N.continue) }).click()

/** nothing the customer can read on this step may still be in English */
const noEnglish = async (where) => {
  if (lang === 'en') return
  const text = await page.evaluate(() => document.body.innerText)
  const left = ENGLISH.filter(([, sentence]) => text.includes(sentence))
  if (left.length) fail(`English left on ${where}: ${left.map(([k, f]) => `${k} — "${f.slice(0, 70)}"`).join('\n  ')}`)
}

// the host fixes the language, which is also the path an insurer serving a Spanish page takes
if (lang === 'es') await page.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
await page.goto(`${origin}/`, { waitUntil: 'networkidle' })

// ── 0 · what happened ─────────────────────────────────────────────────
// the kind decides the flow: a hail claim has no other party and nothing to diagram
await page.waitForSelector(`[role=radiogroup][aria-label="${N.kindGroup}"]`)
const kinds = page.locator(`[role=radiogroup][aria-label="${N.kindGroup}"] [role=radio]`)
if ((await kinds.count()) !== 8) fail(`expected 8 kinds of incident, got ${await kinds.count()}`)
await page.getByRole('radio', { name: starts(N.weather) }).click()
await page.waitForTimeout(300)
if ((await page.locator('header ol li').count()) !== 6) fail(`a weather claim should have 6 steps, got ${await page.locator('header ol li').count()}`)
if ((await draft()).vehicles.length !== 1) fail('a weather claim should drop the other vehicle')
await page.getByRole('radio', { name: starts(N.collision) }).click()
await page.waitForTimeout(300)
if ((await page.locator('header ol li').count()) !== 7) fail('a collision should have 7 steps')
if ((await draft()).vehicles.length !== 2) fail('switching back to a collision should bring an other vehicle back')
await noEnglish('what happened')
ok('what happened: 8 kinds; weather drops the other vehicle and the diagram step, collision brings them back')
await next()

// ── 1 · where ──────────────────────────────────────────────────────────
if (!(await page.getByRole('button', { name: starts(N.continue) }).isDisabled())) fail('Continue should be disabled until a place is chosen')

// ── a photograph that knows where and when it was taken ───────────────
// A date far enough back that the weather comes from the archive rather than the forecast
// endpoint, which is the path an insurer's real claims take. The zone is stamped into the
// photograph too, so the minutes come out zero on a machine in any zone.
const past = new Date(Date.now() - 10 * 86400000)
const pastLocal = `${new Date(past.getTime() - past.getTimezoneOffset() * 60000).toISOString().slice(0, 11)}08:00`
const withExif = stampExif(readFileSync(new URL('./fixtures/scene.jpg', import.meta.url)), {
  takenAt: pastLocal,
  offset: '-04:00',
  lng: -73.9859,
  lat: 40.7573,
})
const asksBefore = reverseAsks.length
await page.setInputFiles(`input[type=file][aria-label="${N.fromPhoto}"]`, { name: 'scene.jpg', mimeType: 'image/jpeg', buffer: withExif })
await page.waitForSelector('[data-photo-found]', { timeout: 20000 })
const offered = await page.locator('[data-photo-found]').innerText()
// offered as rounded coordinates, and not yet sent anywhere: a gallery photo may have been taken at home
if (!/40\.757, -73\.986/.test(offered)) fail(`the photo's own place was not offered, rounded: ${offered}`)
if (/40\.7573|-73\.9859/.test(offered)) fail(`the photo's exact position is on screen before the customer agreed: ${offered}`)
await page.waitForTimeout(500)
if (reverseAsks.length !== asksBefore) fail(`the photo's position went to the geocoder before "use that": ${reverseAsks.slice(asksBefore).join(' ')}`)
await page.getByRole('button', { name: N.usePhoto }).click()
await page
  .waitForFunction(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.incident.location, null, { timeout: 20000 })
  .catch(() => fail('"use that" did not set the place'))
if (reverseAsks.length !== asksBefore + 1) fail(`after "use that" the position should be looked up once, was ${reverseAsks.length - asksBefore} times`)
const fromPic = await draft()
if (!fromPic.incident.location || Math.abs(fromPic.incident.location.lat - 40.7573) > 0.001) fail(`the photo did not fill the place: ${JSON.stringify(fromPic.incident.location)}`)
if (fromPic.incident.at !== pastLocal) fail(`the photo did not fill the time: ${fromPic.incident.at} vs ${pastLocal}`)
const scenePic = fromPic.attachments.photos[0]
if (!scenePic || scenePic.of !== null) fail('the photo was not kept as a photo of the scene')
if (scenePic.metresFromScene !== 0 || scenePic.minutesFromIncident !== 0) fail(`the photo's distances are wrong: ${JSON.stringify(scenePic)}`)
ok(`where: a photograph filled the place and the time by itself, and is ${scenePic.metresFromScene} m / ${scenePic.minutesFromIncident} min from the claim`)

await page.getByRole('combobox', { name: N.where }).fill('Times Square New York')
await page.waitForSelector('[role=option]', { timeout: 20000 })
await page.locator('[role=option]').first().click()
await page.waitForTimeout(1200)
if ((await page.locator('[role=option]').count()) !== 0) fail('the suggestions stayed open after picking one')
const d1 = await draft()
if (!d1.incident.location || !/Times Square/.test(d1.incident.location.address)) fail(`location not saved: ${JSON.stringify(d1.incident.location)}`)

// the street map has to actually paint. It once did not: the vector provider answered every
// tile with 200 and an empty body, so the style drew its background colour and nothing else,
// which looks exactly like a map that is still loading.
await settled('.maplibregl-canvas')
const streetColours = await colours('.maplibregl-canvas')
if (streetColours < 60) fail(`the street map looks blank (${streetColours} distinct colours)`)
// ── the scene fills itself in ─────────────────────────────────────────
// the photograph already set this minute; setting it again is what a customer who typed it
// would do, and the lookup has to answer for it either way
await page.locator('input[type=datetime-local]').fill(pastLocal)
await page.waitForSelector(`[data-looked] [data-looked-lines] li`, { timeout: 30000 })
const lookedLines = await page.locator('[data-looked-lines] li').allInnerTexts()
if (lookedLines.length < 2) fail(`the looked-up card says almost nothing: ${JSON.stringify(lookedLines)}`)
if (!(await page.locator(`text=${N.lookedUp}`).count())) fail('the looked-up card has no title')

const looked = await state()
const ctx = looked.claim.incident.context
if (!ctx) fail('nothing was looked up')
if (!ctx.weather || typeof ctx.weather.code !== 'number') fail(`no weather in the context: ${JSON.stringify(ctx)}`)
if (!ctx.sun || !Number.isFinite(ctx.sun.altitude)) fail(`no sun in the context: ${JSON.stringify(ctx.sun)}`)
if (!ctx.road || !ctx.road.class) fail(`no road in the context (overpass answered ${overpassHits} time(s)): ${JSON.stringify(ctx)}`)
if (looked.claim.incident.utcOffset === null) fail('the lookup did not resolve the zone, so `at` is still a wall clock')
// the three selects were filled by the lookup and are still following it
const condsOwned = looked.autoConditions ?? {}
for (const k of ['weather', 'road', 'light']) {
  if (condsOwned[k] !== 'auto') fail(`${k} was not filled by the lookup (${JSON.stringify(condsOwned)})`)
  if (!looked.claim.incident.conditions[k]) fail(`${k} is marked auto but empty`)
}
// a photograph of a wet road is not what the customer remembers: touching a select takes it
await page.getByRole('combobox', { name: N.weatherSel }).selectOption('rain')
await page.getByRole('combobox', { name: N.roadSel }).selectOption('wet')
await page.getByRole('combobox', { name: N.lightSel }).selectOption('daylight')
const condsTaken = (await state()).autoConditions ?? {}
for (const k of ['weather', 'road', 'light']) if (condsTaken[k] !== 'user') fail(`${k} should be the customer's after they picked it (${JSON.stringify(condsTaken)})`)
// and the card, which says "public records, not your answers", still reads the record
const lookedAfter = await page.locator('[data-looked-lines] li').allInnerTexts()
if (JSON.stringify(lookedAfter) !== JSON.stringify(lookedLines)) fail(`the looked-up card followed the customer's answers: ${JSON.stringify(lookedLines)} → ${JSON.stringify(lookedAfter)}`)
// and it stops following: moving the pin re-runs the lookup and must not take them back
const pinned = (await draft()).incident.conditions
await noEnglish('where')
ok(`where: ${d1.incident.location.address}, street tiles painted (${streetColours} colours); looked up "${lookedLines.join(' · ')}", then the customer took the three selects (${JSON.stringify(pinned)})`)

// ── 2 · vehicles ───────────────────────────────────────────────────────
await next()
await page.waitForSelector(`text=${N.yourVehicle}`)
await page.getByRole('button', { name: N.addVehicle }).click()
const cards = page.locator(`[role=radiogroup][aria-label="${N.bodyType}"]`)
if ((await cards.count()) !== 3) fail(`expected 3 vehicle cards, got ${await cards.count()}`)

// make, year and model from the lists; the model list comes from the vehicle database
const makes = page.getByRole('combobox', { name: N.make })
const years = page.getByRole('combobox', { name: N.year })
const modelsA = page.getByRole('combobox', { name: N.model }).first()
await makes.first().selectOption('Honda')
await years.first().selectOption('2021')
await page.waitForFunction((label) => {
  const sel = document.querySelector(`select[aria-label="${label}"]`)
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'CR-V')
}, N.model, { timeout: 30000 })
await modelsA.selectOption('CR-V')
const d2a = await draft()
if (d2a.vehicles[0].make !== 'Honda' || d2a.vehicles[0].model !== 'CR-V' || d2a.vehicles[0].year !== 2021) fail(`make/model/year not saved: ${JSON.stringify([d2a.vehicles[0].make, d2a.vehicles[0].model, d2a.vehicles[0].year])}`)
if (d2a.vehicles[0].body !== 'suv') fail(`a CR-V should pick the SUV shape, got ${d2a.vehicles[0].body}`)
ok(`vehicles: ${d2a.vehicles[0].year} ${d2a.vehicles[0].make} ${d2a.vehicles[0].model} from the database, shape ${d2a.vehicles[0].body}`)

await page.getByRole('textbox', { name: 'VIN' }).first().fill('1hgcm82633a004352')
// that VIN is a real 2003 Accord: the page must say so rather than overwrite the CR-V the customer picked
await page.waitForSelector(`text=${N.vinDiffers}`, { timeout: 20000 }).catch(() => fail('a VIN that disagrees with the chosen model was not pointed out'))
await page.getByRole('textbox', { name: N.plateState }).first().fill('ny')
await cards.nth(1).getByRole('radio', { name: N.van }).click()
await cards.nth(0).locator('..').locator('..').getByRole('radio', { name: N.red }).click()
const d2 = await draft()
if (d2.vehicles[1].body !== 'van') fail(`body change did not save: ${d2.vehicles[1].body}`)
if (d2.vehicles[0].color !== '#b91c1c') fail(`colour change did not save: ${d2.vehicles[0].color}`)
await page.waitForTimeout(2500)
if ((await page.locator('canvas').count()) < 2) fail('expected a 3D preview on each card without a make and model yet')
ok(`vehicles: ${d2.vehicles.map((v) => `${v.id}:${v.body}`).join(' ')}`)

// the real car: a photograph of the make and model, found and actually loaded by the browser
const alt = named(d2a.vehicles[0].year, d2a.vehicles[0].make, d2a.vehicles[0].model)
await page
  .waitForFunction((alt) => {
    const i = document.querySelector(`img[alt="${alt}"]`)
    return i && i.complete && i.naturalWidth > 0
  }, alt, { timeout: 30000 })
  .catch(() => fail(`no photograph of the ${alt} loaded on its card`))
const photoSrc = await page.locator(`img[alt="${alt}"]`).getAttribute('src')
if (!/wikimedia\.org/.test(photoSrc)) fail(`the photograph came from somewhere unexpected: ${photoSrc}`)
if (!(await page.locator('a', { hasText: N.credit }).count())) fail('the photograph is not credited')
await noEnglish('vehicles')
ok(`vehicles: a real photograph of the ${alt} on its card`)

// ── 2b · people, injuries, police ──────────────────────────────────────
await next()
await page.waitForSelector(`text=${N.whoDriving}`)
// the other driver, off their insurance card
await page.getByRole('textbox', { name: N.driverBName }).fill('Dana Q')
await page.getByRole('textbox', { name: N.driverBPhone }).fill('555 0199')
await page.getByRole('textbox', { name: N.insurerB }).fill('Acme Mutual')
await page.getByRole('textbox', { name: N.policyB }).fill('am-77')
// a passenger in the customer's car, who was hurt
await page.getByRole('button', { name: N.addPassenger }).click()
await page.getByRole('textbox', { name: N.passengerName }).fill('Sam Lee')
await page.locator(`[role=radiogroup][aria-label="${N.hurtGroup}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.getByRole('checkbox', { name: starts(N.samLine) }).check()
await page.getByRole('textbox', { name: N.injurySam }).fill('Whiplash, seen at urgent care')
await page.locator(`[role=radiogroup][aria-label="${N.policeGroup}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.getByRole('textbox', { name: N.reportNumber }).fill('2026-0042')
await page.getByRole('button', { name: N.addWitness }).click()
await page.getByRole('textbox', { name: N.witnessName }).fill('Wit Ness')
const d2b = await draft()
const roles = d2b.people.map((p) => p.role).sort().join(',')
if (roles !== 'driver,passenger,witness') fail(`people not saved: ${roles}`)
if (!d2b.people.find((p) => p.role === 'passenger')?.injured) fail('the injured passenger was not marked as hurt')
if (d2b.police.called !== true || d2b.police.report !== '2026-0042') fail(`police not saved: ${JSON.stringify(d2b.police)}`)
await noEnglish('people')
ok('people: the other driver and insurer, an injured passenger, the police report, a witness')

// ── 3 · the map ────────────────────────────────────────────────────────
await next()
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
await page.waitForSelector('.mk-car', { timeout: 20000 })
await page.waitForTimeout(6000)
if ((await page.locator('.mk-car').count()) !== 3) fail(`expected 3 cars on the map, got ${await page.locator('.mk-car').count()}`)
// the diagram is lit from the live record — the sun at 08:00 on that day, the weather that hour —
// and a gate that samples pixels must not depend on the season or on somebody else's answer:
// "Plain view" for the walk, and the light as it was is proved on its own seeded pages below
await page.getByRole('button', { name: N.plain }).click()
await page.waitForTimeout(600)
if (!(await state()).plainView) fail('"Plain view" did not take on the diagram')
const before = (await draft()).vehicles[0].position
if (!before) fail('vehicle A was not placed on the map')

// the road the cars are standing on, drawn from the same Overpass answer the document quotes.
// Asserted on the source rather than by sampling pixels: a thin white line over satellite
// imagery is exactly the kind of check that passes on one machine's GPU and fails on another
const ways = await page.evaluate(() => {
  const map = window.__map
  if (!map) return 'no __map handle on the diagram'
  if (!map.getSource('roads')) return `no roads source; sources: ${Object.keys(map.getStyle().sources).join(',')}`
  const data = map.getSource('roads').serialize().data
  return { drawn: data?.features?.length ?? 0, rendered: map.querySourceFeatures('roads').length }
})
if (typeof ways === 'string' || !ways.drawn) fail(`the roads layer has no ways to draw (${JSON.stringify(ways)})`)
const roadsVisible = await page.evaluate(() => ({
  ids: window.__map.getStyle().layers.map((l) => l.id),
  vis: ['roads-casing', 'roads-core'].map((id) => (window.__map.getLayer(id) ? (window.__map.getLayoutProperty(id, 'visibility') ?? 'visible') : 'missing')),
}))
if (roadsVisible.vis.some((v) => v !== 'visible')) fail(`the roads layers are not visible on the satellite ground: ${JSON.stringify(roadsVisible)}`)
ok(`the map: ${ways.drawn} ways of real road under the cars, ${ways.rendered} of them in view`)

// drag the customer's car east; the drag itself is the route, so the car follows the
// pointer, leaves a trail behind it and turns to face the way it is going
await page.evaluate(() => localStorage.setItem('cm-probe', '1'))
const pathBefore = (await draft()).vehicles[0].path.length
await drag(await centre(page.locator('.mk-car').first()), 150, 20)
const dragged = (await draft()).vehicles[0]
const movedEast = dragged.position[0] - before[0]
if (movedEast < 0.00003) fail(`car did not follow the drag (Δlng ${movedEast})`)
if (dragged.path.length <= pathBefore) fail(`the drag drew no path (${pathBefore} → ${dragged.path.length} points)`)
if (dragged.heading < 45 || dragged.heading > 135) fail(`dragging east should face the car east, got ${dragged.heading}°`)
// and the path has to be on screen, not just in the store: the GeoJSON layers silently drew
// nothing for three commits while MapLibre's worker URL was a 404. Sample the canvas halfway
// between the first waypoint and the car for the vehicle's blue.
const blueShare = await page.evaluate(() => {
  const way = document.querySelector('.mk-way').getBoundingClientRect()
  const car = document.querySelector('.mk-car').getBoundingClientRect()
  const canvas = document.querySelector('.maplibregl-canvas')
  const cr = canvas.getBoundingClientRect()
  const dpr = canvas.width / cr.width
  const off = document.createElement('canvas')
  off.width = canvas.width
  off.height = canvas.height
  const ctx = off.getContext('2d')
  ctx.drawImage(canvas, 0, 0)
  const mx = ((way.left + way.width / 2 + car.left + car.width / 2) / 2 - cr.left) * dpr
  const my = ((way.top + way.height / 2 + car.top + car.height / 2) / 2 - cr.top) * dpr
  const size = 24 * dpr
  const px = ctx.getImageData(mx - size / 2, my - size / 2, size, size).data
  // by hue, not by level: the car's own shadow — a low morning sun, as the record has it —
  // can lie across this stretch of the path, and a path in shadow is still on the map
  let blue = 0
  for (let i = 0; i < px.length; i += 4) if (px[i + 2] > 100 && px[i + 2] > px[i] * 1.6 && px[i + 2] > px[i + 1] * 1.25) blue++
  return blue / (px.length / 4)
})
if (blueShare < 0.05) fail(`the path is in the store but not on the map (${(blueShare * 100).toFixed(0)}% blue between the waypoint and the car)`)
ok(`map: dragging drew the path (${pathBefore} → ${dragged.path.length} points, ${(blueShare * 100).toFixed(0)}% blue on screen) and faced the car ${dragged.heading}°`)

// the 3D car under the marker must be its paint: red pixels, not the pink an overexposed
// layer produces, and not the grey of a paint that never got applied
const redShare = await page.evaluate(() => {
  const r = document.querySelector('.mk-car').getBoundingClientRect()
  const canvas = document.querySelector('.maplibregl-canvas')
  const cr = canvas.getBoundingClientRect()
  const dpr = canvas.width / cr.width
  const off = document.createElement('canvas')
  off.width = canvas.width
  off.height = canvas.height
  const ctx = off.getContext('2d')
  ctx.drawImage(canvas, 0, 0)
  // the marker sits at the wheels; the paint — roof, hood, doors — is above it on a tilted map
  const size = 56 * dpr
  const x = (r.left + r.width / 2 - cr.left) * dpr - size / 2
  const y = (r.top + r.height / 2 - cr.top) * dpr - size / 2 - 12 * dpr
  const px = ctx.getImageData(x, y, size, size).data
  let red = 0
  for (let i = 0; i < px.length; i += 4) if (px[i] > 90 && px[i] > px[i + 1] * 1.6 && px[i] > px[i + 2] * 1.6) red++
  return red / (px.length / 4)
})
if (redShare < 0.08) fail(`car A on the map is not red (${(redShare * 100).toFixed(0)}% red pixels around its marker)`)
ok(`map: car A renders in its paint (${(redShare * 100).toFixed(0)}% red around the marker)`)

// select it, turn it with the facing slider, and check the heading and the arrow follow
await page.locator('.mk-car').first().click()
await page.waitForSelector('.mk-car[data-selected="true"] .mk-turn', { timeout: 5000 })
const h0 = (await draft()).vehicles[0].heading
await page.getByRole('slider', { name: N.facingA }).fill('135')
await page.waitForTimeout(300)
const h1 = (await draft()).vehicles[0].heading
if (h1 !== 135) fail(`heading did not follow the slider (${h0} → ${h1})`)
if ((await page.locator('.mk-way').count()) < 1) fail('the selected vehicle shows no waypoint')
ok(`map: facing ${h0}° → ${h1}° via the slider`)

// and on the map itself: drag the handle ahead of the nose round to the east of the car.
// The car must turn, not move — the handle's drag must never become the marker's drag.
const carCentre = await centre(page.locator('.mk-car').first())
const handleAt = await centre(page.locator('.mk-car[data-selected="true"] .mk-turn'))
await page.mouse.move(handleAt.x, handleAt.y)
await page.mouse.down()
await page.mouse.move(carCentre.x + 90, carCentre.y, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
const turned = (await draft()).vehicles[0]
if (Math.abs(turned.heading - 90) > 12) fail(`dragging the handle east of the car should face it east, got ${turned.heading}°`)
if (Math.hypot(turned.position[0] - dragged.position[0], turned.position[1] - dragged.position[1]) > 1e-7) fail('turning the car by its handle moved it')
ok(`map: turned on the map by its handle, ${h1}° → ${turned.heading}°`)

// a point added by hand, for a bend the drag did not capture
await page.getByRole('button', { name: new RegExp(`${N.addBend}|${N.tapMap}`) }).click()
const mapBox = await page.locator('.maplibregl-canvas').boundingBox()
const before3 = (await draft()).vehicles[0].path.length
await page.mouse.click(mapBox.x + mapBox.width * 0.3, mapBox.y + mapBox.height * 0.3)
await page.waitForTimeout(300)
if ((await draft()).vehicles[0].path.length !== before3 + 1) fail('tapping the map did not add to the path')
await page.getByRole('button', { name: N.done, exact: true }).click()

// nobody asks for the impact: drag one car onto another and the cross appears between them
if ((await draft()).impact) fail('the impact should not exist before the cars have met')
// B swings out past A and comes back at it from the east, so it ends nose to nose with A
// (which now faces east): its centre stops a bumper's length short of A's, overlapping by
// half a metre, and the last leg of the drag leaves it facing west
const carB = await centre(page.locator('.mk-car').nth(1))
const carA = await centre(page.locator('.mk-car').first())
const aBox = await page.locator('.mk-car').first().boundingBox()
const bBox = await page.locator('.mk-car').nth(1).boundingBox()
const noseToNose = Math.max(aBox.width, aBox.height) / 2 + Math.max(bBox.width, bBox.height) / 2 - 8
await page.mouse.move(carB.x, carB.y)
await page.mouse.down()
await page.mouse.move(carA.x + noseToNose + 160, carA.y - 70, { steps: 12 })
await page.mouse.move(carA.x + noseToNose + 160, carA.y, { steps: 6 })
await page.mouse.move(carA.x + noseToNose, carA.y, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(300)
await page.waitForSelector('.mk-impact', { timeout: 5000 })
const hit = (await draft()).impact
if (!hit) fail('driving one car into another did not mark an impact')
const [ax, ay] = (await draft()).vehicles[0].position
const off = Math.hypot(hit[0] - ax, hit[1] - ay)
if (off > 0.0002) fail(`the impact landed ${off} away from the cars, not between them`)
ok(`map: impact found on its own when the cars met`)

// the diagram already says which panel each car was hit on: nose to nose, both front bumpers
const hitA = (await draft()).vehicles[0].damages
const hitB = (await draft()).vehicles[1].damages
if (hitA.length !== 1 || hitA[0].zone !== 'front_bumper') fail(`A should be marked on the front bumper from the impact, got ${JSON.stringify(hitA)}`)
if (hitB.length !== 1 || hitB[0].zone !== 'front_bumper') fail(`B should be marked on the front bumper from the impact, got ${JSON.stringify(hitB)}`)
if (!(await page.locator(`text=${N.hitOnBumper}`).count())) fail('the vehicle list does not say where it was hit')
ok('map: both cars marked on the front bumper from the impact')

// play it back: the handles step aside while the cars drive their routes, then come back
await page.getByRole('button', { name: N.playBack }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
if ((await page.locator('.mk-car').count()) !== 3) fail('the cars did not come back after playback')
ok('map: playback ran and handed the map back')

// the city around the crash: the buildings the same Overpass answer carried, extruded under
// everything else. The flat map shows them as flat footprints; the tilt below is the point.
const city = await page.evaluate(async () => {
  const map = window.__map
  if (!map.getLayer('buildings')) return null
  const fc = await map.getSource('buildings').getData()
  return fc.features.map((f) => {
    const ring = f.geometry.coordinates[0]
    const n = ring.length - 1
    let x = 0
    let y = 0
    for (let i = 0; i < n; i++) {
      x += ring[i][0]
      y += ring[i][1]
    }
    return { at: [x / n, y / n], height: f.properties.height }
  })
})
if (!city) fail('the map has no building-extrusion layer')
if (city.length <= 20) fail(`Times Square should be full of buildings; the layer holds ${city.length}`)
if (!city.every((b) => b.height > 0)) fail(`a building has no height to extrude to: ${JSON.stringify(city.filter((b) => !(b.height > 0)))}`)
// and they paint, flat, on the map the customer is actually editing on — which is also what
// `compose()` puts in `attachments.scene`. Zoomed out to see a block at all: at the diagram's
// own zoom the nearest frontage is past the edge of a 700 px canvas.
const diagramZoom = await page.evaluate(() => {
  const z = window.__map.getZoom()
  window.__map.setZoom(17)
  return z
})
await page.waitForTimeout(2500)
const flat = await page.evaluate(() => {
  const map = window.__map
  const src = map.getCanvas()
  const off = document.createElement('canvas')
  off.width = off.height = 1
  const ctx = off.getContext('2d', { willReadFrequently: true })
  const dpr = src.width / src.clientWidth
  const mid = [src.clientWidth / 2, src.clientHeight / 2]
  const sampled = []
  for (let gx = 0.1; gx < 1; gx += 0.2) {
    for (let gy = 0.1; gy < 1; gy += 0.2) {
      const x = Math.round(gx * src.clientWidth)
      const y = Math.round(gy * src.clientHeight)
      // the middle of the frame is the cars, their paths, the impact cross and the road
      if (Math.hypot(x - mid[0], y - mid[1]) < 150) continue
      if (!map.queryRenderedFeatures([x, y], { layers: ['buildings'] }).length) continue
      ctx.drawImage(src, x * dpr, y * dpr, 1, 1, 0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      sampled.push({ grey: Math.max(r, g, b) - Math.min(r, g, b) <= 18 && (r + g + b) / 3 > 100, rgb: [r, g, b] })
    }
  }
  return sampled
})
await page.evaluate((z) => window.__map.setZoom(z), diagramZoom)
await page.waitForTimeout(1500)
const flatGrey = flat.filter((p) => p.grey).length
if (flat.length < 3) fail(`the flat map draws no building footprints to sample (${flat.length} points on the layer)`)
if (flatGrey / flat.length < 0.75) fail(`the flat footprints are not the extrusion's grey: ${JSON.stringify(flat)}`)
ok(`map: ${city.length} building footprints on the map, the tallest ${Math.max(...city.map((b) => b.height))} m; flat, they paint over the imagery (${flatGrey}/${flat.length} sampled points the extrusion's grey, e.g. rgb(${flat.find((p) => p.grey).rgb}))`)

// watch it: the camera opens up and chases, the shockwave rings the impact, and the diagram
// comes back exactly as it was — flat, north-up, every marker where it stood. The ring lives
// 600 ms of the playback's clock and a loaded machine decides how many frames of that a
// sampler gets to see, so nothing here races it: the replay's own clock is driven from here
// (`window.__play`, DEV only, from the diagram step) and settled frames of the same chase shot
// are compared — inside the ring's life against just after it has gone, one camera, one pose.
const carsBefore = await page.evaluate(() => [...document.querySelectorAll('.mk-car')].map((e) => [e.getBoundingClientRect().left, e.getBoundingClientRect().top]))
await page.getByRole('button', { name: N.watch }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
const watched = await page.evaluate(async (impact) => {
  const map = window.__map
  const play = window.__play
  if (!play?.timeline) return { error: 'the diagram step did not expose the replay clock on window.__play' }
  const RING_MS = 600 // src/map/playback.ts
  const size = 160
  const off = document.createElement('canvas')
  off.width = off.height = size
  const ctx = off.getContext('2d', { willReadFrequently: true })
  // the box around the impact, wherever the camera has put it
  const box = () => {
    const src = map.getCanvas()
    const p = map.project(impact)
    const dpr = src.width / src.clientWidth
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(src, (p.x - size / 2) * dpr, (p.y - size / 2) * dpr, size * dpr, size * dpr, 0, 0, size, size)
    return ctx.getImageData(0, 0, size, size).data
  }
  // A building's own wall, once the camera is tilted. Where the map is drawing one is asked of
  // the map rather than worked out from a footprint: a block's centroid at this zoom is
  // usually off the top of the frame while the building itself fills it. So a coarse grid is
  // queried against the extrusion layer, and the first column of pixels with the layer at both
  // of its ends is read back off the canvas. That column is a wall, and a wall is one flat
  // grey — the satellite's picture of the same block, at this zoom, never is.
  const COLUMN = 24
  const wall = () => {
    const src = map.getCanvas()
    const dpr = src.width / src.clientWidth
    const on = (x, y) => map.queryRenderedFeatures([x, y], { layers: ['buildings'] })
    for (let gx = 0.15; gx < 1; gx += 0.2) {
      for (let gy = 0.08; gy < 0.6; gy += 0.13) {
        const x = Math.round(gx * src.clientWidth)
        const y = Math.round(gy * src.clientHeight)
        const hit = on(x, y)
        if (!hit.length || !on(x, y + COLUMN).length) continue
        ctx.clearRect(0, 0, size, size)
        ctx.drawImage(src, (x - 1) * dpr, y * dpr, 3 * dpr, COLUMN * dpr, 0, 0, 3, COLUMN)
        const px = ctx.getImageData(0, 0, 3, COLUMN).data
        const n = px.length / 4
        let grey = 0
        const sum = [0, 0, 0]
        for (let i = 0; i < px.length; i += 4) {
          const [r, g, bl] = [px[i], px[i + 1], px[i + 2]]
          sum[0] += r
          sum[1] += g
          sum[2] += bl
          if (Math.max(r, g, bl) - Math.min(r, g, bl) <= 16 && (r + g + bl) / 3 > 80) grey++
        }
        return { grey: grey / n, mean: sum.map((v) => Math.round(v / n)), height: hit[0].properties.height }
      }
    }
    return null
  }
  const walls = []
  // one moment on the playback clock, settled: the seek holds the frame loop there, the page
  // hands that frame to the map, and the map is made to paint before the pixels are read back
  const at = async (ms) => {
    play.seek(ms)
    await new Promise((r) => setTimeout(r, 250))
    for (let i = 0; i < 2; i++)
      await new Promise((r) => {
        map.once('render', () => requestAnimationFrame(r))
        map.triggerRepaint()
      })
    return { px: box(), pitch: map.getPitch() }
  }
  const { impactMs } = play.timeline
  // the reference frame: the same shot once the ring has gone — same camera, same cars, no
  // shockwave — so what lights up against it is the shockwave and nothing else
  const gone = await at(impactMs + RING_MS + 50)
  const lit = ({ px }) => {
    let n = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] - gone.px[i] > 25 && px[i + 1] - gone.px[i + 1] > 25) n++
    return n / (px.length / 4)
  }
  // the ring is scaled from nothing, so the moment of impact itself is the control: the same
  // frame again, with a ring of no radius in it
  const born = lit(await at(impactMs))
  const frames = []
  for (const u of [0.6, 0.7, 0.8]) {
    const f = await at(impactMs + u * RING_MS)
    frames.push(f)
    // The city is read off these same three frames. They are already settled and the camera is
    // already tilted on them — the pitch assertion below says so — and the wall is taken after
    // the ring's pixels have been copied out of the canvas, so the most expensive thing here
    // (a grid of queryRenderedFeatures and a canvas read) costs the measurement beside it
    // nothing. Three readings prove the city; there is no fourth frame to want.
    const w = wall()
    if (w) walls.push(w)
  }
  play.stop()
  walls.sort((a, b) => b.grey - a.grey)
  return {
    born,
    rings: frames.map(lit),
    pitch: Math.max(...frames.map((f) => f.pitch)),
    gonePitch: gone.pitch,
    walls: walls.length,
    wall: walls[0] ?? null,
  }
}, (await draft()).impact)
const pc = (n) => `${(n * 100).toFixed(0)}%`
if (watched.error) fail(watched.error)
const peak = Math.max(...(watched.rings ?? [0]))
if (watched.pitch < 40) fail(`watching never tilted the map (pitch was ${watched.pitch.toFixed(0)}° on the shockwave's own frames)`)
if (Math.abs(watched.pitch - watched.gonePitch) > 1)
  fail(`the frames compared are not the same shot, so nothing is proved (pitch ${watched.pitch.toFixed(0)}° with the ring, ${watched.gonePitch.toFixed(0)}° without)`)
if (peak < 0.1) fail(`no shockwave: it lit [${watched.rings.map(pc).join(' ')}] of the box around the impact against the same frame with the ring gone`)
if (watched.born > 0.05) fail(`the box around the impact changes without a shockwave in it (${pc(watched.born)} at the moment of impact, where the ring has no radius yet)`)
if (!watched.wall) fail(`no building stood up in front of the tilted camera on the shockwave's own frames`)
if (watched.wall.grey < 0.9) fail(`what the extrusion layer drew is not its own flat grey: ${(watched.wall.grey * 100).toFixed(0)}% grey, mean rgb(${watched.wall.mean})`)
await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
const home = await page.evaluate(() => ({ pitch: window.__map.getPitch(), bearing: window.__map.getBearing() }))
if (home.pitch !== 0 || home.bearing !== 0) fail(`the map came back tilted (pitch ${home.pitch}, bearing ${home.bearing})`)
const carsAfter = await page.evaluate(() => [...document.querySelectorAll('.mk-car')].map((e) => [e.getBoundingClientRect().left, e.getBoundingClientRect().top]))
if (carsAfter.length !== carsBefore.length || carsAfter.some(([x, y], i) => Math.abs(x - carsBefore[i][0]) > 1 || Math.abs(y - carsBefore[i][1]) > 1))
  fail(`the markers came back somewhere else: ${JSON.stringify(carsBefore)} → ${JSON.stringify(carsAfter)}`)
ok(
  `map: watched it — the camera tilted to ${watched.pitch.toFixed(0)}°, the shockwave lit [${watched.rings.map(pc).join(' ')}] of the box around the impact against the same frame once it had gone (${pc(watched.born)} before it had any radius), buildings stood in front of it on ${watched.walls} of those frames (a ${watched.wall.height} m wall read ${(watched.wall.grey * 100).toFixed(0)}% flat grey, rgb(${watched.wall.mean})), and the map came back flat with the markers where they were`,
)

// somewhere the map cannot show — a garage, a covered car park: the same diagram on a
// drawn parking lot. The ground is saved with the claim, and the cars survive the switch.
await page.getByRole('radio', { name: N.lot }).click()
await page.waitForTimeout(2000)
if ((await draft()).incident.surface !== 'lot') fail('the ground was not saved')
if ((await page.locator('.mk-car').count()) !== 3) fail('the cars did not survive the change of ground')
const asphalt = await page.evaluate(() => {
  const c = document.querySelector('.maplibregl-canvas')
  const off = document.createElement('canvas')
  off.width = c.width
  off.height = c.height
  const ctx = off.getContext('2d')
  ctx.drawImage(c, 0, 0)
  const px = ctx.getImageData(0, 0, c.width, c.height).data
  let hit = 0
  let n = 0
  for (let i = 0; i < px.length; i += 4 * 97) {
    n++
    if (Math.abs(px[i] - 75) < 10 && Math.abs(px[i + 1] - 83) < 10 && Math.abs(px[i + 2] - 97) < 10) hit++
  }
  return hit / n
})
if (asphalt < 0.5) fail(`the parking lot did not paint (${(asphalt * 100).toFixed(0)}% tarmac)`)
// there is no real city around a drawn parking lot, any more than there is a real road
const shown = () => page.evaluate(() => ['buildings', 'roads-casing'].map((id) => window.__map.getLayoutProperty(id, 'visibility')))
if ((await shown()).some((v) => v !== 'none')) fail(`the road and the buildings are still drawn on the parking lot: ${await shown()}`)
await page.getByRole('radio', { name: N.satellite }).click()
await page.waitForTimeout(2000)
if ((await draft()).incident.surface !== 'satellite') fail('could not switch back to the satellite map')
if ((await shown()).some((v) => v !== 'visible')) fail(`the road and the buildings did not come back on the satellite map: ${await shown()}`)
ok(`map: drawn parking lot for places the map cannot show (${(asphalt * 100).toFixed(0)}% tarmac), no road or buildings on it, cars kept, back to satellite`)

await page.getByRole('textbox', { name: N.describeLabel }).fill('The van pulled out across me.')
await noEnglish('the map')
ok('map: bend added by hand, description saved')

// ── 4 · damage ─────────────────────────────────────────────────────────
await next()
await page.waitForSelector('.cm-root canvas', { timeout: 20000 })
await settled('.cm-root canvas')
// the mark from the impact is already on the car, and the page says so
if (!(await page.locator(`text=${N.markedForYou}`).count())) fail('the damage step does not say the mark came from the impact')
const autoBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.autoDamage)
if (autoBefore.a !== 'auto') fail(`vehicle A's mark should be the impact's, got ${JSON.stringify(autoBefore)}`)
await page.mouse.click(...Object.values(await centre(page.locator('.cm-root canvas'))))
await page.waitForTimeout(600)
if ((await page.locator('.cm-pop').count()) !== 1) fail('tapping the car did not open the severity picker')
// force: the popover follows the 3D point, and OrbitControls' damping keeps it drifting by
// fractions of a pixel for seconds, which Playwright's exact-rect stability check never accepts
await page.getByRole('button', { name: N.dent, exact: true }).click({ force: true })
await page.waitForTimeout(600)
const d4 = await draft()
if (d4.vehicles[0].damages.length !== 2 || d4.vehicles[0].damages[1].severity !== 'dent') fail(`damage not saved: ${JSON.stringify(d4.vehicles[0].damages)}`)
// the customer has touched it: it is theirs now and the impact will not overwrite it
const autoAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.autoDamage)
if (autoAfter.a !== 'user') fail(`vehicle A's marks should be the customer's after a tap, got ${JSON.stringify(autoAfter)}`)
ok(`damage: ${d4.vehicles[0].damages[0].zone} from the impact + ${d4.vehicles[0].damages[1].zone} / dent by hand on the ${d4.vehicles[0].body}`)

// ── the damage is on the paint, not just a pin on it ──────────────────
// The dent: with the effect blended away through the real slider, the paint just above the mark —
// the dish's shadowed wall — reads lighter than with it on, and the frame the export takes differs
// from the unmarked car by more than the pin. The picker is closed first and the camera given its
// moment to ease round.
await page.locator('.cm-pop .cm-x').click({ force: true })
await page.waitForTimeout(1500)
const strengthSlider = page.locator('.cm-tools input[type=range]')
if ((await strengthSlider.count()) !== 1) fail('the customer’s marker has no before/after slider')
const dentPoint = d4.vehicles[0].damages[1].point
const dented = await markerSample(dentPoint)
await strengthSlider.fill('0')
await page.waitForTimeout(500)
const undented = await markerSample(dentPoint)
await strengthSlider.fill('1')
await page.waitForTimeout(500)
const darker = 1 - dented.mean / undented.mean
if (darker < 0.03) fail(`the dent is not in the paint: the wall above the mark reads ${undented.mean.toFixed(1)} without it and ${dented.mean.toFixed(1)} with it`)
const differing = await pixelsDiffering(dented.png, undented.png)
if (differing < 300) fail(`the marked car's export differs from the unmarked one by only ${differing} px`)
ok(`damage: the dent is in the paint — its wall ${(darker * 100).toFixed(1)}% darker above the mark, ${differing} px of the export differ from the unmarked car`)
// A missing part is the whole panel: the left front door, picked at its own anchor, shows the
// cavity just below the dot — dark, and warmer than glass or a tyre
const door = zoneById(d4.vehicles[0].body, 'left_front_door')
await page.evaluate((p) => document.querySelector('.cm-root canvas').__probe.store.getState().pick(p), door.anchor)
await page.waitForTimeout(400)
await page.getByRole('button', { name: N.missing, exact: true }).click({ force: true })
await page.waitForTimeout(400)
await page.locator('.cm-pop .cm-x').click({ force: true })
await page.waitForTimeout(1500)
const hole = await markerSample(door.anchor, 14)
if (Math.max(...hole.spot) > 60 || hole.spot[0] < hole.spot[2]) fail(`the missing door shows no cavity: rgb(${hole.spot}) just below the mark`)
const d4b = await draft()
if (d4b.vehicles[0].damages.length !== 3 || d4b.vehicles[0].damages[2].severity !== 'missing' || d4b.vehicles[0].damages[2].zone !== 'left_front_door') fail(`the missing door was not saved: ${JSON.stringify(d4b.vehicles[0].damages)}`)
ok(`damage: the missing ${door.id.replace(/_/g, ' ')} is a cavity on the car, rgb(${hole.spot})`)

// a photograph through the real file picker: downscaled to 1280 on the long edge, kept as a
// JPEG on the claim, tagged with the vehicle it shows
const png = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 1600
  c.height = 1200
  const x = c.getContext('2d')
  x.fillStyle = '#b91c1c'
  x.fillRect(0, 0, 1600, 1200)
  x.fillStyle = '#fff'
  x.fillRect(200, 300, 900, 500)
  return c.toDataURL('image/png').split(',')[1]
})
await page.locator(`input[aria-label="${N.addPhotos}"]`).setInputFiles({ name: 'bumper.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
await page.waitForSelector(`img[alt="${N.photo2}"]`, { timeout: 15000 })
await page.getByRole('textbox', { name: N.caption2 }).fill('Front bumper, close up')
const photo = (await draft()).attachments.photos[1]
if (!photo || !photo.data.startsWith('data:image/jpeg;base64,')) fail('the photo was not kept as a JPEG')
if (photo.of !== 'a') fail(`the photo should be of vehicle A, got ${photo.of}`)
const photoKb = Math.round(photo.data.length / 1024)
if (photoKb > 400) fail(`the photo was not downscaled (${photoKb} kB)`)
const dims = await page.evaluate(
  (d) =>
    new Promise((r) => {
      const i = new Image()
      i.onload = () => r([i.naturalWidth, i.naturalHeight])
      i.src = d
    }),
  photo.data,
)
if (dims[0] !== 1280 || dims[1] !== 960) fail(`expected 1280×960 after downscaling, got ${dims.join('×')}`)
// the car now, and the pole it took with it
await page.locator(`[role=radiogroup][aria-label="${N.drivable}"]`).getByRole('radio', { name: N.no, exact: true }).click()
await page.locator(`[role=radiogroup][aria-label="${N.airbags}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.locator(`[role=radiogroup][aria-label="${N.towed}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.getByRole('textbox', { name: N.whereNow }).fill("Mike's Towing, Brooklyn")
await page.getByRole('textbox', { name: N.otherProperty }).fill('Traffic light pole')
await noEnglish('the damage')
ok(`damage: photo kept as ${dims.join('×')} JPEG (${photoKb} kB) of A with a caption; not drivable, airbags out, towed; the pole noted`)

// ── 5 · review and send ────────────────────────────────────────────────
await next()
await page.waitForSelector(`text=${N.send}`, { timeout: 20000 })
// nothing goes without the customer's word and their name on it
if (!(await page.getByRole('button', { name: N.send }).isDisabled())) fail('Send should be disabled before the attestation')
await page.getByRole('textbox', { name: N.yourName }).fill('Ashish B')
await page.getByRole('textbox', { name: N.yourPhone }).fill('555 0100')
await page.getByRole('textbox', { name: N.yourEmail }).fill('ME@example.com')
await page.locator(`[role=radiogroup][aria-label="${N.policyholder}"]`).getByRole('radio', { name: N.yes, exact: true }).click()
await page.getByRole('checkbox', { name: N.agree }).check()
if (!(await page.getByRole('button', { name: N.send }).isDisabled())) fail('Send should still be disabled until it is signed')
await page.getByRole('textbox', { name: N.sign }).fill('Ashish B')
if (await page.getByRole('button', { name: N.send }).isDisabled()) fail('Send should be enabled once confirmed and signed')
if (!(await page.locator('text=Dana Q').count())) fail('review does not show the other driver')
// the review's marked-up car is the same shader: the cavity of the missing door is in its frame,
// and blending the damage away takes it out — the export at send is the car as it always renders
await settled('.cm-root canvas')
const reviewCavity = { off: await cavityPixels(0), on: await cavityPixels(1) }
if (reviewCavity.on < reviewCavity.off + 150) fail(`the review's car does not show the missing door: ${reviewCavity.off} cavity px without the damage, ${reviewCavity.on} with it`)
if (await page.locator('.cm-tools').count()) fail('the customer’s review page should not offer the before/after slider')
ok(`review: the marked-up car shows the missing door (${reviewCavity.on - reviewCavity.off} px of cavity), and has no slider to blend it away before the export`)
if (!(await page.locator('text=2026-0042').count())) fail('review does not show the police report number')
if (!(await page.locator('text=Times Square').count())) fail('review does not show the address')
if (!(await page.locator('text=The van pulled out across me.').count())) fail('review does not show the description')
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
await page.waitForTimeout(7000)
await noEnglish('the review')

// the review can play it back too: the insurer sees what happened, not a still
await page.getByRole('button', { name: N.playBack }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
ok('review: playback ran on the review map')

// and watch it there too: the read-only map — the desk's is this same component — tilts and comes back
await page.getByRole('button', { name: N.watch }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
const reviewPitch = await page.evaluate(async () => {
  let pitch = 0
  const t0 = performance.now()
  while (document.querySelector('.maplibregl-map').classList.contains('mk-playing') && performance.now() - t0 < 30000) {
    pitch = Math.max(pitch, window.__map.getPitch())
    await new Promise((r) => setTimeout(r, 50))
  }
  return { peak: pitch, after: window.__map.getPitch() }
})
if (reviewPitch.peak < 40 || reviewPitch.after !== 0) fail(`the review map did not tilt and come back (peaked at ${reviewPitch.peak.toFixed(0)}°, now ${reviewPitch.after}°)`)
ok(`review: watched it on the read-only map (tilted to ${reviewPitch.peak.toFixed(0)}°, back to flat)`)

const submitted = page.evaluate(() => new Promise((r) => window.addEventListener('claim:submitted', (e) => r(e.detail), { once: true })))
await page.getByRole('button', { name: N.send }).click()
const doc = await submitted
await page.waitForSelector(`text=${N.reportIn}`, { timeout: 20000 })

if (doc.schema !== 'claim/1') fail(`document schema ${doc.schema}`)
if (!/^CM-[A-HJ-NP-Z2-9]{6}$/.test(doc.reference)) fail(`reference ${doc.reference}`)
if (doc.vehicles.length !== 3) fail(`document has ${doc.vehicles.length} vehicles`)
if (doc.vehicles[0].make !== 'Honda' || doc.vehicles[0].year !== 2021) fail('document lost the make or year')
if (doc.vehicles[0].damages.length !== 3) fail('document lost a damage')
if (doc.vehicles[1].damages.length !== 1) fail("document lost B's damage from the impact")
if (!doc.impact) fail('document lost the impact')
if (doc.incident.surface !== 'satellite') fail(`document ground ${doc.incident.surface}`)
if (doc.incident.language !== lang) fail(`document says it is in ${doc.incident.language}, not ${lang}`)
if (!/^data:image\/png;base64,/.test(doc.attachments.scene ?? '')) fail('no scene PNG attached')
if (!/^data:image\/png;base64,/.test(doc.attachments.damage.a ?? '')) fail('no damage PNG attached for vehicle A')
const sceneKb = Math.round(doc.attachments.scene.length / 1024)
if (sceneKb < 40) fail(`scene PNG suspiciously small (${sceneKb} kB)`)
if (!(await page.locator(`text=${doc.reference}`).count())) fail('confirmation does not show the reference')
// the whole report, not just the reconstruction
if (doc.incident.kind !== 'collision') fail(`kind ${doc.incident.kind}`)
if (doc.incident.conditions.weather !== 'rain' || doc.incident.conditions.road !== 'wet' || doc.incident.conditions.light !== 'daylight') fail(`conditions ${JSON.stringify(doc.incident.conditions)}`)
if (!doc.incident.context?.road?.class) fail(`the document lost what the record said about the road: ${JSON.stringify(doc.incident.context)}`)
if (!doc.incident.context?.weather || !doc.incident.context?.sun) fail('the document lost the looked-up weather or sun')
if (doc.incident.utcOffset === null) fail('the document lost the zone, so `at` is not an instant')
if (doc.incident.context.source !== 'open-meteo+osm') fail(`the document does not name its source: ${doc.incident.context.source}`)
if (doc.vehicles[0].vin !== '1HGCM82633A004352' || doc.vehicles[0].plateState !== 'NY') fail(`VIN/state ${doc.vehicles[0].vin} ${doc.vehicles[0].plateState}`)
if (doc.vehicles[1].insurer !== 'Acme Mutual' || doc.vehicles[1].policy !== 'AM-77') fail(`other insurer ${doc.vehicles[1].insurer} ${doc.vehicles[1].policy}`)
const dana = doc.people.find((p) => p.role === 'driver' && p.vehicle === 'b')
if (!dana || dana.name !== 'Dana Q' || dana.phone !== '555 0199') fail(`other driver ${JSON.stringify(dana)}`)
const sam = doc.people.find((p) => p.role === 'passenger')
if (!sam || sam.vehicle !== 'a' || !sam.injured || !/whiplash/i.test(sam.injury)) fail(`passenger ${JSON.stringify(sam)}`)
if (!doc.people.find((p) => p.role === 'witness' && p.name === 'Wit Ness')) fail('witness lost')
if (doc.police.called !== true || doc.police.report !== '2026-0042') fail(`police ${JSON.stringify(doc.police)}`)
const damagePic = doc.attachments.photos.find((p) => p.of === 'a')
if (doc.attachments.photos.length !== 2 || !damagePic || damagePic.caption !== 'Front bumper, close up') fail(`photos lost: ${JSON.stringify(doc.attachments.photos.map((p) => [p.of, p.caption]))}`)
// the photograph knew where it was taken; the document knows only how far that was from the
// claim — and it followed, because the customer then picked the geocoder's Times Square,
// which is a few metres off the one the camera recorded
const sent = doc.attachments.photos.find((p) => p.of === null)
if (sent?.minutesFromIncident !== 0) fail(`the scene photo lost its time: ${JSON.stringify(sent?.minutesFromIncident)}`)
if (typeof sent?.metresFromScene !== 'number' || sent.metresFromScene > 50) fail(`the scene photo's distance did not follow the place: ${JSON.stringify(sent?.metresFromScene)}`)
const coords = JSON.stringify(doc.attachments.photos)
if (/"(lng|lat|gps|latitude|longitude)"/i.test(coords) || /-73\.98/.test(coords)) fail('a coordinate from a photograph reached the document')
ok(`sent: a photograph reports ${sent.metresFromScene} m / ${sent.minutesFromIncident} min from the claim, and no coordinate of its own`)
const cond = doc.vehicles[0].condition
if (cond.drivable !== false || cond.airbags !== true || cond.towed !== true || !/Mike/.test(cond.location)) fail(`condition ${JSON.stringify(cond)}`)
if (doc.property.description !== 'Traffic light pole') fail(`property ${JSON.stringify(doc.property)}`)
if (doc.reporter.name !== 'Ashish B' || doc.reporter.email !== 'me@example.com' || doc.reporter.policyholder !== true) fail(`reporter ${JSON.stringify(doc.reporter)}`)
if (!doc.attestation.agreed || doc.attestation.name !== 'Ashish B' || doc.attestation.at !== doc.submittedAt) fail(`attestation ${JSON.stringify(doc.attestation)}`)
ok(`sent: what the record said — ${doc.incident.context.weather.label}, ${doc.incident.context.road.class}${doc.incident.context.road.name ? ` "${doc.incident.context.road.name}"` : ''}, sun ${doc.incident.context.sun.altitude}° — beside what the customer answered`)
ok('sent: the whole report — kind, conditions, VIN, the other driver and their insurer, an injured passenger, the police report, a witness, a photo, the car now, the pole, who to call, signed')
ok(`sent: ${doc.reference}, scene ${sceneKb} kB, damage PNG ${Math.round(doc.attachments.damage.a.length / 1024)} kB`)

// ── the desk shows the same car ───────────────────────────────────────
// The claims desk renders this same document through the same component, so the missing door's
// cavity is in its frame too — and the desk, unlike the review page, gets the before/after
// slider and the severity map. Its API is answered here from the document just sent.
const receipt = {
  reference: doc.reference,
  clientReference: null,
  receivedAt: doc.submittedAt,
  status: 'new',
  files: {},
  signals: [],
  summary: { kind: doc.incident.kind, at: doc.incident.at, address: doc.incident.location.address, reporter: doc.reporter.name, vehicles: doc.vehicles.length, plates: [], hurt: 0, damaged: 2, photos: 2, drivable: false },
}
const deskPage = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
deskPage.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
deskPage.on('pageerror', (e) => errors.push(String(e)))
await deskPage.route(`${origin}/desk-api/**`, (route) => {
  const path = new URL(route.request().url()).pathname.replace('/desk-api', '')
  const body = path === '/claims' ? { claims: [receipt] } : path === `/claims/${doc.reference}` ? { ...receipt, claim: doc } : null
  return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: { error: 'not found' } })
})
await deskPage.goto(`${origin}/adjuster.html?api=${origin}/desk-api#/${doc.reference}`, { waitUntil: 'networkidle' })
await deskPage.waitForSelector('.cm-root canvas', { timeout: 20000 })
await settled('.cm-root canvas', deskPage)
const deskCavity = { off: await cavityPixels(0, 0, deskPage), on: await cavityPixels(1, 0, deskPage) }
if (deskCavity.on < deskCavity.off + 150) fail(`the desk's car does not show the missing door: ${deskCavity.off} cavity px without the damage, ${deskCavity.on} with it`)
if ((await deskPage.locator('.cm-tools input[type=range]').count()) < 1) fail('the desk’s marker has no before/after slider')
if (!(await deskPage.getByRole('button', { name: 'Severity map' }).count())) fail('the desk’s marker has no severity map')
await deskPage.close()
ok(`desk: the same marked-up car — the missing door is ${deskCavity.on - deskCavity.off} px of cavity there too — with the before/after slider and the severity map`)

// ── the replay, recorded at send time ─────────────────────────────────
// Judged on what it shows, not on its size, which follows the machine's load: decoded in the
// page, it has to last, have a real picture in its middle frame, and move between its first
// and last quarters (scripts/video-check.mjs has the thresholds and why).
const replay = doc.attachments.replay
if (!/^data:video\/(webm|mp4)(;[^,]*)?;base64,/.test(replay ?? '')) fail(`no replay was attached: ${String(replay).slice(0, 40)}`)
const replayBytes = Math.round((replay.length - replay.indexOf(',') - 1) * 0.75)
const replayVideo = await readVideo(page, replay)
const replayWrong = videoProblem(replayVideo, replayBytes)
if (replayWrong) fail(`the replay is not a real recording: ${replayWrong}`)
ok(`sent: a replay of ${describeVideo(replayVideo, replayBytes)}`)

// ── a refresh lands on the confirmation, not the first step ────────────
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector(`text=${N.reportIn}`, { timeout: 10000 })
await noEnglish('the confirmation')
ok('refresh keeps the confirmation')

// ── the moment, lit as it was ─────────────────────────────────────────
// A draft seeded straight onto the diagram — the same place, the same two cars, the same
// tiles — under three lights: rain after dark, a clear evening with the sun on the horizon,
// and "Plain view". The tiles never change, so every difference on the ground is the layer's
// own: the wet road has to read darker than the plain one, the ground ahead of a car's nose
// brighter than behind its tail (its headlights), a low sun has to lay a shadow between the
// cars and nowhere else, and the canvas the export captures has to be a picture. Then the
// chip turns all of it off, and is kept with the draft.
const LIT_LNG = -73.9859
const LIT_LAT = 40.7573
const litM = 1 / (111320 * Math.cos((LIT_LAT * Math.PI) / 180))
const litRoad = (lit) => ({ name: 'W 44th St', class: 'residential', lanes: 2, oneway: true, maxspeed: '25 mph', lit, junction: 'none', controls: [] })
const NIGHT_RAIN = { weather: { code: 61, label: 'Light rain', tempC: 14, precipMm: 1.2, windKph: 12 }, sun: { altitude: -20, azimuth: 300 }, road: litRoad(null) }
/** the same night on a road the record says is lit: the warm pool under the incident */
const NIGHT_LIT = { ...NIGHT_RAIN, road: litRoad(true) }
const LOW_SUN = { weather: { code: 0, label: 'Clear sky', tempC: 22, precipMm: 0, windKph: 6 }, sun: { altitude: 6, azimuth: 270 }, road: litRoad(null) }
const litSeed = (context, plainView) => ({
  // a version behind: the store's migrate fills in every section this seed leaves out
  version: 7,
  state: {
    step: 'scene',
    impactManual: false,
    autoDamage: {},
    autoConditions: {},
    policy: [],
    delivery: null,
    lang,
    invite: null,
    plainView,
    claim: {
      incident: {
        kind: 'collision',
        at: '2026-09-08T21:00',
        utcOffset: -240,
        shared: null,
        location: { lng: LIT_LNG, lat: LIT_LAT, address: 'Times Square, New York' },
        surface: 'satellite',
        conditions: { weather: '', road: '', light: '' },
        description: '',
        language: lang,
        context: { ...context, source: 'open-meteo+osm', fetchedAt: '2026-09-08T12:00:00.000Z' },
      },
      // A six metres west of the impact facing east, B six metres east facing west: clear road between them
      vehicles: [
        { id: 'a', role: 'insured', body: 'sedan', color: '#c0392b', position: [LIT_LNG - 6 * litM, LIT_LAT], heading: 90, path: [[LIT_LNG - 30 * litM, LIT_LAT - 4 / 111320]], damages: [] },
        { id: 'b', role: 'other', body: 'suv', color: '#2563eb', position: [LIT_LNG + 6 * litM, LIT_LAT], heading: 270, path: [], damages: [] },
      ],
      impact: [LIT_LNG, LIT_LAT],
    },
  },
})
/** mean luminance of the map canvas around a few points on the ground, in metres east of the impact along its latitude, or south of it */
const litSample = (p) =>
  p.evaluate(([lng, lat, m]) => {
    const map = window.__map
    const src = map.getCanvas()
    const dpr = src.width / src.clientWidth
    const off = document.createElement('canvas')
    off.width = src.width
    off.height = src.height
    const ctx = off.getContext('2d')
    ctx.drawImage(src, 0, 0)
    const lum = (east, south) => {
      const q = map.project([lng + east * m, lat - south / 111320])
      const size = 12 * dpr
      const px = ctx.getImageData(q.x * dpr - size / 2, q.y * dpr - size / 2, size, size).data
      let s = 0
      for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      return s / (px.length / 4)
    }
    const all = ctx.getImageData(0, 0, src.width, src.height).data
    const seen = new Set()
    for (let i = 0; i < all.length; i += 4 * 499) seen.add((all[i] << 16) | (all[i + 1] << 8) | all[i + 2])
    // open road ten metres south; ahead of A's nose and behind its tail; the ground between the two
    // cars; six metres south of the incident, inside the street light's pool and outside every headlight
    return { road: lum(0, 10), ahead: lum(-1.5, 0), behind: lum(-10.5, 0), between: lum(1, 0), pool: lum(0, 6), colours: seen.size }
  }, [LIT_LNG, LIT_LAT, litM])
/** the ground under car A with its body hidden for a moment: the faked shadow, or bare tiles */
const litUnder = (p) =>
  p.evaluate(async ([lng, lat, m]) => {
    const map = window.__map
    const car = map.getLayer('cars').implementation.cars.get('a')
    car.root.children[0].visible = false
    map.triggerRepaint()
    await new Promise((r) => setTimeout(r, 500))
    const src = map.getCanvas()
    const dpr = src.width / src.clientWidth
    const off = document.createElement('canvas')
    off.width = src.width
    off.height = src.height
    const ctx = off.getContext('2d')
    ctx.drawImage(src, 0, 0)
    const q = map.project([lng - 6 * m, lat])
    const size = 12 * dpr
    const px = ctx.getImageData(q.x * dpr - size / 2, q.y * dpr - size / 2, size, size).data
    let sum = 0
    for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    car.root.children[0].visible = true
    map.triggerRepaint()
    return sum / (px.length / 4)
  }, [LIT_LNG, LIT_LAT, litM])
const litPage = async (context, plainView = false) => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  if (lang === 'es') await p.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
  // seeded once: an init script runs on every navigation, and the reload below must find what the page saved
  await p.addInitScript((seed) => void (localStorage.getItem('claim-marker/draft') || localStorage.setItem('claim-marker/draft', JSON.stringify(seed))), litSeed(context, plainView))
  await p.goto(`${origin}/`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.mk-car', { timeout: 20000 })
  // the tiles and the shaders both take their time; wait for a real frame, then a little longer for the tiles
  for (let i = 0; i < 60 && (await litSample(p)).colours < 50; i++) await p.waitForTimeout(300)
  await p.waitForTimeout(3000)
  return p
}
const nightPage = await litPage(NIGHT_RAIN)
const night = await litSample(nightPage)
const litPageAtNight = await litPage(NIGHT_LIT)
const nightLit = await litSample(litPageAtNight)
await litPageAtNight.close()
const duskPage = await litPage(LOW_SUN)
const dusk = await litSample(duskPage)
// with the sun up the faked shadow is off and, with A's body hidden, nothing casts: bare tiles under A
const bare = await litUnder(duskPage)
await duskPage.close()
const plainPage = await litPage(LOW_SUN, true)
const plain = await litSample(plainPage)
// no sun in plain view: the faked shadow under A — a ghost's is the same disc under the same matrix
const under = await litUnder(plainPage)
await plainPage.close()
if (night.colours < 50) fail(`the map after dark is a blank canvas (${night.colours} colours) — the export would capture nothing`)
if (night.road >= plain.road * 0.75) fail(`the wet road after dark is not darker than the plain one (${night.road.toFixed(0)} vs ${plain.road.toFixed(0)})`)
if (night.ahead <= night.behind * 1.3) fail(`no headlights: the road ahead of A's nose is ${night.ahead.toFixed(0)}, behind its tail ${night.behind.toFixed(0)}`)
if (dusk.between >= plain.between * 0.85) fail(`a sun on the horizon lays no shadow between the cars (${dusk.between.toFixed(0)} vs ${plain.between.toFixed(0)} plain)`)
if (Math.abs(dusk.road - plain.road) > plain.road * 0.12) fail(`the low sun changed the open road, not just the shadow (${dusk.road.toFixed(0)} vs ${plain.road.toFixed(0)} plain)`)
if (nightLit.pool < night.pool + 20) fail(`no pool under the street light: the ground six metres from the incident reads ${nightLit.pool.toFixed(0)} lit against ${night.pool.toFixed(0)} unlit`)
if (under >= bare * 0.8) fail(`the faked shadow is not drawn under a car in plain view (${under.toFixed(0)} under A against ${bare.toFixed(0)} bare tiles)`)
ok(`lit: after dark in the rain the road reads ${night.road.toFixed(0)} against ${plain.road.toFixed(0)} plain, ${night.ahead.toFixed(0)} ahead of A's headlights against ${night.behind.toFixed(0)} behind it, ${nightLit.pool.toFixed(0)} under a street light against ${night.pool.toFixed(0)} without; a sun on the horizon shadows the ground between the cars (${dusk.between.toFixed(0)} vs ${plain.between.toFixed(0)}) and leaves the open road alone (${dusk.road.toFixed(0)}); the faked shadow reads ${under.toFixed(0)} under A against ${bare.toFixed(0)} bare`)

// "Plain view" turns it all off, on this page and on a reload
await nightPage.getByRole('button', { name: N.plain }).click()
await nightPage.waitForTimeout(1500)
const plained = await litSample(nightPage)
if (plained.road < plain.road * 0.85) fail(`"Plain view" left the road dark (${plained.road.toFixed(0)} vs ${plain.road.toFixed(0)} plain)`)
if (!(await nightPage.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.plainView))) fail('"Plain view" was not kept with the draft')
await nightPage.reload({ waitUntil: 'networkidle' })
await nightPage.waitForSelector('.mk-car', { timeout: 20000 })
if ((await nightPage.getByRole('button', { name: N.plain }).getAttribute('aria-pressed')) !== 'true') fail('"Plain view" did not survive a reload')
await nightPage.close()
ok(`lit: "Plain view" brought the road back to ${plained.road.toFixed(0)}, and stayed on after a reload`)

// ── nothing depends on the lookups ────────────────────────────────────
// With all three hosts refused, the Where step must be exactly what it was before any of this
// existed: no card, no filled selects, no error shown to a customer who did not ask for any
// of it. A page that only works when a third party answers is not a claim form.
const blocked = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
for (const host of ['**://api.open-meteo.com/**', '**://archive-api.open-meteo.com/**', '**://overpass.kumi.systems/**']) {
  await blocked.route(host, (route) => route.abort())
}
if (lang === 'es') await blocked.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
await blocked.goto(`${origin}/`, { waitUntil: 'networkidle' })
await blocked.getByRole('button', { name: starts(N.continue) }).click()
await blocked.getByRole('combobox', { name: N.where }).fill('Times Square New York')
await blocked.waitForSelector('[role=option]', { timeout: 20000 })
await blocked.locator('[role=option]').first().click()
await blocked.waitForTimeout(4000)
if (await blocked.locator('[data-looked]').count()) fail('the looked-up card appeared with every lookup host blocked')
const blind = await blocked.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.incident)
if (blind.context !== null) fail(`a blocked lookup still wrote a context: ${JSON.stringify(blind.context)}`)
if (blind.conditions.weather || blind.conditions.road || blind.conditions.light) fail(`a blocked lookup still filled the selects: ${JSON.stringify(blind.conditions)}`)
if (!blind.location) fail('the place was not saved with the lookup hosts blocked')
await blocked.close()
ok('with all three lookup hosts blocked, the Where step is exactly what it was')

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log(`\nall smoke checks passed${lang === 'es' ? ' (in Spanish)' : ''}`)
