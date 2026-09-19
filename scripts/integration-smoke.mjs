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
 * valid signature; the desk lists, opens and re-files the report; a report older than
 * RETAIN_DAYS is gone by the time the server is up; who may link what to an incident is
 * decided by the token, never by the document; and the desk's map draws three reports filed at
 * three places as three pins in their status colours, folds them into a cluster as it zooms
 * out, opens one when it is tapped, and narrows the list to what is in view.
 *
 * Then a second, shorter walk through the demo portal the same server serves at /demo: sign in
 * as a sample customer, report an accident in the *built* page it embeds — not the dev page —
 * land on the portal's claim page with the server's reference, and follow its link into the
 * claims desk, which opens that report and nothing else.
 */
import { chromium } from 'playwright'
import { readFileSync as readDictionary } from 'node:fs'
import { spawn } from 'node:child_process'
import { sign } from '../server/session.mjs'
import { describeVideo, readVideo, videoProblem } from './video-check.mjs'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
// a report filed long ago, with the page's reference pointing at it: RETAIN_DAYS should forget both
const OLD = 'INS-2000-OLDONE'
await mkdir(join(dir, OLD))
await writeFile(join(dir, OLD, 'receipt.json'), JSON.stringify({ reference: OLD, clientReference: 'CM-OLDONE', receivedAt: '2000-01-01T00:00:00.000Z', status: 'new', files: {} }))
await mkdir(join(dir, 'by-client'))
await writeFile(join(dir, 'by-client', 'CM-OLDONE'), OLD)
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
    RETAIN_DAYS: '7',
    DEMO: '1',
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
if (health.retainDays !== 7) fail(`/health says reports are kept ${health.retainDays} days`)
for (let i = 0; i < 30 && (existsSync(join(dir, OLD)) || existsSync(join(dir, 'by-client', 'CM-OLDONE'))); i++) await new Promise((r) => setTimeout(r, 100))
if (existsSync(join(dir, OLD)) || existsSync(join(dir, 'by-client', 'CM-OLDONE'))) fail('a report older than RETAIN_DAYS survived startup')
ok('retention: a report from 2000 and its client reference are swept at startup; /health says 7 days')

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

/**
 * The embedded walk is driven in Spanish: the host page fixes the language the way an insurer
 * with Spanish-speaking customers would, and every name below comes from the dictionaries the
 * build emits, so nothing here can quietly go back to matching English.
 */
const DICT = JSON.parse(readDictionary(new URL('../dist/lib/messages.json', import.meta.url), 'utf8')).es
const es = (key, vars = {}) => String(DICT[key]).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? vars[name] : whole))
const EN = JSON.parse(readDictionary(new URL('../dist/lib/messages.json', import.meta.url), 'utf8')).en
/** the other driver's page is not the host's, so it is not fixed to Spanish: it reads English */
const enT = (key, vars = {}) => String(EN[key]).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? vars[name] : whole))

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
    lang: 'es',
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
// the host asked for Spanish, so the very first thing the customer reads is Spanish
const firstHeading = await frame.locator('h1').first().innerText()
if (firstHeading !== es('shell.head.kind.title')) fail(`the host asked for Spanish and the page opened with "${firstHeading}"`)
if ((await frame.getByRole('group', { name: es('shell.lang.label') }).count()) !== 0) fail('the language switch is still offered although the host fixed the language')
ok(`embed: config reached the page (brand shown, opened in Spanish with "${firstHeading}"), the host heard the step, the iframe took the page height`)

const next = () => frame.getByRole('button', { name: new RegExp(`^${es('common.continue')}`) }).click()
await next()

// where
const search = frame.getByRole('combobox', { name: es('start.where.label') })
await search.fill('Times Square, New York')
const option = frame.getByRole('option').first()
await option.waitFor({ timeout: 20000 }).catch(() => fail('no address suggestions'))
await option.click()
await frame.locator(`text=${es('start.where.dragPin')}`).waitFor({ timeout: 10000 })
await next()

// vehicles: the policy's two vehicles are a pick
const picks = frame.getByRole('radiogroup', { name: es('start.vehicles.whichOfYours') }).getByRole('radio')
if ((await picks.count()) !== 2) fail(`expected two policy vehicles to pick from, got ${await picks.count()}`)
await picks.nth(1).click()
if ((await frame.getByRole('combobox', { name: es('start.vehicles.make') }).first().inputValue()) !== 'Ford') fail('picking the F-150 did not fill the card')
await picks.nth(0).click()
const make = await frame.getByRole('combobox', { name: es('start.vehicles.make') }).first().inputValue()
const vin = await frame.getByRole('textbox', { name: 'VIN' }).first().inputValue()
const plate = await frame.getByRole('textbox', { name: es('start.vehicles.plate') }).first().inputValue()
if (make !== 'Toyota' || vin !== '4T1BF1FK5CU123456' || plate !== 'ABC 123') fail(`picking the Camry gave ${make} ${vin} ${plate}`)
ok('prefill: two policy vehicles to pick from; picking one fills make, model, year, plate and VIN')
await next()

// people, the scene, the damage: nothing to add for this run
await frame.locator(`text=${es('start.people.drivingTitle')}`).waitFor()
await next()
await frame.locator('.mk-car').first().waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)

// ── the other driver, invited from the scene step ─────────────────────
await frame.getByRole('button', { name: es('scene.invite.ask') }).click()
await frame.locator('[data-invite-url]').waitFor({ timeout: 20000 }).catch(() => fail('the invite did not produce a link'))
const partyUrl = (await frame.locator('[data-invite-url]').innerText()).trim()
if (!/\/\?party=[\w.-]+$/.test(partyUrl)) fail(`the invite link looks wrong: ${partyUrl}`)
if (!(await frame.locator('[data-invite-made] svg').count())) fail('the invite has no QR code to show')
const partyToken = new URL(partyUrl).searchParams.get('party')
ok(`invite: the scene step made a link and a QR code for the other driver`)

await next()
await frame.locator('.cm-root canvas').waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)
await next()

// review: the reporter is already filled in
await frame.locator(`text=${es('scene.contact.title')}`).waitFor()
const name = await frame.getByRole('textbox', { name: es('scene.contact.name') }).inputValue()
const email = await frame.getByRole('textbox', { name: es('scene.contact.emailAria') }).inputValue()
const policy = await frame.getByRole('textbox', { name: es('scene.contact.policyAria') }).inputValue()
if (name !== 'Sam Lee' || email !== 'sam@example.com' || policy !== 'POL-9') fail(`reporter prefill gave ${name} / ${email} / ${policy}`)
ok('prefill: the reporter is filled in on the review page')
await frame.getByRole('checkbox', { name: es('scene.send.agreeAria') }).check()
await frame.getByRole('textbox', { name: es('scene.send.signAria') }).fill('Sam Lee')

// send with no signal: the report is kept, and the host hears it
await context.setOffline(true)
await frame.getByRole('button', { name: es('scene.send.send') }).click()
await frame.locator(`text=${es('shell.done.queued.title')}`).waitFor({ timeout: 40000 }).catch(() => fail('a report sent with no signal was not kept'))
const queued = (await events()).find((e) => e.type === 'queued')
if (!queued || !/^CM-/.test(queued.reference)) fail('the host was not told the report was queued')
ok('offline: the report is kept with the page\'s reference and the host hears "queued"')

// the signal returns: it leaves by itself, and the server's reference replaces the page's
await context.setOffline(false)
await frame.locator('body').evaluate(() => window.dispatchEvent(new Event('online')))
await frame.locator(`text=${es('shell.done.sent.title')}`).waitFor({ timeout: 30000 }).catch(() => fail('the queued report did not send when back online'))
const shown = await frame.locator('.font-mono.text-3xl').textContent()
if (!/^INS-\d{4}-[A-Z2-9]{6}$/.test(shown ?? '')) fail(`the done page shows ${shown}, not the server's reference`)
const submitted = (await events()).find((e) => e.type === 'submitted')
if (!submitted || submitted.reference !== shown) fail(`the host heard ${JSON.stringify(submitted)}`)
if (submitted.document?.schema !== 'claim/1' || submitted.document.reporter.name !== 'Sam Lee') fail('the host asked for the document and did not get it')
// the document says which language its free text is in, so the desk knows what it is reading
if (submitted.document.incident.language !== 'es') fail(`the report was written in Spanish but the document says ${submitted.document.incident.language}`)
ok(`online again: sent as ${shown}; the host heard "submitted" with the document`)

// ── the server's side ─────────────────────────────────────────────────

const desk = { headers: { authorization: `Bearer ${DESK_TOKEN}` } }
const list = await (await fetch(`http://localhost:${API_PORT}/claims`, desk)).json()
if (list.claims.length !== 1 || list.claims[0].reference !== shown) fail(`the server lists ${JSON.stringify(list)}`)
const one = await (await fetch(`http://localhost:${API_PORT}/claims/${shown}`, desk)).json()
if (one.claim.reporter.name !== 'Sam Lee' || one.claim.vehicles[0].vin !== '4T1BF1FK5CU123456' || one.claim.attestation.name !== 'Sam Lee') fail('the stored document is not the one sent')
if (!one.claim.attestation.at || !one.claim.submittedAt) fail('the attestation was not stamped')
if (one.customer?.id !== 'cust-1' || one.customer.policy !== 'POL-9') fail(`the report was not filed against the session's customer: ${JSON.stringify(one.customer)}`)
if (one.claim.incident.language !== 'es') fail(`the stored document says ${one.claim.incident.language}, not es`)
const files = await readdir(join(dir, shown))
// no damage was marked on this walk (scripts/smoke.mjs covers that), so there is a diagram but no marked-up car
for (const f of ['claim.json', 'receipt.json', 'scene.png']) if (!files.includes(f)) fail(`${f} was not unpacked; have ${files.join(', ')}`)
// the replay is unpacked as a real video file, and served as one
const replayFile = files.find((f) => /^replay\.(webm|mp4)$/.test(f))
if (!replayFile) fail(`the replay was not unpacked; have ${files.join(', ')}`)
const replayRes = await fetch(`http://localhost:${API_PORT}/claims/${shown}/files/${replayFile}`, desk)
if (replayRes.status !== 200 || !/^video\/(webm|mp4)$/.test(replayRes.headers.get('content-type') ?? '')) fail(`the replay is served as ${replayRes.status} ${replayRes.headers.get('content-type')}`)
// judged on what it shows once decoded, not on its size, which follows the machine's load
const replayBody = Buffer.from(await replayRes.arrayBuffer())
const servedReplay = await readVideo(page, `data:${replayRes.headers.get('content-type')};base64,${replayBody.toString('base64')}`)
const servedWrong = videoProblem(servedReplay, replayBody.length)
if (servedWrong) fail(`the replay the server unpacked is not a real recording: ${servedWrong}`)
const png = await fetch(`http://localhost:${API_PORT}/claims/${shown}/files/scene.png`, desk)
if (png.headers.get('content-type') !== 'image/png' || (await png.arrayBuffer()).byteLength < 10000) fail('the scene PNG is not served as a real image')
ok(`server: filed as ${shown} with ${files.length} files, the diagram served as image/png, the replay as ${replayFile} (${describeVideo(servedReplay, replayBody.length)})`)

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
// report folders only: by-client, the reuse indexes and the invites live beside them
if ((await readdir(dir)).filter((n) => !['by-client', 'index', 'incidents'].includes(n)).length !== 1) fail('a resend was filed twice')
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

// ── the other driver gives their side, on their own phone ─────────────
// How far their cars drove, and therefore when their account reaches the impact: `durationOf`
// is the longest route over SPEED (6 m/s, src/map/playback.ts) and two cars that drive to rest
// touching meet at the end of the drive, so this is the moment of impact on the shared clock.
const OTHER_DRIVE_M = 24
const OTHER_IMPACT_MS = (OTHER_DRIVE_M / 6) * 1000
// A second browser, a stranger's: no session, no prefill, nothing but the link.
const incidentId = (await (await fetch(`${API}/claims/${shown}`, desk)).json()).incident
if (!/^INC-/.test(incidentId ?? '')) fail(`the customer's report did not name an incident: ${incidentId}`)

// what the token opens, and what it does not
const seedRes = await fetch(`${API}/incidents/${incidentId}/seed`, { headers: { authorization: `Bearer ${partyToken}` } })
const seedBody = await seedRes.json()
if (seedRes.status !== 200) fail(`the seed answered ${seedRes.status}`)
const seedText = JSON.stringify(seedBody)
for (const secret of ['Sam Lee', 'sam@example.com', 'POL-9', 'ABC 123', '4T1BF1FK5CU123456', shown, 'invited']) {
  if (seedText.includes(secret)) fail(`the seed hands the other driver "${secret}"`)
}
if (Object.keys(seedBody).sort().join() !== 'at,location,surface,utcOffset,vehicles') fail(`the seed has keys it should not: ${Object.keys(seedBody).join()}`)
if ((await fetch(`${API}/incidents/${incidentId}/seed`, { headers: { authorization: `Bearer ${session.token}` } })).status !== 401) fail("the customer's own token opened the party seed")
if ((await fetch(`${API}/incidents/${incidentId}/seed`, { headers: { authorization: 'Bearer not.a.token' } })).status !== 401) fail('a forged party token opened the seed')
ok(`invite: the seed is where, when, the ground and the shapes of the cars — and a wrong token is 401`)

const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const other = await otherCtx.newPage()
const otherErrors = []
other.on('pageerror', (e) => otherErrors.push(String(e)))
await other.goto(`${API}/?party=${partyToken}`, { waitUntil: 'networkidle' })
await other.locator(`text=${enT('shell.title.party')}`).waitFor({ timeout: 20000 }).catch(() => fail('the party link did not open the other driver\'s page'))
// the other driver's page keeps its own draft, keyed by the incident, so it can never
// overwrite a report the same browser was already writing
const partyKey = `claim-marker/draft/${incidentId}`
const otherState = () => other.evaluate((key) => JSON.parse(localStorage.getItem(key)).state.claim, partyKey)
const seeded = await otherState()
if (seeded.reporter.party !== 'other_party') fail(`the other driver's page is not in party mode: ${seeded.reporter.party}`)
if (seeded.incident.shared !== incidentId) fail(`the other driver's report does not name the incident: ${seeded.incident.shared}`)
if (!seeded.incident.location) fail('the seed did not fill the place')
// their own car is the one to fill in; the customer's arrives as the other vehicle
if (seeded.vehicles[0].role !== 'insured' || seeded.vehicles[1]?.role !== 'other') fail(`the seeded vehicles are wrong: ${JSON.stringify(seeded.vehicles.map((v) => v.role))}`)
const otherSees = await other.locator('body').innerText()
for (const secret of ['Sam Lee', 'sam@example.com', 'POL-9', 'ABC 123', '4T1BF1FK5CU123456', shown]) {
  if (otherSees.includes(secret)) fail(`the other driver's page shows "${secret}"`)
}
ok('invite: the other driver lands on a seeded report in party mode, and sees nothing of the first one')

// they fill in the little that is needed and send — describing their own car as the shape and
// colour it really is, which is how the desk pairs it with the customer's account of it
const theirCar = (await (await fetch(`${API}/claims/${shown}`, desk)).json()).claim.vehicles.find((v) => v.role === 'other')
await other.evaluate(({ car, key, drive }) => {
  const raw = JSON.parse(localStorage.getItem(key))
  raw.state.step = 'review'
  raw.state.claim.reporter = { ...raw.state.claim.reporter, name: 'Dana Q', phone: '555 0199', email: 'dana@example.com', policy: 'OTHER-1' }
  raw.state.claim.incident = { ...raw.state.claim.incident, description: 'I was already in the junction.' }
  // They place the cars themselves, and remember it differently: nose to nose on the spot, each
  // having driven `drive` metres to get there. That length is the constructed part — the drive
  // is the longest route over SPEED (6 m/s), and two cars that arrive touching meet at the end
  // of it, so this account's moment of impact is a number the desk can be held to.
  const at = raw.state.claim.incident.location
  const north = (metres) => at.lat + metres / 111320
  raw.state.claim.vehicles = raw.state.claim.vehicles.map((v, i) => ({
    ...v,
    ...(i === 0 ? { body: car.body, color: car.color } : {}),
    position: [at.lng, north(i === 0 ? 2 : -2)],
    path: [[at.lng, north(i === 0 ? 2 + drive : -2 - drive)]],
    heading: i === 0 ? 180 : 0,
  }))
  localStorage.setItem(key, JSON.stringify(raw))
}, { car: theirCar, key: partyKey, drive: OTHER_DRIVE_M })
await other.reload({ waitUntil: 'networkidle' })
await other.getByRole('checkbox', { name: enT('scene.send.agreeAria') }).check()
await other.getByRole('textbox', { name: enT('scene.send.signAria') }).fill('Dana Q')
await other.getByRole('button', { name: enT('scene.send.send') }).click()
await other.locator(`text=${enT('shell.done.party.title')}`).waitFor({ timeout: 40000 }).catch(() => fail("the other driver's report did not send"))
const partyRef = (await other.locator('.font-mono.text-3xl').textContent())?.trim()
ok(`invite: the other driver's own account was filed as ${partyRef}`)

// one report per party token
const second = await fetch(`${API}/claims`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${partyToken}` },
  body: JSON.stringify({ schema: 'claim/1', incident: { kind: 'collision', shared: incidentId }, vehicles: [] }),
})
const secondBody = await second.json()
if (second.status !== 200 || !secondBody.duplicate || secondBody.reference !== partyRef) fail(`a second report from one party token gave ${second.status} ${JSON.stringify(secondBody)}`)
ok('invite: a party token files one report; a second is answered with the first')

// the desk has both, on one map, side by side
const both = await (await fetch(`${API}/incidents/${incidentId}`, desk)).json()
if (both.reports?.length !== 2) fail(`the incident does not hold two accounts: ${JSON.stringify(both).slice(0, 200)}`)
if (both.reports.map((r) => r.party).sort().join() !== 'other_party,policyholder') fail(`the two accounts are not tagged: ${both.reports.map((r) => r.party).join()}`)
// a reload, not a hash change: the desk was opened on this report before the second account
// existed, and like the rest of the inbox it shows what was there when it loaded
await deskPage.goto(`${PAGE}/adjuster.html?api=http://localhost:${API_PORT}#/${shown}`)
await deskPage.reload()
await deskPage.locator('text=2 accounts').first().waitFor({ timeout: 20000 }).catch(async () =>
  fail(`the desk does not say there are two accounts; it shows: ${(await deskPage.locator('body').innerText()).slice(0, 600)}`),
)
await deskPage.locator('[data-compare]').waitFor({ timeout: 20000 }).catch(() => fail('the desk does not lay the two accounts side by side'))
// the map mounts first and the table right behind it; wait for the table, not just the wrapper
await deskPage.locator('[data-compare] table').waitFor({ timeout: 15000 }).catch(async () =>
  fail(`the comparison has no table: ${(await deskPage.locator('[data-compare]').innerHTML()).slice(0, 800)}`),
)
const compared = await deskPage.locator('[data-compare]').innerText()
const table = await deskPage.locator('[data-compare] table').innerText()
if (!/agree/i.test(table)) fail(`the comparison lists nothing the two accounts agree on: ${table.slice(0, 600)}`)
if (!/differ/i.test(table)) fail(`the comparison lists nothing the two accounts differ on: ${table.slice(0, 600)}`)
for (const word of ['fraud', 'fault', 'liability', 'blame', 'suspicious']) {
  if (new RegExp(word, 'i').test(compared)) fail(`the comparison says "${word}"`)
}
ok('desk: two accounts under one incident, laid side by side, saying nothing about who is right')

// one clock for both: the two impacts are two ticks on one scrubber, and the headline says how
// far apart they are. The other driver's is where it was constructed; the policyholder's is
// whatever their page drew, so the headline is held to the difference between the two.
const shared = await deskPage.evaluate(() => {
  const p = window.__play
  return p?.ghostTimeline ? { mine: p.timeline.impactMs, theirs: p.ghostTimeline.impactMs, duration: p.duration } : null
})
if (!shared) fail('the compare view did not expose its shared clock on window.__play')
if (Math.abs(shared.theirs - OTHER_IMPACT_MS) > 50) fail(`the other driver's impact is at ${shared.theirs.toFixed(0)} ms on the shared clock, not the constructed ${OTHER_IMPACT_MS}`)
const tickAt = (await deskPage.locator('[data-impact-tick]').evaluateAll((els) => els.map((e) => Number(e.dataset.impactTick)))).sort((a, b) => a - b)
const expectTicks = [shared.mine, shared.theirs].map(Math.round).sort((a, b) => a - b)
if (tickAt.length !== 2 || tickAt.some((t, i) => Math.abs(t - expectTicks[i]) > 1)) fail(`the scrubber's impact ticks are ${JSON.stringify(tickAt)}, not ${JSON.stringify(expectTicks)}`)
const apartS = (Math.abs(shared.mine - shared.theirs) / 1000).toFixed(1)
const headline = await deskPage.locator('[data-compare] table caption').innerText()
if (!new RegExp(`^The two accounts' impacts are \\d+ m and ${apartS.replace('.', '\\.')} s apart\\.$`).test(headline)) fail(`the headline does not give the gap as ${apartS} s: "${headline}"`)
if (Number(apartS) < 1) fail(`the constructed disagreement is only ${apartS} s: the ticks would sit on top of each other`)
ok(`desk: one scrubber, two impact ticks ${expectTicks.join(' ms and ')} ms — the other driver's where it was built (${OTHER_IMPACT_MS} ms) — and the headline "${headline}"`)

// both sets move on that clock: two moments of the scrub, each account's cars somewhere else
const scrubbed = await deskPage.evaluate(async () => {
  const snap = async (ms) => {
    window.__play.seek(ms)
    await new Promise((r) => setTimeout(r, 300))
    const p = window.__play
    return { mine: p.poses?.map((x) => x.position) ?? [], theirs: p.ghostPoses?.map((x) => x.position) ?? [] }
  }
  const a = await snap(300)
  const b = await snap(2000)
  // metres, near enough: a degree of longitude at this latitude is about 84 km
  const far = (u, v) => Math.max(0, ...u.map((p, i) => Math.hypot((p[0] - v[i][0]) * 84_000, (p[1] - v[i][1]) * 111_320)))
  window.__play.stop()
  return { sets: [a.mine.length, a.theirs.length], mine: far(a.mine, b.mine), theirs: far(a.theirs, b.theirs) }
})
if (scrubbed.sets[0] < 2 || scrubbed.sets[1] < 2) fail(`the scrub does not hold both accounts' cars: ${JSON.stringify(scrubbed.sets)}`)
if (scrubbed.mine < 1 || scrubbed.theirs < 1) fail(`scrubbing moved the policyholder's cars ${scrubbed.mine.toFixed(1)} m and the other driver's ${scrubbed.theirs.toFixed(1)} m`)
ok(`desk: scrubbing 0.3 s → 2 s moves both sets — the policyholder's cars ${scrubbed.mine.toFixed(1)} m, the other driver's ghosts ${scrubbed.theirs.toFixed(1)} m`)

// "Watch both" chases the policyholder's car; "Swap" chases the other driver's. The chase looks
// the way the car it follows set off, and the two were built to set off opposite ways, so the
// camera's bearing says which car it is behind — no need to guess from where it is. And the
// moment goes with the car: the slow-motion is at the followed account's own tick and not at
// the other's, 1.7 s away — asked of the hook (the rate it plays that moment at) and of the map
// (the light trails it lights for slow motion), because both cut a shot list and must agree.
await deskPage.getByRole('button', { name: 'Watch both' }).click()
await deskPage.locator('[data-compare] .maplibregl-map.mk-playing').waitFor({ timeout: 5000 }).catch(() => fail('"Watch both" did not start'))
const chased = () =>
  deskPage.evaluate(async () => {
    // the compare view's own map: the two documents under it have one each, and `window.__map`
    // is whichever of the three was made last
    const map = document.querySelector('[data-compare] .maplibregl-map').__map
    const at = async (ms) => {
      window.__play.seek(ms)
      await new Promise((r) => setTimeout(r, 400))
      return { rate: window.__play.rate, trail: map.getPaintProperty('paths-flow', 'line-width'), pitch: map.getPitch(), bearing: map.getBearing() }
    }
    const p = window.__play
    const atMine = await at(p.timeline.impactMs)
    // the later of the two impacts, last: the chase has to last until both drives are over, not
    // hand the camera back while the other account's cars are still on their way
    const atTheirs = await at(p.ghostTimeline.impactMs)
    return { ...atTheirs, atMine, atTheirs, follow: document.querySelector('[data-compare]').dataset.follow }
  })
const angle = (b) => Math.abs(((((b % 360) + 540) % 360) - 180))
const mineChase = await chased()
await deskPage.getByRole('button', { name: 'Swap' }).click()
await deskPage.waitForTimeout(300)
const theirChase = await chased()
if (mineChase.pitch < 40 || theirChase.pitch < 40) fail(`the chase did not tilt (${mineChase.pitch.toFixed(0)}°, then ${theirChase.pitch.toFixed(0)}°)`)
if (angle(mineChase.bearing - 0) > 5) fail(`"Watch both" is not behind the policyholder's car, which set off north: bearing ${mineChase.bearing.toFixed(0)}°`)
if (angle(theirChase.bearing - 180) > 5) fail(`"Swap" is not behind the other driver's car, which set off south: bearing ${theirChase.bearing.toFixed(0)}°`)
if (mineChase.follow !== '' || !theirChase.follow.startsWith('other:')) fail(`the followed car did not change: ${mineChase.follow || '(default)'} → ${theirChase.follow}`)
const slowAt = (c) => (c.atMine.rate < 1 && c.atMine.trail > 3 ? 'mine' : '') + (c.atTheirs.rate < 1 && c.atTheirs.trail > 3 ? 'theirs' : '')
const momentSaid = (c) => `rate ${c.atMine.rate} / trail ${c.atMine.trail} px at the policyholder's tick, rate ${c.atTheirs.rate} / trail ${c.atTheirs.trail} px at the other driver's`
if (slowAt(mineChase) !== 'mine') fail(`"Watch both" does not slow into the policyholder's impact alone: ${momentSaid(mineChase)}`)
if (slowAt(theirChase) !== 'theirs') fail(`after "Swap" the slow-motion did not move to the other driver's impact: ${momentSaid(theirChase)}`)
await deskPage.getByRole('button', { name: 'Stop' }).click()
await deskPage.waitForTimeout(500)
const deskHome = await deskPage.evaluate(() => {
  const map = document.querySelector('[data-compare] .maplibregl-map').__map
  return { pitch: map.getPitch(), bearing: map.getBearing() }
})
if (deskHome.pitch !== 0 || deskHome.bearing !== 0) fail(`the desk's map came back tilted (pitch ${deskHome.pitch}, bearing ${deskHome.bearing})`)
ok(
  `desk: "Watch both" chases the policyholder's car (bearing ${mineChase.bearing.toFixed(0)}°) and slows into its impact (${momentSaid(mineChase)}); "Swap" chases the other driver's (${theirChase.bearing.toFixed(0)}°) and the slow-motion moves with it (${momentSaid(theirChase)}); Stop hands the map back flat`,
)

// "Save video" runs the same recorder over both accounts and hands the file over; nothing is uploaded
const uploads = []
const watchUploads = (req) => req.method() !== 'GET' && uploads.push(req.url())
deskPage.on('request', watchUploads)
const [download] = await Promise.all([deskPage.waitForEvent('download', { timeout: 30000 }), deskPage.getByRole('button', { name: 'Save video' }).click()]).catch(() => [null])
deskPage.off('request', watchUploads)
if (!download) fail('"Save video" did not hand over a file')
const savedName = download.suggestedFilename()
if (!/-both-accounts\.(webm|mp4)$/.test(savedName)) fail(`the saved video is called ${savedName}`)
if (uploads.length) fail(`saving the video sent something: ${uploads.join(', ')}`)
const savedBody = await readFile(await download.path())
const savedVideo = await readVideo(deskPage, `data:video/${savedName.endsWith('.mp4') ? 'mp4' : 'webm'};base64,${savedBody.toString('base64')}`)
const savedWrong = videoProblem(savedVideo, savedBody.length)
if (savedWrong) fail(`the saved video of both accounts is not a real recording: ${savedWrong}`)
ok(`desk: "Save video" recorded both accounts to ${savedName} (${describeVideo(savedVideo, savedBody.length)}) and uploaded nothing`)
if (otherErrors.length) fail(`the other driver's page threw: ${otherErrors.join('\n')}`)
await otherCtx.close()

// ── the same photograph, the same VIN, seen before ────────────────────
// Two reports from two different customers carrying the same picture and the same VIN. The
// server notices, on the receipt, for the adjuster — and the customer's own page, which has
// been open this whole walk, says none of it.
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const SHARED_HASH = 'f0e1d2c3b4a59687'
const SHARED_VIN = '1HGCM82633A004352'
const reused = (id) => ({
  schema: 'claim/1',
  vehicles: [{ id: 'a', role: 'insured', body: 'sedan', color: '#b91c1c', vin: SHARED_VIN, plate: 'ZZZ 999' }],
  incident: { kind: 'collision', at: '2026-09-06T17:30', location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' } },
  attachments: { photos: [{ data: JPEG, of: 'a', caption: id, hash: SHARED_HASH }] },
})
const fileAs = async (customerId, body) => {
  const s = await (await mint({ 'x-api-key': API_KEY }, { customer: { id: customerId, policy: 'POL-X' }, ttlSeconds: 600 })).json()
  const res = await fetch(`${API}/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}`, 'idempotency-key': `CM-${customerId.toUpperCase().replace(/[^A-Z0-9]/g, '')}` },
    body: JSON.stringify(body),
  })
  return (await res.json()).reference
}
const firstRef = await fileAs('reuse-one', reused('one'))
const secondRef = await fileAs('reuse-two', reused('two'))
if (!firstRef || !secondRef) fail(`the two reports were not filed: ${firstRef} ${secondRef}`)
const firstReceipt = await (await fetch(`${API}/claims/${firstRef}`, desk)).json()
const secondReceipt = await (await fetch(`${API}/claims/${secondRef}`, desk)).json()
if (firstReceipt.signals?.length) fail(`the first report of its kind signalled against nothing: ${JSON.stringify(firstReceipt.signals)}`)
const seenCodes = (secondReceipt.signals ?? []).map((x) => x.code).sort()
if (!seenCodes.includes('photo_seen_before')) fail(`the reused photograph was not noticed: ${JSON.stringify(secondReceipt.signals)}`)
if (!seenCodes.includes('vin_seen_before')) fail(`the reused VIN was not noticed: ${JSON.stringify(secondReceipt.signals)}`)
if (!secondReceipt.signals.some((x) => x.with === firstRef)) fail('a signal does not name the report it saw before')
ok(`server: the second report carries ${seenCodes.join(', ')}, naming ${firstRef}`)

// the desk shows them, with a link to the other report
await deskPage.goto(`${PAGE}/adjuster.html?api=http://localhost:${API_PORT}#/${secondRef}`)
await deskPage.locator('[data-worth-a-look]').waitFor({ timeout: 15000 }).catch(() => fail('the desk does not show what was seen before'))
const worth = await deskPage.locator('[data-worth-a-look]').innerText()
if (!worth.includes(firstRef)) fail(`the "Worth a look" card does not link to the other report: ${worth}`)
if (!/photograph/i.test(worth) || !/VIN/i.test(worth)) fail(`the card does not say what was seen: ${worth}`)
// the same report is named by each signal, so any one of the links will do
await deskPage.locator('[data-worth-a-look]').getByRole('button', { name: firstRef }).first().click()
await deskPage.waitForFunction((r) => window.location.hash.includes(r), firstRef, { timeout: 5000 }).catch(() => fail('the link did not open the other report'))
ok('desk: "Worth a look" names both, and the link opens the report it saw before')

// and none of it is anywhere the customer has been
const customerSaw = await frame.locator('body').innerText()
for (const word of ['Worth a look', 'seen before', 'photo_seen_before', 'vin_seen_before', 'fraud', 'Fraud']) {
  if (customerSaw.includes(word)) fail(`the customer's page says "${word}"`)
}
ok("desk: none of it is on the customer's page")

// ── who may link what: the token decides, never the document ──────────
// From an address of its own, like the flood, so these extra requests leave the walk's bucket alone.
const aside = { 'x-forwarded-for': '198.51.100.7' }
const sessionFor = async (id) => (await (await mint({ 'x-api-key': API_KEY, ...aside }, { customer: { id, policy: 'POL-X' }, ttlSeconds: 600 })).json()).token
const as = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}`, ...aside })
const SEED = {
  location: { lng: -73.9859, lat: 40.7573, address: 'Times Square' },
  at: '2026-09-06T17:30',
  utcOffset: -240,
  surface: 'satellite',
  vehicles: [{ body: 'sedan', color: '#b91c1c', make: 'Toyota', model: 'Camry' }],
}
const invite = (token, extra = {}) => fetch(`${API}/incidents`, { method: 'POST', headers: as(token), body: JSON.stringify({ ...SEED, ...extra }) })
const fileWith = async (token, doc) => (await (await fetch(`${API}/claims`, { method: 'POST', headers: as(token), body: JSON.stringify({ schema: 'claim/1', vehicles: [], ...doc }) })).json()).reference
const filed = async (ref) => (await fetch(`${API}/claims/${ref}`, desk)).json()

if ((await mint({ 'x-api-key': API_KEY, ...aside }, { customer: { id: 'party:INC-AAAAAA' } })).status !== 400) fail('a session was minted for a customer named like a party token')

// firstRef belongs to reuse-one and is linked to nothing: nobody else may attach an invite to it
const untouched = JSON.stringify(await filed(firstRef))
const byParty = await invite(partyToken, { reference: firstRef })
if (byParty.status !== 403) fail(`a party token could create an invite: ${byParty.status}`)
if ((await invite(await sessionFor('intruder'), { reference: firstRef })).status !== 201) fail('another customer could not make an invite of their own')
if ((await invite(CLAIM_TOKEN, { reference: firstRef })).status !== 201) fail('the shared token could not make an invite')
if (JSON.stringify(await filed(firstRef)) !== untouched) fail(`someone else's invite was attached to ${firstRef}`)
const ownInvite = await (await invite(await sessionFor('reuse-one'), { reference: firstRef })).json()
const attached = await filed(firstRef)
if (attached.incident !== ownInvite.incident || attached.party !== 'policyholder') fail(`its owner could not attach an invite: ${attached.incident} ${attached.party}`)
ok("invite: a party token is 403; another customer or the shared token cannot attach an invite to a report that isn't theirs; its owner can")

// the other driver says they are the policyholder, of someone else's incident: the token wins
const fresh = await (await invite(await sessionFor('liar-host'))).json()
const liarRef = await fileWith(new URL(fresh.url).searchParams.get('party'), {
  reporter: { name: 'Lee R', party: 'policyholder' },
  incident: { kind: 'collision', shared: incidentId },
})
const lie = await filed(liarRef)
if (lie.party !== 'other_party' || lie.claim.reporter.party !== 'other_party') fail(`a party report claiming to be the policyholder was filed as ${lie.party} / ${lie.claim.reporter.party}`)
if (lie.incident !== fresh.incident || lie.claim.incident.shared !== fresh.incident) fail(`a party report joined ${lie.incident} / ${lie.claim.incident.shared}, not its token's ${fresh.incident}`)
// a customer names an incident cust-1 created, and one that does not exist
const crasher = await sessionFor('gatecrasher')
const crash = await filed(await fileWith(crasher, { incident: { kind: 'collision', shared: incidentId } }))
if (crash.incident || crash.claim.incident.shared !== null) fail(`a customer joined an incident they did not create: ${crash.incident} / ${crash.claim.incident.shared}`)
if ((await (await fetch(`${API}/incidents/${incidentId}`, desk)).json()).reports.length !== 2) fail(`${incidentId} gained a third account`)
await fileWith(crasher, { incident: { kind: 'collision', shared: 'INC-NOPE99' } })
if (existsSync(join(dir, 'incidents', 'INC-NOPE99'))) fail('a made-up incident id left a folder behind')
ok('linking: a party report is filed as the other party of its own incident whatever it says; a customer cannot join an incident they did not create')

// the seed keeps a short address and the page's own body shapes, and a large body is no invite at all
const trimmed = await (await invite(crasher, {
  location: { ...SEED.location, address: 'x'.repeat(500) },
  vehicles: [{ body: 'spaceship', color: '#000000', make: 'X', model: 'Y' }, ...SEED.vehicles],
})).json()
const trimmedSeed = await (await fetch(`${API}/incidents/${trimmed.incident}/seed`, { headers: { authorization: `Bearer ${new URL(trimmed.url).searchParams.get('party')}` } })).json()
if (trimmedSeed.location.address.length !== 200 || trimmedSeed.vehicles.length !== 1) fail(`the seed kept ${trimmedSeed.location.address.length} characters and ${trimmedSeed.vehicles.length} vehicles`)
const huge = await invite(crasher, { padding: 'x'.repeat(20_000) }).then((r) => r.status, () => 'reset')
if (huge === 201) fail('a 20 kB invite was accepted')
ok(`invite: the address is capped at 200, an unknown body is dropped, a 20 kB body is refused (${huge})`)

// ── the desk's map of everything ──────────────────────────────────────
// Three reports at three places, in the three statuses. The desk draws a pin apiece in its own
// colour, folds them into a cluster as it zooms out, opens one when it is tapped, and narrows
// the list to the part of the world on screen.

const mapIp = { 'x-forwarded-for': '198.51.100.44' }
const mapSession = async (id) => (await (await mint({ 'x-api-key': API_KEY, ...mapIp }, { customer: { id, policy: 'POL-MAP' }, ttlSeconds: 600 })).json()).token
const fileAt = async (id, location) =>
  (
    await (
      await fetch(`${API}/claims`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await mapSession(id)}`, ...mapIp },
        body: JSON.stringify({ schema: 'claim/1', vehicles: [], incident: { kind: 'collision', at: '2026-09-06T17:30', location } }),
      })
    ).json()
  ).reference

/** the colours the inbox rows wear, which the pins wear too */
const STATUS_COLOUR = { new: '#1f56e6', reviewing: '#d97706', closed: '#64748b' }
const PLACES = [
  { id: 'map-one', status: 'new', location: { lng: -73.9859, lat: 40.7573, address: 'Broadway at 7th, New York' } },
  { id: 'map-two', status: 'reviewing', location: { lng: -118.2437, lat: 34.0522, address: 'Wilshire Boulevard, Los Angeles' } },
  { id: 'map-three', status: 'closed', location: { lng: -0.1276, lat: 51.5072, address: 'Trafalgar Square, London' } },
]
for (const place of PLACES) {
  place.reference = await fileAt(place.id, place.location)
  if (!place.reference) fail(`the report at ${place.location.address} was not filed`)
  const { summary } = await filed(place.reference)
  if (summary.lng !== place.location.lng || summary.lat !== place.location.lat) fail(`the receipt for ${place.reference} does not carry its place: ${JSON.stringify(summary)}`)
  if (place.status === 'new') continue
  const moved = await fetch(`${API}/claims/${place.reference}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...desk.headers }, body: JSON.stringify({ status: place.status }) })
  if (!moved.ok) fail(`moving ${place.reference} to ${place.status} gave ${moved.status}`)
}
ok(`server: three receipts carry where they happened (${PLACES.map((p) => `${p.reference} ${p.status}`).join(', ')})`)

/** the colour under the middle of the map, where a map showing one report has put its pin */
const centreColour = () =>
  deskPage.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas')
    if (!canvas) return null
    const off = document.createElement('canvas')
    off.width = canvas.width
    off.height = canvas.height
    const ctx = off.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const px = ctx.getImageData(Math.round(canvas.width / 2) - 3, Math.round(canvas.height / 2) - 3, 6, 6).data
    const seen = new Map()
    for (let i = 0; i < px.length; i += 4) {
      const hex = '#' + [px[i], px[i + 1], px[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')
      seen.set(hex, (seen.get(hex) ?? 0) + 1)
    }
    return [...seen].sort((a, b) => b[1] - a[1])[0][0]
  })

const near = (a, b, tolerance = 8) => a && b && [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= tolerance)
/** the map draws on a frame of its own, and flies: wait for what should be there rather than a timeout */
const settles = async (test) => {
  for (let i = 0; i < 60; i++) {
    if (await test()) return true
    await deskPage.waitForTimeout(250)
  }
  return false
}

const openDeskMap = async () => {
  await deskPage.goto(`${PAGE}/adjuster.html?api=${API}`)
  await deskPage.getByRole('button', { name: 'Map', exact: true }).click()
  await deskPage.locator('.maplibregl-canvas').waitFor({ timeout: 20000 })
}
await openDeskMap()
const deskFind = deskPage.getByRole('searchbox', { name: 'Search reports' })
const listed = () => deskPage.locator('aside ul li').count()

// one report at a time: the map frames its one pin in the middle, so the colour under the
// middle is that report's status and nothing the basemap happens to paint
for (const place of PLACES) {
  await deskFind.fill(place.reference)
  if (!(await settles(async () => (await listed()) === 1))) fail(`searching for ${place.reference} left ${await listed()} rows`)
  const colour = STATUS_COLOUR[place.status]
  if (!(await settles(async () => near(await centreColour(), colour)))) fail(`the pin for a "${place.status}" report is ${await centreColour()}, not ${colour}`)
}
ok('desk map: a pin per report — brand blue for new, amber for in review, slate for closed')

// the heat layer, around the one report still on the map, and only while it is on: the ground
// within 60 px of the pin — and not the pin itself, which is drawn over the heat either way
const aroundThePin = () =>
  deskPage.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas')
    const off = document.createElement('canvas')
    off.width = canvas.width
    off.height = canvas.height
    const ctx = off.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const px = ctx.getImageData(Math.round(canvas.width / 2) - 60, Math.round(canvas.height / 2) - 60, 120, 120).data
    const out = []
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 120; x++) {
        if (Math.abs(x - 60) < 16 && Math.abs(y - 60) < 16) continue
        const i = (y * 120 + x) * 4
        out.push((px[i] << 16) | (px[i + 1] << 8) | px[i + 2])
      }
    }
    return out
  })
const changed = (a, b) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0)

const cold = await aroundThePin()
await deskPage.getByRole('button', { name: 'Heat' }).click()
if (!(await settles(async () => changed(await aroundThePin(), cold) > 1000))) fail('turning the heat layer on drew nothing around the report')
const warm = await aroundThePin()
await deskPage.getByRole('button', { name: 'Heat' }).click()
if (!(await settles(async () => changed(await aroundThePin(), warm) > 1000))) fail('turning the heat layer off left it on the map')
ok(`desk map: the heat layer paints volume over the region while it is on, and nothing when it is off (${changed(warm, cold)} px around the pin)`)

// tapping the pin opens that report
const box = await deskPage.locator('.maplibregl-canvas').boundingBox()
await deskPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
const tapped = PLACES[2].reference
await deskPage
  .waitForFunction((r) => window.location.hash.includes(r), tapped, { timeout: 10000 })
  .catch(() => fail(`tapping the pin did not open ${tapped}: the hash is ${deskPage.url()}`))
await deskPage.locator('text=Reported by').waitFor({ timeout: 20000 }).catch(() => fail('tapping the pin opened no document'))
ok(`desk map: tapping a pin opens its report (${tapped})`)

// the two accounts of one accident stand in the same place: they are one row in the list, and
// one pin — the row's lead — rather than two points on top of each other under a "2"
const clusterCounts = async () => (await deskPage.locator('.desk-cluster').allInnerTexts()).map(Number)
// the premise first, from the receipts themselves: two accounts, one place, and a word that
// finds those two and nothing else filed by now
const pair = (await (await fetch(`${API}/incidents/${incidentId}`, desk)).json()).reports
if (pair.length !== 2) fail(`${incidentId} holds ${pair.length} accounts, not two`)
const standing = pair.map((r) => `${r.reference} ${r.status} ${r.summary.lng},${r.summary.lat}`)
if (new Set(pair.map((r) => `${r.summary.lng},${r.summary.lat}`)).size !== 1) fail(`the two accounts do not stand in the same place: ${standing.join(' | ')}`)
const WORD = 'manhattan'
const inbox = (await (await fetch(`${API}/claims`, desk)).json()).claims
const matching = inbox.filter((c) => [c.reference, c.clientReference, c.summary.reporter, c.summary.address].some((s) => s?.toLowerCase().includes(WORD)))
if (matching.length !== 2 || matching.some((c) => !pair.some((r) => r.reference === c.reference)))
  fail(`"${WORD}" finds ${matching.map((c) => c.reference).join()}, not the two accounts of one accident`)
const lead = pair.find((r) => r.party === 'policyholder') ?? pair[0]

await openDeskMap()
await deskFind.fill(WORD)
if (!(await settles(async () => (await listed()) === 1))) fail(`the two accounts of ${incidentId} are ${await listed()} rows in the list`)
if (!(await settles(async () => near(await centreColour(), STATUS_COLOUR[lead.status]))))
  fail(`the two accounts of one accident draw ${await centreColour()}, not one "${lead.status}" pin (clusters: ${JSON.stringify(await clusterCounts())})`)
// zoomed out, two points standing on the same spot have to cluster: one pin cannot, so a "2"
// here is the map having been given the receipts instead of the rows
for (let i = 0; i < 3; i++) {
  await deskPage.getByRole('button', { name: 'Zoom out' }).click()
  await deskPage.waitForTimeout(300)
}
await deskPage.waitForTimeout(1000)
if (await deskPage.locator('.desk-cluster').count()) fail(`the two accounts of one accident are two points on one spot: zoomed out they cluster ${JSON.stringify(await clusterCounts())}`)
if (!near(await centreColour(), STATUS_COLOUR[lead.status])) fail(`zoomed out, the one pin for ${incidentId} is ${await centreColour()}, not "${lead.status}"`)
ok(`desk map: two accounts of one accident (${standing.join(', ')}) are one pin, in the "${lead.status}" colour of the account leading their row`)

// zoomed out to the whole world, everything filed folds into one cluster, and tapping it opens it up
await openDeskMap()
const biggest = async () => Math.max(0, ...(await clusterCounts()))
for (let i = 0; i < 6; i++) {
  await deskPage.getByRole('button', { name: 'Zoom out' }).click()
  await deskPage.waitForTimeout(300)
}
if (!(await settles(async () => (await biggest()) >= 3))) fail(`zoomed out to the world, the reports do not cluster: ${JSON.stringify(await clusterCounts())}`)
const clustered = await biggest()
await deskPage.locator('.desk-cluster').first().click()
if (!(await settles(async () => (await biggest()) < clustered))) fail(`tapping the cluster of ${clustered} did not open it up: ${JSON.stringify(await clusterCounts())}`)
const left = await biggest()
ok(`desk map: zoomed out the reports fold into a cluster of ${clustered}, and tapping it splits them into ${left ? `clusters of at most ${left}` : 'separate pins'}`)

// and the list follows the map when it is asked to
await openDeskMap()
const all = await listed()
await deskPage.getByRole('button', { name: "Only what's on the map" }).click()
// fewer than the whole list already: a report with no place is on no map
const framed = await listed()
if (framed < PLACES.length || framed > all) fail(`the map's own view lists ${framed} of ${all} reports, and the three just filed are on it`)
for (let i = 0; i < 8; i++) {
  await deskPage.getByRole('button', { name: 'Zoom in' }).click()
  await deskPage.waitForTimeout(250)
}
if (!(await settles(async () => (await listed()) < framed))) fail(`zoomed into the ocean between them, the list still holds ${await listed()} of ${framed} reports`)
const narrowed = await listed()
await deskPage.getByRole('button', { name: "Only what's on the map" }).click()
if (!(await settles(async () => (await listed()) === all))) fail(`the list did not come back when it stopped following the map: ${await listed()} of ${all}`)
ok(`desk map: "only what's on the map" narrows the list to the view (${all} filed, ${framed} on the map, ${narrowed} in the view) and gives it back`)

// ── the demo portal, on the same server, embedding the built page ─────

const demo = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const portal = await demo.newPage()
const portalErrors = []
portal.on('pageerror', (e) => portalErrors.push(String(e)))
await portal.goto(`${API}/demo`)
if (!/\/demo\/$/.test(portal.url())) fail(`/demo did not land on /demo/: ${portal.url()}`)
await portal.getByRole('button', { name: /Alex Rivera/ }).click()
await portal.waitForURL(/policy\.html$/, { timeout: 10000 }).catch(() => fail('signing in did not reach the policy page'))
await portal.locator('text=Signed in as').waitFor({ timeout: 5000 })
const report = portal.frameLocator('iframe')
await report
  .locator('text=Acme Mutual')
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => fail('the built page never took the portal\'s config'))
ok('demo: /demo redirects to /demo/, signing in mints a session, and the built page takes its config')

const go = () => report.getByRole('button', { name: /^Continue/ }).click()
await go()
const demoSearch = report.getByRole('combobox', { name: 'Where did it happen?' })
await demoSearch.fill('Times Square, New York')
const demoOption = report.getByRole('option').first()
await demoOption.waitFor({ timeout: 20000 }).catch(() => fail('no address suggestions in the demo walk'))
await demoOption.click()
await report.locator('text=Drag the pin on the map').waitFor({ timeout: 10000 })
await go()
const demoPicks = report.getByRole('radiogroup', { name: 'Which of your vehicles' }).getByRole('radio')
if ((await demoPicks.count()) !== 2) fail(`the policy's two vehicles are not a pick: ${await demoPicks.count()}`)
await demoPicks.nth(0).click()
ok("demo: the sample customer's two policy vehicles are a pick, filled from the session's prefill")
await go()
await report.locator('text=Who was driving?').waitFor()
await go()
await report.locator('.mk-car').first().waitFor({ timeout: 30000 })
await portal.waitForTimeout(3000)
await go()
await report.locator('.cm-root canvas').waitFor({ timeout: 30000 })
await portal.waitForTimeout(3000)
await go()
await report.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
await report.getByRole('textbox', { name: 'Signature' }).fill('Alex Rivera')
await report.getByRole('button', { name: 'Send my report' }).click()
await portal.waitForURL(/claims\.html#/, { timeout: 60000 }).catch(() => fail('the portal never took the customer to its claim page'))
const demoRef = await portal.locator('#reference').textContent()
if (!/^INS-\d{4}-[A-Z2-9]{6}$/.test(demoRef ?? '')) fail(`the portal shows ${demoRef}, not the server's reference`)
ok(`demo: the report was filed from the portal as ${demoRef}`)

const filedDemo = await (await fetch(`${API}/claims/${demoRef}`, desk)).json()
if (filedDemo.demo !== true || !filedDemo.customer?.id?.startsWith('demo-')) fail(`the demo report is not tagged: ${JSON.stringify(filedDemo.customer)} ${filedDemo.demo}`)

await portal.getByRole('link', { name: 'Open the claims desk' }).click()
await portal.waitForURL(/adjuster\.html#/, { timeout: 10000 })
await portal.locator('text=Reported by').waitFor({ timeout: 20000 }).catch(() => fail('the desk link did not open the report'))
const deskText = await portal.locator('article').first().innerText()
if (!/The policyholder/.test(deskText)) fail('the desk does not read in the adjuster\'s voice')
// the visitor's own session opened their report; it must not open anyone else's
const others = await (await fetch(`${API}/claims`, { headers: { authorization: `Bearer ${await portal.evaluate(() => sessionStorage.getItem('claim-marker/desk-token'))}` } })).json()
if (others.claims.length !== 1 || others.claims[0].reference !== demoRef) fail(`the demo visitor sees ${others.claims.length} reports, not only their own`)
ok('demo: its link opens the desk on that report, in the adjuster\'s voice, and that visitor sees no other report')

// a demonstration is neither checked against the reuse indexes nor remembered in them
if (filedDemo.signals?.length) fail(`a demo report carries signals: ${JSON.stringify(filedDemo.signals)}`)
const indexed = (await Promise.all(['photos', 'vins', 'plates'].map((n) => readFile(join(dir, 'index', `${n}.jsonl`), 'utf8').catch(() => '')))).join('')
if (indexed.includes(demoRef)) fail(`${demoRef} was recorded into the reuse indexes`)
// the other driver a demo visitor invites is part of the demonstration too, and so is the invite
const visitor = await (await fetch(`${API}/demo/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...aside }, body: '{"customer":"one-car"}' })).json()
const demoInvite = await (await invite(visitor.token)).json()
const demoParty = await filed(await fileWith(new URL(demoInvite.url).searchParams.get('party'), { incident: { kind: 'collision' } }))
if (demoParty.demo !== true || demoParty.incident !== demoInvite.incident) fail(`the other driver of a demo invite is not tagged: demo ${demoParty.demo}, incident ${demoParty.incident}`)
if (JSON.parse(await readFile(join(dir, 'incidents', demoInvite.incident, 'seed.json'), 'utf8')).invited.demo !== true) fail('a demo invite is not tagged')
ok('demo: no signals and nothing indexed; a demo invite and the report it brings in are both tagged demo, and swept with it')

const portalReal = portalErrors.filter((e) => !/WebGL|GPU|ResizeObserver/.test(e))
if (portalReal.length) fail(`demo portal page errors: ${portalReal.join(' | ')}`)

const real = errors.filter((e) => !/WebGL|GPU|ResizeObserver/.test(e))
if (real.length) fail(`page errors: ${real.join(' | ')}`)

await browser.close()
await cleanup()
console.log('\nall integration checks passed')
