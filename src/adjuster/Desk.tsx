/**
 * The insurer's side: what has arrived, and each report as the document it was sent as —
 * the map with playback, the marked-up car, the photographs — read-only, printable, with a
 * status the desk can move along. It reads the reference server's API; a claims system with
 * its own inbox would render `ReportDocument` from wherever it keeps the JSON.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { KIND_INFO, parseClaim, toDocument, type Claim, type Party } from '../claim/schema'
import { findings, type Finding } from '../claim/plausibility'
import { deskVoice, vehicleOf, type Voice } from '../claim/describe'
import { config } from '../config'
import { Icon } from '../app/icons'
import { ReportDocument } from '../app/ReportDocument'
import { Compare } from './Compare'
import { inboxRows } from './inbox'
import { lightingFor, type Lighting } from '../scene/lighting'
import { Reconstruction } from '../marker/Reconstruction'
import { usePlayback } from '../map/usePlayback'

/**
 * The claims server: `?api=` for a desk pointed at another one, then the build-time default,
 * then whatever the server serving this page injected — where an empty string means "the
 * same origin", which is the whole-product deployment and why this is not a plain `||` chain.
 */
const INJECTED = (window as { CLAIM_MARKER?: { claimsApi?: unknown } }).CLAIM_MARKER?.claimsApi
const API: string =
  new URLSearchParams(window.location.search).get('api') ||
  (import.meta.env.VITE_CLAIMS_API as string | undefined) ||
  (typeof INJECTED === 'string' ? INJECTED : 'http://localhost:8788')
const TOKEN_KEY = 'claim-marker/desk-token'

type Status = 'new' | 'reviewing' | 'closed'
const STATUSES: Status[] = ['new', 'reviewing', 'closed']
const STATUS_LABEL: Record<Status, string> = { new: 'New', reviewing: 'In review', closed: 'Closed' }
const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-brand-50 text-brand-700 ring-brand-200',
  reviewing: 'bg-amber-50 text-amber-800 ring-amber-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
}

/**
 * Something the server noticed about this report against everything filed before it: the same
 * photograph, the same VIN or plate under another customer, a great many reports from one
 * person. The insurer's own record — it rides on the receipt and is not part of `claim/1`.
 */
type Signal = { code: string; with: string | null; detail: string }

export type Receipt = {
  reference: string
  clientReference: string | null
  receivedAt: string
  status: Status
  files: Record<string, string>
  signals?: Signal[]
  /** the id two reports of one accident share, when the other driver was invited to add theirs */
  incident?: string
  /** which side of the accident this report is, when it carries an `incident` — set by the server from the token it was sent with, not from the document */
  party?: Party
  summary: {
    kind: Claim['incident']['kind']
    at: string
    address: string
    reporter: string
    vehicles: number
    /** the plates on the report, so the desk can find it the way a caller names it */
    plates?: string[]
    hurt: number
    damaged: number
    photos: number
    drivable: boolean | null
  }
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 36) return `${h} h ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** what the server's codes mean, in the words an adjuster would use */
const SIGNAL_LABEL: Record<string, string> = {
  photo_seen_before: 'A photograph on this report has been filed before',
  vin_seen_before: 'This VIN has been filed under a different customer',
  plate_seen_before: 'This plate has been filed under a different customer',
  frequent_reporter: 'This customer has filed several reports recently',
}

/**
 * What an adjuster should know before they start reading — the geometry of the diagram checked
 * against itself, and what the server has seen before. **Desk only.** None of it is shown to
 * the customer, none of it blocks anything, and none of it says what any of it means: a panel
 * on the wrong side is very often somebody mis-remembering a bad afternoon.
 */
function WorthALook({ claim, signals, onOpen }: { claim: Claim; signals: Signal[]; onOpen: (reference: string) => void }) {
  const found: Finding[] = findings(claim)
  if (found.length === 0 && signals.length === 0) {
    return (
      <div className="card mb-4 flex items-center gap-2 px-6 py-3 text-sm text-slate-500">
        <Icon.check /> Nothing stands out in the diagram or the photographs.
      </div>
    )
  }
  return (
    <div data-worth-a-look className="card mb-4 px-6 py-5">
      <h3 className="eyebrow">Worth a look</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {found.map((f) => (
          <li key={`${f.code}:${f.text}`} className="flex items-start gap-2.5">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${f.level === 'look' ? 'bg-amber-500' : 'bg-slate-300'}`} />
            <span>
              {f.text} <span className="text-slate-500">{f.evidence}</span>
            </span>
          </li>
        ))}
        {signals.map((sig) => (
          <li key={`${sig.code}:${sig.with}`} className="flex items-start gap-2.5">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
            <span>
              {SIGNAL_LABEL[sig.code] ?? sig.code}
              {sig.with && (
                <>
                  {' — '}
                  <button className="font-mono underline underline-offset-2" onClick={() => onOpen(sig.with!)}>
                    {sig.with}
                  </button>
                </>
              )}{' '}
              <span className="text-slate-500">{sig.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const StatusPill = ({ status }: { status: Status }) => (
  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
)

/**
 * The accident in 3D, for the desk: the cars where the diagram put them, with their real damage,
 * orbitable; "Play" drives them in on the same `posesAt` clock as the map's playback, and the
 * scrubber holds any moment of it. A scrub stops the frame loop where it lands (`seek`), so the
 * button offers Play again rather than a Stop that has nothing running to stop.
 */
function ReconstructionView({ claim, voice, lighting }: { claim: Claim; voice: Voice; lighting: Lighting | null }) {
  const play = usePlayback(claim.vehicles)
  const [held, setHeld] = useState(false)
  const running = play.playing && !held
  // at rest the scene is the end of the drive, so that is where the scrubber sits
  const at = play.playing ? Math.min(play.clock, play.timeline.ms) : play.timeline.ms
  return (
    <div data-reconstruction-view className="card overflow-hidden">
      <Reconstruction
        vehicles={claim.vehicles}
        impact={claim.impact}
        poses={play.poses}
        photos={claim.attachments.photos}
        lang="en"
        lighting={lighting}
        className="h-[480px] bg-slate-100"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
        {play.canPlay && (
          <>
            <button
              type="button"
              className="chip"
              aria-pressed={running}
              onClick={() => {
                setHeld(false)
                if (running) play.stop()
                else play.start()
              }}
            >
              {running ? <Icon.stop /> : <Icon.play />} {running ? 'Stop' : 'Play'}
            </button>
            <input
              type="range"
              className="min-w-40 flex-1 accent-brand-600"
              min={0}
              max={play.timeline.ms}
              step={10}
              value={at}
              aria-label="Moment in the drive"
              onChange={(e) => {
                setHeld(true)
                play.seek(Number(e.target.value))
              }}
            />
            <span className="font-mono tabular-nums">{(at / 1000).toFixed(1)} s</span>
          </>
        )}
        <span className="flex w-full flex-wrap gap-x-4 gap-y-1">
          {claim.vehicles
            .filter((v) => v.position)
            .map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm ring-1 ring-slate-900/20" style={{ background: v.color }} />
                {v.id.toUpperCase()} · {vehicleOf(v, voice)}
              </span>
            ))}
          <span className="ml-auto">Drag to turn it round.{claim.impact && ' The red ring is where they hit.'}</span>
        </span>
      </div>
    </div>
  )
}

type Tab = 'report' | 'compare' | 'reconstruction'

/**
 * The open report, in tabs: the document; `Compare` when it is one of two accounts; and the
 * reconstruction when the diagram placed a vehicle. `tab` lives here rather than in `Desk` and
 * starts on the comparison, so switching to a different report — a new `key` from the caller —
 * starts back there with no effect to reset it; until the other account has loaded (or when
 * there is none) a comparison it cannot show reads as the report.
 */
function ReportView({ showing, linked, onOpen }: { showing: { receipt: Receipt; claim: Claim }; linked: { receipt: Receipt; claim: Claim }[] | null; onOpen: (reference: string) => void }) {
  const [tab, setTab] = useState<Tab>('compare')
  const canReconstruct = showing.claim.vehicles.some((v) => v.position)
  const view: Tab = (tab === 'compare' && !linked) || (tab === 'reconstruction' && !canReconstruct) ? 'report' : tab
  const tabs: [Tab, string][] = [['report', 'Report'], ...(linked ? [['compare', 'Compare'] as [Tab, string]] : []), ...(canReconstruct ? [['reconstruction', 'Reconstruction'] as [Tab, string]] : [])]
  const voice = deskVoice(showing.receipt.party)
  // the moment's light, from what the record in this document said
  const context = showing.claim.incident.context
  const lighting = useMemo(() => lightingFor(context), [context])
  return (
    <>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="View" className="mb-4 flex gap-1.5 print:hidden">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" className="chip" aria-selected={view === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {view !== 'compare' && <WorthALook claim={showing.claim} signals={showing.receipt.signals ?? []} onOpen={onOpen} />}
      {view === 'compare' && linked && <Compare reports={linked} />}
      {view === 'report' && <ReportDocument claim={showing.claim} voice={voice} lighting={lighting} badge={<StatusPill status={showing.receipt.status} />} />}
      {view === 'reconstruction' && <ReconstructionView claim={showing.claim} voice={voice} lighting={lighting} />}
    </>
  )
}

class Unauthorised extends Error {}

export function Desk() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '')
  const [askToken, setAskToken] = useState(false)
  const [claims, setClaims] = useState<Receipt[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const [query, setQuery] = useState('')
  const [ref, setRef] = useState<string | null>(() => window.location.hash.replace(/^#\/?/, '') || null)
  const [open, setOpen] = useState<{ receipt: Receipt; claim: Claim } | null>(null)
  // the last incident fetched and what came back, kept together so a stale answer for a
  // report we have since navigated away from is never mistaken for the current one — no
  // effect resets this between reports, `linked` below just stops trusting it
  const [incidentReports, setIncidentReports] = useState<{ incident: string; reports: { receipt: Receipt; claim: Claim }[] } | null>(null)

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

  // the incident this report belongs to, once it names one: the other driver's own account
  useEffect(() => {
    const incident = open?.receipt.incident
    if (!incident) return
    let live = true
    api<{ incident: string; reports: (Receipt & { claim: unknown })[] }>(`/incidents/${encodeURIComponent(incident)}`)
      .then((r) => {
        if (!live) return
        const reports = r.reports.map(({ claim, ...receipt }) => ({ receipt, claim: parseClaim(claim).value }))
        if (reports.length >= 2) setIncidentReports({ incident, reports })
      })
      .catch((e) => live && fail(e))
    return () => {
      live = false
    }
  }, [open?.receipt.incident, api])

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

  // a caller says a name, a plate or a street, almost never a reference; all of them search
  const q = query.trim().toLowerCase()
  const matches = (c: Receipt) =>
    !q || [c.reference, c.clientReference, c.summary.reporter, c.summary.address, ...(c.summary.plates ?? [])].some((s) => s?.toLowerCase().includes(q))
  // the accounts of one accident share a row; it shows when any of them matches
  const rows = inboxRows(claims ?? []).filter((g) => g.accounts.some((c) => (filter === 'all' || c.status === filter) && matches(c)))
  const showing = open && open.receipt.reference === ref ? open : null
  // the fetched incident, but only once it actually names the report on screen — a stale
  // answer for a report we have since left never reads as this one's
  const linked = showing && incidentReports && incidentReports.incident === showing.receipt.incident ? incidentReports.reports : null

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
            {error} <span className="text-red-500">Is the claims server running at {API || 'this origin'}?</span>
          </p>
        )}

        <div className={`grid gap-6 ${showing ? 'lg:grid-cols-[340px_minmax(0,1fr)]' : ''}`}>
          <aside className={`${showing ? 'hidden lg:block' : ''} print:hidden`}>
            <input
              type="search"
              className="input mb-3"
              placeholder="Reference, name, address or plate"
              aria-label="Search reports"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && rows[0]) show(rows[0].lead.reference)
                if (e.key === 'Escape') setQuery('')
              }}
            />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(['all', ...STATUSES] as const).map((f) => (
                <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>
            {claims === null && !error && !askToken && <p className="text-sm text-slate-500">Loading…</p>}
            {claims !== null && rows.length === 0 && (
              <p className="text-sm text-slate-500">
                {q ? `Nothing matches “${query.trim()}”.` : 'Nothing here yet. A report sent from the page lands in this list.'}
              </p>
            )}
            <ul className={`space-y-2 ${showing ? '' : 'grid gap-3 space-y-0 sm:grid-cols-2 lg:grid-cols-3'}`}>
              {rows.map(({ lead: c, accounts }) => {
                const on = accounts.some((a) => a.reference === ref)
                // the open incident may know of an account this inbox has not loaded yet
                const count = Math.max(accounts.length, incidentReports && c.incident === incidentReports.incident ? incidentReports.reports.length : 0)
                return (
                  <li key={c.reference}>
                    <button
                      className={`card w-full p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${on ? 'ring-2 ring-brand-600' : ''}`}
                      aria-current={on ? 'true' : undefined}
                      onClick={() => show(c.reference)}
                    >
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
                        {c.incident && <span className={count > 1 ? 'font-semibold text-ink' : ''}>· {count > 1 ? `${count} accounts` : 'linked'}</span>}
                        {(c.signals?.length ?? 0) > 0 && (
                          <span className="font-semibold text-brand-700">
                            · {c.signals!.length} seen before
                          </span>
                        )}
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
              <ReportView key={showing.receipt.reference} showing={showing} linked={linked} onOpen={show} />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
