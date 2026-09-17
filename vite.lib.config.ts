import { defineConfig, type Plugin } from 'vite'
import { en, es } from './src/i18n/messages.ts'

/**
 * Both dictionaries as plain JSON beside the parser, so anything outside the bundle can read
 * the page's own words without importing TypeScript: the smoke scripts drive the page in
 * either language by looking a key up here rather than hard-coding a translated sentence.
 *
 * It lands in `dist/lib/`, which the server refuses to serve and the offline shell's precache
 * never sees — that list is built from the site bundle, and this is not in it.
 */
function messages(): Plugin {
  return {
    name: 'claim-marker:messages',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'messages.json', source: JSON.stringify({ en, es }, null, 2) })
    },
  }
}

/**
 * The document parser as a plain ES module, so `server/claim-server.mjs` validates with the
 * same code the page exports with. `npm run build` produces it into dist/lib/.
 */
export default defineConfig({
  // public/ belongs to the site build; without this it is copied into dist/lib/ as well
  publicDir: false,
  plugins: [messages()],
  build: {
    lib: { entry: 'src/claim/schema.ts', formats: ['es'], fileName: () => 'claim.js' },
    outDir: 'dist/lib',
    emptyOutDir: false,
    minify: false,
    target: 'node20',
    sourcemap: false,
  },
})
