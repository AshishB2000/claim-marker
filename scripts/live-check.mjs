/**
 * A deployed instance, checked from the outside: plain `fetch`, no browser, nothing started
 * here. What a prospect's browser and an insurer's backend would each reach, and what neither
 * should.
 *
 *   npm run build      # once, for dist/lib/claim.js: the report it files is built by the page's own code
 *   API_KEY=… DESK_TOKEN=… node scripts/live-check.mjs https://claim-marker.fly.dev
 *
 * API_KEY and DESK_TOKEN are the ones the instance was deployed with. It files one report,
 * for a customer called `live-check`, and closes it on the desk afterwards so the inbox a
 * prospect sees stays tidy.
 */
import { existsSync } from 'node:fs'

const BASE = (process.argv[2] ?? '').replace(/\/+$/, '')
const { API_KEY, DESK_TOKEN } = process.env
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

if (!/^https?:\/\/[^/]+$/.test(BASE)) fail('usage: API_KEY=… DESK_TOKEN=… node scripts/live-check.mjs https://your-instance')
if (!API_KEY || !DESK_TOKEN) fail('set API_KEY and DESK_TOKEN to the ones the instance was deployed with')
const LIB = new URL('../dist/lib/claim.js', import.meta.url)
if (!existsSync(LIB)) fail('dist/lib/claim.js is missing: run `npm run build` first')
const { emptyClaim, toDocument, makeReference } = await import(LIB)

const at = (path, init) => fetch(BASE + path, init)
const body = async (res) => res.json().catch(() => null)

// ── the instance is up and serving the page ──

const health = await body(await at('/health'))
if (!health?.ok || health.static !== true) fail(`/health answered ${JSON.stringify(health)}`)
ok(`health: up, serving the page, ${health.schema}, reports kept ${health.retainDays ? `${health.retainDays} days` : 'for ever'}`)

const page = await at('/')
const html = await page.text()
const csp = page.headers.get('content-security-policy') ?? ''
if (page.status !== 200 || !/^text\/html/.test(page.headers.get('content-type') ?? '')) fail(`GET / answered ${page.status} ${page.headers.get('content-type')}`)
if (!/(^|;\s*)frame-ancestors [^;]+/.test(csp)) fail(`no frame-ancestors in the CSP: ${csp}`)
if (!/script-src [^;]*'sha256-/.test(csp)) fail(`the injected config's hash is not in script-src: ${csp}`)
if (!html.includes('window.CLAIM_MARKER=') || !html.includes('"submitUrl":"/claims"')) fail('the runtime config is not injected into the page')
const hashed = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
if (!hashed) fail('the page references no hashed asset')
const asset = await at(hashed)
await asset.arrayBuffer()
if (asset.status !== 200 || !(asset.headers.get('cache-control') ?? '').includes('immutable')) fail(`${hashed}: ${asset.status}, cache-control ${asset.headers.get('cache-control')}`)
ok(`page: HTML with frame-ancestors and the config's sha256 in its CSP, config injected, ${hashed} immutable`)

// ── what must not be reachable ──

// %2f keeps the URL parser from folding the `..` away before it ever leaves this machine
for (const path of ['/lib/claim.js', '/%2e%2e%2fserver%2fclaim-server.mjs']) {
  const res = await at(path)
  await res.arrayBuffer()
  if (res.status !== 404) fail(`${path} answered ${res.status}`)
}
ok('private: the parser under /lib and a path out of the static folder are 404')

// ── the insurer's backend mints a session, and the page files a report with it ──

const mint = (headers) =>
  at('/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ customer: { id: 'live-check', policy: 'LIVE-1', name: 'Live Check' }, ttlSeconds: 300 }),
  })
const refused = await mint({})
await refused.arrayBuffer()
if (refused.status !== 401) fail(`POST /sessions without the key answered ${refused.status}`)
const minted = await mint({ 'x-api-key': API_KEY })
const session = await body(minted)
if (minted.status !== 200 || !session?.token) fail(`POST /sessions with the key answered ${minted.status} ${JSON.stringify(session)}`)
ok('sessions: 401 without the key, a token with it')

const reference = makeReference()
const claim = emptyClaim()
const doc = toDocument({
  ...claim,
  reference,
  submittedAt: new Date().toISOString(),
  reporter: { ...claim.reporter, name: 'Live Check' },
  incident: { ...claim.incident, description: 'Filed by scripts/live-check.mjs; closed straight after.' },
})
const send = () =>
  at('/claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}`, 'idempotency-key': reference },
    body: JSON.stringify(doc),
  })
const first = await send()
const filed = await body(first)
if (first.status !== 201 || !/^INS-/.test(filed?.reference ?? '')) fail(`POST /claims answered ${first.status} ${JSON.stringify(filed)}`)
const second = await send()
const again = await body(second)
if (second.status !== 200 || again?.duplicate !== true || again.reference !== filed.reference) fail(`the resend answered ${second.status} ${JSON.stringify(again)}`)
ok(`claims: filed as ${filed.reference} (201); the same report again is 200, a duplicate, the same reference`)

// ── the desk ──

const locked = await at('/claims')
await locked.arrayBuffer()
if (locked.status !== 401) fail(`GET /claims without the desk token answered ${locked.status}`)
const desk = { authorization: `Bearer ${DESK_TOKEN}` }
const inbox = await body(await at('/claims', { headers: desk }))
const row = inbox?.claims?.find((c) => c.reference === filed.reference)
if (!row || row.customer?.id !== 'live-check') fail(`the desk does not list ${filed.reference} against live-check`)
const closed = await at(`/claims/${filed.reference}`, { method: 'PATCH', headers: { ...desk, 'content-type': 'application/json' }, body: '{"status":"closed"}' })
const receipt = await body(closed)
if (closed.status !== 200 || receipt?.status !== 'closed') fail(`closing ${filed.reference} answered ${closed.status} ${JSON.stringify(receipt)}`)
ok(`desk: 401 without the token; lists ${filed.reference} for live-check, and it is now closed`)

console.log(`\n${BASE} passes the live check`)
