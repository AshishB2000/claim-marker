import { Fragment, useRef, useState, type ReactNode } from 'react'
import { useClaim, type Step } from '../../claim/store'
import { KIND_INFO, ROLE_COLOR, makeReference, toDocument, type ClaimVehicle, type Person } from '../../claim/schema'
import { conditionLabels, contactLine, driverName, driverShort, gaps, personLine, vehicleName, whose, yesNo } from '../../claim/describe'
import type { LngLat } from '../../geo'
import { MapScene, type MapSceneHandle } from '../../map/MapScene'
import { DamageMarker, type DamageMarkerHandle } from '../../marker/DamageMarker'
import { SCHEMA, SEVERITY_COLOR } from '../../schema'
import { zoneById } from '../../zones'
import { paintLabel } from '../../vehicles/paint'
import { Icon } from '../icons'
import { Field, YesNo } from '../ui'
import { FRAUD_NOTICE, submitClaim } from '../submit'
import { VehiclePhoto } from '../VehiclePhoto'
import { usePlayback } from '../../map/usePlayback'

// ── the pieces the document is written in ────────────────────────────

function Edit({ step, children = 'Change' }: { step: Step; children?: ReactNode }) {
  const goto = useClaim((s) => s.goto)
  return (
    <button className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline" onClick={() => goto(step)}>
      {children}
    </button>
  )
}

/** one section of the document: an eyebrow, a way back to the step it came from, the content */
function Part({ title, edit, children }: { title: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-6 py-5 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="eyebrow">{title}</h3>
        {edit}
      </div>
      {children}
    </section>
  )
}

const NotGiven = () => <span className="text-slate-400">Not given</span>
const given = (s: string | null | undefined): ReactNode => (s ? s : <NotGiven />)
const mono = (s: string | null | undefined): ReactNode => (s ? <span className="font-mono text-[13px]">{s}</span> : <NotGiven />)
/** a yes/no answered as words, or not answered */
const answered = (v: boolean | null, yes: string, no: string): string | null => (v === null ? null : v ? yes : no)

/** label / value pairs, the way a form reads back */
function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

function Tag({ v }: { v: ClaimVehicle }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
      {v.id.toUpperCase()}
    </span>
  )
}

const when = (at: string) => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
}

/** the marks on one vehicle, numbered as they are on the car */
function Marks({ v }: { v: ClaimVehicle }) {
  return (
    <ol className="space-y-1.5 text-sm">
      {v.damages.map((d, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: SEVERITY_COLOR[d.severity] }}>
            {i + 1}
          </span>
          <span>
            <span className="font-medium">{zoneById(v.body, d.zone)?.label ?? d.zone}</span>
            <span className="text-slate-500"> — {d.severity}</span>
            {d.note && <span className="block text-slate-600">“{d.note}”</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Hurt({ p }: { p: Person }) {
  if (!p.injured) return null
  return (
    <span className="mt-0.5 block text-red-700">
      <span className="font-semibold">Hurt</span>
      {p.injury && ` — ${p.injury}`}
    </span>
  )
}

// ── the page ─────────────────────────────────────────────────────────

export function Review({ onSubmitted }: { onSubmitted: () => void }) {
  const claim = useClaim((s) => s.claim)
  const submitted = useClaim((s) => s.submitted)
  const setReporter = useClaim((s) => s.setReporter)
  const setAttestation = useClaim((s) => s.setAttestation)
  const map = useRef<MapSceneHandle>(null)
  const markers = useRef(new Map<string, DamageMarkerHandle>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const play = usePlayback(claim.vehicles)

  const loc = claim.incident.location
  const center: LngLat | null = loc ? [loc.lng, loc.lat] : null
  const info = KIND_INFO[claim.incident.kind]
  const mine = claim.vehicles.find((v) => v.role === 'insured') ?? claim.vehicles[0]
  const conditions = conditionLabels(claim.incident.conditions)
  const damaged = claim.vehicles.filter((v) => v.damages.length > 0)
  const photos = claim.attachments.photos
  const hurt = claim.people.filter((p) => p.injured)
  const driverOf = (v: ClaimVehicle) => claim.people.find((p) => p.role === 'driver' && p.vehicle === v.id)
  const inVehicle = (v: ClaimVehicle) => claim.people.filter((p) => p.vehicle === v.id && p.role !== 'driver')
  const outside = claim.people.filter((p) => !p.vehicle)
  const cond = mine.condition
  const missing = gaps(claim)
  const canSend = !busy && claim.attestation.agreed && claim.attestation.name.trim().length > 1

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const damage: Record<string, string> = {}
      for (const [id, h] of markers.current) {
        const png = h.export().png
        if (png) damage[id] = png
      }
      const reference = makeReference()
      const submittedAt = new Date().toISOString()
      // the attestation is stamped at the moment of sending, and only then
      const doc = toDocument({
        ...claim,
        reference,
        submittedAt,
        attestation: { ...claim.attestation, at: submittedAt },
        attachments: { ...claim.attachments, scene: map.current?.export() ?? null, damage },
      })
      await submitClaim(doc)
      setAttestation({ at: submittedAt })
      submitted(reference, submittedAt)
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <article className="card overflow-hidden">
        {/* ── the header: what, where, when ───────────────────────── */}
        <header className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow">Accident report</div>
              <h2 className="mt-1 flex flex-wrap items-baseline gap-3 text-2xl font-semibold tracking-tight">
                {info.label}
                <Edit step="kind">Change</Edit>
              </h2>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Draft — not sent yet</span>
          </div>
          <div className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-slate-400">
                <Icon.pin />
              </span>
              <div>
                <div className="text-sm font-medium">{loc?.address ?? <NotGiven />}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Where it happened · <Edit step="where">Change</Edit>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-slate-400">
                <Icon.target />
              </span>
              <div>
                <div className="text-sm font-medium">{when(claim.incident.at)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {conditions.length ? conditions.join(' · ') : 'Conditions not given'} · <Edit step="where">Change</Edit>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── what an adjuster would ring up to ask ────────────────── */}
        {missing.length > 0 ? (
          <div className="border-b border-slate-100 bg-amber-50/60 px-6 py-4">
            <div className="text-sm font-semibold text-amber-900">Worth adding before you send</div>
            <p className="mt-0.5 text-xs text-amber-800/80">None of this stops you sending. Each one is a phone call saved.</p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-amber-900 sm:grid-cols-2">
              {missing.map((g) => (
                <li key={g.text} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    {g.text}
                    {g.step !== 'review' && (
                      <>
                        {' '}
                        · <Edit step={g.step}>Add it</Edit>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-emerald-50/60 px-6 py-3 text-sm font-medium text-emerald-800">
            <Icon.check /> Everything a claims handler needs is here.
          </div>
        )}

        {/* ── vehicles ────────────────────────────────────────────── */}
        <Part title="Vehicles" edit={<Edit step="vehicles" />}>
          <div className="divide-y divide-slate-100">
            {claim.vehicles.map((v) => {
              const d = driverOf(v)
              const rows: [string, ReactNode][] = [
                ['Colour', paintLabel(v.color)],
                ['Plate', given(v.plate ? `${v.plate}${v.plateState ? ` (${v.plateState})` : ''}` : null)],
                ['VIN', mono(v.vin)],
              ]
              if (v.role !== 'insured') {
                rows.push(
                  ['Driver', given(driverName(d) ? `${driverName(d)}${d && contactLine(d) ? ` · ${contactLine(d)}` : ''}` : null)],
                  ['Insurer', given(v.insurer ? `${v.insurer}${v.policy ? `, policy ${v.policy}` : ''}` : null)],
                  ['Owner', v.owner || 'The driver'],
                )
              }
              rows.push(['Damage', v.damages.length ? `${v.damages.length} panel${v.damages.length === 1 ? '' : 's'} marked, below` : 'None marked'])
              return (
                <div key={v.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <VehiclePhoto
                    vehicle={v}
                    className="h-20 w-28 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-900/10"
                    fallback={
                      <div className="grid h-20 w-28 shrink-0 place-items-center rounded-lg bg-slate-100">
                        <span className="size-7 rounded-full ring-2 ring-white" style={{ background: v.color }} />
                      </div>
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Tag v={v} />
                      <span className="font-semibold">{vehicleName(v)}</span>
                      <span className="text-xs text-slate-500">{v.role === 'insured' ? 'Your vehicle' : 'Other vehicle'}</span>
                    </div>
                    <Rows items={rows} />
                  </div>
                </div>
              )
            })}
          </div>
        </Part>

        {/* ── people ──────────────────────────────────────────────── */}
        <Part title="People and injuries" edit={<Edit step="people" />}>
          <div className="mb-3">
            {hurt.length ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                {hurt.length} {hurt.length === 1 ? 'person' : 'people'} hurt
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <Icon.check /> No one hurt
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {claim.vehicles.map((v) => {
              const d = driverOf(v)
              const others = inVehicle(v)
              return (
                <div key={v.id} className="rounded-xl bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Tag v={v} />
                    In {whose(v)} {vehicleName(v)}
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-slate-400">
                        <Icon.person />
                      </span>
                      <span>
                        {d ? (
                          <>
                            {driverShort(d)}
                            {contactLine(d) && <span className="block text-xs text-slate-500">{contactLine(d)}</span>}
                            <Hurt p={d} />
                          </>
                        ) : v.role === 'insured' ? (
                          'You, driving'
                        ) : (
                          <span className="text-slate-400">Driver not given</span>
                        )}
                      </span>
                    </li>
                    {others.map((p) => (
                      <li key={p.name + p.phone} className="flex items-start gap-2">
                        <span className="mt-0.5 text-slate-400">
                          <Icon.person />
                        </span>
                        <span>
                          {p.name || 'A passenger'}, passenger
                          {p.phone && <span className="block text-xs text-slate-500">{p.phone}</span>}
                          <Hurt p={p} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
            {outside.length > 0 && (
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="mb-2 text-sm font-semibold">Not in a vehicle</div>
                <ul className="space-y-2 text-sm">
                  {outside.map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 text-slate-400">
                        <Icon.person />
                      </span>
                      <span>
                        {personLine(p, claim.vehicles)}
                        {contactLine(p) && <span className="block text-xs text-slate-500">{contactLine(p)}</span>}
                        <Hurt p={p} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <span className="text-slate-400">
                <Icon.shield />
              </span>
              Police
            </div>
            {claim.police.called === null ? (
              <p className="text-sm text-slate-400">Not answered — were the police called?</p>
            ) : claim.police.called === false ? (
              <p className="text-sm">The police were not called.</p>
            ) : (
              <Rows
                items={[
                  ['Department', given(claim.police.department)],
                  ['Report number', mono(claim.police.report)],
                  ['Tickets', claim.police.citations || 'None mentioned'],
                ]}
              />
            )}
          </div>
        </Part>

        {/* ── what happened ───────────────────────────────────────── */}
        <Part title="What happened" edit={<Edit step={info.diagram ? 'scene' : 'damage'} />}>
          {claim.incident.description ? (
            <blockquote className="border-l-4 border-brand-200 pl-4 text-[15px] leading-relaxed whitespace-pre-line">{claim.incident.description}</blockquote>
          ) : (
            <p className="text-sm text-slate-400">No description written. A sentence or two in your own words helps.</p>
          )}
          {center && info.diagram && (
            <figure className="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-900/10">
              <div className="relative">
                <MapScene ref={map} center={center} style={claim.incident.surface} vehicles={claim.vehicles} impact={claim.impact} selected={null} interactive={false} poses={play.poses} className="h-[360px]" />
                {play.canPlay && (
                  <button className="chip absolute top-3 right-3" onClick={play.playing ? play.stop : play.start} aria-pressed={play.playing}>
                    {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? 'Stop' : 'Play it back'}
                  </button>
                )}
              </div>
              <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                {claim.vehicles
                  .filter((v) => v.position)
                  .map((v) => (
                    <span key={v.id} className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-sm" style={{ background: ROLE_COLOR[v.role] }} />
                      {v.id.toUpperCase()} · {whose(v)} {vehicleName(v)}
                    </span>
                  ))}
                {claim.impact && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="grid size-3.5 place-items-center rounded-full bg-red-600 text-[8px] font-bold text-white">✕</span>
                    where they hit
                  </span>
                )}
                <span className="ml-auto">The lines are the routes each vehicle took.</span>
              </figcaption>
            </figure>
          )}
        </Part>

        {/* ── damage ──────────────────────────────────────────────── */}
        <Part title="Damage" edit={<Edit step="damage" />}>
          {damaged.length === 0 ? (
            <p className="text-sm text-slate-400">No damage marked on any vehicle.</p>
          ) : (
            <div className="space-y-4">
              {damaged.map((v) => (
                <div key={v.id} className="grid gap-4 overflow-hidden rounded-xl ring-1 ring-slate-900/10 sm:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="pointer-events-none h-44 bg-slate-100 sm:h-full">
                    <DamageMarker
                      ref={(h) => {
                        if (h) markers.current.set(v.id, h)
                        else markers.current.delete(v.id)
                      }}
                      vehicle={v.body}
                      paint={v.color}
                      value={{ schema: SCHEMA, vehicle: v.body, damages: v.damages }}
                    />
                  </div>
                  <div className="p-4 pt-3 sm:pl-0">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Tag v={v} />
                      {whose(v) === 'your' ? 'Your' : 'Their'} {vehicleName(v)}
                    </div>
                    <Marks v={v} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {photos.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-sm font-semibold">
                Photos <span className="font-normal text-slate-500">· {photos.length}</span>
              </div>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {photos.map((p, i) => (
                  <li key={i}>
                    <img src={p.data} alt={p.caption || `Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-900/10" />
                    <span className="mt-1 block truncate text-[11px] text-slate-600">
                      {p.of && <span className="font-semibold">{p.of.toUpperCase()} · </span>}
                      {p.caption || <span className="text-slate-400">No caption</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold">Your {vehicleName(mine)} now</div>
              <Rows
                items={[
                  ['Drivable', given(answered(cond.drivable, 'Yes', 'No'))],
                  ['Airbags', given(answered(cond.airbags, 'Went off', 'Did not go off'))],
                  ['Towed', given(yesNo(cond.towed))],
                  ['Where it is', given(cond.location)],
                ]}
              />
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="mb-2 text-sm font-semibold">Other property</div>
              {claim.property.description ? (
                <Rows items={[['Damaged', claim.property.description], ['Belongs to', given(claim.property.owner)]]} />
              ) : (
                <p className="text-sm text-slate-500">Nothing else was damaged.</p>
              )}
            </div>
          </div>
        </Part>
      </article>

      {/* ── who to contact ───────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">How do we reach you?</h2>
        <p className="mt-1 text-sm text-slate-500">A claims handler will call or email about this report.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Your name">
            <input className="input" aria-label="Your name" value={claim.reporter.name} onChange={(e) => setReporter({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" aria-label="Your phone" value={claim.reporter.phone} onChange={(e) => setReporter({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" aria-label="Your email" value={claim.reporter.email} onChange={(e) => setReporter({ email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label="Policy number, if you have it">
            <input className="input uppercase" aria-label="Policy number" value={claim.reporter.policy} onChange={(e) => setReporter({ policy: e.target.value })} autoComplete="off" />
          </Field>
        </div>
        <div className="mt-4">
          <span className="label">Are you the policyholder?</span>
          <YesNo name="Are you the policyholder" value={claim.reporter.policyholder} onChange={(policyholder) => setReporter({ policyholder })} />
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      {/* ── confirm and send ─────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">Confirm and send</h2>
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">{FRAUD_NOTICE}</p>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={claim.attestation.agreed} onChange={(e) => setAttestation({ agreed: e.target.checked })} aria-label="I confirm this report is true" />
          <span>I confirm that what I have said in this report is true and complete to the best of my knowledge.</span>
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Type your full name to sign">
            <input className="input max-w-md" aria-label="Signature" placeholder={claim.reporter.name || 'Your full name'} value={claim.attestation.name} onChange={(e) => setAttestation({ name: e.target.value })} autoComplete="name" />
          </Field>
          <button className="btn btn-primary" onClick={send} disabled={!canSend}>
            {busy ? <Icon.spinner /> : <Icon.check />}
            {busy ? 'Sending…' : 'Send my report'}
          </button>
        </div>
        {!canSend && !busy && <p className="mt-2 text-xs text-slate-500">Tick the box and sign to send.</p>}
      </div>
    </div>
  )
}
