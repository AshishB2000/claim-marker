/**
 * The assistant, end to end, against a stub endpoint.
 *
 *   node scripts/assist-smoke.mjs
 *
 * It starts its own stub of the `claim-assist/1` endpoint and its own dev server pointed at
 * it, so it needs no API key and no network beyond the map. What it proves is this page's
 * half of the contract: the request it sends, the answer it accepts, what lands on the map,
 * and that a malicious or broken answer cannot put anything there. The model's own judgement
 * is not tested here — that needs a key and `scripts/assist-server.mjs`.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const ASSIST_PORT = 8788
const DEV_PORT = 5174
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

browser = await chromium.launch()
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

if (errors.length) fail(`console errors:\n${errors.join('\n')}`)
console.log('\nall assist checks passed')
shutdown(0)
