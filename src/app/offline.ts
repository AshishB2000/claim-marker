/**
 * Putting the shell on the device.
 *
 * Production builds only: in development the worker would serve a stale bundle and there is
 * nothing to patch its precache list with. Registration failing is not an error the customer
 * should ever see — Safari refuses service workers in cross-site iframes, so the embedded
 * case simply degrades to the behaviour it had before this existed.
 */
import { translate, type Lang } from '../i18n'

const SHOWN_FOR = 5000

/** the language is settled before this is called, and passed in: no store, no React, no hooks */
export function keepOffline(lang: Lang): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // no controller means no worker has ever run for this origin: this load is the one that
  // installs the shell, and the only one worth saying anything about
  const first = !navigator.serviceWorker.controller
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => first && toast(lang))
    .catch(() => {})
}

/** plain DOM: this runs before React has anything on the page, and outlives a step change */
function toast(lang: Lang) {
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.textContent = translate(lang, 'shell.offline.ready')
  el.style.cssText =
    'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:60;max-width:calc(100vw - 32px);' +
    'padding:10px 16px;border-radius:12px;background:#0f172a;color:#fff;font:500 13px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 8px 24px -8px rgba(15,23,42,.6);text-align:center'
  document.body.appendChild(el)
  setTimeout(() => el.remove(), SHOWN_FOR)
}
