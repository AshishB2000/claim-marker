/**
 * The offline shell.
 *
 * A report is filled in at the roadside, which is exactly where the signal goes. The outbox
 * already covers a report that cannot be *sent* — but only for a page that had already
 * loaded. This covers the other half: the page itself, the map library, the seven car bodies,
 * the environment map and the textures live on the device, so the whole flow works with the
 * phone in flight mode and the report leaves when the signal comes back.
 *
 * Hand-written, and a plugin in `vite.config.ts` patches `__PRECACHE__` and `__VERSION__` at
 * build time. `vite-plugin-pwa` would generate roughly this file plus a manifest plus a
 * registration helper plus a config surface, and the whole thing here is sixty lines whose
 * every rule is a decision worth reading.
 *
 * **No `skipWaiting`.** An open page may still ask for a lazily-loaded chunk from the build it
 * was served by; a new worker that took over immediately would have deleted that build's cache
 * and the chunk would 404 mid-claim. The new shell takes over when the last old tab closes,
 * which for a form someone is filling in is the right trade.
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL = `cm-shell-${VERSION}`
const RUNTIME = 'cm-runtime'
/** map tiles are small and endless; this is a few hundred tiles, not a map of the country */
const RUNTIME_MAX = 400
/** the providers the page reads from: tiles, the geocoder, the vehicle database, the photos */
const RUNTIME_HOSTS = ['server.arcgisonline.com', 'photon.komoot.io', 'vpic.nhtsa.dot.gov', 'en.wikipedia.org', 'upload.wikimedia.org']

const paths = new Set(PRECACHE)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cm-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // a POST of a claim is the outbox's business, not this file's
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // the page itself: the network first so a deploy is picked up, the shell when there is none.
  // The claims desk is deliberately not offline — an adjuster with no signal has no claims either
  if (req.mode === 'navigate') {
    if (url.origin !== self.location.origin || url.pathname.startsWith('/adjuster')) return
    event.respondWith(fetch(req).catch(() => caches.match('/index.html', { cacheName: SHELL, ignoreVary: true })))
    return
  }

  if (url.origin === self.location.origin && paths.has(url.pathname)) {
    // hashed forever, or listed in this build: the copy on the device is the right one.
    // Matched by path, not by the request: a reload marks its subresources `cache: 'reload'`
    // and `Cache.match` then answers nothing at all for them, which is a blank page offline
    event.respondWith(caches.match(url.pathname, { cacheName: SHELL, ignoreVary: true }).then((hit) => hit || fetch(req)))
    return
  }

  if (RUNTIME_HOSTS.includes(url.host)) event.respondWith(fresh(req))
  // everything else — /claims, /sessions, the assist endpoint — is none of our business
})

/** what is on the device now, with a fresh copy fetched behind it for next time */
async function fresh(req) {
  const cache = await caches.open(RUNTIME)
  const hit = await cache.match(req)
  const network = fetch(req)
    .then(async (res) => {
      // an opaque response cannot be read and costs ~7 MB of quota each; not worth keeping
      if (res.ok && res.type !== 'opaque') {
        await cache.put(req, res.clone())
        await trim(cache)
      }
      return res
    })
    .catch(() => null)
  return hit || (await network) || Response.error()
}

async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - RUNTIME_MAX; i++) await cache.delete(keys[i])
}
