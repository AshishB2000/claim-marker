/**
 * The README's twenty seconds: the demo portal's whole journey, recorded once.
 *
 *   npm run build
 *   node scripts/record-demo.mjs        # → docs/demo.gif
 *
 * It starts its own claim server with `DEMO=1` on a free port, drives the portal the way a
 * prospect would — sign in, report the accident, get the claim number, open the desk — with
 * Playwright's video recording, then hands the webm to ffmpeg, sped up and palette-mapped, and
 * throws the reports away. Without ffmpeg it leaves `docs/demo.webm` and says so.
 *
 * A one-off: run it when the journey changes, commit what comes out.
 */
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  server?.kill()
  process.exit(1)
}
let server = null
if (!existsSync(join(root, 'dist/lib/claim.js'))) fail('dist/lib/claim.js is missing: run `npm run build` first')

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const PORT = await freePort()
const API = `http://localhost:${PORT}`
const dir = await mkdtemp(join(tmpdir(), 'claim-marker-demo-'))
const videos = await mkdtemp(join(tmpdir(), 'claim-marker-video-'))

server = spawn(process.execPath, ['server/claim-server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), CLAIM_DIR: dir, SESSION_SECRET: 'recording-secret', DESK_TOKEN: 'recording-desk', DEMO: '1', BRAND: 'Acme Mutual' },
  stdio: ['ignore', 'ignore', 'inherit'],
})
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${API}/health`)).ok) break
  } catch {
    await new Promise((r) => setTimeout(r, 100))
  }
}

const browser = await chromium.launch()
const size = { width: 1120, height: 760 }
const context = await browser.newContext({ viewport: size, recordVideo: { dir: videos, size } })
const page = await context.newPage()
// long enough to read, short enough that the sped-up GIF still moves
const beat = (ms = 900) => page.waitForTimeout(ms)
/**
 * The embedded page is as tall as the step it is showing, so clicking Continue leaves the
 * outer window scrolled to wherever the button was. Put the top of the report back at the top
 * of the frame, which is where each step starts.
 */
const top = () => page.evaluate(() => (document.querySelector('iframe') ?? document.documentElement).scrollIntoView({ block: 'start' }))

await page.goto(`${API}/demo/`)
await beat(1600)
await page.getByRole('button', { name: /Alex Rivera/ }).click()
await page.waitForURL(/policy\.html$/)
const report = page.frameLocator('iframe')
await report.locator('text=Acme Mutual').first().waitFor({ timeout: 20000 })
await beat(1600)

const go = async () => {
  await report.getByRole('button', { name: /^Continue/ }).click()
  await top()
  await beat()
}
await go()
await report.getByRole('combobox', { name: 'Where did it happen?' }).fill('Times Square, New York')
await report.getByRole('option').first().waitFor({ timeout: 20000 })
await report.getByRole('option').first().click()
await report.locator('text=Drag the pin on the map').waitFor({ timeout: 15000 })
await top()
await beat(2500)
await go()
await report.getByRole('radiogroup', { name: 'Which of your vehicles' }).getByRole('radio').first().click()
await top()
await beat(2500)
await go()
await beat(1200)
await go()
await report.locator('.mk-car').first().waitFor({ timeout: 30000 })
// the map and the 3D car change the page's height as they arrive, and the iframe follows
await beat(1200)
await top()
await beat(3000)
await go()
await report.locator('.cm-root canvas').waitFor({ timeout: 30000 })
await beat(1200)
await top()
await beat(3000)
await go()
await report.getByRole('checkbox', { name: 'I confirm this report is true' }).check()
await report.getByRole('textbox', { name: 'Signature' }).fill('Alex Rivera')
await beat(1200)
await top()
await report.getByRole('button', { name: 'Send my report' }).click()
await page.waitForURL(/claims\.html#/, { timeout: 60000 })
await beat(2500)
await page.getByRole('link', { name: 'Open the claims desk' }).click()
await page.locator('text=Reported by').waitFor({ timeout: 20000 })
await beat(3000)

const video = page.video()
await context.close()
await browser.close()
server.kill()
const webm = await video.path()

// ── the GIF ──────────────────────────────────────────────────────────

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const out = join(root, 'docs', ffmpeg ? 'demo.gif' : 'demo.webm')
if (!ffmpeg) {
  await copyFile(webm, out)
  console.log(`no ffmpeg: left the recording at ${out} as webm`)
} else {
  // sped up so the whole journey fits in about twenty seconds, and a palette per clip because
  // a 256-colour GIF of a satellite map without one is mud
  const filters = 'setpts=PTS/3.5,fps=8,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3'
  const run = spawnSync('ffmpeg', ['-y', '-i', webm, '-filter_complex', filters, '-loop', '0', out], { stdio: 'inherit' })
  if (run.status !== 0) fail('ffmpeg could not make the gif')
  console.log(`wrote ${out}`)
}

await rm(dir, { recursive: true, force: true })
await rm(videos, { recursive: true, force: true })
