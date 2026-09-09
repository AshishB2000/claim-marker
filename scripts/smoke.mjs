/**
 * The whole flow, end to end, in a headless browser: search an address, pick vehicles, drag
 * a car and its heading on the real map, mark a damage, send the report, and check the
 * document that came out. Unit tests cover the maths; this covers the product.
 *
 *   npm run dev   # in another shell
 *   node scripts/smoke.mjs [origin]
 */
import { chromium } from 'playwright'

const origin = process.argv[2] ?? 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

/** the claim as the page has saved it */
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim)

/** distinct colours in a data URL or canvas, sampled sparsely — a blank frame has one or two */
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

/** wait for a real frame: three.js skips objects whose shaders are still linking */
const settled = async (sel) => {
  for (let i = 0; i < 60; i++) {
    if ((await colours(sel)) >= 50) return
    await page.waitForTimeout(300)
  }
  fail(`${sel} never rendered a frame`)
}

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
const next = () => page.getByRole('button', { name: /^Continue/ }).click()

await page.goto(`${origin}/`, { waitUntil: 'networkidle' })

// ── 0 · what happened ─────────────────────────────────────────────────
// the kind decides the flow: a hail claim has no other party and nothing to diagram
await page.waitForSelector('[role=radiogroup][aria-label="What happened"]')
const kinds = page.locator('[role=radiogroup][aria-label="What happened"] [role=radio]')
if ((await kinds.count()) !== 8) fail(`expected 8 kinds of incident, got ${await kinds.count()}`)
await page.getByRole('radio', { name: /^Weather/ }).click()
await page.waitForTimeout(300)
if ((await page.locator('header ol li').count()) !== 6) fail(`a weather claim should have 6 steps, got ${await page.locator('header ol li').count()}`)
if ((await draft()).vehicles.length !== 1) fail('a weather claim should drop the other vehicle')
await page.getByRole('radio', { name: /^Collision/ }).click()
await page.waitForTimeout(300)
if ((await page.locator('header ol li').count()) !== 7) fail('a collision should have 7 steps')
if ((await draft()).vehicles.length !== 2) fail('switching back to a collision should bring an other vehicle back')
ok('what happened: 8 kinds; weather drops the other vehicle and the diagram step, collision brings them back')
await next()

// ── 1 · where ──────────────────────────────────────────────────────────
if (!(await page.getByRole('button', { name: /^Continue/ }).isDisabled())) fail('Continue should be disabled until a place is chosen')
await page.getByRole('combobox', { name: 'Where did it happen?' }).fill('Times Square New York')
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
await page.getByRole('combobox', { name: 'Weather' }).selectOption('rain')
await page.getByRole('combobox', { name: 'Road' }).selectOption('wet')
await page.getByRole('combobox', { name: 'Light' }).selectOption('daylight')
ok(`where: ${d1.incident.location.address}, street tiles painted (${streetColours} colours), conditions set`)

// ── 2 · vehicles ───────────────────────────────────────────────────────
await next()
await page.waitForSelector('text=Your vehicle')
await page.getByRole('button', { name: 'Add a vehicle' }).click()
const cards = page.locator('[role=radiogroup][aria-label="Body type"]')
if ((await cards.count()) !== 3) fail(`expected 3 vehicle cards, got ${await cards.count()}`)

// make, year and model from the lists; the model list comes from the vehicle database
const makes = page.getByRole('combobox', { name: 'Make' })
const years = page.getByRole('combobox', { name: 'Year' })
const modelsA = page.getByRole('combobox', { name: 'Model' }).first()
await makes.first().selectOption('Honda')
await years.first().selectOption('2021')
await page.waitForFunction(() => {
  const sel = document.querySelector('select[aria-label="Model"]')
  return sel && !sel.disabled && [...sel.options].some((o) => o.value === 'CR-V')
}, null, { timeout: 30000 })
await modelsA.selectOption('CR-V')
const d2a = await draft()
if (d2a.vehicles[0].make !== 'Honda' || d2a.vehicles[0].model !== 'CR-V' || d2a.vehicles[0].year !== 2021) fail(`make/model/year not saved: ${JSON.stringify([d2a.vehicles[0].make, d2a.vehicles[0].model, d2a.vehicles[0].year])}`)
if (d2a.vehicles[0].body !== 'suv') fail(`a CR-V should pick the SUV shape, got ${d2a.vehicles[0].body}`)
ok(`vehicles: ${d2a.vehicles[0].year} ${d2a.vehicles[0].make} ${d2a.vehicles[0].model} from the database, shape ${d2a.vehicles[0].body}`)

await page.getByRole('textbox', { name: 'VIN' }).first().fill('1hgcm82633a004352')
await page.getByRole('textbox', { name: 'Plate state' }).first().fill('ny')
await cards.nth(1).getByRole('radio', { name: 'Van' }).click()
await cards.nth(0).locator('..').locator('..').getByRole('radio', { name: 'Red' }).click()
const d2 = await draft()
if (d2.vehicles[1].body !== 'van') fail(`body change did not save: ${d2.vehicles[1].body}`)
if (d2.vehicles[0].color !== '#b91c1c') fail(`colour change did not save: ${d2.vehicles[0].color}`)
await page.waitForTimeout(2500)
if ((await page.locator('canvas').count()) < 2) fail('expected a 3D preview on each card without a make and model yet')
ok(`vehicles: ${d2.vehicles.map((v) => `${v.id}:${v.body}`).join(' ')}`)

// the real car: a photograph of the make and model, found and actually loaded by the browser
const alt = `${d2a.vehicles[0].year} ${d2a.vehicles[0].make} ${d2a.vehicles[0].model}`
await page
  .waitForFunction((alt) => {
    const i = document.querySelector(`img[alt="${alt}"]`)
    return i && i.complete && i.naturalWidth > 0
  }, alt, { timeout: 30000 })
  .catch(() => fail(`no photograph of the ${alt} loaded on its card`))
const photoSrc = await page.locator(`img[alt="${alt}"]`).getAttribute('src')
if (!/wikimedia\.org/.test(photoSrc)) fail(`the photograph came from somewhere unexpected: ${photoSrc}`)
if (!(await page.locator('a', { hasText: 'Photo: Wikimedia Commons' }).count())) fail('the photograph is not credited')
ok(`vehicles: a real photograph of the ${alt} on its card`)

// ── 2b · people, injuries, police ──────────────────────────────────────
await next()
await page.waitForSelector('text=Who was driving?')
// the other driver, off their insurance card
await page.getByRole('textbox', { name: 'Driver of B name' }).fill('Dana Q')
await page.getByRole('textbox', { name: 'Driver of B phone' }).fill('555 0199')
await page.getByRole('textbox', { name: 'Insurer of B' }).fill('Acme Mutual')
await page.getByRole('textbox', { name: 'Policy of B' }).fill('am-77')
// a passenger in the customer's car, who was hurt
await page.getByRole('button', { name: 'Add a passenger' }).click()
await page.getByRole('textbox', { name: 'Passenger name' }).fill('Sam Lee')
await page.locator('[role=radiogroup][aria-label="Was anyone hurt"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.getByRole('checkbox', { name: /Sam Lee, passenger in your/ }).check()
await page.getByRole('textbox', { name: 'Injury of Sam Lee' }).fill('Whiplash, seen at urgent care')
await page.locator('[role=radiogroup][aria-label="Were the police called"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.getByRole('textbox', { name: 'Police report number' }).fill('2026-0042')
await page.getByRole('button', { name: 'Add a witness' }).click()
await page.getByRole('textbox', { name: 'Witness name' }).fill('Wit Ness')
const d2b = await draft()
const roles = d2b.people.map((p) => p.role).sort().join(',')
if (roles !== 'driver,passenger,witness') fail(`people not saved: ${roles}`)
if (!d2b.people.find((p) => p.role === 'passenger')?.injured) fail('the injured passenger was not marked as hurt')
if (d2b.police.called !== true || d2b.police.report !== '2026-0042') fail(`police not saved: ${JSON.stringify(d2b.police)}`)
ok('people: the other driver and insurer, an injured passenger, the police report, a witness')

// ── 3 · the map ────────────────────────────────────────────────────────
await next()
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
await page.waitForSelector('.mk-car', { timeout: 20000 })
await page.waitForTimeout(6000)
if ((await page.locator('.mk-car').count()) !== 3) fail(`expected 3 cars on the map, got ${await page.locator('.mk-car').count()}`)
const before = (await draft()).vehicles[0].position
if (!before) fail('vehicle A was not placed on the map')

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
  let blue = 0
  for (let i = 0; i < px.length; i += 4) if (px[i + 2] > 170 && px[i] < 110 && px[i + 1] < 150) blue++
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
await page.getByRole('slider', { name: 'Facing of vehicle A' }).fill('135')
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
await page.getByRole('button', { name: /Add a bend|Tap it on the map/ }).click()
const mapBox = await page.locator('.maplibregl-canvas').boundingBox()
const before3 = (await draft()).vehicles[0].path.length
await page.mouse.click(mapBox.x + mapBox.width * 0.3, mapBox.y + mapBox.height * 0.3)
await page.waitForTimeout(300)
if ((await draft()).vehicles[0].path.length !== before3 + 1) fail('tapping the map did not add to the path')
await page.getByRole('button', { name: 'Done', exact: true }).click()

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
if (!(await page.locator('text=hit on the front bumper').count())) fail('the vehicle list does not say where it was hit')
ok('map: both cars marked on the front bumper from the impact')

// play it back: the handles step aside while the cars drive their routes, then come back
await page.getByRole('button', { name: /Play it back/ }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
if ((await page.locator('.mk-car').count()) !== 3) fail('the cars did not come back after playback')
ok('map: playback ran and handed the map back')

// somewhere the map cannot show — a garage, a covered car park: the same diagram on a
// drawn parking lot. The ground is saved with the claim, and the cars survive the switch.
await page.getByRole('radio', { name: 'Parking lot' }).click()
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
await page.getByRole('radio', { name: 'Satellite' }).click()
await page.waitForTimeout(2000)
if ((await draft()).incident.surface !== 'satellite') fail('could not switch back to the satellite map')
ok(`map: drawn parking lot for places the map cannot show (${(asphalt * 100).toFixed(0)}% tarmac), cars kept, back to satellite`)

await page.getByRole('textbox', { name: 'In your own words, what happened?' }).fill('The van pulled out across me.')
ok('map: bend added by hand, description saved')

// ── 4 · damage ─────────────────────────────────────────────────────────
await next()
await page.waitForSelector('.cm-root canvas', { timeout: 20000 })
await settled('.cm-root canvas')
// the mark from the impact is already on the car, and the page says so
if (!(await page.locator('text=Marked for you').count())) fail('the damage step does not say the mark came from the impact')
const autoBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.autoDamage)
if (autoBefore.a !== 'auto') fail(`vehicle A's mark should be the impact's, got ${JSON.stringify(autoBefore)}`)
await page.mouse.click(...Object.values(await centre(page.locator('.cm-root canvas'))))
await page.waitForTimeout(600)
if ((await page.locator('.cm-pop').count()) !== 1) fail('tapping the car did not open the severity picker')
// force: the popover follows the 3D point, and OrbitControls' damping keeps it drifting by
// fractions of a pixel for seconds, which Playwright's exact-rect stability check never accepts
await page.getByRole('button', { name: 'dent', exact: true }).click({ force: true })
await page.waitForTimeout(600)
const d4 = await draft()
if (d4.vehicles[0].damages.length !== 2 || d4.vehicles[0].damages[1].severity !== 'dent') fail(`damage not saved: ${JSON.stringify(d4.vehicles[0].damages)}`)
// the customer has touched it: it is theirs now and the impact will not overwrite it
const autoAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.autoDamage)
if (autoAfter.a !== 'user') fail(`vehicle A's marks should be the customer's after a tap, got ${JSON.stringify(autoAfter)}`)
ok(`damage: ${d4.vehicles[0].damages[0].zone} from the impact + ${d4.vehicles[0].damages[1].zone} / dent by hand on the ${d4.vehicles[0].body}`)

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
await page.locator('input[aria-label="Add photos"]').setInputFiles({ name: 'bumper.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
await page.waitForSelector('img[alt="Photo 1"]', { timeout: 15000 })
await page.getByRole('textbox', { name: 'Caption for photo 1' }).fill('Front bumper, close up')
const photo = (await draft()).attachments.photos[0]
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
await page.locator('[role=radiogroup][aria-label="Can it be driven"]').getByRole('radio', { name: 'No', exact: true }).click()
await page.locator('[role=radiogroup][aria-label="Did the airbags go off"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.locator('[role=radiogroup][aria-label="Was it towed"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.getByRole('textbox', { name: 'Where is the vehicle now' }).fill("Mike's Towing, Brooklyn")
await page.getByRole('textbox', { name: 'Other property damaged' }).fill('Traffic light pole')
ok(`damage: photo kept as ${dims.join('×')} JPEG (${photoKb} kB) of A with a caption; not drivable, airbags out, towed; the pole noted`)

// ── 5 · review and send ────────────────────────────────────────────────
await next()
await page.waitForSelector('text=Send my report', { timeout: 20000 })
// nothing goes without the customer's word and their name on it
if (!(await page.getByRole('button', { name: 'Send my report' }).isDisabled())) fail('Send should be disabled before the attestation')
await page.getByRole('textbox', { name: 'Your name' }).fill('Ashish B')
await page.getByRole('textbox', { name: 'Your phone' }).fill('555 0100')
await page.getByRole('textbox', { name: 'Your email' }).fill('ME@example.com')
await page.locator('[role=radiogroup][aria-label="Are you the policyholder"]').getByRole('radio', { name: 'Yes', exact: true }).click()
await page.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
if (!(await page.getByRole('button', { name: 'Send my report' }).isDisabled())) fail('Send should still be disabled until it is signed')
await page.getByRole('textbox', { name: 'Signature' }).fill('Ashish B')
if (await page.getByRole('button', { name: 'Send my report' }).isDisabled()) fail('Send should be enabled once confirmed and signed')
if (!(await page.locator('text=Dana Q').count())) fail('review does not show the other driver')
if (!(await page.locator('text=2026-0042').count())) fail('review does not show the police report number')
if (!(await page.locator('text=Times Square').count())) fail('review does not show the address')
if (!(await page.locator('text=The van pulled out across me.').count())) fail('review does not show the description')
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
await page.waitForTimeout(7000)

// the review can play it back too: the insurer sees what happened, not a still
await page.getByRole('button', { name: /Play it back/ }).click()
await page.waitForSelector('.maplibregl-map.mk-playing', { timeout: 3000 })
await page.waitForFunction(() => !document.querySelector('.maplibregl-map').classList.contains('mk-playing'), null, { timeout: 12000 })
ok('review: playback ran on the review map')

const submitted = page.evaluate(() => new Promise((r) => window.addEventListener('claim:submitted', (e) => r(e.detail), { once: true })))
await page.getByRole('button', { name: 'Send my report' }).click()
const doc = await submitted
await page.waitForSelector('text=Your report is in', { timeout: 20000 })

if (doc.schema !== 'claim/1') fail(`document schema ${doc.schema}`)
if (!/^CM-[A-HJ-NP-Z2-9]{6}$/.test(doc.reference)) fail(`reference ${doc.reference}`)
if (doc.vehicles.length !== 3) fail(`document has ${doc.vehicles.length} vehicles`)
if (doc.vehicles[0].make !== 'Honda' || doc.vehicles[0].year !== 2021) fail('document lost the make or year')
if (doc.vehicles[0].damages.length !== 2) fail('document lost a damage')
if (doc.vehicles[1].damages.length !== 1) fail("document lost B's damage from the impact")
if (!doc.impact) fail('document lost the impact')
if (doc.incident.surface !== 'satellite') fail(`document ground ${doc.incident.surface}`)
if (!/^data:image\/png;base64,/.test(doc.attachments.scene ?? '')) fail('no scene PNG attached')
if (!/^data:image\/png;base64,/.test(doc.attachments.damage.a ?? '')) fail('no damage PNG attached for vehicle A')
const sceneKb = Math.round(doc.attachments.scene.length / 1024)
if (sceneKb < 40) fail(`scene PNG suspiciously small (${sceneKb} kB)`)
if (!(await page.locator(`text=${doc.reference}`).count())) fail('confirmation does not show the reference')
// the whole report, not just the reconstruction
if (doc.incident.kind !== 'collision') fail(`kind ${doc.incident.kind}`)
if (doc.incident.conditions.weather !== 'rain' || doc.incident.conditions.road !== 'wet' || doc.incident.conditions.light !== 'daylight') fail(`conditions ${JSON.stringify(doc.incident.conditions)}`)
if (doc.vehicles[0].vin !== '1HGCM82633A004352' || doc.vehicles[0].plateState !== 'NY') fail(`VIN/state ${doc.vehicles[0].vin} ${doc.vehicles[0].plateState}`)
if (doc.vehicles[1].insurer !== 'Acme Mutual' || doc.vehicles[1].policy !== 'AM-77') fail(`other insurer ${doc.vehicles[1].insurer} ${doc.vehicles[1].policy}`)
const dana = doc.people.find((p) => p.role === 'driver' && p.vehicle === 'b')
if (!dana || dana.name !== 'Dana Q' || dana.phone !== '555 0199') fail(`other driver ${JSON.stringify(dana)}`)
const sam = doc.people.find((p) => p.role === 'passenger')
if (!sam || sam.vehicle !== 'a' || !sam.injured || !/whiplash/i.test(sam.injury)) fail(`passenger ${JSON.stringify(sam)}`)
if (!doc.people.find((p) => p.role === 'witness' && p.name === 'Wit Ness')) fail('witness lost')
if (doc.police.called !== true || doc.police.report !== '2026-0042') fail(`police ${JSON.stringify(doc.police)}`)
if (doc.attachments.photos.length !== 1 || doc.attachments.photos[0].caption !== 'Front bumper, close up' || doc.attachments.photos[0].of !== 'a') fail('photo lost')
const cond = doc.vehicles[0].condition
if (cond.drivable !== false || cond.airbags !== true || cond.towed !== true || !/Mike/.test(cond.location)) fail(`condition ${JSON.stringify(cond)}`)
if (doc.property.description !== 'Traffic light pole') fail(`property ${JSON.stringify(doc.property)}`)
if (doc.reporter.name !== 'Ashish B' || doc.reporter.email !== 'me@example.com' || doc.reporter.policyholder !== true) fail(`reporter ${JSON.stringify(doc.reporter)}`)
if (!doc.attestation.agreed || doc.attestation.name !== 'Ashish B' || doc.attestation.at !== doc.submittedAt) fail(`attestation ${JSON.stringify(doc.attestation)}`)
ok('sent: the whole report — kind, conditions, VIN, the other driver and their insurer, an injured passenger, the police report, a witness, a photo, the car now, the pole, who to call, signed')
ok(`sent: ${doc.reference}, scene ${sceneKb} kB, damage PNG ${Math.round(doc.attachments.damage.a.length / 1024)} kB`)

// ── a refresh lands on the confirmation, not the first step ────────────
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=Your report is in', { timeout: 10000 })
ok('refresh keeps the confirmation')

await browser.close()
if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nall smoke checks passed')
