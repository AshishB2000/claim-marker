/**
 * The integration, end to end, the way an insurer would run it: their own page embeds the
 * report with `embed.js`, hands over a token and what it knows about the customer, and the
 * reference server on the other end receives the document, files it, and announces it with
 * a signed webhook — then the claims desk opens it.
 *
 *   npm run dev                          # in another shell (and `npm run build` once, for dist/lib)
 *   node scripts/integration-smoke.mjs
 *
 * Along the way it proves the parts that are hard to see: the config reaches the iframe and
 * the brand changes; the host hears each step and sizes the iframe; the policy's two vehicles
 * become a pick and fill the card; the reporter is prefilled; a report sent with no signal is
 * kept and leaves by itself when the signal returns, and the host hears both; the server's
 * reference replaces the page's; the same document sent twice is filed once; the webhook
 * carries a valid signature; and the desk lists, opens and re-files the report.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = process.argv[2] ?? 'http://localhost:5173'
/** a port nothing else on the machine is using — other dev servers are often parked next to 5173 */
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const API_PORT = await freePort()
const HOOK_PORT = await freePort()
const HOST_PORT = await freePort()
const CLAIM_TOKEN = 'customer-token'
const DESK_TOKEN = 'desk-token'
const SECRET = 'hook-secret'

/** the claim server, once started; killed on failure so nothing is left behind */
let server = null
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  // stop here, not after the next line's misleading "ok"; the temp folder is left for a look
  server?.kill()
  process.exit(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

if (!existsSync(new URL('../dist/lib/claim.js', import.meta.url))) fail('dist/lib/claim.js is missing: run `npm run build` first')

// ── the insurer's side: a webhook receiver, the claim server, a host page ──

const hooks = []
const hookServer = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    hooks.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(204).end()
  })
})
hookServer.on('error', (e) => fail(`webhook receiver: ${e.message}`))
hookServer.listen(HOOK_PORT)

const dir = await mkdtemp(join(tmpdir(), 'claim-marker-'))
server = spawn(process.execPath, ['server/claim-server.mjs'], {
  env: { ...process.env, PORT: String(API_PORT), CLAIM_DIR: dir, CLAIM_TOKEN, DESK_TOKEN, WEBHOOK_URL: `http://localhost:${HOOK_PORT}/hook`, WEBHOOK_SECRET: SECRET },
  stdio: ['ignore', 'pipe', 'inherit'],
})
server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`))

const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>Acme Mutual — my policy</title>
<h1>Acme Mutual</h1><p>Something happened? Tell us below.</p>
<div id="report"></div>
<script src="${PAGE}/embed.js"></script>
<script>
  window.events = []
  window.widget = ClaimMarker.mount('#report', {
    url: '${PAGE}/',
    submitUrl: 'http://localhost:${API_PORT}/claims',
    token: '${CLAIM_TOKEN}',
    brand: 'Acme Mutual',
    returnDocument: true,
    prefill: {
      reporter: { name: 'Sam Lee', phone: '555 0100', email: 'Sam@Example.com', policy: 'pol-9', policyholder: true },
      vehicles: [
        { make: 'Toyota', model: 'Camry', year: 2021, plate: 'ABC 123', plateState: 'NY', vin: '4T1BF1FK5CU123456', color: '#b91c1c' },
        { make: 'Ford', model: 'F-150', year: 2020, plate: 'TRK 9', color: '#1c1f26' },
      ],
    },
    onStep: function (e) { events.push(e) },
    onSubmitted: function (e) { events.push(e) },
    onQueued: function (e) { events.push(e) },
  })
</script>`
const hostServer = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HOST_PAGE))
hostServer.on('error', (e) => fail(`host page: ${e.message}`))
hostServer.listen(HOST_PORT)

async function cleanup() {
  server.kill()
  hookServer.close()
  hostServer.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// wait for the claim server
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`http://localhost:${API_PORT}/health`)).ok) break
  } catch {
    await new Promise((r) => setTimeout(r, 100))
  }
}

// ── the customer, on the insurer's page ───────────────────────────────

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage()
const errors = []
const logs = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
await page.goto(`http://localhost:${HOST_PORT}/`)
const frame = page.frameLocator('iframe')
const events = () => page.evaluate(() => window.events)

await frame
  .locator('text=Acme Mutual')
  .first()
  .waitFor({ timeout: 20000 })
  .catch(async (e) => {
    console.error('frames:', page.frames().map((f) => f.url()))
    console.error('iframe src:', await page.evaluate(() => document.querySelector('iframe')?.src ?? '(no iframe)'))
    console.error('host console:', logs.slice(0, 10))
    console.error('page errors:', errors)
    fail(`the brand from the host config never reached the iframe: ${e.message.split('\n')[0]}`)
  })
await page.waitForFunction(() => window.events.some((e) => e.type === 'step' && e.step === 'kind'), null, { timeout: 5000 }).catch(() => fail('the host never heard the first step'))
const height = await page.waitForFunction(() => parseInt(document.querySelector('iframe').style.height) > 400, null, { timeout: 5000 }).catch(() => null)
if (!height) fail('the iframe was never sized to the page')
ok('embed: config reached the page (brand shown), the host heard the step, the iframe took the page height')

const next = () => frame.getByRole('button', { name: /^Continue/ }).click()
await next()

// where
const search = frame.getByRole('combobox', { name: 'Where did it happen?' })
await search.fill('Times Square, New York')
const option = frame.getByRole('option').first()
await option.waitFor({ timeout: 20000 }).catch(() => fail('no address suggestions'))
await option.click()
await frame.locator('text=Drag the pin on the map').waitFor({ timeout: 10000 })
await next()

// vehicles: the policy's two vehicles are a pick
const picks = frame.getByRole('radiogroup', { name: 'Which of your vehicles' }).getByRole('radio')
if ((await picks.count()) !== 2) fail(`expected two policy vehicles to pick from, got ${await picks.count()}`)
await picks.nth(1).click()
if ((await frame.getByRole('combobox', { name: 'Make' }).first().inputValue()) !== 'Ford') fail('picking the F-150 did not fill the card')
await picks.nth(0).click()
const make = await frame.getByRole('combobox', { name: 'Make' }).first().inputValue()
const vin = await frame.getByRole('textbox', { name: 'VIN' }).first().inputValue()
const plate = await frame.getByRole('textbox', { name: 'Plate' }).first().inputValue()
if (make !== 'Toyota' || vin !== '4T1BF1FK5CU123456' || plate !== 'ABC 123') fail(`picking the Camry gave ${make} ${vin} ${plate}`)
ok('prefill: two policy vehicles to pick from; picking one fills make, model, year, plate and VIN')
await next()

// people, the scene, the damage: nothing to add for this run
await frame.locator('text=Who was driving?').waitFor()
await next()
await frame.locator('.mk-car').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)
await next()
await frame.locator('.cm-root canvas').waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)
await next()

// review: the reporter is already filled in
await frame.locator('text=How do we reach you?').waitFor()
const name = await frame.getByRole('textbox', { name: 'Your name' }).inputValue()
const email = await frame.getByRole('textbox', { name: 'Your email' }).inputValue()
const policy = await frame.getByRole('textbox', { name: 'Policy number' }).inputValue()
if (name !== 'Sam Lee' || email !== 'sam@example.com' || policy !== 'POL-9') fail(`reporter prefill gave ${name} / ${email} / ${policy}`)
ok('prefill: the reporter is filled in on the review page')
await frame.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
await frame.getByRole('textbox', { name: 'Signature' }).fill('Sam Lee')

// send with no signal: the report is kept, and the host hears it
await context.setOffline(true)
await frame.getByRole('button', { name: 'Send my report' }).click()
await frame.locator('text=Your report is saved').waitFor({ timeout: 40000 }).catch(() => fail('a report sent with no signal was not kept'))
const queued = (await events()).find((e) => e.type === 'queued')
if (!queued || !/^CM-/.test(queued.reference)) fail('the host was not told the report was queued')
ok('offline: the report is kept with the page\'s reference and the host hears "queued"')

// the signal returns: it leaves by itself, and the server's reference replaces the page's
await context.setOffline(false)
await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('online')))
await frame.locator('text=Your report is in').waitFor({ timeout: 30000 }).catch(() => fail('the queued report did not send when back online'))
const shown = await frame.locator('.font-mono.text-3xl').textContent()
if (!/^INS-\d{4}-[A-Z2-9]{6}$/.test(shown ?? '')) fail(`the done page shows ${shown}, not the server's reference`)
const submitted = (await events()).find((e) => e.type === 'submitted')
if (!submitted || submitted.reference !== shown) fail(`the host heard ${JSON.stringify(submitted)}`)
if (submitted.document?.schema !== 'claim/1' || submitted.document.reporter.name !== 'Sam Lee') fail('the host asked for the document and did not get it')
ok(`online again: sent as ${shown}; the host heard "submitted" with the document`)

// ── the server's side ─────────────────────────────────────────────────

const desk = { headers: { authorization: `Bearer ${DESK_TOKEN}` } }
const list = await (await fetch(`http://localhost:${API_PORT}/claims`, desk)).json()
if (list.claims.length !== 1 || list.claims[0].reference !== shown) fail(`the server lists ${JSON.stringify(list)}`)
const one = await (await fetch(`http://localhost:${API_PORT}/claims/${shown}`, desk)).json()
if (one.claim.reporter.name !== 'Sam Lee' || one.claim.vehicles[0].vin !== '4T1BF1FK5CU123456' || one.claim.attestation.name !== 'Sam Lee') fail('the stored document is not the one sent')
if (!one.claim.attestation.at || !one.claim.submittedAt) fail('the attestation was not stamped')
const files = await readdir(join(dir, shown))
// no damage was marked on this walk (scripts/smoke.mjs covers that), so there is a diagram but no marked-up car
for (const f of ['claim.json', 'receipt.json', 'scene.png']) if (!files.includes(f)) fail(`${f} was not unpacked; have ${files.join(', ')}`)
const png = await fetch(`http://localhost:${API_PORT}/claims/${shown}/files/scene.png`, desk)
if (png.headers.get('content-type') !== 'image/png' || (await png.arrayBuffer()).byteLength < 10000) fail('the scene PNG is not served as a real image')
ok(`server: filed as ${shown} with ${files.length} files, the diagram served as image/png`)

if ((await fetch(`http://localhost:${API_PORT}/claims`)).status !== 401) fail('the desk API answered without a token')
const anon = await fetch(`http://localhost:${API_PORT}/claims`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
if (anon.status !== 401) fail(`a POST without the token got ${anon.status}`)
ok('server: both tokens are enforced')

// the same document again, as a bad connection would: the page's reference is the key, and it is filed once
const again = await fetch(`http://localhost:${API_PORT}/claims`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${CLAIM_TOKEN}`, 'idempotency-key': queued.reference },
  body: JSON.stringify({ ...submitted.document, reference: queued.reference }),
})
const dup = await again.json()
if (again.status !== 200 || !dup.duplicate || dup.reference !== shown) fail(`a resend was answered ${again.status} ${JSON.stringify(dup)}`)
if ((await readdir(dir)).filter((n) => n !== 'by-client').length !== 1) fail('a resend was filed twice')
ok('server: the same report sent twice is filed once and answered with the same reference')

const nonsense = await fetch(`http://localhost:${API_PORT}/claims`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${CLAIM_TOKEN}` }, body: '{"schema":"claim/9"}' })
if (nonsense.status !== 400) fail(`a document with the wrong schema got ${nonsense.status}`)
ok('server: the wrong schema is refused with a 400')

// the webhook, with a signature the receiver can check
for (let i = 0; i < 50 && hooks.length === 0; i++) await new Promise((r) => setTimeout(r, 100))
if (hooks.length !== 1) fail(`the webhook fired ${hooks.length} times`)
const hook = hooks[0]
const expected = 'sha256=' + createHmac('sha256', SECRET).update(hook.body).digest('hex')
if (hook.headers['x-claim-signature'] !== expected) fail('the webhook signature does not verify')
const payload = JSON.parse(hook.body)
if (payload.event !== 'claim.received' || payload.reference !== shown || payload.claim.attachments || !payload.files.scene) fail(`the webhook payload is off: ${hook.body.slice(0, 200)}`)
ok('webhook: one announcement, signature verifies, document without attachments plus links to the files')

// ── the claims desk ───────────────────────────────────────────────────

const deskPage = await context.newPage()
await deskPage.goto(`${PAGE}/adjuster.html?api=http://localhost:${API_PORT}`)
await deskPage.getByRole('textbox', { name: 'token' }).fill(DESK_TOKEN)
await deskPage.getByRole('button', { name: 'Open' }).click()
await deskPage.locator(`text=${shown}`).first().waitFor({ timeout: 10000 }).catch(() => fail('the desk does not list the report'))
await deskPage.locator(`text=${shown}`).first().click()
await deskPage.locator('text=Reported by').waitFor({ timeout: 15000 }).catch(() => fail('the desk did not open the report'))
if (!(await deskPage.locator('text=Sam Lee').count())) fail('the opened report does not show the reporter')
await deskPage.getByRole('radio', { name: 'In review' }).click()
await deskPage.waitForTimeout(500)
await deskPage.waitForTimeout(4000)
await deskPage.screenshot({ path: 'docs/desk.png' })
const after = await (await fetch(`http://localhost:${API_PORT}/claims/${shown}`, desk)).json()
if (after.status !== 'reviewing') fail(`the desk's status change did not reach the server: ${after.status}`)
ok('desk: lists the report, opens the document, moves it to "in review"')

const real = errors.filter((e) => !/WebGL|GPU|ResizeObserver/.test(e))
if (real.length) fail(`page errors: ${real.join(' | ')}`)

await browser.close()
await cleanup()
console.log('\nall integration checks passed')
