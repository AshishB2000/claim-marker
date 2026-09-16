/**
 * A reference backend for the page: what receiving a report looks like, runnable as is and
 * meant to be copied.
 *
 *   npm run build                         # produces dist/lib/claim.js, the document parser
 *   node server/claim-server.mjs          # http://localhost:8788
 *
 *   POST  /claims               the page sends `claim/1`; answers { reference, status }
 *   GET   /claims               the desk lists what has arrived, newest first
 *   GET   /claims/:ref          one report, the whole document included
 *   GET   /claims/:ref/files/x  the diagram, the marked-up car and the photographs as files
 *   PATCH /claims/:ref          { status } — new, reviewing, closed
 *   GET   /health
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
 * Environment:
 *   PORT             8788
 *   CLAIM_DIR        ./data/claims
 *   CLAIM_TOKEN      if set, POST needs `Authorization: Bearer <this>` — what the page sends
 *   DESK_TOKEN       if set, GET and PATCH need it — what the claims desk sends
 *   WEBHOOK_URL      where to announce a new report
 *   WEBHOOK_SECRET   the HMAC key for X-Claim-Signature
 *   CLAIM_ORIGIN     the page's origin for CORS; * by default, never in production
 *
 * No dependencies: node's own http, fs and crypto.
 */
import { createServer } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const LIB = resolve(here, '../dist/lib/claim.js')
if (!existsSync(LIB)) {
  console.error(`claim-server: ${LIB} is missing — run \`npm run build\` first; it produces the document parser the server validates with.`)
  process.exit(1)
}
const { parseClaim, CLAIM_SCHEMA } = await import(LIB)

const PORT = Number(process.env.PORT ?? 8788)
const DIR = resolve(process.env.CLAIM_DIR ?? 'data/claims')
const CLAIM_TOKEN = process.env.CLAIM_TOKEN
const DESK_TOKEN = process.env.DESK_TOKEN
const WEBHOOK_URL = process.env.WEBHOOK_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? ''
const ORIGIN = process.env.CLAIM_ORIGIN ?? '*'
/** a document with twelve photographs is a few MB; this is far above any real one */
const MAX_BODY = 40 * 1024 * 1024
const STATUSES = ['new', 'reviewing', 'closed']

// ── helpers ──────────────────────────────────────────────────────────

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, vary: 'origin' })
  res.end(JSON.stringify(body))
}
const cors = (res) =>
  res.writeHead(204, {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, idempotency-key',
    'access-control-max-age': '600',
  })

const bearer = (req) => {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')
  return m ? m[1].trim() : null
}
const authorised = (req, token) => {
  if (!token) return true
  const given = bearer(req)
  return !!given && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
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

async function store(doc, clientRef) {
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

// ── the webhook ──────────────────────────────────────────────────────

async function announce(receipt, doc, base) {
  if (!WEBHOOK_URL) return
  const { attachments: _drop, ...claim } = doc
  const body = JSON.stringify({
    event: 'claim.received',
    schema: CLAIM_SCHEMA,
    reference: receipt.reference,
    clientReference: receipt.clientReference,
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

async function receive(req, res) {
  if (!authorised(req, CLAIM_TOKEN)) return json(res, 401, { error: 'a bearer token is required' })
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
  const receipt = await store(doc, clientRef)
  console.log(`received ${receipt.reference} (${clientRef ?? 'no client ref'}): ${receipt.summary.kind} at ${receipt.summary.address || 'no address'}, ${parsed.rejected} vehicle(s) rejected`)
  json(res, 201, { reference: receipt.reference, status: receipt.status, rejectedVehicles: parsed.rejected })
  const base = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
  announce(receipt, doc, base).catch(() => {})
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

async function route(req, res) {
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.split('/').filter(Boolean)
  if (req.method === 'OPTIONS') return cors(res), res.end()
  if (parts[0] === 'health') return json(res, 200, { ok: true, schema: CLAIM_SCHEMA })
  if (parts[0] !== 'claims') return json(res, 404, { error: 'not found' })

  if (parts.length === 1 && req.method === 'POST') return receive(req, res)
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
    res.writeHead(200, { 'content-type': TYPES[name.split('.').pop()] ?? 'application/octet-stream', 'access-control-allow-origin': ORIGIN, 'cache-control': 'private, max-age=3600' })
    return res.end(bytes)
  }
  json(res, 405, { error: 'method not allowed' })
}

await mkdir(DIR, { recursive: true })
createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e)
    if (!res.headersSent) json(res, 500, { error: 'something went wrong' })
  })
}).listen(PORT, () => {
  console.log(`claim-server on http://localhost:${PORT} — reports go to ${DIR}${CLAIM_TOKEN ? ', POST needs a token' : ''}${WEBHOOK_URL ? `, announcing to ${WEBHOOK_URL}` : ''}`)
})
