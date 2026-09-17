import { useState } from 'react'
import { useClaim, insuredOf } from '../../claim/store'
import { VEHICLES } from '../../zones'
import { KIND_INFO, ROLE_COLOR } from '../../claim/schema'
import { Field, YesNo } from '../ui'
import { Describe } from '../Describe'
import { assistOn } from '../../assist/client'
import { useNarrow } from '../narrow'
import { Capture } from './damage/Capture'
import { MarkerPanel } from './damage/MarkerPanel'
import { PhotoSuggestions, Suggestions } from './damage/Suggestions'

export function Damage() {
  const claim = useClaim((s) => s.claim)
  const setCondition = useClaim((s) => s.setCondition)
  const setProperty = useClaim((s) => s.setProperty)
  const [id, setId] = useState(insuredOf(claim).id)
  const v = claim.vehicles.find((x) => x.id === id) ?? insuredOf(claim)
  const diagram = KIND_INFO[claim.incident.kind].diagram
  // At the roadside on a phone the customer's instinct is the camera, not a 3D model: so with
  // the assistant there to read them, photos come first, then what was seen in them, then the
  // car for whatever they missed. Without the assistant, or on a wider screen, as it always was.
  const narrow = useNarrow()
  const photoFirst = assistOn() && narrow

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

      {photoFirst ? (
        <>
          <Capture v={v} guided />
          <PhotoSuggestions v={v} />
          <MarkerPanel v={v} afterPhotos />
        </>
      ) : (
        <MarkerPanel v={v}>
          <Suggestions v={v} />
        </MarkerPanel>
      )}

      {!diagram && (
        <div className="card mt-5 p-5">
          <Describe placeholder="For example: I came out in the morning and the driver's window was smashed and the glovebox emptied." />
        </div>
      )}

      {!photoFirst && <Capture v={v} />}

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
