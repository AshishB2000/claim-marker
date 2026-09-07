import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

// match subpaths too, or `react-dom/client` and `react/jsx-runtime` get bundled whole
const bare = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)]
const isExternal = (id: string) => bare.some((name) => id === name || id.startsWith(`${name}/`))

/** `--mode lib` builds the npm package into dist/; the default build is the demo page. */
export default defineConfig(({ mode }) =>
  mode === 'lib'
    ? {
        plugins: [react()],
        build: {
          // lib mode always inlines assets, so the .glb rides along as a data URI. That is
          // what we want here: one self-contained file, no "remember to copy the model" step.
          lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'claim-marker' },
          rollupOptions: { external: isExternal },
        },
      }
    : {
        plugins: [react(), tailwindcss()],
        build: {
          outDir: 'dist-demo',
          // second page exercises the vanilla mount() entry point
          rollupOptions: { input: { main: 'index.html', vanilla: 'demo/vanilla.html' } },
        },
      },
)
