import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../app.css'
import { applyConfig } from '../config'
import { Desk } from './Desk'

// the desk has no host page to talk to, but a server that serves it injects the brand
applyConfig((window as { CLAIM_MARKER?: unknown }).CLAIM_MARKER)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desk />
  </StrictMode>,
)
