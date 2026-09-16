import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../app.css'
import { Desk } from './Desk'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desk />
  </StrictMode>,
)
