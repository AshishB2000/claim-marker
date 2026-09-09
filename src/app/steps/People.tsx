import { useState } from 'react'
import { insuredOf, othersOf, useClaim } from '../../claim/store'
import { KIND_INFO, ROLE_COLOR, newPerson, type Person } from '../../claim/schema'
import { UNKNOWN_DRIVER, personLine, vehicleName as label } from '../../claim/describe'
import { Field, Section, YesNo } from '../ui'
import { Icon } from '../icons'

/** name and phone, plus the licence for a driver */
function Contact({ person, onChange, licence, who }: { person: Person; onChange: (patch: Partial<Person>) => void; licence?: boolean; who: string }) {
  return (
    <div className={`grid gap-3 ${licence ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      <Field label="Name">
        <input className="input" aria-label={`${who} name`} value={person.name} onChange={(e) => onChange({ name: e.target.value })} autoComplete="off" />
      </Field>
      <Field label="Phone">
        <input className="input" type="tel" aria-label={`${who} phone`} value={person.phone} onChange={(e) => onChange({ phone: e.target.value })} autoComplete="off" />
      </Field>
      {licence && (
        <Field label="Licence number (if known)">
          <input className="input uppercase" aria-label={`${who} licence`} value={person.licence} onChange={(e) => onChange({ licence: e.target.value })} autoComplete="off" />
        </Field>
      )}
    </div>
  )
}

export function People() {
  const claim = useClaim((s) => s.claim)
  const setDriver = useClaim((s) => s.setDriver)
  const addPerson = useClaim((s) => s.addPerson)
  const updatePerson = useClaim((s) => s.updatePerson)
  const removePerson = useClaim((s) => s.removePerson)
  const updateVehicle = useClaim((s) => s.updateVehicle)
  const setPolice = useClaim((s) => s.setPolice)

  const info = KIND_INFO[claim.incident.kind]
  const mine = insuredOf(claim)
  const others = othersOf(claim)
  const driverOf = (id: string) => claim.people.find((p) => p.role === 'driver' && p.vehicle === id) ?? newPerson('driver', id)
  const myDriver = driverOf(mine.id)
  // "me" is the default until they say otherwise; a blank driver record means me
  const meDriving = !claim.people.some((p) => p.role === 'driver' && p.vehicle === mine.id && !p.self)

  const anyoneHurt = claim.people.some((p) => p.injured)
  const [hurt, setHurt] = useState<boolean | null>(anyoneHurt ? true : null)
  const answerHurt = (v: boolean | null) => {
    setHurt(v)
    if (v === false) claim.people.forEach((p, i) => p.injured && updatePerson(i, { injured: false, injury: '' }))
  }

  // everyone who could have been hurt: drivers (created on the fly), passengers, pedestrians
  const listed = claim.people.map((p, index) => ({ p, index })).filter(({ p }) => p.role !== 'witness')
  const missingDrivers = claim.vehicles.filter((v) => !claim.people.some((p) => p.role === 'driver' && p.vehicle === v.id))

  return (
    <div>
      <Section title="Who was driving?" hint="Only what you know. Anything you leave blank we can ask about later.">
        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR.insured }}>
                {mine.id.toUpperCase()}
              </span>
              <div className="font-semibold">Your {label(mine)}</div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who was driving your vehicle">
              <button className="chip" role="radio" aria-checked={meDriving} aria-pressed={meDriving} onClick={() => setDriver(mine.id, { self: true, name: '', phone: '', licence: '' })}>
                I was driving
              </button>
              <button className="chip" role="radio" aria-checked={!meDriving} aria-pressed={!meDriving} onClick={() => setDriver(mine.id, { self: false })}>
                Someone else was driving
              </button>
            </div>
            {!meDriving && (
              <div className="mt-4">
                <Contact person={myDriver} onChange={(patch) => setDriver(mine.id, patch)} licence who="Your driver" />
              </div>
            )}
          </div>

          {info.others &&
            others.map((v) => {
              const d = driverOf(v.id)
              const unknown = d.name === UNKNOWN_DRIVER
              return (
                <div key={v.id} className="card p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR.other }}>
                        {v.id.toUpperCase()}
                      </span>
                      <div>
                        <div className="font-semibold">The driver of the {label(v)}</div>
                        <div className="text-xs text-slate-500">From their licence and insurance card, if you exchanged details</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={unknown}
                        onChange={(e) => setDriver(v.id, { name: e.target.checked ? UNKNOWN_DRIVER : '', phone: '', licence: '', self: false })}
                      />
                      I don't know — they left
                    </label>
                  </div>
                  {!unknown && (
                    <div className="space-y-3">
                      <Contact person={d} onChange={(patch) => setDriver(v.id, patch)} licence who={`Driver of ${v.id.toUpperCase()}`} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Their insurer">
                          <input className="input" aria-label={`Insurer of ${v.id.toUpperCase()}`} value={v.insurer} onChange={(e) => updateVehicle(v.id, { insurer: e.target.value })} autoComplete="off" />
                        </Field>
                        <Field label="Their policy number">
                          <input className="input uppercase" aria-label={`Policy of ${v.id.toUpperCase()}`} value={v.policy} onChange={(e) => updateVehicle(v.id, { policy: e.target.value })} autoComplete="off" />
                        </Field>
                        <Field label="Owner, if not the driver">
                          <input className="input" aria-label={`Owner of ${v.id.toUpperCase()}`} value={v.owner} onChange={(e) => updateVehicle(v.id, { owner: e.target.value })} autoComplete="off" />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      </Section>

      <Section
        title="Anyone else in the vehicles?"
        hint="Passengers, by name."
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => addPerson('passenger', mine.id)}>
            <Icon.plus /> Add a passenger
          </button>
        }
      >
        <div className="space-y-3">
          {claim.people.map((p, index) =>
            p.role !== 'passenger' ? null : (
              <div key={index} className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <select className="input w-auto" aria-label="Which vehicle" value={p.vehicle ?? ''} onChange={(e) => updatePerson(index, { vehicle: e.target.value })}>
                    {claim.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        In {v.id.toUpperCase()} · {v.role === 'insured' ? 'your' : 'their'} {label(v)}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={() => removePerson(index)} aria-label="Remove this passenger">
                    <Icon.x /> Remove
                  </button>
                </div>
                <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who="Passenger" />
              </div>
            ),
          )}
          {!claim.people.some((p) => p.role === 'passenger') && <p className="text-sm text-slate-400">No passengers listed.</p>}
        </div>
      </Section>

      <Section title="Was anyone hurt?" hint="However minor. This is the first thing a claims handler needs to know.">
        <div className="card p-5">
          <YesNo value={hurt} onChange={answerHurt} name="Was anyone hurt" />
          {hurt && (
            <div className="mt-4 space-y-3">
              {missingDrivers.map((v) => (
                <label key={v.id} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={false} onChange={() => setDriver(v.id, { self: v.role === 'insured', injured: true })} />
                  <span>{personLine({ ...newPerson('driver', v.id), self: v.role === 'insured' }, claim.vehicles)}</span>
                </label>
              ))}
              {listed.map(({ p, index }) => (
                <div key={index}>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1" checked={p.injured} onChange={(e) => updatePerson(index, { injured: e.target.checked, injury: e.target.checked ? p.injury : '' })} />
                    <span>{personLine(p, claim.vehicles)}</span>
                  </label>
                  {p.injured && (
                    <div className="mt-2 ml-7 space-y-2">
                      {p.role === 'pedestrian' && <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who="Injured person" />}
                      <textarea
                        className="input min-h-20"
                        aria-label={`Injury of ${p.name || 'this person'}`}
                        placeholder="What happened to them — and were they taken to hospital?"
                        value={p.injury}
                        onChange={(e) => updatePerson(index, { injury: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => addPerson('pedestrian')}>
                <Icon.plus /> Someone not listed — a pedestrian or cyclist
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Were the police called?" hint="The report number is the one thing an adjuster will ask you for.">
        <div className="card p-5">
          <YesNo value={claim.police.called} onChange={(called) => setPolice({ called })} name="Were the police called" />
          {claim.police.called && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Police department">
                <input className="input" aria-label="Police department" value={claim.police.department} onChange={(e) => setPolice({ department: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Report number">
                <input className="input uppercase" aria-label="Police report number" value={claim.police.report} onChange={(e) => setPolice({ report: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Any tickets given? To whom?">
                <input className="input" aria-label="Citations" value={claim.police.citations} onChange={(e) => setPolice({ citations: e.target.value })} autoComplete="off" />
              </Field>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Did anyone see it happen?"
        hint="A witness who is not in any of the vehicles."
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => addPerson('witness')}>
            <Icon.plus /> Add a witness
          </button>
        }
      >
        <div className="space-y-3">
          {claim.people.map((p, index) =>
            p.role !== 'witness' ? null : (
              <div key={index} className="card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Witness</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => removePerson(index)} aria-label="Remove this witness">
                    <Icon.x /> Remove
                  </button>
                </div>
                <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who="Witness" />
              </div>
            ),
          )}
          {!claim.people.some((p) => p.role === 'witness') && <p className="text-sm text-slate-400">No witnesses listed.</p>}
        </div>
      </Section>
    </div>
  )
}
