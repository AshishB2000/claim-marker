/**
 * How the page is configured at runtime, and how it talks to the page that embeds it.
 *
 * An insurer does not rebuild a Vite app to change a URL. So the settings that differ per
 * deployment arrive at runtime, in this order of precedence:
 *
 *   1. a `config` message from the host page, when this page is in an iframe the host
 *      controls (`public/embed.js` sends it as soon as the page says it is ready);
 *   2. `window.CLAIM_MARKER`, a global set by a `<script>` before the bundle on a hosted page;
 *   3. `?token=` in the URL — the one thing that may travel there, because it is short-lived;
 *   4. the `VITE_*` build-time defaults.
 *
 * Provider settings — tile URLs, the geocoder, the vehicle database — stay build-time: they
 * are chosen once per deployment, not per customer.
 *
 * Messages are a trust boundary. Config is accepted only from origins in
 * `VITE_ALLOWED_HOSTS` (comma-separated), or in `window.CLAIM_MARKER.allowedHosts` when the
 * server serving the page set it; unset, any origin is accepted and a warning says so, which
 * suits development and nothing else. Everything that arrives is parsed, never trusted, and
 * events go back only to the origin the config came from.
 */
import { isLang, type Lang } from './i18n'
import { parsePrefill, type Prefill } from './claim/prefill'

export type Config = {
  /** where the finished document is POSTed; null behaves as if it had been sent */
  submitUrl: string | null
  /** sent as a bearer token with the document, so the insurer knows whose report this is */
  token: string | null
  brand: string
  fraudNotice: string
  /** an endpoint speaking `claim-assist/1`; null means no AI exists in the page */
  assistUrl: string | null
  /**
   * the language the host fixed the page to; null leaves the choice to the customer. Set, it
   * also hides the switch: an insurer that serves a Spanish page did not mean "Spanish first".
   */
  lang: Lang | null
  prefill: Prefill | null
  /** include the whole document in the `submitted` event to the host, not just the reference */
  returnDocument: boolean
  /**
   * The other driver's way in: `?party=<token>` off the QR code the customer showed at the
   * scene. **From the URL only** — never from `window.CLAIM_MARKER` and never from a host
   * page's config message, because a host that could name a party token could read an
   * accident that is not theirs.
   */
  party: { token: string; incident: string } | null
  /** true inside an iframe whose host page has claimed it */
  embedded: boolean
  /** the origin events are posted to; null when not embedded */
  hostOrigin: string | null
}

const env = import.meta.env
const DEFAULT_FRAUD_NOTICE =
  'Any person who knowingly and with intent to defraud any insurance company or other person files a statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material thereto, commits a fraudulent insurance act, which is a crime and subjects such person to criminal and civil penalties.'
/**
 * The same warning so a Spanish reader can read it, and nothing more than that: it is a
 * plain-language translation, **not legal text**. Fraud warnings are mandated per state, in
 * wording the state sets, and several states mandate a Spanish one of their own. An insurer
 * deploying this supplies its own through `fraudNotice`; this is what stands until it does.
 */
const DEFAULT_FRAUD_NOTICE_ES =
  'Toda persona que, a sabiendas y con la intención de defraudar a una compañía de seguros o a otra persona, presente una declaración de reclamo con información falsa sobre un punto importante, u oculte información sobre un hecho importante para engañar, comete un acto fraudulento de seguros, que es un delito y expone a esa persona a sanciones penales y civiles.'
/** the wording the deployment supplied, if it supplied one; null means the defaults above stand */
let suppliedFraudNotice: string | null = (env.VITE_FRAUD_NOTICE as string | undefined) || null

export const config: Config = {
  submitUrl: (env.VITE_SUBMIT_URL as string | undefined) || null,
  token: null,
  brand: (env.VITE_BRAND as string | undefined) || 'claim-marker',
  fraudNotice: suppliedFraudNotice || DEFAULT_FRAUD_NOTICE,
  assistUrl: (env.VITE_ASSIST_URL as string | undefined) || null,
  lang: null,
  prefill: null,
  party: null,
  returnDocument: false,
  embedded: false,
  hostOrigin: null,
}

/** the fraud warning to show: the insurer's own whatever the language, else the default for it */
export const fraudNoticeFor = (lang: Lang): string =>
  suppliedFraudNotice ?? (lang === 'es' ? DEFAULT_FRAUD_NOTICE_ES : DEFAULT_FRAUD_NOTICE)

const ENV_ALLOWED: string[] = ((env.VITE_ALLOWED_HOSTS as string | undefined) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/**
 * Who may configure this page: the build-time list, or — for a server that serves the page
 * and injects its own settings — `window.CLAIM_MARKER.allowedHosts`. From the global only,
 * never from a `config` message, or a host page could widen its own permission.
 */
const allowedHosts = (): string[] => {
  if (ENV_ALLOWED.length) return ENV_ALLOWED
  const injected = (window as { CLAIM_MARKER?: { allowedHosts?: unknown } }).CLAIM_MARKER?.allowedHosts
  return Array.isArray(injected) ? injected.filter((h): h is string => typeof h === 'string' && !!h.trim()) : []
}

/**
 * The incident id inside a party token, or null. The token is `base64url(payload).base64url(mac)`
 * and the payload's `sub` is `party:<INC-…>`; this reads it without checking the signature,
 * because the page has no secret and the server checks it on every call anyway. It is used for
 * knowing which incident to ask about, and for knowing that a refusal of this token is final.
 */
export function partyIncident(token: string): string | null {
  const body = token.split('.')[0]
  if (!body) return null
  try {
    const sub = (JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown }).sub
    const m = typeof sub === 'string' ? /^party:(INC-[A-Z0-9-]{4,32})$/.exec(sub) : null
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * The other driver's token and incident from a page URL's query string, or null. The one place
 * `party` is read from — `loadConfig` for `config.party`, and the store, which has to know before
 * any config is loaded which draft to open (the other driver's is kept apart from the customer's).
 */
export function partyFromUrl(search: string): Config['party'] {
  const token = new URLSearchParams(search).get('party')
  const incident = token && partyIncident(token)
  return token && incident ? { token, incident } : null
}

/** the incidents endpoints, wherever the reports are posted; null when nothing takes reports */
export const incidentUrl = (path: string): string | null => {
  if (!config.submitUrl) return null
  try {
    return new URL(path.replace(/^\//, ''), new URL('./', config.submitUrl)).href
  } catch {
    return null
  }
}

/** the tag on every message in either direction, so unrelated messages on the page are ignored */
export const CHANNEL = 'claim-marker'
/** how long an embedded page waits for its host before starting with the defaults */
const HOST_WAIT = 1500

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
/**
 * A submit or assist URL. Absolute, or relative to this page — a server that serves the page
 * and takes the reports says `/claims` and means its own origin. Resolved either way, and
 * http(s) either way, so `javascript:` and `data:` are dropped.
 */
const url = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  try {
    const u = new URL(s, window.location.href)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** read a config object from any of the sources; unknown keys are ignored, bad values dropped */
export function applyConfig(input: unknown): void {
  if (typeof input !== 'object' || input === null) return
  const c = input as Record<string, unknown>
  if ('submitUrl' in c) config.submitUrl = url(c.submitUrl)
  if ('assistUrl' in c) config.assistUrl = url(c.assistUrl)
  if ('token' in c) config.token = str(c.token)
  if (str(c.brand)) config.brand = str(c.brand)!.slice(0, 80)
  if (str(c.fraudNotice)) config.fraudNotice = suppliedFraudNotice = str(c.fraudNotice)!.slice(0, 4000)
  // a language this page does not speak is no language at all: the customer chooses instead
  if ('lang' in c) config.lang = isLang(c.lang) ? c.lang : null
  if ('returnDocument' in c) config.returnDocument = c.returnDocument === true
  if ('prefill' in c) {
    const p = parsePrefill(c.prefill)
    config.prefill = Object.keys(p).length ? p : null
  }
}

const originAllowed = (origin: string) => {
  // a page on this very origin can already reach into this one directly, so a config message
  // from it grants nothing new — and it is how the demo portal at /demo embeds this page
  if (origin === window.location.origin) return true
  const allowed = allowedHosts()
  if (allowed.length === 0) {
    console.warn(`claim-marker: accepting config from ${origin}; set VITE_ALLOWED_HOSTS in production`)
    return true
  }
  return allowed.includes(origin)
}

/**
 * Settle the configuration before the first render: the globals and the URL at once, and,
 * inside an iframe, the host's config message or a short wait for one.
 */
export function loadConfig(): Promise<Config> {
  applyConfig((window as { CLAIM_MARKER?: unknown }).CLAIM_MARKER)
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (token) config.token = token
  // the other driver arrives with one of these and nothing else; it is both who they are and
  // which accident they are answering about
  const party = partyFromUrl(window.location.search)
  if (party) {
    config.party = party
    config.token = party.token
  }
  if (window.parent === window) return Promise.resolve(config)

  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      resolve(config)
    }
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { source?: unknown; type?: unknown; config?: unknown } | null
      if (!m || m.source !== `${CHANNEL}-host` || m.type !== 'config') return
      if (!originAllowed(e.origin)) return
      config.embedded = true
      config.hostOrigin = e.origin
      applyConfig(m.config)
      finish()
    }
    // the host keeps listening: a config that arrives late, or a second one, still applies
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(finish, HOST_WAIT)
    window.parent.postMessage({ source: CHANNEL, type: 'ready' }, '*')
  })
}

/** tell the host page something happened; a no-op when there is no host */
export function tell(type: string, detail: Record<string, unknown> = {}): void {
  if (!config.embedded || !config.hostOrigin) return
  window.parent.postMessage({ source: CHANNEL, type, ...detail }, config.hostOrigin)
}
