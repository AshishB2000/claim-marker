import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const OUT = 'dist'

/** everything under a folder in `public/`, as the paths the browser will ask for */
function under(dir: string): string[] {
  if (!existsSync(join('public', dir))) return []
  return readdirSync(join('public', dir)).flatMap((name) => {
    const rel = `${dir}/${name}`
    return statSync(join('public', rel)).isDirectory() ? under(rel) : [`/${rel}`]
  })
}

/**
 * The offline shell's precache list, written into `dist/sw.js` at build time.
 *
 * The list cannot be hand-maintained: the asset names are content hashes and change on every
 * build. `generateBundle` sees exactly what rollup emitted — minus the claims desk, which is
 * the insurer's screen and has no business on a claimant's phone — and `closeBundle` adds the
 * files Vite copies straight from `public/`, which rollup never sees. The version is a hash of
 * the finished list, so a build that changed nothing keeps its caches.
 *
 * Vite copies `public/` before rollup writes the bundle, so `dist/sw.js` is already there to
 * be patched in place.
 */
function offlineShell(): Plugin {
  let emitted: string[] = []
  return {
    name: 'claim-marker:offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      emitted = Object.keys(bundle).filter((name) => name !== 'adjuster.html' && !/(^|\/)adjuster-[-\w]+\.js$/.test(name))
    },
    closeBundle() {
      const sw = join(OUT, 'sw.js')
      if (!existsSync(sw)) return
      const precache = [
        // the page itself, under both the names a browser asks for it by. Vite emits the HTML
        // after this plugin's generateBundle, so it is named here rather than found in the bundle
        '/',
        '/index.html',
        ...emitted.map((name) => `/${name}`),
        // copied from public/: the environment map, the tyre and flake normals, the icons
        ...under('hdr'),
        ...under('tex'),
        ...under('icons'),
        '/manifest.webmanifest',
        '/icon.svg',
      ].filter((path, i, all) => all.indexOf(path) === i && existsSync(join(OUT, path === '/' ? 'index.html' : path.slice(1))))
      const version = createHash('sha1').update(precache.join('\n')).digest('hex').slice(0, 12)
      // the two declarations by name, not the bare tokens: those also appear in the file's own
      // doc comment, and replacing the first occurrence there ships a worker that does nothing
      let src = readFileSync(sw, 'utf8')
      for (const [from, to] of [
        ['const PRECACHE = __PRECACHE__', `const PRECACHE = ${JSON.stringify(precache)}`],
        ["const VERSION = '__VERSION__'", `const VERSION = '${version}'`],
      ]) {
        if (!src.includes(from)) throw new Error(`offline shell: public/sw.js no longer declares \`${from}\``)
        src = src.replace(from, to)
      }
      writeFileSync(sw, src)
      this.info?.(`offline shell ${version}: ${precache.length} files`)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), offlineShell()],
  build: {
    outDir: OUT,
    // two pages: the customer's, and the claims desk the insurer's side opens
    rollupOptions: { input: { main: 'index.html', adjuster: 'adjuster.html' } },
    // maplibre and three are each several hundred kB; that is the price of a real map and
    // real 3D, not something to be warned about on every build
    chunkSizeWarningLimit: 2500,
  },
})
