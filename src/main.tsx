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
import { App, LinkGone } from './app/App'
import { partyDraftFor } from './claim/seed'

/** the page's own language attribute, for a screen reader and for the browser's translate bar */
const markLang = (lang: Lang) => {
  if (document.documentElement.lang !== lang) document.documentElement.lang = lang
}

/**
 * The other driver arrived from a QR code held up at the scene. Their page starts from the
 * *seed* — where, when, the ground, and the shapes and colours of the cars — and from nothing
 * else: the first report is not theirs to read.
 *
 * Their draft is kept apart from any other on this phone, one per incident (see `draftName` in
 * the store), and seeded once: a reload, or coming back to finish it on the bus home, picks up
 * what they typed. Resolves false when the link cannot be opened — expired, forged, or the
 * server unreachable — because a blank report sent with a token nobody can renew would be
 * turned away however it was filled in; the page says so instead of offering the form.
 */
async function seedParty(): Promise<boolean> {
  if (!config.party) return true
  if (partyDraftFor(useClaim.getState().claim, config.party.incident)) return true
  const seed = await fetchSeed(config.party.incident, config.party.token)
  if (!seed) return false
  useClaim.getState().reset()
  useClaim.getState().seedFromIncident(config.party.incident, seed)
  return true
}

// the configuration is settled before anything renders: a host page's prefill has to be in
// the store before the first step shows, and the brand before the header does
loadConfig()
  .then(seedParty)
  .then((opened) => {
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
        {opened ? <App /> : <LinkGone />}
      </StrictMode>,
    )
  })
