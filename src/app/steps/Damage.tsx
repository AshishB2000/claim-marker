import { useRef, useState } from 'react'
import { useClaim, insuredOf } from '../../claim/store'
import { SCHEMA, SEVERITIES, SEVERITY_COLOR, type Damage as Mark } from '../../schema'
import { VEHICLES, zoneById } from '../../zones'
import { DamageMarker } from '../../marker/DamageMarker'
import { KIND_INFO, MAX_PHOTOS, ROLE_COLOR } from '../../claim/schema'
import { VehiclePhoto } from '../VehiclePhoto'
import { Field, YesNo } from '../ui'
import { Describe } from '../Describe'
import { Icon } from '../icons'
import { assistOn, damageFromPhotos } from '../../assist/client'

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
  const camera = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [over, setOver] = useState(false)
  // keyed on the vehicle, so switching cars does not leave the other one's suggestions up
  const [suggested, setSuggested] = useState<{ id: string; marks: Mark[] } | null>(null)
  const [looking, setLooking] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setAdding(true)
    try {
      await addPhotos(list, v.id)
    } finally {
      setAdding(false)
      if (files.current) files.current.value = ''
      if (camera.current) camera.current.value = ''
    }
  }
  const full = photos.length >= MAX_PHOTOS
  const diagram = KIND_INFO[claim.incident.kind].diagram
  const ofThis = photos.filter((p) => p.of === v.id).length
  const marks = suggested?.id === v.id ? suggested.marks : null

  const look = async () => {
    setLooking(true)
    setFailed(null)
    try {
      setSuggested({ id: v.id, marks: await damageFromPhotos(claim, v.id) })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The assistant could not answer.')
    } finally {
      setLooking(false)
    }
  }
  // the customer pressed Add, so this vehicle's damage is now theirs — `setDamages` flips it
  const add = (m: Mark) => {
    setDamages(v.id, [...v.damages, m])
    setSuggested((s) => (s && s.id === v.id ? { id: v.id, marks: s.marks.filter((x) => x !== m) } : s))
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

          {assistOn() && ofThis > 0 && (
            <div className="card p-4">
              <h3 className="eyebrow">From your photos</h3>
              <p className="mt-1 text-sm text-slate-500">
                We can look at the {ofThis === 1 ? 'photo' : `${ofThis} photos`} of this vehicle and suggest the panels. You decide what goes on the car.
              </p>
              <button className="btn btn-secondary btn-sm mt-3" onClick={look} disabled={looking}>
                {looking ? <Icon.spinner /> : <Icon.wand />}
                {looking ? 'Looking…' : marks ? 'Look again' : 'Suggest from photos'}
              </button>
              {failed && !looking && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
              {marks && !looking && marks.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing clear enough to suggest.</p>}
              {marks && !looking && marks.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {marks.map((m, i) => (
                    <li key={`${m.zone}-${i}`} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[m.severity] }} />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{zoneById(v.body, m.zone)?.label ?? m.zone}</span>
                        <span className="text-slate-500"> · {m.severity}</span>
                        {m.note && <span className="block text-xs text-slate-500">{m.note}</span>}
                      </span>
                      <button className="btn btn-ghost btn-sm shrink-0" onClick={() => add(m)} aria-label={`Add ${zoneById(v.body, m.zone)?.label ?? m.zone}`}>
                        <Icon.plus /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-slate-400">Read by AI from the photos. It says what it can see, never what it would cost or who is at fault.</p>
            </div>
          )}
        </aside>
      </div>

      {!diagram && (
        <div className="card mt-5 p-5">
          <Describe placeholder="For example: I came out in the morning and the driver's window was smashed and the glovebox emptied." />
        </div>
      )}

      <div className="card mt-5 p-5">
        <h3 className="font-semibold">Photos</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          The damage up close and from a step back, the other vehicle, its plate, their insurance card, the scene. Photos are the first thing a claims handler looks at.
        </p>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Take a photo" onChange={(e) => onFiles(e.target.files)} />
        <input ref={files} type="file" accept="image/*" multiple className="hidden" aria-label="Add photos" onChange={(e) => onFiles(e.target.files)} />
        <div
          className={`mt-4 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60'}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            if (!full) onFiles(e.dataTransfer.files)
          }}
        >
          <span className="grid size-12 place-items-center rounded-full bg-white text-brand-600 shadow-sm ring-1 ring-slate-900/10 [&_svg]:size-6">
            {adding ? <Icon.spinner /> : <Icon.camera />}
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" onClick={() => camera.current?.click()} disabled={adding || full}>
              <Icon.camera /> Take a photo
            </button>
            <button className="btn btn-secondary" onClick={() => files.current?.click()} disabled={adding || full}>
              <Icon.plus /> Choose photos
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {adding ? 'Adding…' : full ? `That is the most we can take — ${MAX_PHOTOS} photos.` : `Photos of ${v.id.toUpperCase()} · ${photos.length} of ${MAX_PHOTOS} · or drop them here`}
          </p>
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
