import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import { config, loadConfig } from './config'
import { useClaim } from './claim/store'
import { flushOutbox } from './app/submit'
import { App } from './app/App'

// the configuration is settled before anything renders: a host page's prefill has to be in
// the store before the first step shows, and the brand before the header does
loadConfig().then(() => {
  if (config.prefill) useClaim.getState().prefill(config.prefill)
  const drain = () => flushOutbox((local, reference) => useClaim.getState().delivered(local, reference))
  drain()
  window.addEventListener('online', drain)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
