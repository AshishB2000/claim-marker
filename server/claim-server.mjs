/**
 * The whole product on one port: the customer's page, the claims desk, and the API that
 * receives what the page sends. Runnable as is and meant to be copied.
 *
 *   npm run build                         # produces dist/ and dist/lib/claim.js, the parser
 *   node server/claim-server.mjs          # http://localhost:8788
 *
 *   POST  /sessions             the insurer's backend mints a token for one customer
 *   POST  /claims               the page sends `claim/1`; answers { reference, status }
 *   GET   /claims               the desk lists what has arrived, newest first
 *   GET   /claims/:ref          one report, the whole document included
 *   GET   /claims/:ref/files/x  the diagram, the marked-up car and the photographs as files
 *   PATCH /claims/:ref          { status } — new, reviewing, closed
 *   GET   /health
 *   GET   /*                    the built page, when dist/ is beside this file
 *
 * Every report is validated with the page's own parser, then written under CLAIM_DIR as a
 * folder: the document as JSON, and each attachment unpacked as a real file, because that is
 * what a claims system, a document store and an adjuster's screen all want. The page's
 * reference is the idempotency key — the same report sent twice, say after a lost reply on a
 * bad connection, is filed once and answered the same way.
 *
 * With WEBHOOK_URL set, each new report is announced with a POST carrying the document
 * without its attachments, links to the files, and an HMAC signature in X-Claim-Signature
 * so the receiver can prove where it came from. Delivery is retried three times.
 *
 * Serving the page from here means one origin, one deployment and no CORS: the page's
 * settings are injected into the HTML as `window.CLAIM_MARKER` at startup, so one built
 * image serves any insurer without a rebuild, and the Content-Security-Policy is built to
 * match — including the hash of that one inline script.
 *
 * Environment:
 *   PORT             8788
 *   CLAIM_DIR        ./data/claims
 *   STATIC_DIR       ../dist — the built page; serving is skipped when it is not there
 *   CLAIM_TOKEN      if set, POST /claims accepts `Authorization: Bearer <this>`
 *   SESSION_SECRET   if set, POST /claims also accepts a token minted by POST /sessions
 *   API_KEY          the key the insurer's backend sends to POST /sessions
 *   DESK_TOKEN       if set, GET and PATCH need it — what the claims desk sends
 *   RATE_LIMIT       POSTs per minute per IP, default 30
 *   TRUST_PROXY      1 when something in front sets X-Forwarded-For (or Fly-Client-IP)
 *   ALLOWED_HOSTS    origins allowed to embed the page, comma-separated; sets frame-ancestors
 *   BRAND            the insurer's name, injected into the page
 *   ASSIST_URL       an endpoint speaking `claim-assist/1`, injected into the page
 *   CONNECT_SRC      extra origins the page may reach (your own tiles or geocoder)
 *   WEBHOOK_URL      where to announce a new report
 *   WEBHOOK_SECRET   the HMAC key for X-Claim-Signature
 *   CLAIM_ORIGIN     an extra origin for CORS; * in development, unset in production
 *   RETAIN_DAYS      forget reports older than this many days; unset keeps them for ever
 *
 * No dependencies: node's own http, fs and crypto.
 */
import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify as verifySession, sign as signSession } from './session.mjs'
import { expired } from './retention.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const LIB = resolve(here, '../dist/lib/claim.js')
if (!existsSync(LIB)) {
  console.error(`claim-server: ${LIB} is missing — run \`npm run build\` first; it produces the document parser the server validates with.`)
  process.exit(1)
}
const { parseClaim, CLAIM_SCHEMA } = await import(LIB)

const PRODUCTION = process.env.NODE_ENV === 'production'
// `||`, not `??`: an empty line in .env or compose's ${X:-} must not mean port 0, the current
// directory, or zero requests a minute
const PORT = Number(process.env.PORT || 8788)
const DIR = resolve(process.env.CLAIM_DIR || 'data/claims')
const STATIC = resolve(process.env.STATIC_DIR || resolve(here, '../dist'))
const CLAIM_TOKEN = process.env.CLAIM_TOKEN
const SESSION_SECRET = process.env.SESSION_SECRET
const API_KEY = process.env.API_KEY
const DESK_TOKEN = process.env.DESK_TOKEN
const WEBHOOK_URL = process.env.WEBHOOK_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? ''
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
/** in production an unset CLAIM_ORIGIN means no CORS header at all: the page it serves needs none */
const ORIGIN = process.env.CLAIM_ORIGIN ?? (PRODUCTION ? '' : '*')
/** a document with twelve photographs is a few MB; this is far above any real one */
const MAX_BODY = 40 * 1024 * 1024
const STATUSES = ['new', 'reviewing', 'closed']
/** null keeps every report for ever */
const RETAIN_DAYS = Number(process.env.RETAIN_DAYS) > 0 ? Number(process.env.RETAIN_DAYS) : null

// ── what an insurer must have decided before this faces the internet ──

if (PRODUCTION) {
  const missing = []
  if (!CLAIM_TOKEN && !SESSION_SECRET) missing.push('CLAIM_TOKEN or SESSION_SECRET (otherwise anyone can file a report)')
  if (!DESK_TOKEN) missing.push('DESK_TOKEN (otherwise anyone can read every report)')
  if (ORIGIN === '*') missing.push('CLAIM_ORIGIN must not be * (leave it unset for same-origin only)')
  if (missing.length) {
    console.error(`claim-server: refusing to start with NODE_ENV=production:\n  - ${missing.join('\n  - ')}`)
    process.exit(1)
  }
}
if (!ALLOWED_HOSTS.length) console.warn('claim-server: ALLOWED_HOSTS is unset — any site may embed the page. Set it in production.')

// ── helpers ──────────────────────────────────────────────────────────

const corsHeaders = () => (ORIGIN ? { 'access-control-allow-origin': ORIGIN, vary: 'origin' } : {})

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', ...corsHeaders() })
  res.end(JSON.stringify(body))
}
const cors = (res) =>
  res.writeHead(204, {
    ...corsHeaders(),
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, idempotency-key, x-api-key',
    'access-control-max-age': '600',
  })

const bearer = (req) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  return m ? m[1].trim() : null
}
const sameSecret = (given, token) => !!given && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
const authorised = (req, token) => (!token ? true : sameSecret(bearer(req), token))

/**
 * Who sent this report: a session minted for one customer, the shared customer token, or —
 * only when neither is configured, which is development — nobody in particular.
 */
function whoSent(req) {
  const given = bearer(req)
  if (SESSION_SECRET && given) {
    const session = verifySession(given, SESSION_SECRET)
    if (session) return { customer: { id: session.sub, policy: session.policy } }
  }
  if (CLAIM_TOKEN && sameSecret(given, CLAIM_TOKEN)) return { customer: null }
  if (!CLAIM_TOKEN && !SESSION_SECRET) return { customer: null }
  return null
}

/**
 * Fly's proxy sets `Fly-Client-IP` to the address it saw. `X-Forwarded-For` is a list a
 * client can start itself, and a proxy that appends to it leaves the made-up entry first — a
 * flood carrying a new one on every request would never run out of tokens.
 */
const ipOf = (req) =>
  (TRUST_PROXY ? String(req.headers['fly-client-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') ||
  req.socket.remoteAddress ||
  'unknown'

/**
 * A token bucket per IP, refilling to RATE_LIMIT a minute.
 *
 * ponytail: one in-memory map, so it is per-process and forgets on restart; put a real
 * limiter in front (nginx, a gateway, a shared store) when there is more than one of these.
 */
const buckets = new Map()
function rateLimited(ip) {
  const now = Date.now()
  if (buckets.size > 10_000) buckets.clear()
  const b = buckets.get(ip) ?? { tokens: RATE_LIMIT, at: now }
  b.tokens = Math.min(RATE_LIMIT, b.tokens + ((now - b.at) / 60_000) * RATE_LIMIT)
  b.at = now
  buckets.set(ip, b)
  if (b.tokens < 1) return true
  b.tokens -= 1
  return false
}
const tooMany = (res) => {
  res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60', ...corsHeaders() })
  res.end(JSON.stringify({ error: 'too many requests; try again in a minute' }))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** the insurer's own claim number: the year and six unambiguous characters */
const newReference = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let s = ''
  for (const b of bytes) s += alphabet[b % alphabet.length]
  return `INS-${new Date().getFullYear()}-${s}`
}
const safeRef = (s) => /^[A-Z0-9-]{4,40}$/i.test(s)
const dataUrl = (s) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(s ?? '')
  return m ? { type: m[1], ext: m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg', bytes: Buffer.from(m[2], 'base64') } : null
}

// ── the built page ───────────────────────────────────────────────────

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  glb: 'model/gltf-binary',
  hdr: 'image/vnd.radiance',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  map: 'application/json',
}
const typeOf = (name) => TYPES[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream'

/** what the page reads out of `window.CLAIM_MARKER`; a key it has no value for is left out */
const pageConfig = {
  // the page is served from here, so it posts back to here
  submitUrl: '/claims',
  // the desk reads the same origin; the empty string says so out loud
  claimsApi: '',
  ...(process.env.BRAND ? { brand: process.env.BRAND } : {}),
  ...(process.env.ASSIST_URL ? { assistUrl: process.env.ASSIST_URL } : {}),
  ...(ALLOWED_HOSTS.length ? { allowedHosts: ALLOWED_HOSTS } : {}),
}
// `</script>` inside a value would end the tag early; escaping every `<` is the blunt fix
const CONFIG_SCRIPT = `window.CLAIM_MARKER=${JSON.stringify(pageConfig).replace(/</g, '\\u003c')}`
const CONFIG_HASH = `'sha256-${createHash('sha256').update(CONFIG_SCRIPT).digest('base64')}'`

/** where the page is allowed to reach: the providers it ships with, plus whatever was added */
const CONNECT = [
  'https://server.arcgisonline.com',
  'https://photon.komoot.io',
  'https://vpic.nhtsa.dot.gov',
  'https://en.wikipedia.org',
  ...(process.env.ASSIST_URL ? [new URL(process.env.ASSIST_URL).origin] : []),
  ...(process.env.CONNECT_SRC ?? '').split(',').map((s) => s.trim()).filter(Boolean),
]
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${CONFIG_HASH}`,
  // maplibre and three both set element styles; a nonce per element is not on offer
  "style-src 'self' 'unsafe-inline'",
  // raster tiles arrive as images when the browser will not give MapLibre an ImageBitmap
  `img-src 'self' data: blob: https://upload.wikimedia.org ${CONNECT.join(' ')}`,
  // `data:` is not decoration: the kit's GLB files carry their texture as a data URI and
  // three fetches it, so without this every car loads untextured and the console fills up
  `connect-src 'self' data: blob: ${CONNECT.join(' ')}`,
  // the MapLibre worker is a file in /assets; three and the codecs make theirs from blobs
  "worker-src 'self' blob:",
  `frame-ancestors ${ALLOWED_HOSTS.length ? ALLOWED_HOSTS.join(' ') : '*'}`,
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** the two HTML pages, read once and patched with the runtime config */
function loadPages() {
  if (!existsSync(join(STATIC, 'index.html'))) return null
  const pages = {}
  for (const name of ['index.html', 'adjuster.html']) {
    const file = join(STATIC, name)
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf8')
    pages['/' + name] = raw.replace('</head>', `<script>${CONFIG_SCRIPT}</script></head>`)
  }
  pages['/'] = pages['/index.html']
  return pages
}
const PAGES = loadPages()
if (!PAGES) console.log(`claim-server: no built page at ${STATIC} — serving the API only (run \`npm run build\`)`)

const sendHtml = (req, res, html) => {
  const body = Buffer.from(html, 'utf8')
  res.writeHead(200, {
    'content-type': TYPES.html,
    'content-length': body.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': CSP,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

/** hashed assets never change; everything else is a day, and the entry points are never cached */
const cacheFor = (path) => {
  if (path.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  if (/\.html$/.test(path) || path === '/sw.js' || path === '/manifest.webmanifest') return 'no-cache'
  return 'public, max-age=86400'
}

async function serveStatic(req, res, pathname) {
  if (!PAGES) return json(res, 404, { error: 'not found' })
  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return json(res, 400, { error: 'bad path' })
  }
  if (path.includes('\0')) return json(res, 400, { error: 'bad path' })
  if (PAGES[path]) return sendHtml(req, res, PAGES[path])
  // dist/lib is the parser this server imports, not something a browser should fetch
  if (path.startsWith('/lib/')) return json(res, 404, { error: 'not found' })

  const full = resolve(STATIC, '.' + path)
  if (full !== STATIC && !full.startsWith(STATIC + sep)) return json(res, 404, { error: 'not found' })
  let info
  try {
    info = await stat(full)
  } catch {
    return json(res, 404, { error: 'not found' })
  }
  if (!info.isFile()) return json(res, 404, { error: 'not found' })

  const headers = {
    'content-type': typeOf(path),
    'content-length': info.size,
    'cache-control': cacheFor(path),
    'x-content-type-options': 'nosniff',
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, headers)
    return res.end()
  }
  res.writeHead(200, headers)
  res.end(await readFile(full))
}

// ── storage: one folder per report ───────────────────────────────────

const folder = (ref) => join(DIR, ref)
const receiptOf = async (ref) => JSON.parse(await readFile(join(folder(ref), 'receipt.json'), 'utf8'))
const claimOf = async (ref) => JSON.parse(await readFile(join(folder(ref), 'claim.json'), 'utf8'))

/** the page's reference → ours, so a resend is answered with the first answer */
const byClient = async (clientRef) => {
  if (!safeRef(clientRef)) return null
  try {
    return (await readFile(join(DIR, 'by-client', clientRef), 'utf8')).trim()
  } catch {
    return null
  }
}

async function store(doc, clientRef, customer) {
  const reference = newReference()
  const dir = folder(reference)
  await mkdir(dir, { recursive: true })
  const files = {}
  const put = async (name, data) => {
    const d = dataUrl(data)
    if (!d) return
    await writeFile(join(dir, `${name}.${d.ext}`), d.bytes)
    files[name] = `${name}.${d.ext}`
  }
  await put('scene', doc.attachments.scene)
  for (const [id, png] of Object.entries(doc.attachments.damage)) await put(`damage-${id}`, png)
  for (let i = 0; i < doc.attachments.photos.length; i++) await put(`photo-${String(i + 1).padStart(2, '0')}`, doc.attachments.photos[i].data)

  const receipt = {
    reference,
    clientReference: clientRef,
    // who the session said this was, when it came with one: the report is on their policy
    customer,
    receivedAt: new Date().toISOString(),
    status: 'new',
    files,
    summary: summarise(doc),
  }
  await writeFile(join(dir, 'claim.json'), JSON.stringify(doc))
  await writeFile(join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2))
  if (clientRef && safeRef(clientRef)) {
    await mkdir(join(DIR, 'by-client'), { recursive: true })
    await writeFile(join(DIR, 'by-client', clientRef), reference)
  }
  return receipt
}

/** what an inbox row shows */
const summarise = (doc) => ({
  kind: doc.incident.kind,
  at: doc.incident.at,
  address: doc.incident.location?.address ?? '',
  reporter: doc.reporter.name,
  vehicles: doc.vehicles.length,
  plates: doc.vehicles.map((v) => v.plate).filter(Boolean),
  hurt: doc.people.filter((p) => p.injured).length,
  damaged: doc.vehicles.filter((v) => v.damages.length > 0).length,
  photos: doc.attachments.photos.length,
  drivable: doc.vehicles.find((v) => v.role === 'insured')?.condition.drivable ?? null,
})

async function list() {
  let names = []
  try {
    names = (await readdir(DIR)).filter((n) => n !== 'by-client')
  } catch {
    return []
  }
  const receipts = []
  for (const n of names) {
    try {
      if ((await stat(join(DIR, n))).isDirectory()) receipts.push(await receiptOf(n))
    } catch {
      // a half-written folder is not a report
    }
  }
  return receipts.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
}

/**
 * Forget what is older than RETAIN_DAYS: the report's folder, photographs and all, and the
 * page's reference that pointed at it. A public instance that keeps strangers' photographs for
 * ever is a liability, not an archive.
 */
async function sweep() {
  for (const r of await list()) {
    // the reference names the folder to delete; one that is not a reference names nothing
    if (!safeRef(r.reference) || !expired(r.receivedAt, RETAIN_DAYS)) continue
    await rm(folder(r.reference), { recursive: true, force: true })
    if (r.clientReference && safeRef(r.clientReference)) await rm(join(DIR, 'by-client', r.clientReference), { force: true })
    console.log(`swept ${r.reference}, received ${r.receivedAt}`)
  }
}

// ── the webhook ──────────────────────────────────────────────────────

async function announce(receipt, doc, base) {
  if (!WEBHOOK_URL) return
  const { attachments: _drop, ...claim } = doc
  const body = JSON.stringify({
    event: 'claim.received',
    schema: CLAIM_SCHEMA,
    reference: receipt.reference,
    clientReference: receipt.clientReference,
    customer: receipt.customer,
    receivedAt: receipt.receivedAt,
    claim,
    files: Object.fromEntries(Object.entries(receipt.files).map(([k, f]) => [k, `${base}/claims/${receipt.reference}/files/${f}`])),
  })
  const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  for (const wait of [0, 2000, 8000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-claim-event': 'claim.received', 'x-claim-signature': signature },
        body,
      })
      if (res.ok) return
      console.warn(`webhook: ${res.status} for ${receipt.reference}`)
    } catch (e) {
      console.warn(`webhook: ${e.message} for ${receipt.reference}`)
    }
  }
}

// ── routes ───────────────────────────────────────────────────────────

const MAX_ID = 80

/**
 * The insurer's backend, having just authenticated the customer, asks for a token to hand to
 * the page along with what it already knows about them. Server to server: an API key, and no
 * `Origin` header, because a browser sends one and a browser has no business here.
 */
async function mintSession(req, res) {
  if (!API_KEY || !SESSION_SECRET) return json(res, 503, { error: 'sessions are not configured: set API_KEY and SESSION_SECRET' })
  if (req.headers.origin) return json(res, 403, { error: 'this endpoint is server to server; call it from your backend' })
  const key = req.headers['x-api-key']
  if (!key || !sameSecret(String(key), API_KEY)) return json(res, 401, { error: 'x-api-key is required' })
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (e) {
    return json(res, e.status ?? 400, { error: e.status ? e.message : 'the body is not JSON' })
  }
  const customer = typeof body?.customer === 'object' && body.customer !== null ? body.customer : {}
  const id = typeof customer.id === 'string' ? customer.id.trim() : ''
  if (!id || id.length > MAX_ID) return json(res, 400, { error: 'customer.id is required and must be at most 80 characters' })
  const policy = typeof customer.policy === 'string' ? customer.policy.trim().slice(0, MAX_ID) : ''
  const token = signSession({ sub: id, policy }, SESSION_SECRET, body.ttlSeconds ?? 3600)
  const session = verifySession(token, SESSION_SECRET)
  const reporter = {}
  for (const k of ['name', 'phone', 'email']) if (typeof customer[k] === 'string' && customer[k].trim()) reporter[k] = customer[k].trim()
  if (policy) reporter.policy = policy
  json(res, 200, {
    token,
    expiresAt: new Date(session.exp * 1000).toISOString(),
    // ready to hand to ClaimMarker.mount({ prefill }); the page parses it again anyway
    prefill: {
      ...(Object.keys(reporter).length ? { reporter } : {}),
      ...(Array.isArray(body.vehicles) ? { vehicles: body.vehicles.slice(0, 6) } : {}),
    },
  })
}

async function receive(req, res) {
  const sender = whoSent(req)
  if (!sender) return json(res, 401, { error: 'a bearer token is required' })
  let raw
  try {
    raw = JSON.parse(await readBody(req))
  } catch (e) {
    return json(res, e.status ?? 400, { error: e.status ? e.message : 'the body is not JSON' })
  }
  let parsed
  try {
    parsed = parseClaim(raw)
  } catch (e) {
    return json(res, 400, { error: e.message })
  }
  const doc = parsed.value
  const clientRef = (req.headers['idempotency-key'] || doc.reference || '').toString().trim().toUpperCase() || null
  // seen before, under the page's reference or — a client echoing our answer back — under ours
  const seen = clientRef && ((await byClient(clientRef)) || (safeRef(clientRef) && existsSync(folder(clientRef)) ? clientRef : null))
  if (seen) {
    const receipt = await receiptOf(seen)
    return json(res, 200, { reference: receipt.reference, status: receipt.status, duplicate: true })
  }
  const receipt = await store(doc, clientRef, sender.customer)
  console.log(
    `received ${receipt.reference} (${clientRef ?? 'no client ref'}${sender.customer ? `, customer ${sender.customer.id}` : ''}): ${receipt.summary.kind} at ${receipt.summary.address || 'no address'}, ${parsed.rejected} vehicle(s) rejected`,
  )
  json(res, 201, { reference: receipt.reference, status: receipt.status, rejectedVehicles: parsed.rejected })
  const base = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
  announce(receipt, doc, base).catch(() => {})
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.split('/').filter(Boolean)
  if (req.method === 'OPTIONS') return cors(res), res.end()
  if (parts[0] === 'health') return json(res, 200, { ok: true, schema: CLAIM_SCHEMA, static: !!PAGES, retainDays: RETAIN_DAYS })

  if (parts[0] === 'sessions' && parts.length === 1) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (rateLimited(ipOf(req))) return tooMany(res)
    return mintSession(req, res)
  }

  if (parts[0] === 'claims') {
    // the limit comes before the auth: a flood of bad tokens is still a flood
    if (parts.length === 1 && req.method === 'POST') {
      if (rateLimited(ipOf(req))) return tooMany(res)
      return receive(req, res)
    }
    if (!authorised(req, DESK_TOKEN)) return json(res, 401, { error: 'a bearer token is required' })
    if (parts.length === 1 && req.method === 'GET') return json(res, 200, { claims: await list() })

    const ref = parts[1]
    if (!ref || !safeRef(ref) || !existsSync(folder(ref))) return json(res, 404, { error: 'no such report' })

    if (parts.length === 2 && req.method === 'GET') return json(res, 200, { ...(await receiptOf(ref)), claim: await claimOf(ref) })
    if (parts.length === 2 && req.method === 'PATCH') {
      let body
      try {
        body = JSON.parse(await readBody(req))
      } catch {
        return json(res, 400, { error: 'the body is not JSON' })
      }
      if (!STATUSES.includes(body.status)) return json(res, 400, { error: `status must be one of ${STATUSES.join(', ')}` })
      const receipt = { ...(await receiptOf(ref)), status: body.status, updatedAt: new Date().toISOString() }
      await writeFile(join(folder(ref), 'receipt.json'), JSON.stringify(receipt, null, 2))
      return json(res, 200, receipt)
    }
    if (parts.length === 4 && parts[2] === 'files' && req.method === 'GET') {
      const name = parts[3]
      const receipt = await receiptOf(ref)
      if (!Object.values(receipt.files).includes(name)) return json(res, 404, { error: 'no such file' })
      const bytes = await readFile(join(folder(ref), name))
      res.writeHead(200, { 'content-type': typeOf(name), 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', ...corsHeaders() })
      return res.end(bytes)
    }
    return json(res, 405, { error: 'method not allowed' })
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname)
  json(res, 404, { error: 'not found' })
}

await mkdir(DIR, { recursive: true })
if (RETAIN_DAYS) {
  const sweepNow = () => sweep().catch((e) => console.error(`sweep: ${e.message}`))
  sweepNow()
  // unref: a timer is no reason to keep the process alive
  setInterval(sweepNow, 6 * 3_600_000).unref()
}
createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e)
    if (!res.headersSent) json(res, 500, { error: 'something went wrong' })
  })
}).listen(PORT, () => {
  const bits = [
    `reports go to ${DIR}`,
    PAGES ? `serving the page from ${STATIC}` : 'API only',
    SESSION_SECRET ? 'sessions on' : CLAIM_TOKEN ? 'POST needs a token' : 'POST is open',
    `${RATE_LIMIT}/min per IP`,
    RETAIN_DAYS ? `reports kept ${RETAIN_DAYS} days` : 'reports kept for ever',
  ]
  if (WEBHOOK_URL) bits.push(`announcing to ${WEBHOOK_URL}`)
  console.log(`claim-server on http://localhost:${PORT} — ${bits.join(', ')}`)
})
