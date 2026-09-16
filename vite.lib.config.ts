import { defineConfig } from 'vite'

/**
 * The document parser as a plain ES module, so `server/claim-server.mjs` validates with the
 * same code the page exports with. `npm run build` produces it into dist/lib/.
 */
export default defineConfig({
  // public/ belongs to the site build; without this it is copied into dist/lib/ as well
  publicDir: false,
  build: {
    lib: { entry: 'src/claim/schema.ts', formats: ['es'], fileName: () => 'claim.js' },
    outDir: 'dist/lib',
    emptyOutDir: false,
    minify: false,
    target: 'node20',
    sourcemap: false,
  },
})
