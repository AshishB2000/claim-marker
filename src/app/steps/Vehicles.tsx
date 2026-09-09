import { useEffect, useState } from 'react'
import { useClaim, insuredOf, othersOf } from '../../claim/store'
import { KIND_INFO, ROLE_COLOR, type ClaimVehicle } from '../../claim/schema'
import { VEHICLES, isVehicle, type Vehicle } from '../../zones'
import { BODY_ORDER } from '../../vehicles/bodies'
import { FALLBACK, MAKES, OTHER, YEARS, guessBody, modelsFor } from '../../vehicles/catalog'
import { PAINTS, paintLabel } from '../../vehicles/paint'
import { BodyPreview } from '../../vehicles/BodyPreview'
import { VehiclePhoto } from '../VehiclePhoto'
import { Field, Section } from '../ui'
import { Icon } from '../icons'

const BODIES = BODY_ORDER.filter(isVehicle) as Vehicle[]

/** the model list for a make and year, live from the vehicle database with a bundled fallback */
function useModels(make: string, year: number | null) {
  const [state, setState] = useState<{ key: string; models: string[]; offline: boolean }>({ key: '', models: [], offline: false })
  const key = make ? `${make}|${year ?? ''}` : ''

  useEffect(() => {
    if (!make) return
    const ac = new AbortController()
    const wanted = `${make}|${year ?? ''}`
    modelsFor(make, year ?? new Date().getFullYear(), ac.signal)
      .then((models) => {
        if (!ac.signal.aborted) setState({ key: wanted, models, offline: false })
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ key: wanted, models: FALLBACK[make] ?? [], offline: true })
      })
    return () => ac.abort()
  }, [make, year])

  return { models: state.key === key ? state.models : [], loading: !!key && state.key !== key, offline: state.key === key && state.offline }
}

function VehicleCard({ vehicle: v }: { vehicle: ClaimVehicle }) {
  const updateVehicle = useClaim((s) => s.updateVehicle)
  const setBody = useClaim((s) => s.setBody)
  const removeVehicle = useClaim((s) => s.removeVehicle)
  const mine = v.role === 'insured'
  const { models, loading, offline } = useModels(v.make, v.year)
  // "Other" turns the model dropdown into a box to type in
  const [typing, setTyping] = useState(false)
  const listed = models.includes(v.model)

  const chooseModel = (model: string) => {
    if (model === OTHER) {
      setTyping(true)
      updateVehicle(v.id, { model: '' })
      return
    }
    setTyping(false)
    updateVehicle(v.id, { model })
    // the closest 3D shape, unless damage has already been marked on the current one
    const body = guessBody(model)
    if (body && body !== v.body && v.damages.length === 0) setBody(v.id, body)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR[v.role] }}>
            {v.id.toUpperCase()}
          </span>
          <div>
            <div className="font-semibold">{mine ? 'Your vehicle' : 'Other vehicle'}</div>
            <div className="text-xs text-slate-500">{mine ? 'The one on your policy' : 'As best you can tell'}</div>
          </div>
        </div>
        {!mine && (
          <button className="btn btn-ghost btn-sm" onClick={() => removeVehicle(v.id)} aria-label={`Remove vehicle ${v.id.toUpperCase()}`}>
            <Icon.x /> Remove
          </button>
        )}
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative h-56 overflow-hidden rounded-xl bg-gradient-to-b from-slate-100 to-slate-200/80 ring-1 ring-slate-900/[0.06] sm:h-full sm:min-h-56">
          {/* the real car in a photograph once make and model are known; the 3D shape until then */}
          <VehiclePhoto vehicle={v} credit className="absolute inset-0" fallback={<BodyPreview body={v.body} paint={v.color} className="!absolute inset-0" />} />
          <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-slate-600 backdrop-blur">
            <span className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: v.color }} />
            {[v.year, v.make, v.model].filter(Boolean).join(' ') || VEHICLES[v.body].label} · {paintLabel(v.color)}
          </span>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1.1fr_1.4fr_0.8fr]">
            <Field label="Make">
              <select className="input" aria-label="Make" value={v.make} onChange={(e) => updateVehicle(v.id, { make: e.target.value, model: '' })}>
                <option value="">Select…</option>
                {MAKES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={loading ? 'Model · loading…' : offline ? 'Model · common models' : 'Model'}>
              {typing || (v.model && !listed && !loading && v.make) ? (
                <div className="flex gap-1.5">
                  <input className="input" aria-label="Model" placeholder="Type the model" value={v.model} onChange={(e) => updateVehicle(v.id, { model: e.target.value })} autoFocus={typing} />
                  <button
                    className="btn btn-ghost btn-sm shrink-0"
                    onClick={() => {
                      setTyping(false)
                      updateVehicle(v.id, { model: '' })
                    }}
                    aria-label="Back to the list"
                  >
                    <Icon.x />
                  </button>
                </div>
              ) : (
                <select className="input" aria-label="Model" value={v.model} disabled={!v.make || loading} onChange={(e) => chooseModel(e.target.value)}>
                  <option value="">{!v.make ? 'Pick a make first' : loading ? 'Loading…' : 'Select…'}</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {v.make && !loading && <option value={OTHER}>Other / not listed…</option>}
                </select>
              )}
            </Field>
            <Field label="Year">
              <select className="input" aria-label="Year" value={v.year ?? ''} onChange={(e) => updateVehicle(v.id, { year: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <span className="label">Closest shape</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Body type">
              {BODIES.map((b) => (
                <button key={b} className="chip" role="radio" aria-checked={v.body === b} aria-pressed={v.body === b} onClick={() => setBody(v.id, b)}>
                  {VEHICLES[b].label}
                </button>
              ))}
            </div>
            {v.damages.length > 0 && <p className="mt-1.5 text-xs text-amber-700">Changing the shape clears the damage you marked on it.</p>}
          </div>

          <div>
            <span className="label">Colour</span>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colour">
              {PAINTS.map((p) => (
                <button
                  key={p.id}
                  className="swatch"
                  style={{ background: p.hex }}
                  role="radio"
                  aria-checked={v.color === p.hex}
                  aria-pressed={v.color === p.hex}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => updateVehicle(v.id, { color: p.hex })}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_0.6fr_1.6fr]">
            <Field label="Plate">
              <input className="input uppercase" aria-label="Plate" placeholder="ABC 123" value={v.plate} onChange={(e) => updateVehicle(v.id, { plate: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="State">
              <input className="input uppercase" aria-label="Plate state" placeholder="NY" maxLength={3} value={v.plateState} onChange={(e) => updateVehicle(v.id, { plateState: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={mine ? 'VIN — on the dashboard or your insurance card' : 'VIN (if you have it)'}>
              <input className="input uppercase font-mono" aria-label="VIN" placeholder="17 characters" maxLength={17} value={v.vin} onChange={(e) => updateVehicle(v.id, { vin: e.target.value })} autoComplete="off" />
            </Field>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Vehicles() {
  const claim = useClaim((s) => s.claim)
  const addVehicle = useClaim((s) => s.addVehicle)
  const removeVehicle = useClaim((s) => s.removeVehicle)
  const others = othersOf(claim)
  const info = KIND_INFO[claim.incident.kind]

  return (
    <div>
      <Section title="Your vehicle" hint="Pick it from the lists. The shape and colour are what you will place on the map and mark the damage on.">
        <VehicleCard vehicle={insuredOf(claim)} />
      </Section>

      {info.others && (
      <Section
        title={others.length === 0 ? (claim.incident.kind === 'parked' ? 'Did you see the vehicle that hit yours?' : 'Was anyone else involved?') : `Other vehicle${others.length === 1 ? '' : 's'}`}
        hint={
          others.length === 0
            ? claim.incident.kind === 'parked'
              ? 'Add it if you know anything about it — a note left on the windscreen, a witness, CCTV.'
              : 'Add each other vehicle that was part of it. Leave this empty if it was only you.'
            : 'Add as many as were involved.'
        }
        action={
          <button className="btn btn-secondary btn-sm" onClick={addVehicle} disabled={claim.vehicles.length >= 6}>
            <Icon.plus /> Add a vehicle
          </button>
        }
      >
        <div className="space-y-4">
          {others.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
          {others.length > 0 && (
            <button className="text-sm text-slate-500 underline-offset-2 hover:underline" onClick={() => others.forEach((v) => removeVehicle(v.id))}>
              {claim.incident.kind === 'parked' ? "I don't know anything about the other vehicle" : 'It was only my vehicle'}
            </button>
          )}
        </div>
      </Section>
      )}
    </div>
  )
}
