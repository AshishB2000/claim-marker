/**
 * The offline shell, proved the only way it can be: by taking the server away.
 *
 *   npm run build
 *   node scripts/offline-smoke.mjs
 *
 * It serves `dist/` with `vite preview` on a free port, lets the page install its worker,
 * waits until the whole precache list is on the device — then **kills the preview process**
 * and puts the browser offline before reloading. Emulating offline alone is not enough: a
 * service worker's own `fetch` still reaches localhost, so a page that was quietly being
 * served by the dead-but-not-dead server would pass a test that proves nothing.
 *
 * What it then checks is not that the HTML came back but that the *claim* works: the step
 * renders and the 3D car is drawn, which needs the body, the environment map and the
 * textures, all from the cache.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  stop()
  process.exit(1)
}
const ok = (msg) => console.log(`ok — ${msg}`)

// ── the build has to be a real one ────────────────────────────────────

const swFile = `${root}dist/sw.js`
if (!existsSync(swFile)) fail('dist/sw.js is missing: run `npm run build` first')
const list = /^const PRECACHE = (\[.*\])$/m.exec(readFileSync(swFile, 'utf8'))
if (!list) fail('dist/sw.js still has its placeholders — `npm run build` is what fills them in')
const PRECACHE = JSON.parse(list[1])
if (PRECACHE.length < 10) fail(`the precache list is only ${PRECACHE.length} files; something did not make it in`)
if (PRECACHE.some((p) => /adjuster/.test(p))) fail('the claims desk is in the precache list; it is the insurer’s screen')

// ── the server, for as long as it is wanted ───────────────────────────

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const PORT = await freePort()
const origin = `http://localhost:${PORT}`

// its own process group, because `npx` is a wrapper and killing the wrapper leaves vite serving
let preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
preview.stderr.on('data', (d) => process.stderr.write(d))
const killPreview = () => {
  if (!preview) return
  try {
    process.kill(-preview.pid, 'SIGKILL')
  } catch {
    preview.kill('SIGKILL')
  }
}
let browser
function stop() {
  browser?.close().catch(() => {})
  killPreview()
}
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(origin)).ok) break
  } catch {
    await new Promise((r) => setTimeout(r, 100))
  }
}

browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
const page = await context.newPage()
const missed = []
page.on('requestfailed', (r) => missed.push(`${r.url()} (${r.failure()?.errorText})`))
page.on('response', (r) => r.status() >= 400 && missed.push(`${r.url()} (${r.status()})`))
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

/** distinct colours in a canvas, sampled sparsely — as scripts/smoke.mjs does it */
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

/** wait for a real frame — three.js skips objects whose shaders are still linking — and say how full it is */
const settled = async (sel) => {
  for (let i = 0; i < 60; i++) {
    const n = await colours(sel)
    if (n >= 50) return n
    await page.waitForTimeout(300)
  }
  fail(`${sel} never rendered a frame — ${missed.length ? `missed: ${missed.slice(0, 4).join(' | ')}` : 'nothing failed to load'}`)
}

// ── the first visit: the shell lands on the device ────────────────────

await page.goto(origin)
const toast = page.getByRole('status').filter({ hasText: 'Works offline now' })
await toast.waitFor({ timeout: 30000 }).catch(() => fail('the page never said it works offline'))
await page.evaluate(() => navigator.serviceWorker.ready)
ok('first visit: the worker installed and the page said so')

const cached = async () =>
  page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('cm-shell-'))
    if (!name) return []
    const keys = await (await caches.open(name)).keys()
    return keys.map((r) => new URL(r.url).pathname)
  })
let have = []
for (let i = 0; i < 100; i++) {
  have = await cached()
  if (PRECACHE.every((p) => have.includes(p))) break
  await page.waitForTimeout(200)
}
const short = PRECACHE.filter((p) => !have.includes(p))
if (short.length) fail(`the shell is missing ${short.length} of ${PRECACHE.length} files: ${short.slice(0, 4).join(', ')}`)
ok(`shell: all ${PRECACHE.length} files are on the device, the seven bodies and the environment map included`)

// A draft on the damage step: it has to load a body, the environment map and the textures to
// show anything, and its canvas is the one kept with `preserveDrawingBuffer` (it is exported
// into the report), so its pixels can actually be read back. The card previews cannot be.
await page.evaluate(() => {
  const claim = {
    schema: 'claim/1',
    reference: null,
    submittedAt: null,
    reporter: { name: '', phone: '', email: '', policy: '', policyholder: null },
    incident: {
      kind: 'collision',
      at: '2026-09-08T09:15',
      location: { lng: -73.9859, lat: 40.7573, address: 'Times Square, Manhattan, New York' },
      surface: 'satellite',
      conditions: { weather: '', road: '', light: '' },
      description: '',
    },
    // no make, so the card draws the 3D body rather than looking for a photograph
    vehicles: [
      {
        id: 'a',
        role: 'insured',
        body: 'sedan',
        color: '#b91c1c',
        make: '',
        model: '',
        year: null,
        plate: '',
        plateState: '',
        vin: '',
        owner: '',
        insurer: '',
        policy: '',
        condition: { drivable: null, airbags: null, towed: null, location: '' },
        position: null,
        heading: 0,
        path: [],
        damages: [],
      },
    ],
    people: [],
    impact: null,
    police: { called: null, department: '', report: '', citations: '' },
    property: { description: '', owner: '' },
    attestation: { agreed: false, name: '', at: null },
    attachments: { scene: null, damage: {}, photos: [] },
  }
  localStorage.setItem(
    'claim-marker/draft',
    JSON.stringify({ state: { claim, step: 'damage', impactManual: false, autoDamage: {}, policy: [], delivery: null }, version: 5 }),
  )
})

// ── take the server away ──────────────────────────────────────────────

killPreview()
preview = null
// belt and braces: emulated offline alone still lets the worker's own fetches through
await context.setOffline(true)
let answering = true
for (let i = 0; i < 60 && answering; i++) {
  answering = await fetch(origin).then(() => true).catch(() => false)
  if (answering) await new Promise((r) => setTimeout(r, 100))
}
if (answering) fail('the preview server is still answering; the test would prove nothing')

missed.length = 0
await page.reload({ timeout: 30000 }).catch(() => fail('the page did not load with no server and no network'))
await page
  .locator('text=Where is the damage?')
  .waitFor({ timeout: 20000 })
  .catch(() => fail(`the step did not render offline — ${missed.slice(0, 4).join(' | ') || 'nothing failed to load'}`))
const painted = await settled('.cm-root canvas')
ok(`offline: the page loaded with the server killed, the step rendered, and the 3D car drew (${painted} distinct colours)`)

const broke = missed.filter((m) => m.includes('/assets/') || m.includes('/hdr/') || m.includes('/tex/'))
if (broke.length) fail(`${broke.length} shell request(s) failed offline: ${broke.slice(0, 3).join(' | ')}`)
const shells = await page.evaluate(() => caches.keys().then((k) => k.filter((n) => n.startsWith('cm-shell-'))))
if (shells.length !== 1) fail(`expected one shell cache, found ${shells.length}: ${shells.join(', ')}`)
ok(`offline: nothing under /assets, /hdr or /tex went to the network, and there is exactly one shell cache (${shells[0]})`)

if (errors.length) fail(`page errors: ${errors.join(' | ')}`)
await browser.close()
console.log('\nall offline checks passed')
