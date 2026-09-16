/**
 * The insurer's side: what has arrived, and each report as the document it was sent as —
 * the map with playback, the marked-up car, the photographs — read-only, printable, with a
 * status the desk can move along. It reads the reference server's API; a claims system with
 * its own inbox would render `ReportDocument` from wherever it keeps the JSON.
 */
import { useCallback, useEffect, useState } from 'react'
import { KIND_INFO, parseClaim, toDocument, type Claim } from '../claim/schema'
import { config } from '../config'
import { Icon } from '../app/icons'
import { ReportDocument } from '../app/ReportDocument'

/** the claims server: `?api=` for a desk pointed at another one, else the build-time default */
const API: string = new URLSearchParams(window.location.search).get('api') || (import.meta.env.VITE_CLAIMS_API as string | undefined) || 'http://localhost:8788'
const TOKEN_KEY = 'claim-marker/desk-token'

type Status = 'new' | 'reviewing' | 'closed'
const STATUSES: Status[] = ['new', 'reviewing', 'closed']
const STATUS_LABEL: Record<Status, string> = { new: 'New', reviewing: 'In review', closed: 'Closed' }
const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-brand-50 text-brand-700 ring-brand-200',
  reviewing: 'bg-amber-50 text-amber-800 ring-amber-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
}

type Receipt = {
  reference: string
  clientReference: string | null
  receivedAt: string
  status: Status
  files: Record<string, string>
  summary: { kind: Claim['incident']['kind']; at: string; address: string; reporter: string; vehicles: number; hurt: number; damaged: number; photos: number; drivable: boolean | null }
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 36) return `${h} h ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const StatusPill = ({ status }: { status: Status }) => (
  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
)

class Unauthorised extends Error {}

export function Desk() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [askToken, setAskToken] = useState(false)
  const [claims, setClaims] = useState<Receipt[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const [ref, setRef] = useState<string | null>(() => window.location.hash.replace(/^#\/?/, '') || null)
  const [open, setOpen] = useState<{ receipt: Receipt; claim: Claim } | null>(null)

  const api = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
      if (token) headers.authorization = `Bearer ${token}`
      const res = await fetch(API + path, { ...init, headers })
      if (res.status === 401) throw new Unauthorised('This desk needs a token.')
      if (!res.ok) throw new Error(`The claims server answered ${res.status}.`)
      return (await res.json()) as T
    },
    [token],
  )

  const fail = (e: unknown) => {
    if (e instanceof Unauthorised) setAskToken(true)
    else setError(e instanceof Error ? e.message : String(e))
  }

  // the inbox
  useEffect(() => {
    let live = true
    api<{ claims: Receipt[] }>('/claims')
      .then((r) => live && (setClaims(r.claims), setError(null), setAskToken(false)))
      .catch((e) => live && fail(e))
    return () => {
      live = false
    }
  }, [api])

  // the report in the hash
  useEffect(() => {
    const onHash = () => setRef(window.location.hash.replace(/^#\/?/, '') || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!ref) return
    let live = true
    api<Receipt & { claim: unknown }>(`/claims/${encodeURIComponent(ref)}`)
      .then(({ claim, ...receipt }) => live && setOpen({ receipt, claim: parseClaim(claim).value }))
      .catch((e) => live && fail(e))
    return () => {
      live = false
    }
  }, [ref, api])

  const show = (r: string | null) => {
    window.location.assign(r ? `#/${r}` : '#')
    if (!r) setOpen(null)
  }

  const setStatus = async (status: Status) => {
    if (!open) return
    try {
      const receipt = await api<Receipt>(`/claims/${encodeURIComponent(open.receipt.reference)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setOpen({ ...open, receipt })
      setClaims((list) => list?.map((c) => (c.reference === receipt.reference ? receipt : c)) ?? list)
    } catch (e) {
      fail(e)
    }
  }

  const download = () => {
    if (!open) return
    const a = document.createElement('a')
    a.download = `${open.receipt.reference}.json`
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(toDocument(open.claim), null, 2))
    a.click()
  }

  const rows = (claims ?? []).filter((c) => filter === 'all' || c.status === filter)
  const showing = open && open.receipt.reference === ref ? open : null

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200/70 bg-white/85 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
              <Icon.shield />
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">Claims desk</div>
              <div className="text-xs text-slate-500">{config.brand}</div>
            </div>
          </div>
          {claims && (
            <div className="text-xs text-slate-500">
              {claims.filter((c) => c.status === 'new').length} new · {claims.length} in all
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        {askToken && (
          <form
            className="card mx-auto mb-6 max-w-md p-6"
            onSubmit={(e) => {
              e.preventDefault()
              const t = (new FormData(e.currentTarget).get('token') as string).trim()
              sessionStorage.setItem(TOKEN_KEY, t)
              setToken(t)
            }}
          >
            <h2 className="font-semibold">This desk needs a token</h2>
            <p className="mt-1 text-sm text-slate-500">The one the claims server was started with as DESK_TOKEN. It is kept for this tab only.</p>
            <div className="mt-4 flex gap-2">
              <input className="input font-mono" name="token" placeholder="token" defaultValue={token} autoComplete="off" />
              <button className="btn btn-primary">Open</button>
            </div>
          </form>
        )}
        {error && (
          <p className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error} <span className="text-red-500">Is the claims server running at {API}?</span>
          </p>
        )}

        <div className={`grid gap-6 ${showing ? 'lg:grid-cols-[340px_minmax(0,1fr)]' : ''}`}>
          <aside className={`${showing ? 'hidden lg:block' : ''} print:hidden`}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(['all', ...STATUSES] as const).map((f) => (
                <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>
            {claims === null && !error && !askToken && <p className="text-sm text-slate-500">Loading…</p>}
            {claims !== null && rows.length === 0 && <p className="text-sm text-slate-500">Nothing here yet. A report sent from the page lands in this list.</p>}
            <ul className={`space-y-2 ${showing ? '' : 'grid gap-3 space-y-0 sm:grid-cols-2 lg:grid-cols-3'}`}>
              {rows.map((c) => {
                const on = c.reference === ref
                return (
                  <li key={c.reference}>
                    <button className={`card w-full p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${on ? 'ring-2 ring-brand-600' : ''}`} onClick={() => show(c.reference)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">{c.reference}</span>
                        <StatusPill status={c.status} />
                      </div>
                      <div className="mt-2 font-medium">{KIND_INFO[c.summary.kind]?.label ?? c.summary.kind}</div>
                      <div className="mt-0.5 truncate text-sm text-slate-500">{c.summary.address || 'No address'}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{c.summary.reporter || 'Name not given'}</span>
                        <span>· {ago(c.receivedAt)}</span>
                        {c.summary.hurt > 0 && <span className="font-semibold text-red-700">· {c.summary.hurt} hurt</span>}
                        {c.summary.drivable === false && <span className="font-semibold text-amber-700">· not drivable</span>}
                        {c.summary.photos > 0 && <span>· {c.summary.photos} photos</span>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {showing && (
            <section className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
                <button className="btn btn-ghost btn-sm lg:hidden" onClick={() => show(null)}>
                  <Icon.back /> All reports
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Received {new Date(showing.receipt.receivedAt).toLocaleString()}</span>
                  {showing.receipt.clientReference && <span className="text-xs text-slate-400">· customer's reference {showing.receipt.clientReference}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1" role="radiogroup" aria-label="Status">
                    {STATUSES.map((s) => (
                      <button key={s} className="chip" role="radio" aria-checked={showing.receipt.status === s} aria-pressed={showing.receipt.status === s} onClick={() => setStatus(s)}>
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>
                    <Icon.pen /> Print / save as PDF
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={download}>
                    <Icon.download /> JSON
                  </button>
                </div>
              </div>
              <ReportDocument claim={showing.claim} badge={<StatusPill status={showing.receipt.status} />} />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
