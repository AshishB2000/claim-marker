/**
 * The PNG icons a web app manifest wants, rendered once from `public/icon.svg`.
 *
 *   node scripts/icons.mjs
 *
 * A one-off: the PNGs are committed, and this only needs running when the mark changes. It
 * uses the Playwright that is already here to rasterise, rather than adding an image library
 * for two files.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const svg = readFileSync(`${root}public/icon.svg`, 'utf8')

const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  const png = await page.locator('svg').screenshot({ omitBackground: true })
  writeFileSync(`${root}public/icons/icon-${size}.png`, png)
  console.log(`icon-${size}.png — ${png.length} bytes`)
  await page.close()
}
await browser.close()
