/**
 * Reports that could not be sent, kept until they can be. A report is written at the
 * roadside, where there is often no signal; the customer should tap Send once and be done.
 * So a document that fails to leave is stored here — IndexedDB, because a document with its
 * photographs is several megabytes and localStorage's budget is five — and sent again when
 * the browser says it is back online, or the next time the page opens.
 *
 * Each document carries its own reference, which is also the idempotency key the server
 * sees, so a report that was in fact received but whose reply was lost is not filed twice.
 * The token it was to be sent with is kept beside it: the host page that minted it may not
 * be there when the queue drains.
 */
import type { Claim } from './schema'

const DB = 'claim-marker'
const STORE = 'outbox'

export type Queued = { reference: string; doc: Claim; token: string | null }

/** the server understood the request and said no; retrying is pointless */
export class Rejected extends Error {}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'reference' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const enqueue = (entry: Queued): Promise<unknown> => tx('readwrite', (s) => s.put(entry))
export const pending = (): Promise<Queued[]> => tx('readonly', (s) => s.getAll() as IDBRequest<Queued[]>)
const remove = (reference: string): Promise<unknown> => tx('readwrite', (s) => s.delete(reference))

let flushing = false

/**
 * Try every queued document once, in order. `send` resolves with the reference the server
 * gave, and `onSent` hears about each one so the page can show it. A document that still
 * cannot be sent stays, and the rest wait behind it; a document the server rejects outright
 * is dropped, because trying it again would only get the same answer.
 */
export async function flush(send: (entry: Queued) => Promise<string>, onSent: (local: string, reference: string) => void): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    for (const entry of await pending().catch(() => [] as Queued[])) {
      try {
        const reference = await send(entry)
        await remove(entry.reference)
        onSent(entry.reference, reference)
      } catch (e) {
        if (e instanceof Rejected) await remove(entry.reference)
        else return
      }
    }
  } finally {
    flushing = false
  }
}
