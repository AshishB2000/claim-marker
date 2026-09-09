import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // maplibre and three are each several hundred kB; that is the price of a real map and
    // real 3D, not something to be warned about on every build
    chunkSizeWarningLimit: 2500,
  },
})
