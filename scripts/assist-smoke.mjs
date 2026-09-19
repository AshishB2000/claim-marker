/**
 * The assistant, end to end, against a stub endpoint.
 *
 *   node scripts/assist-smoke.mjs
 *
 * It starts its own stub of the `claim-assist/1` endpoint and its own dev server pointed at
 * it, so it needs no API key and no network beyond the map. What it proves is this page's
 * half of the contract for all four tasks — the diagram, the statement, the damage read off
 * the photographs and the second look before sending: the request it sends, the answer it
 * accepts, what lands on the car and on the map, and that a malicious or broken answer cannot
 * put anything there. It walks the damage step twice: at desktop width, where the customer asks
 * for the photos to be read, and at phone width, where the step leads with the camera and reads
 * them by itself. The model's own judgement is not tested here — that needs a key and
 * `scripts/assist-server.mjs`.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

/** its own ports, found free: several of these scripts run beside each other on one machine */
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const ASSIST_PORT = await freePort()
const DEV_PORT = await freePort()
const origin = `http://localhost:${DEV_PORT}`

const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  shutdown(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

/** what the stub was asked, and what it should answer next */
const seen = []
let answer = null

const stub = createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  seen.push(body)
  const [code, out] = answer(body)
  res.writeHead(code, cors)
  res.end(JSON.stringify(out))
})
await new Promise((r) => stub.listen(ASSIST_PORT, r))

const dev = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], {
  env: { ...process.env, VITE_ASSIST_URL: `http://localhost:${ASSIST_PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 30000)
  dev.stdout.on('data', (d) => String(d).includes('ready in') && (clearTimeout(t), resolve()))
  dev.stderr.on('data', (d) => process.stderr.write(d))
})

let browser
function shutdown(code) {
  browser?.close()
  dev.kill('SIGTERM')
  stub.close()
  process.exit(code)
}

// A camera the guided tiles can actually open. Chromium's fake device plays a moving test
// pattern into getUserMedia, which is enough to prove the sheet opens, samples frames, hints,
// shoots and — the part that matters — lets the camera go again afterwards.
browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
// step 5 asks the stub for a 502 on purpose; the browser logs every failed fetch
const expected = /502 \(Bad Gateway\)/
page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state)

// straight to the scenario step with two vehicles at a known place. The draft is written in
// the v3 shape on purpose: the store's migration has to fill in everything v4 added.
const HERE = { lng: -73.9859, lat: 40.7573 }
await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
await page.evaluate((here) => {
  const v = (id, role, body, color, make, model, year) => ({ id, role, body, color, make, model, year, plate: '', position: null, heading: 0, path: [], damages: [] })
  const claim = {
    schema: 'claim/1',
    reference: null,
    submittedAt: null,
    incident: { at: '2026-09-08T09:15', location: { ...here, address: 'Times Square, Manhattan, New York' }, surface: 'satellite', description: '' },
    vehicles: [v('a', 'insured', 'sedan', '#b91c1c', 'Toyota', 'Camry', 2021), v('b', 'other', 'suv', '#1c1f26', 'Honda', 'CR-V', 2019)],
    impact: null,
    attachments: { scene: null, damage: {} },
  }
  localStorage.setItem('claim-marker/draft', JSON.stringify({ state: { claim, step: 'scene', impactManual: false, autoDamage: {} }, version: 3 }))
}, HERE)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.mk-car', { timeout: 20000 })
await page.waitForTimeout(4000)

const story = 'I was heading north through the junction on a green light and a black SUV turned left across me and hit my front bumper.'
const box = page.getByRole('textbox', { name: 'In your own words, what happened?' })

// ── 1 · the request the page sends ─────────────────────────────────────
answer = () => [200, { schema: 'claim-assist/1', task: 'diagram', scene: { vehicles: [], note: 'Nothing to place.' } }]
await box.fill(story)
await page.getByRole('button', { name: 'Draw this on the map' }).click()
await page.waitForFunction(() => document.body.innerText.includes('Nothing to place'), null, { timeout: 15000 })
const asked = seen.at(-1)
if (asked.schema !== 'claim-assist/1' || asked.task !== 'diagram') fail(`wrong envelope: ${JSON.stringify(asked).slice(0, 200)}`)
if (asked.text !== story) fail('the description was not sent')
if (!/Times Square/.test(asked.place)) fail('the place was not sent')
if (asked.vehicles.length !== 2) fail(`expected both vehicles, got ${asked.vehicles.length}`)
if (asked.vehicles[0].id !== 'a' || asked.vehicles[0].role !== 'insured' || asked.vehicles[0].model !== 'Camry') fail(`vehicle A wrong: ${JSON.stringify(asked.vehicles[0])}`)
if (asked.vehicles[1].color !== 'black') fail(`the colour should go as a name, got ${JSON.stringify(asked.vehicles[1].color)}`)
if (JSON.stringify(asked).includes('sk-') || asked.vehicles[0].plate !== undefined) fail('the request carries more than it should')
ok(`assist: the page asks for a diagram with the story, the place and both vehicles`)

// ── 2 · a scene comes back and lands on the map ────────────────────────
// A came from 30 m south and stopped just short of the junction facing north; B came from
// the east and stopped across it facing west; they hit between them.
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'diagram',
    scene: {
      vehicles: [
        { id: 'a', at: [0, -3], heading: 0, from: [[0, -30], [0, -14]] },
        { id: 'b', at: [2, 1], heading: 270, from: [[26, 2], [12, 1]] },
      ],
      impact: [0.5, -0.5],
      note: 'Drawn from your description.',
    },
  },
]
await page.getByRole('button', { name: 'Draw this on the map' }).click()
await page.waitForFunction(() => document.body.innerText.includes('Drawn from your description'), null, { timeout: 15000 })
await page.waitForTimeout(800)
const after = (await draft()).claim
const R = 6371008.8
const metres = (p, q) => {
  const [φ1, φ2] = [p[1], q[1]].map((d) => (d * Math.PI) / 180)
  const dφ = φ2 - φ1
  const dλ = ((q[0] - p[0]) * Math.PI) / 180
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2))
}
const a = after.vehicles[0]
const b = after.vehicles[1]
if (metres([HERE.lng, HERE.lat], a.position) > 3.5) fail(`A landed ${metres([HERE.lng, HERE.lat], a.position).toFixed(1)} m from the incident, expected ~3`)
if (a.heading !== 0 || b.heading !== 270) fail(`headings not applied: ${a.heading}, ${b.heading}`)
if (a.path.length !== 2 || b.path.length !== 2) fail(`routes not applied: ${a.path.length}, ${b.path.length}`)
if (metres(a.path[0], a.position) < 25) fail("A's route should start ~30 m back")
if (!after.impact) fail('the impact from the description was not placed')
if (metres(after.impact, [HERE.lng, HERE.lat]) > 2) fail('the impact landed away from where the words put it')
if ((await page.locator('.mk-car').count()) !== 2) fail('the cars are not on the map')
ok(`assist: the scene landed — A facing ${a.heading}° with a ${a.path.length}-point route, B facing ${b.heading}°, impact placed`)

// the damage that follows from that impact is already worked out, as it is for a drag
if (a.damages[0]?.zone !== 'front_bumper') fail(`A should be marked on the front bumper, got ${JSON.stringify(a.damages)}`)
ok(`assist: the panel each car was hit on follows from the drawn scene (A: ${a.damages[0].zone})`)

// ── 3 · the diagram back into words ────────────────────────────────────
const written = 'I was driving north through the junction when the other vehicle turned across me. The front of my car struck its nearside.'
answer = () => [200, { schema: 'claim-assist/1', task: 'describe', text: `  ${written}  ` }]
await page.getByRole('button', { name: 'Write it from the diagram' }).click()
await page.waitForFunction((t) => document.querySelector('textarea')?.value === t, written, { timeout: 15000 })
const told = seen.at(-1)
if (told.task !== 'describe') fail(`wrong task: ${told.task}`)
if (told.vehicles.length !== 2) fail('the diagram was not sent')
if (Math.abs(told.vehicles[0].at[1] + 3) > 0.5) fail(`A's position went out wrong: ${JSON.stringify(told.vehicles[0].at)}`)
if (told.vehicles[0].heading !== 0 || told.vehicles[1].heading !== 270) fail('headings went out wrong')
if (!told.vehicles[0].damage.some((d) => /front bumper/i.test(d))) fail(`the marked damage was not sent: ${JSON.stringify(told.vehicles[0].damage)}`)
if (!told.impact) fail('the impact was not sent')
if ((await draft()).claim.incident.description !== written) fail('the statement was not saved to the claim')
ok(`assist: the diagram went out as metres and bearings and the statement came back into the box`)

// ── 4 · a bad answer changes nothing ───────────────────────────────────
const before = JSON.stringify((await draft()).claim.vehicles)
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'diagram',
    // a vehicle nobody listed, one 40 km away, one with no heading, and a nonsense impact
    scene: {
      vehicles: [
        { id: 'zz', at: [1, 1], heading: 10, from: [] },
        { id: 'a', at: [40000, 0], heading: 10, from: [] },
        { id: 'b', at: [1, 1], heading: 'north', from: [] },
      ],
      impact: ['over', 'there'],
      note: 'x'.repeat(900),
    },
  },
]
await page.getByRole('button', { name: 'Draw this on the map' }).click()
await page.waitForFunction(() => document.body.innerText.includes('Nothing in that could be placed') || document.body.innerText.includes('xxxx'), null, { timeout: 15000 })
await page.waitForTimeout(500)
if (JSON.stringify((await draft()).claim.vehicles) !== before) fail('a malformed answer moved the cars')
if ((await page.locator('.mk-car').count()) !== 2) fail('a malformed answer added a car')
ok('assist: an answer naming an unknown vehicle, an impossible position and a bad heading moves nothing')

// ── 5 · the endpoint failing is a message, not a broken page ───────────
answer = () => [502, { error: 'the assistant could not answer' }]
await page.getByRole('button', { name: 'Draw this on the map' }).click()
await page.waitForFunction(() => /could not answer \(502\)/.test(document.body.innerText), null, { timeout: 15000 })
if (JSON.stringify((await draft()).claim.vehicles) !== before) fail('a failed call changed the claim')
ok('assist: a failing endpoint says so and leaves the diagram alone')

// ── 6 · the damage read off a photograph ───────────────────────────────

await page.getByRole('button', { name: /^Continue/ }).click()
await page.locator('.cm-root canvas').waitFor({ timeout: 30000 })

// a real photograph of vehicle A, through the real input, so it is downscaled and tagged
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
await page.getByLabel('Add photos').setInputFiles({ name: 'damage.png', mimeType: 'image/png', buffer: PNG })
await page.locator('text=From your photos').waitFor({ timeout: 15000 }).catch(() => fail('a photo of this vehicle did not offer to be read'))

// at this width the step is the one it always was: the photos wait to be asked about, and the
// phone's capture tiles are nowhere
const quiet = seen.length
await page.waitForTimeout(2500)
if (seen.length !== quiet) fail('the desktop step read the photos without being asked')
if (await page.getByRole('button', { name: 'The damage, close up' }).count()) fail('the phone capture tiles are in the desktop layout')
if (!(await page.getByRole('button', { name: 'Suggest from photos' }).count())) fail('the desktop button to read the photos is gone')
ok('assist: at 1280 the damage step is unchanged — the photos are read only when the button is pressed')

// one panel this body has, and one it does not: a sedan has left/right rear doors, not "rear_door"
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'damage',
    damages: [
      { zone: 'hood', severity: 'dent', note: 'crumpled at the front edge', point: [99, 99, 99] },
      { zone: 'rear_door', severity: 'crack' },
    ],
  },
]
await page.getByRole('button', { name: 'Suggest from photos' }).click()
await page.getByRole('button', { name: /^Add Hood/ }).waitFor({ timeout: 15000 }).catch(() => fail('no suggestion came back from the photos'))
const looked = seen.at(-1)
if (looked.task !== 'damage' || looked.vehicle !== 'sedan') fail(`wrong damage request: ${JSON.stringify(looked).slice(0, 200)}`)
if (!looked.zones?.some((z) => z.id === 'hood') || looked.zones.some((z) => z.id === 'rear_door')) fail("the zone list is not this body's own panels")
if (looked.photos?.length !== 1 || !/^data:image\/jpeg;base64,/.test(looked.photos[0])) fail(`the photograph was not sent: ${JSON.stringify(looked.photos)?.slice(0, 80)}`)
if ((await page.getByRole('button', { name: /^Add / }).count()) !== 1) fail('a panel this body does not have was offered')
ok('assist: the photo went out with this body’s own panels; a suggestion naming a panel it does not have is dropped')

const beforeAdd = (await draft()).claim.vehicles[0].damages.length
await page.getByRole('button', { name: /^Add Hood/ }).click()
await page.waitForFunction((n) => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.vehicles[0].damages.length > n, beforeAdd, { timeout: 5000 })
const marked = (await draft()).claim
const hood = marked.vehicles[0].damages.find((d) => d.zone === 'hood')
if (!hood) fail('Add did not put the mark on the car')
if (JSON.stringify(hood.point) !== JSON.stringify([0, 0.76, 0.78])) fail(`the mark did not land on the hood's own anchor: ${JSON.stringify(hood.point)}`)
if (hood.severity !== 'dent' || !/crumpled/.test(hood.note)) fail(`the mark lost its severity or note: ${JSON.stringify(hood)}`)
if ((await draft()).autoDamage.a !== 'user') fail('adding a suggestion did not make this vehicle’s damage the customer’s own')
ok(`assist: "Add" lands the mark on the hood's measured anchor and the damage becomes the customer's`)

// ── 7 · a second look before sending ───────────────────────────────────

await page.getByRole('button', { name: /^Continue/ }).click()
await page.locator('text=A second look').waitFor({ timeout: 20000 }).catch(() => fail('the review page does not offer a second look'))
const send = page.getByRole('button', { name: 'Send my report' })
if (!(await send.isDisabled())) fail('the review page let the report go unsigned')

// the endpoint failing says so and changes nothing
answer = () => [502, { error: 'the assistant could not answer' }]
// scrolled into view first: the review page is 4000 px of map and document
const check = page.getByRole('button', { name: 'Check it over for me' })
await check.scrollIntoViewIfNeeded()
await check.click()
await page.waitForFunction(() => /could not answer \(502\)/.test(document.body.innerText), null, { timeout: 15000 })
if (!(await send.isDisabled())) fail('a failed check changed whether the report could be sent')
ok('assist: a failing second look says so and changes nothing')

// six come back: one an essay, one naming a step this page does not have, one over the cap
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'check',
    checks: [
      { text: 'x'.repeat(400) },
      { text: 'Add a photo of the other vehicle', step: 'photos' },
      { text: 'Were the police called?', step: 'people' },
      { text: 'Say which way you were going.' },
      { text: 'Is your car drivable?' },
      { text: 'This one is over the cap.' },
    ],
  },
]
// the label only says "again" once something came back; after the 502 it still says "over for me"
const again = page.getByRole('button', { name: /^Check it (over for me|again)$/ })
await again.scrollIntoViewIfNeeded()
await again.click()
await page.waitForFunction(() => document.body.innerText.includes('Were the police called?'), null, { timeout: 15000 })
const asked2 = seen.at(-1)
if (asked2.task !== 'check') fail(`wrong task: ${asked2.task}`)
const wire = JSON.stringify(asked2)
// every key anywhere in the request, so this catches a field added three levels down later
const keysOf = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out))
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k)
      keysOf(x, out)
    }
  }
  return out
}
const keys = keysOf(asked2)
const forbidden = ['attachments', 'photos_data', 'reporter', 'attestation', 'name', 'phone', 'email', 'licence', 'plate', 'plateState', 'vin', 'insurer', 'policy', 'owner'].filter((k) => keys.has(k))
if (forbidden.length) fail(`the check request carries identity or contact fields: ${forbidden.join(', ')}`)
if (asked2.vehicles?.length !== 2 || asked2.people === undefined || asked2.photos !== 1) fail(`the check request is missing the shape of the accident: ${wire.slice(0, 300)}`)
if (!asked2.vehicles[0].damage?.some((d) => /hood/i.test(d))) fail('the marked damage was not sent with the check')
ok('assist: the second look goes out as the shape of the accident — no attachments, no names, no plates, no phone numbers')

const rows = await page.evaluate(() => {
  const card = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'A second look').closest('.card')
  const items = [...card.querySelectorAll('li')]
  return {
    count: items.length,
    longest: Math.max(...items.map((li) => li.innerText.replace(/\s*Go to that step\s*$/, '').trim().length)),
    links: [...card.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Go to that step').length,
    text: items.map((li) => li.innerText),
  }
})
if (rows.count !== 5) fail(`six answers, one over the cap, rendered ${rows.count}`)
if (rows.longest !== 200) fail(`the over-long question was not cut to 200 characters (longest ${rows.longest})`)
// the only "Go to that step" belongs to the one naming a step this page has
if (rows.links !== 1) fail(`expected one step link, got ${rows.links}`)
if (!rows.text.some((t) => /Add a photo of the other vehicle/.test(t) && !/Go to that step/.test(t))) fail('a question naming an unknown step kept its link')
if (!(await send.isDisabled())) fail('the questions changed whether the report could be sent')
ok('assist: five of six rendered, the essay cut to 200, no link on the unknown step, and sending is untouched')

await page.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
await page.getByRole('textbox', { name: 'Signature' }).fill('Sam Lee')
if (await send.isDisabled()) fail('signing did not enable sending')
ok('assist: only the signature decides whether the report can go')

await page.getByRole('button', { name: 'Go to that step' }).click()
await page.waitForFunction(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.step === 'people', null, { timeout: 5000 }).catch(() => fail('"Go to that step" did not navigate'))
ok('assist: "Go to that step" opens the step that answers the question')

// ── 8 · the phone: the camera first, and the photos read by themselves ─

const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] })
const phone = await phoneCtx.newPage()
// every track the page is ever handed, so the walk can prove the camera is released and not
// merely hidden — a page that leaves the camera light on after the sheet closes ends a pilot
await phone.addInitScript(() => {
  window.__tracks = []
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (c) => {
    const stream = await real(c)
    window.__tracks.push(...stream.getTracks())
    return stream
  }
})
phone.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(m.text()))
phone.on('pageerror', (e) => errors.push(String(e)))
const state = () => phone.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state)

await phone.goto(`${origin}/`, { waitUntil: 'networkidle' })
await phone.evaluate((here) => {
  const v = (id, role, body, color, make, model, year) => ({ id, role, body, color, make, model, year, plate: '', position: null, heading: 0, path: [], damages: [] })
  const claim = {
    schema: 'claim/1',
    reference: null,
    submittedAt: null,
    incident: { at: '2026-09-08T09:15', location: { ...here, address: 'Times Square, Manhattan, New York' }, surface: 'satellite', description: '' },
    vehicles: [v('a', 'insured', 'sedan', '#b91c1c', 'Toyota', 'Camry', 2021), v('b', 'other', 'suv', '#1c1f26', 'Honda', 'CR-V', 2019)],
    impact: null,
    attachments: { scene: null, damage: {} },
  }
  localStorage.setItem('claim-marker/draft', JSON.stringify({ state: { claim, step: 'damage', impactManual: false, autoDamage: {} }, version: 3 }))
}, HERE)
await phone.reload({ waitUntil: 'networkidle' })
await phone.locator('.cm-root canvas').waitFor({ timeout: 30000 })

for (const tile of ['The damage, close up', 'The same, from a step back', 'The whole side of the car', 'The other vehicle and its plate']) {
  if (!(await phone.getByRole('button', { name: tile }).count())) fail(`the phone layout is missing the "${tile}" tile`)
}
if (await phone.getByRole('button', { name: 'Suggest from photos' }).count()) fail('the phone layout still asks the customer to press a button')
ok('assist: at 390 the damage step leads with the camera — four guided shots and no button to press')

// a photograph taken from a tile, through the camera input the tile opens
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'damage',
    damages: [
      { zone: 'hood', severity: 'dent', note: 'crumpled at the front edge' },
      { zone: 'rear_door', severity: 'crack' },
    ],
  },
]

/** one guided shot through the live camera: open the sheet, press the shutter, wait for the photo */
const shootTile = async (tile) => {
  const before = (await state()).claim.attachments.photos.length
  await phone.getByRole('button', { name: tile }).click()
  await phone.getByRole('dialog', { name: 'Camera' }).waitFor({ timeout: 20000 })
  await phone.getByRole('button', { name: 'Take photo' }).click()
  await phone.getByRole('dialog', { name: 'Camera' }).waitFor({ state: 'detached', timeout: 10000 })
  await phone
    .waitForFunction((n) => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.attachments.photos.length > n, before, { timeout: 15000 })
    .catch(() => fail(`the "${tile}" shutter did not land a photo`))
}

const before8 = seen.length
// the tile opens the live camera, not a file picker: this is a phone with a camera in it
await phone.getByRole('button', { name: 'The damage, close up' }).click()
await phone.getByRole('dialog', { name: 'Camera' }).waitFor({ timeout: 20000 })
// the sheet renders first and the stream arrives a moment later, as it does on a phone
await phone.waitForFunction(() => window.__tracks.length === 1, null, { timeout: 15000 }).catch(() => fail('the guide did not open the camera'))
// the hints are hints: whatever the fake device's test pattern reads as, the shutter works.
// It waits only for the stream to be ready, which a loaded machine takes more than a second to
// commit — so give that up to 10 s, and then it must be enabled whatever the hints say
const shutter = phone.getByRole('button', { name: 'Take photo' })
for (let i = 0; i < 50 && (await shutter.isDisabled()); i++) await phone.waitForTimeout(200)
if (await shutter.isDisabled()) fail('the shutter was disabled — the checks are hints, never gates')
await shutter.click()
await phone.getByRole('dialog', { name: 'Camera' }).waitFor({ state: 'detached', timeout: 10000 })
const releasedShot = await phone.evaluate(() => window.__tracks.every((t) => t.readyState === 'ended'))
if (!releasedShot) fail('the camera was still running after the shutter closed the sheet')
// the frame goes through the same `addPhotos` a picked file does, so it is downscaled and
// re-encoded before it is kept — which takes a moment
await phone
  .waitForFunction(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.attachments.photos.length === 1, null, { timeout: 15000 })
  .catch(() => fail('the shutter did not land a photo'))
const shot = (await state()).claim.attachments.photos.at(-1)
if (!shot?.data.startsWith('data:image/jpeg;base64,') || shot.of !== 'a') fail(`the shutter did not land a photo of A: ${JSON.stringify(shot?.of)}`)
ok('assist: the guided tile opens the real camera, the shutter lands a photo, and closing releases the camera')

await phone
  .getByRole('button', { name: 'Add Hood' })
  .waitFor({ timeout: 20000 })
  .catch(() => fail('the photos were not read without a button press'))
if (seen.length !== before8 + 1) fail(`one photo should be one read, got ${seen.length - before8}`)
const read = seen.at(-1)
if (read.task !== 'damage' || read.vehicle !== 'sedan' || read.photos?.length !== 1) fail(`wrong damage request from the phone: ${JSON.stringify(read).slice(0, 200)}`)
if ((await phone.getByRole('button', { name: /^Add / }).count()) !== 1) fail('a panel this body does not have was offered')
if (!(await phone.getByRole('button', { name: /The damage, close up, taken/ }).count())) fail('the tile does not show the photo it took')
ok('assist: a photo taken from a tile is read on its own; the tile shows it, and a panel this body has not is dropped')

await phone.getByRole('button', { name: 'Add Hood' }).click()
await phone.waitForFunction(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.vehicles[0].damages.length === 1, null, { timeout: 5000 })
const added = await state()
const mark = added.claim.vehicles[0].damages[0]
if (JSON.stringify(mark.point) !== JSON.stringify([0, 0.76, 0.78])) fail(`the mark did not land on the hood's own anchor: ${JSON.stringify(mark.point)}`)
if (added.autoDamage.a !== 'user') fail('adding a suggestion did not make this vehicle’s damage the customer’s own')
if (added.claim.attachments.photos[0].shows !== 'hood') fail(`the photo was not tagged with the panel it shows: ${JSON.stringify(added.claim.attachments.photos[0].shows)}`)
if (await phone.getByRole('button', { name: 'Add Hood' }).count()) fail('the card stayed after it was added')
ok('assist: "Add" lands the mark on the anchor, makes the damage the customer’s, and tags the photo it was read off')

// a second photo reads again; a panel already on the car is not offered twice, and "Not this" clears one
answer = () => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'damage',
    damages: [
      { zone: 'hood', severity: 'dent', note: 'the same dent again' },
      { zone: 'front_bumper', severity: 'scratch', note: 'scuffed along the corner' },
    ],
  },
]
await shootTile('The same, from a step back')
await phone
  .getByRole('button', { name: 'Add Front bumper' })
  .waitFor({ timeout: 20000 })
  .catch(() => fail('a second photo was not read'))
if ((await phone.getByRole('button', { name: /^Add / }).count()) !== 1) fail('a panel already marked on the car was offered again')
await phone.getByRole('button', { name: 'Not this: Front bumper' }).click()
await phone.waitForTimeout(300)
if (await phone.getByRole('button', { name: 'Add Front bumper' }).count()) fail('"Not this" left the card up')
if ((await state()).claim.vehicles[0].damages.length !== 1) fail('"Not this" changed the car')
ok('assist: another photo reads again, a panel already marked is not offered twice, and "Not this" leaves the car alone')

// the endpoint failing is a quiet line, and the car underneath still takes a tap
answer = () => [502, { error: 'the assistant could not answer' }]
await shootTile('The whole side of the car')
await phone.waitForFunction(() => document.body.innerText.includes('We could not read the photos this time'), null, { timeout: 20000 }).catch(() => fail('a failed read did not say so'))
if (await phone.getByRole('button', { name: /^Add / }).count()) fail('a failed read left a suggestion up')

const canvas = phone.locator('.cm-root canvas')
await canvas.scrollIntoViewIfNeeded()
// three.js is still linking shaders for the first seconds under software GL: tap until the car is there
for (let i = 0; i < 20 && !(await phone.locator('.cm-pop').count()); i++) {
  const b = await canvas.boundingBox()
  await phone.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await phone.waitForTimeout(700)
}
if (!(await phone.locator('.cm-pop').count())) fail('the car under the failed read did not take a tap')
await phone.getByRole('button', { name: 'dent', exact: true }).click({ force: true })
await phone.waitForFunction(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state.claim.vehicles[0].damages.length === 2, null, { timeout: 5000 }).catch(() => fail('the tap did not mark the car'))
ok('assist: a failed read is one quiet line and the car below still takes a mark by hand')

// ── 9 · "just tell us what happened" ──────────────────────────────────
// One account, a whole proposed report back, confirmed piece by piece. The stub answers with
// things the page must never take from a model — a name, a plate, a VIN, a phone number — and
// a place as words; the proposals must show none of the first and the page must turn the second
// into a search the customer finishes, never a coordinate.
const intakeCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const tell = await intakeCtx.newPage()
tell.on('pageerror', (e) => errors.push(String(e)))
const intakeState = () => tell.evaluate(() => JSON.parse(localStorage.getItem('claim-marker/draft')).state)
await tell.goto(`${origin}/`, { waitUntil: 'networkidle' })
// the customer had already typed their car's make before they tried talking instead
await tell.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('claim-marker/draft'))
  raw.state.claim.vehicles[0].make = 'Subaru'
  localStorage.setItem('claim-marker/draft', JSON.stringify(raw))
})
await tell.reload({ waitUntil: 'networkidle' })
await tell.locator('text=Just tell us what happened').waitFor({ timeout: 15000 }).catch(() => fail('the intake card is not on the first screen'))

/** the day before a local `YYYY-MM-DDTHH:mm`, as `YYYY-MM-DD` */
const yesterday = (now) => {
  const d = new Date(`${now.slice(0, 10)}T12:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const account = 'This morning at about 8.40 I was driving my red Honda Civic on 5th Avenue in the rain, a black SUV pulled out and hit my front. My passenger hurt her neck. The police came, report 2026-0042.'
answer = (req) => [
  200,
  {
    schema: 'claim-assist/1',
    task: 'intake',
    draft: {
      kind: 'collision',
      // yesterday's morning: today's 08:40 is still in the future for a run before 08:40, and
      // `parseIntake` rightly drops a time that has not happened yet
      when: `${yesterday(req.now)}T08:40`,
      place: '5th Avenue and 42nd Street, New York',
      conditions: { weather: 'rain', road: 'wet', light: 'daylight' },
      vehicles: [
        { role: 'insured', make: 'Honda', model: 'Civic', color: 'red', body: 'sedan', plate: 'ABC 123', vin: '1HGCM82633A004352' },
        { role: 'other', color: 'black', body: 'suv', plate: 'XYZ 789' },
      ],
      people: [{ role: 'passenger', vehicle: 'insured', injured: true, injury: 'neck pain', name: 'Maria Lopez', phone: '555 0100' }],
      police: { called: true, report: '2026-0042' },
      description: 'A black SUV pulled out and hit my front.',
      name: 'Ashish B',
      email: 'me@example.com',
    },
  },
]
const beforeIntake = seen.length
await tell.getByPlaceholder('What happened, where, when, who was involved…').fill(account)
await tell.getByRole('button', { name: 'Tell us' }).click()
await tell.locator('text=Here is what we understood').waitFor({ timeout: 15000 }).catch(() => fail('the proposal did not appear'))
const sentIntake = seen.at(-1)
if (seen.length !== beforeIntake + 1 || sentIntake.task !== 'intake' || sentIntake.transcript !== account) fail(`wrong intake request: ${JSON.stringify(sentIntake).slice(0, 200)}`)
if (!sentIntake.kinds?.includes('collision') || !sentIntake.bodies?.includes('suv') || !sentIntake.colours?.includes('red')) fail('the intake request does not carry the enums')
const proposal = await tell.locator('body').innerText()
for (const secret of ['Maria Lopez', '555 0100', 'ABC 123', 'XYZ 789', '1HGCM82633A004352', 'Ashish B', 'me@example.com']) {
  if (proposal.includes(secret)) fail(`the proposal shows "${secret}", which came from the model`)
}
if (!proposal.includes('We’ll search for “5th Avenue and 42nd Street, New York”')) fail('the place is not offered as a search')
if (!proposal.includes('1 person hurt')) fail('the injury is not a count')
// words of the model's that would land in the claim as written are shown before they can: nothing lands unseen
if (!proposal.includes('“neck pain”')) fail('the injury the model wrote would land without being shown')
if (!proposal.includes('Report number 2026-0042')) fail('the police report number the model wrote would land without being shown')
ok('intake: one account comes back as proposals — no names, plates, VINs or phone numbers, the injury as a count with its own words shown, the place as a search')

// untick the police: that answer must stay the customer's to give
await tell.getByLabel('The police were called').uncheck()
await tell.getByRole('button', { name: 'Use these' }).click()
await tell.getByRole('combobox', { name: 'Where did it happen?' }).waitFor({ timeout: 15000 }).catch(() => fail('"Use these" did not walk on to the Where step'))
const searchBox = await tell.getByRole('combobox', { name: 'Where did it happen?' }).inputValue()
if (searchBox !== '5th Avenue and 42nd Street, New York') fail(`the place search was not started from the account: "${searchBox}"`)
const filled = (await intakeState()).claim
if (filled.incident.kind !== 'collision') fail(`kind ${filled.incident.kind}`)
if (!filled.incident.at.endsWith('T08:40')) fail(`the time was not filled: ${filled.incident.at}`)
if (filled.incident.location) fail('the model supplied a location; only the customer picks one')
if (JSON.stringify(filled.incident.conditions) !== JSON.stringify({ weather: 'rain', road: 'wet', light: 'daylight' })) fail(`conditions ${JSON.stringify(filled.incident.conditions)}`)
if (filled.vehicles[0].make !== 'Subaru') fail(`a make the customer had typed was overwritten: ${filled.vehicles[0].make}`)
if (filled.vehicles[0].model !== 'Civic' || filled.vehicles[0].color !== '#b91c1c') fail(`the customer's car was not filled: ${JSON.stringify(filled.vehicles[0]).slice(0, 160)}`)
if (!filled.vehicles.some((v) => v.role === 'other' && v.body === 'suv' && v.color === '#1c1f26')) fail('the other vehicle was not proposed into the report')
if (filled.vehicles.some((v) => v.plate || v.vin)) fail('a plate or VIN from the model reached the report')
if (filled.people.some((p) => p.name || p.phone)) fail('a name or phone from the model reached the report')
if (!filled.people.some((p) => p.role === 'passenger' && p.injured && p.vehicle === filled.vehicles[0].id)) fail('the hurt passenger was not placed in the customer\'s car')
if (filled.police.called !== null || filled.police.report) fail(`an unticked proposal was used anyway: police ${JSON.stringify(filled.police)}`)
if (filled.incident.description !== account) fail('the statement is not the customer\'s own words, verbatim')
ok('intake: "Use these" fills what was empty, leaves what was typed and what was unticked, keeps the account verbatim, and opens the place search')

// a failing endpoint is one quiet line, and the ordinary first step still works
await tell.evaluate(() => localStorage.clear())
await tell.reload({ waitUntil: 'networkidle' })
answer = () => [502, { error: 'no' }]
await tell.getByPlaceholder('What happened, where, when, who was involved…').fill('it went wrong')
await tell.getByRole('button', { name: 'Tell us' }).click()
await tell.locator("text=We couldn't make sense of that").waitFor({ timeout: 15000 }).catch(() => fail('a failed intake did not say so'))
await tell.getByRole('radio', { name: /Hit while parked/ }).click()
if ((await intakeState()).claim.incident.kind !== 'parked') fail('the kind cards stopped working after a failed intake')
ok('intake: a failing endpoint is one quiet line and the kind cards still work')

// the same card in Spanish, with nothing English left on it
const esPage = await intakeCtx.newPage()
await esPage.addInitScript(() => void (window.CLAIM_MARKER = { lang: 'es' }))
await esPage.goto(`${origin}/`, { waitUntil: 'networkidle' })
await esPage.locator('text=Cuéntanos qué pasó').waitFor({ timeout: 15000 }).catch(() => fail('the intake card is not in Spanish'))
if (await esPage.locator('text=Just tell us what happened').count()) fail('English left on the Spanish intake card')
ok('intake: the card reads in Spanish')
await intakeCtx.close()

if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nall assist checks passed')
shutdown(0)
