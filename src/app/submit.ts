/**
 * Handing the finished document to the insurer.
 *
 * One POST of `claim/1` JSON to `submitUrl`, with the customer's token as a bearer and the
 * document's reference as an idempotency key. The server may answer with its own claim
 * number, which then replaces the page's; an empty reply is fine too. A server that is down
 * or a phone with no signal does not lose the report: after a few tries it goes into the
 * outbox and leaves when it can. Only a server that understood the request and refused it
 * (a 4xx other than "too busy") is an error the customer sees.
 *
 * Without a `submitUrl` the page behaves as if it had sent, so the flow can be tried before
 * anything is wired up. Either way the host page hears `submitted` and the window gets a
 * `claim:submitted` event with the document, for a page that would rather listen.
 */
import { config, tell } from '../config'
import { Rejected, enqueue, flush, type Queued } from '../claim/outbox'
import type { Claim } from '../claim/schema'

export type Delivery = 'sent' | 'queued'
export type Sent = { reference: string; delivery: Delivery }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** waits between tries: a blip, a stall, a real outage */
const BACKOFF = [1000, 3000, 8000]

export type DeliverOptions = {
  url: string
  token: string | null
  fetch?: typeof fetch
  wait?: (ms: number) => Promise<void>
  /** total tries, at least one */
  attempts?: number
}

/**
 * POST the document until it lands or the tries run out. Resolves with the reference the
 * server assigned, or the document's own when it assigned none. Throws `Rejected` when the
 * server refused it, and a plain error when it could not be reached.
 */
export async function deliver(doc: Claim, opts: DeliverOptions): Promise<string> {
  const doFetch = opts.fetch ?? fetch
  const wait = opts.wait ?? sleep
  const attempts = Math.max(1, opts.attempts ?? BACKOFF.length + 1)
  const headers: Record<string, string> = { 'content-type': 'application/json', 'idempotency-key': doc.reference ?? '' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const body = JSON.stringify(doc)

  let last: Error = new Error('We could not send your report.')
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await wait(BACKOFF[Math.min(i - 1, BACKOFF.length - 1)])
    let res: Response
    try {
      res = await doFetch(opts.url, { method: 'POST', headers, body })
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e))
      continue
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { reference?: unknown } | null
      return typeof json?.reference === 'string' && json.reference.trim() ? json.reference.trim() : (doc.reference ?? '')
    }
    // 408 and 429 are the server asking for patience; 401 and 403 may clear when the host renews the token
    if (res.status >= 400 && res.status < 500 && ![401, 403, 408, 429].includes(res.status)) {
      throw new Rejected(`We could not send your report (${res.status}). Please check it over and try again.`)
    }
    last = new Error(`We could not send your report (${res.status}).`)
  }
  throw last
}

const announce = (doc: Claim, reference: string) => {
  window.dispatchEvent(new CustomEvent('claim:submitted', { detail: { ...doc, reference } }))
  tell('submitted', { reference, ...(config.returnDocument ? { document: { ...doc, reference } } : {}) })
}

/** send now, or keep it for when we can; the customer is done either way */
export async function submitClaim(doc: Claim): Promise<Sent> {
  const local = doc.reference ?? ''
  if (!config.submitUrl) {
    await sleep(900)
    announce(doc, local)
    return { reference: local, delivery: 'sent' }
  }
  try {
    const reference = await deliver(doc, { url: config.submitUrl, token: config.token })
    announce(doc, reference)
    return { reference, delivery: 'sent' }
  } catch (e) {
    if (e instanceof Rejected) throw e
    await enqueue({ reference: local, doc, token: config.token })
    tell('queued', { reference: local })
    return { reference: local, delivery: 'queued' }
  }
}

/** drain the outbox: on load, and whenever the browser comes back online */
export function flushOutbox(onSent: (local: string, reference: string) => void): Promise<void> {
  if (!config.submitUrl) return Promise.resolve()
  const url = config.submitUrl
  return flush(
    (entry: Queued) =>
      deliver(entry.doc, { url, token: entry.token ?? config.token }).then((reference) => {
        announce(entry.doc, reference)
        return reference
      }),
    onSent,
  )
}
