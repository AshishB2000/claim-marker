import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import { config, loadConfig } from './config'
import { pickLang, type Lang } from './i18n'
import { useClaim } from './claim/store'
import { flushOutbox } from './app/submit'
import { keepOffline } from './app/offline'
import { App } from './app/App'

/** the page's own language attribute, for a screen reader and for the browser's translate bar */
const markLang = (lang: Lang) => {
  if (document.documentElement.lang !== lang) document.documentElement.lang = lang
}

// the configuration is settled before anything renders: a host page's prefill has to be in
// the store before the first step shows, and the brand before the header does
loadConfig().then(() => {
  // the language, in order: the host fixed it, the customer chose it last time, the browser
  // asks for it, English. Settled here so the first frame is already in the right language.
  useClaim.getState().setLang(config.lang ?? useClaim.getState().lang ?? pickLang(null, navigator.languages ?? []))
  markLang(useClaim.getState().lang ?? 'en')
  useClaim.subscribe((s) => markLang(s.lang ?? 'en'))

  if (config.prefill) useClaim.getState().prefill(config.prefill)
  const drain = () => flushOutbox((local, reference) => useClaim.getState().delivered(local, reference))
  drain()
  window.addEventListener('online', drain)
  keepOffline(useClaim.getState().lang ?? 'en')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
