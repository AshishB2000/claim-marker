/**
 * The integration, end to end, the way an insurer would run it: their own page embeds the
 * report with `embed.js`, hands over a token and what it knows about the customer, and the
 * reference server on the other end receives the document, files it, and announces it with
 * a signed webhook — then the claims desk opens it.
 *
 *   npm run dev                          # in another shell (and `npm run build` once, for dist/lib)
 *   node scripts/integration-smoke.mjs
 *
 * Along the way it proves the parts that are hard to see: the backend mints a session for one
 * customer and gets back a token and the prefill; the config reaches the iframe and the brand
 * changes; the host hears each step and sizes the iframe; the policy's two vehicles become a
 * pick and fill the card; the reporter is prefilled; a report sent with no signal is kept and
 * leaves by itself when the signal returns, and the host hears both; the report is filed
 * against the customer the session named; the server's reference replaces the page's; the same
 * document sent twice is filed once; an expired or forged token is refused; a flood is rate
 * limited; the built page is served with a CSP and its runtime config; the webhook carries a
 * valid signature; and the desk lists, opens and re-files the report.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { sign } from '../server/session.mjs'
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
const API_KEY = 'backend-key'
const SESSION_SECRET = 'session-secret'
const RATE_LIMIT = 20
const API = `http://localhost:${API_PORT}`

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
  env: {
    ...process.env,
    PORT: String(API_PORT),
    CLAIM_DIR: dir,
    CLAIM_TOKEN,
    DESK_TOKEN,
    API_KEY,
    SESSION_SECRET,
    RATE_LIMIT: String(RATE_LIMIT),
    // so the flood below can have a bucket of its own instead of eating the customer's
    TRUST_PROXY: '1',
    ALLOWED_HOSTS: `http://localhost:${HOST_PORT}`,
    BRAND: 'Acme Mutual',
    WEBHOOK_URL: `http://localhost:${HOOK_PORT}/hook`,
    WEBHOOK_SECRET: SECRET,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`))


async function cleanup() {
  server.kill()
  hookServer.close()
  hostServer.close()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// wait for the claim server
let health = null
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch(`${API}/health`)
    if (res.ok) {
      health = await res.json()
      break
    }
  } catch {
    await new Promise((r) => setTimeout(r, 100))
  }
}
if (!health?.static) fail('the server is not serving the built page; run `npm run build`')

// ── the insurer's backend mints a session for the customer who just logged in ──

const mint = (headers, body) =>
  fetch(`${API}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

const person = {
  customer: { id: 'cust-1', policy: 'POL-9', name: 'Sam Lee', phone: '555 0100', email: 'Sam@Example.com' },
  vehicles: [
    { make: 'Toyota', model: 'Camry', year: 2021, plate: 'ABC 123', plateState: 'NY', vin: '4T1BF1FK5CU123456', color: '#b91c1c' },
    { make: 'Ford', model: 'F-150', year: 2020, plate: 'TRK 9', color: '#1c1f26' },
  ],
  ttlSeconds: 1800,
}
if ((await mint({}, person)).status !== 401) fail('a session was minted without the API key')
if ((await mint({ 'x-api-key': API_KEY, origin: 'https://somewhere.example' }, person)).status !== 403) fail('a browser could mint a session')
const minted = await mint({ 'x-api-key': API_KEY }, person)
const session = await minted.json()
if (minted.status !== 200 || !session.token || !session.expiresAt) fail(`minting a session gave ${minted.status} ${JSON.stringify(session).slice(0, 200)}`)
if (session.prefill?.reporter?.name !== 'Sam Lee' || session.prefill.vehicles?.length !== 2) fail(`the session's prefill is off: ${JSON.stringify(session.prefill)}`)
if (new Date(session.expiresAt) - Date.now() > 1900_000) fail('the session lasts longer than it was asked for')
ok(`sessions: minted for cust-1, good until ${session.expiresAt}, with the prefill ready for the embed; no key is 401, a browser is 403`)

// ── a flood, on a made-up IP so the customer's own bucket is untouched ──

const flood = []
for (let i = 0; i < RATE_LIMIT + 5; i++) {
  const res = await fetch(`${API}/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CLAIM_TOKEN}`, 'x-forwarded-for': '203.0.113.9' },
    body: '{"schema":"claim/9"}',
  })
  flood.push(res.status)
}
if (flood.slice(0, RATE_LIMIT).includes(429)) fail(`the limit bit before ${RATE_LIMIT} requests: ${flood.join(' ')}`)
if (!flood.includes(429)) fail(`${flood.length} requests in a second were all let through: ${flood.join(' ')}`)
ok(`rate limit: the first ${RATE_LIMIT} POSTs are answered, the flood after them gets 429`)

const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>Acme Mutual — my policy</title>
<h1>Acme Mutual</h1><p>Something happened? Tell us below.</p>
<div id="report"></div>
<script src="${PAGE}/embed.js"></script>
<script>
  window.events = []
  window.widget = ClaimMarker.mount('#report', {
    url: '${PAGE}/',
    submitUrl: '${API}/claims',
    token: ${JSON.stringify(session.token)},
    brand: 'Acme Mutual',
    returnDocument: true,
    prefill: ${JSON.stringify(session.prefill)},
    onStep: function (e) { events.push(e) },
    onSubmitted: function (e) { events.push(e) },
    onQueued: function (e) { events.push(e) },
  })
</script>`
const hostServer = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HOST_PAGE))
hostServer.on('error', (e) => fail(`host page: ${e.message}`))
hostServer.listen(HOST_PORT)

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
if (one.customer?.id !== 'cust-1' || one.customer.policy !== 'POL-9') fail(`the report was not filed against the session's customer: ${JSON.stringify(one.customer)}`)
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

// a session that has run out, and one signed by someone else, are not sessions
// a document the parser will refuse, so proving the token got past the door files nothing
const post = (token) =>
  fetch(`${API}/claims`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"schema":"claim/9"}' })
const expired = sign({ sub: 'cust-1', policy: 'POL-9' }, SESSION_SECRET, 60, Date.now() - 120_000)
const [body, sig] = session.token.split('.')
const forged = `${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`
if ((await post(expired)).status !== 401) fail('an expired session token was accepted')
if ((await post(forged)).status !== 401) fail('a token with a flipped signature was accepted')
if ((await post(session.token)).status !== 400) fail('the live session token did not get past the door')
ok('sessions: an expired token and a forged one are 401; the live one still works')

// ── the built page, served from the same origin as the API ────────────

const html = await fetch(`${API}/`)
const served = await html.text()
const csp = html.headers.get('content-security-policy') ?? ''
if (html.status !== 200 || !/^text\/html/.test(html.headers.get('content-type') ?? '')) fail(`GET / gave ${html.status} ${html.headers.get('content-type')}`)
if (!csp.includes(`frame-ancestors http://localhost:${HOST_PORT}`)) fail(`frame-ancestors is not the allowed host: ${csp}`)
if (!/script-src [^;]*'sha256-/.test(csp)) fail(`the injected config is not in script-src: ${csp}`)
if (html.headers.get('x-content-type-options') !== 'nosniff') fail('no nosniff on the page')
if (!served.includes('window.CLAIM_MARKER=') || !served.includes('"submitUrl":"/claims"')) fail('the runtime config was not injected into the page')
if (!served.includes('"brand":"Acme Mutual"')) fail('the brand was not injected into the page')
const hashed = /src="(\/assets\/[^"]+\.js)"/.exec(served)?.[1]
if (!hashed) fail('the page does not reference a hashed asset')
const asset = await fetch(`${API}${hashed}`)
if (!(asset.headers.get('cache-control') ?? '').includes('immutable')) fail(`${hashed} is not cached forever: ${asset.headers.get('cache-control')}`)
await asset.arrayBuffer()
const codes = {}
for (const path of ['/%2e%2e/server/session.mjs', '/lib/claim.js', '/adjuster.html', '/nope.js']) {
  const res = await fetch(`${API}${path}`)
  codes[path] = res.status
  await res.arrayBuffer()
}
if (codes['/%2e%2e/server/session.mjs'] !== 404) fail(`a path out of the static folder gave ${codes['/%2e%2e/server/session.mjs']}`)
if (codes['/lib/claim.js'] !== 404) fail(`the parser is served to the browser (${codes['/lib/claim.js']})`)
if (codes['/adjuster.html'] !== 200) fail(`the claims desk gave ${codes['/adjuster.html']}`)
if (codes['/nope.js'] !== 404) fail(`a missing file gave ${codes['/nope.js']}`)
ok('static: the page is served with its CSP and injected config, assets are immutable, /lib and paths outside dist are 404')

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

// search: a caller says a name or a plate, and Enter opens the first match
const deskSearch = deskPage.getByRole('searchbox', { name: 'Search reports' })
await deskSearch.fill('zzz')
await deskPage.locator('text=Nothing matches').waitFor({ timeout: 5000 }).catch(() => fail('a search with no matches says nothing'))
await deskSearch.fill('ABC 123')
await deskPage.locator(`text=${shown}`).first().waitFor({ timeout: 5000 }).catch(() => fail('searching by plate does not find the report'))
await deskSearch.fill('Sam')
await deskPage.locator(`text=${shown}`).first().waitFor({ timeout: 5000 }).catch(() => fail('searching by the reporter does not find the report'))
await deskSearch.press('Enter')
await deskPage.locator('text=Reported by').waitFor({ timeout: 15000 }).catch(() => fail('Enter in the search did not open the first match'))
ok('desk: search finds the report by plate and by name, and Enter opens it')

if (!(await deskPage.locator('text=Sam Lee').count())) fail('the opened report does not show the reporter')

// the desk reads about a policyholder, not to a customer about themselves
const document_ = await deskPage.locator('article').first().innerText()
if (!/The policyholder/.test(document_)) fail('the desk does not name the policyholder')
if (/You, driving|Your vehicle|\byour \b/i.test(document_)) fail(`the desk still speaks to the customer: ${document_.match(/.{0,60}[Yy]our.{0,60}/)?.[0]}`)
ok("desk: the document reads in the adjuster's voice — the policyholder, not \"you\"")
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
