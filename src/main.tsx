import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import { config, loadConfig } from './config'
import { pickLang, type Lang } from './i18n'
import { useClaim } from './claim/store'
import { flushOutbox } from './app/submit'
import { fetchSeed } from './app/incidents'
import { keepOffline } from './app/offline'
import { App } from './app/App'

/** the page's own language attribute, for a screen reader and for the browser's translate bar */
const markLang = (lang: Lang) => {
  if (document.documentElement.lang !== lang) document.documentElement.lang = lang
}

/**
 * The other driver arrived from a QR code held up at the scene. Their page starts from the
 * *seed* — where, when, the ground, and the shapes and colours of the cars — and from nothing
 * else: the first report is not theirs to read.
 *
 * Seeded once per incident. A reload, or coming back to finish it on the bus home, must not
 * throw away what they have typed; and arriving at a *different* incident starts clean rather
 * than inheriting a half-written report about another accident.
 */
async function seedParty(): Promise<void> {
  if (!config.party) return
  const store = useClaim.getState()
  if (store.claim.incident.shared === config.party.incident) return
  const seed = await fetchSeed(config.party.incident, config.party.token)
  // a seed that will not load leaves an ordinary blank report, which is still a report
  if (!seed) return
  store.reset()
  useClaim.getState().seedFromIncident(config.party.incident, seed)
}

// the configuration is settled before anything renders: a host page's prefill has to be in
// the store before the first step shows, and the brand before the header does
loadConfig()
  .then(seedParty)
  .then(() => {
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
