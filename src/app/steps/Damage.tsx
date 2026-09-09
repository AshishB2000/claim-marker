import { useRef, useState } from 'react'
import { useClaim, insuredOf } from '../../claim/store'
import { SCHEMA, SEVERITIES, SEVERITY_COLOR } from '../../schema'
import { VEHICLES, zoneById } from '../../zones'
import { DamageMarker } from '../../marker/DamageMarker'
import { KIND_INFO, MAX_PHOTOS, ROLE_COLOR } from '../../claim/schema'
import { VehiclePhoto } from '../VehiclePhoto'
import { Field, YesNo } from '../ui'
import { Icon } from '../icons'

export function Damage() {
  const claim = useClaim((s) => s.claim)
  const autoDamage = useClaim((s) => s.autoDamage)
  const setDamages = useClaim((s) => s.setDamages)
  const addPhotos = useClaim((s) => s.addPhotos)
  const captionPhoto = useClaim((s) => s.captionPhoto)
  const removePhoto = useClaim((s) => s.removePhoto)
  const setCondition = useClaim((s) => s.setCondition)
  const setProperty = useClaim((s) => s.setProperty)
  const [id, setId] = useState(insuredOf(claim).id)
  const v = claim.vehicles.find((x) => x.id === id) ?? insuredOf(claim)
  const photos = claim.attachments.photos
  const files = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setAdding(true)
    try {
      await addPhotos(list, v.id)
    } finally {
      setAdding(false)
      if (files.current) files.current.value = ''
    }
  }

  return (
    <div>
      {claim.vehicles.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {claim.vehicles.map((x) => (
            <button key={x.id} className="chip" aria-pressed={x.id === v.id} onClick={() => setId(x.id)}>
              <span className="size-2 rounded-full" style={{ background: ROLE_COLOR[x.role] }} />
              {x.id.toUpperCase()} · {x.role === 'insured' ? 'Your' : 'Other'} {VEHICLES[x.body].label}
              {x.damages.length > 0 && <span className="rounded-full bg-black/10 px-1.5 text-[10px]">{x.damages.length}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="card h-[520px] overflow-hidden sm:h-[580px]">
          <DamageMarker
            key={`${v.id}-${v.body}`}
            vehicle={v.body}
            paint={v.color}
            value={{ schema: SCHEMA, vehicle: v.body, damages: v.damages }}
            onChange={(next) => setDamages(v.id, next.damages)}
          />
        </div>

        <aside className="space-y-4">
          {autoDamage[v.id] === 'auto' && v.damages[0] && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
              <span className="font-semibold">Marked for you: {zoneById(v.body, v.damages[0].zone)?.label.toLowerCase()}.</span> Worked out from where the
              vehicles met and which way this one was facing. Tap the number on the car to change or remove it, or tap another panel to add more.
            </div>
          )}
          <div className="card p-4">
            <VehiclePhoto vehicle={v} className="mb-3 h-32 overflow-hidden rounded-lg" fallback={null} />
            <h3 className="font-semibold">
              {v.role === 'insured' ? 'Your' : 'Their'} {[v.year, v.make, v.model].filter(Boolean).join(' ') || VEHICLES[v.body].label.toLowerCase()}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Drag to turn the car round. Tap the panel where the damage is and say how bad it is. Tap a number to change or remove it.
            </p>
            {v.role !== 'insured' && <p className="mt-2 text-xs text-slate-500">Only if you saw it — this part is optional for other vehicles.</p>}
          </div>

          <div className="card p-4">
            <h3 className="eyebrow">{v.damages.length === 0 ? 'Nothing marked yet' : `${v.damages.length} marked`}</h3>
            <ul className="mt-2 space-y-2">
              {v.damages.map((d, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-white"
                    style={{ background: SEVERITY_COLOR[d.severity] }}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{zoneById(v.body, d.zone)?.label ?? d.zone}</span>
                    <span className="text-slate-500"> · {d.severity}</span>
                    {d.note && <span className="block truncate text-xs text-slate-500">{d.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
              {SEVERITIES.map((s) => (
                <li key={s} className="flex items-center gap-1.5 text-[11px] text-slate-500 capitalize">
                  <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <div className="card mt-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Photos</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              The damage up close and from a step back, the other vehicle, its plate, their insurance card, the scene. Photos are the first thing a claims handler looks at.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {photos.length} of {MAX_PHOTOS}
            </span>
            <input ref={files} type="file" accept="image/*" multiple capture="environment" className="hidden" aria-label="Add photos" onChange={(e) => onFiles(e.target.files)} />
            <button className="btn btn-secondary btn-sm" onClick={() => files.current?.click()} disabled={adding || photos.length >= MAX_PHOTOS}>
              {adding ? <Icon.spinner /> : <Icon.camera />} {adding ? 'Adding…' : `Add photos of ${v.id.toUpperCase()}`}
            </button>
          </div>
        </div>
        {photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {photos.map((p, i) => (
              <li key={i} className="group relative">
                <img src={p.data} alt={p.caption || `Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover ring-1 ring-slate-900/10" />
                {p.of && (
                  <span
                    className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ background: ROLE_COLOR[claim.vehicles.find((x) => x.id === p.of)?.role ?? 'other'] }}
                  >
                    {p.of.toUpperCase()}
                  </span>
                )}
                <button className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
                  <Icon.x />
                </button>
                <input
                  className="input mt-1.5 h-8 py-0 text-xs"
                  placeholder="What it shows"
                  aria-label={`Caption for photo ${i + 1}`}
                  value={p.caption}
                  onChange={(e) => captionPhoto(i, e.target.value)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {v.role === 'insured' && (
        <div className="card mt-5 p-5">
          <h3 className="font-semibold">Your car now</h3>
          <p className="mt-0.5 text-sm text-slate-500">This decides whether we arrange a tow, a hire car, and where to send someone to look at it.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <span className="label">Can it be driven?</span>
              <YesNo name="Can it be driven" value={v.condition.drivable} onChange={(drivable) => setCondition(v.id, { drivable })} unsure="Not sure" />
            </div>
            <div>
              <span className="label">Did the airbags go off?</span>
              <YesNo name="Did the airbags go off" value={v.condition.airbags} onChange={(airbags) => setCondition(v.id, { airbags })} />
            </div>
            <div>
              <span className="label">Was it towed?</span>
              <YesNo name="Was it towed" value={v.condition.towed} onChange={(towed) => setCondition(v.id, { towed })} />
            </div>
          </div>
          <Field label="Where is it now?" className="mt-4">
            <input
              className="input"
              aria-label="Where is the vehicle now"
              placeholder="At home · the tow yard's name · the body shop · an address"
              value={v.condition.location}
              onChange={(e) => setCondition(v.id, { location: e.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>
      )}

      {KIND_INFO[claim.incident.kind].diagram && (
        <div className="card mt-5 p-5">
          <h3 className="font-semibold">Was anything else damaged?</h3>
          <p className="mt-0.5 text-sm text-slate-500">A fence, a pole, a wall, a parked bike — anything that is not a vehicle.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <Field label="What was damaged">
              <input className="input" aria-label="Other property damaged" value={claim.property.description} onChange={(e) => setProperty({ description: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Whose it is, if you know">
              <input className="input" aria-label="Property owner" value={claim.property.owner} onChange={(e) => setProperty({ owner: e.target.value })} autoComplete="off" />
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}
