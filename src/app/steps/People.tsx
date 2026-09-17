import { useState } from 'react'
import { insuredOf, othersOf, useClaim } from '../../claim/store'
import { KIND_INFO, ROLE_COLOR, newPerson, type Person } from '../../claim/schema'
import { UNKNOWN_DRIVER, cap, displayName, personLine, vehicleName as label, vehicleOf } from '../../claim/describe'
import { Field, Section, YesNo } from '../ui'
import { Icon } from '../icons'
import { useLang, useT } from '../../i18n/useT'

/** name and phone, plus the licence for a driver. `who` is already translated: it names the boxes to a screen reader. */
function Contact({ person, onChange, licence, who }: { person: Person; onChange: (patch: Partial<Person>) => void; licence?: boolean; who: string }) {
  const t = useT()
  return (
    <div className={`grid gap-3 ${licence ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      <Field label={t('start.people.name')}>
        <input className="input" aria-label={t('start.people.nameOf', { who })} value={person.name} onChange={(e) => onChange({ name: e.target.value })} autoComplete="off" />
      </Field>
      <Field label={t('start.people.phone')}>
        <input className="input" type="tel" aria-label={t('start.people.phoneOf', { who })} value={person.phone} onChange={(e) => onChange({ phone: e.target.value })} autoComplete="off" />
      </Field>
      {licence && (
        <Field label={t('start.people.licence')}>
          <input className="input uppercase" aria-label={t('start.people.licenceOf', { who })} value={person.licence} onChange={(e) => onChange({ licence: e.target.value })} autoComplete="off" />
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
  const t = useT()
  const lang = useLang()

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
      <Section title={t('start.people.drivingTitle')} hint={t('start.people.drivingHint')}>
        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg text-sm font-bold text-white" style={{ background: ROLE_COLOR.insured }}>
                {mine.id.toUpperCase()}
              </span>
              <div className="font-semibold">{cap(vehicleOf(mine, 'customer', lang))}</div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('start.people.whoDroveMine')}>
              <button className="chip" role="radio" aria-checked={meDriving} aria-pressed={meDriving} onClick={() => setDriver(mine.id, { self: true, name: '', phone: '', licence: '' })}>
                {t('start.people.iDrove')}
              </button>
              <button className="chip" role="radio" aria-checked={!meDriving} aria-pressed={!meDriving} onClick={() => setDriver(mine.id, { self: false })}>
                {t('start.people.elseDrove')}
              </button>
            </div>
            {!meDriving && (
              <div className="mt-4">
                <Contact person={myDriver} onChange={(patch) => setDriver(mine.id, patch)} licence who={t('start.people.whoMine')} />
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
                        <div className="font-semibold">{t('start.people.otherDriver', { vehicle: label(v, lang) })}</div>
                        <div className="text-xs text-slate-500">{t('start.people.otherDriverHint')}</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={unknown}
                        onChange={(e) => setDriver(v.id, { name: e.target.checked ? UNKNOWN_DRIVER : '', phone: '', licence: '', self: false })}
                      />
                      {t('start.people.theyLeft')}
                    </label>
                  </div>
                  {!unknown && (
                    <div className="space-y-3">
                      <Contact person={d} onChange={(patch) => setDriver(v.id, patch)} licence who={t('start.people.whoDriverOf', { id: v.id.toUpperCase() })} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label={t('start.people.insurer')}>
                          <input className="input" aria-label={t('start.people.insurerOf', { id: v.id.toUpperCase() })} value={v.insurer} onChange={(e) => updateVehicle(v.id, { insurer: e.target.value })} autoComplete="off" />
                        </Field>
                        <Field label={t('start.people.policy')}>
                          <input className="input uppercase" aria-label={t('start.people.policyOf', { id: v.id.toUpperCase() })} value={v.policy} onChange={(e) => updateVehicle(v.id, { policy: e.target.value })} autoComplete="off" />
                        </Field>
                        <Field label={t('start.people.owner')}>
                          <input className="input" aria-label={t('start.people.ownerOf', { id: v.id.toUpperCase() })} value={v.owner} onChange={(e) => updateVehicle(v.id, { owner: e.target.value })} autoComplete="off" />
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
        title={t('start.people.passengersTitle')}
        hint={t('start.people.passengersHint')}
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => addPerson('passenger', mine.id)}>
            <Icon.plus /> {t('start.people.addPassenger')}
          </button>
        }
      >
        <div className="space-y-3">
          {claim.people.map((p, index) =>
            p.role !== 'passenger' ? null : (
              <div key={index} className="card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  {/* min-w-0 lets the select shrink below its longest option — a Spanish vehicle line pushed the row off a phone screen */}
                  <select className="input w-auto min-w-0" aria-label={t('start.people.whichVehicle')} value={p.vehicle ?? ''} onChange={(e) => updatePerson(index, { vehicle: e.target.value })}>
                    {claim.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {t('start.people.inVehicle', { id: v.id.toUpperCase(), vehicle: vehicleOf(v, 'customer', lang) })}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-sm shrink-0" onClick={() => removePerson(index)} aria-label={t('start.people.removePassenger')}>
                    <Icon.x /> {t('common.remove')}
                  </button>
                </div>
                <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who={t('role.passenger')} />
              </div>
            ),
          )}
          {!claim.people.some((p) => p.role === 'passenger') && <p className="text-sm text-slate-400">{t('start.people.noPassengers')}</p>}
        </div>
      </Section>

      <Section title={t('start.people.hurtTitle')} hint={t('start.people.hurtHint')}>
        <div className="card p-5">
          <YesNo value={hurt} onChange={answerHurt} name={t('start.people.hurtGroup')} />
          {hurt && (
            <div className="mt-4 space-y-3">
              {missingDrivers.map((v) => (
                <label key={v.id} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={false} onChange={() => setDriver(v.id, { self: v.role === 'insured', injured: true })} />
                  <span>{personLine({ ...newPerson('driver', v.id), self: v.role === 'insured' }, claim.vehicles, 'customer', lang)}</span>
                </label>
              ))}
              {listed.map(({ p, index }) => (
                <div key={index}>
                  <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1" checked={p.injured} onChange={(e) => updatePerson(index, { injured: e.target.checked, injury: e.target.checked ? p.injury : '' })} />
                    <span>{personLine(p, claim.vehicles, 'customer', lang)}</span>
                  </label>
                  {p.injured && (
                    <div className="mt-2 ml-7 space-y-2">
                      {p.role === 'pedestrian' && <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who={t('start.people.whoInjured')} />}
                      <textarea
                        className="input min-h-20"
                        aria-label={t('start.people.injuryOf', { who: displayName(p.name, lang) || t('start.people.thisPerson') })}
                        placeholder={t('start.people.injuryHint')}
                        value={p.injury}
                        onChange={(e) => updatePerson(index, { injury: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => addPerson('pedestrian')}>
                <Icon.plus /> {t('start.people.addPedestrian')}
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title={t('start.people.policeTitle')} hint={t('start.people.policeHint')}>
        <div className="card p-5">
          <YesNo value={claim.police.called} onChange={(called) => setPolice({ called })} name={t('start.people.policeGroup')} />
          {claim.police.called && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label={t('start.people.department')}>
                <input className="input" aria-label={t('start.people.department')} value={claim.police.department} onChange={(e) => setPolice({ department: e.target.value })} autoComplete="off" />
              </Field>
              <Field label={t('start.people.reportNumber')}>
                <input className="input uppercase" aria-label={t('start.people.reportNumberOf')} value={claim.police.report} onChange={(e) => setPolice({ report: e.target.value })} autoComplete="off" />
              </Field>
              <Field label={t('start.people.tickets')}>
                <input className="input" aria-label={t('start.people.citations')} value={claim.police.citations} onChange={(e) => setPolice({ citations: e.target.value })} autoComplete="off" />
              </Field>
            </div>
          )}
        </div>
      </Section>

      <Section
        title={t('start.people.witnessTitle')}
        hint={t('start.people.witnessHint')}
        action={
          <button className="btn btn-secondary btn-sm" onClick={() => addPerson('witness')}>
            <Icon.plus /> {t('start.people.addWitness')}
          </button>
        }
      >
        <div className="space-y-3">
          {claim.people.map((p, index) =>
            p.role !== 'witness' ? null : (
              <div key={index} className="card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">{t('role.witness')}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => removePerson(index)} aria-label={t('start.people.removeWitness')}>
                    <Icon.x /> {t('common.remove')}
                  </button>
                </div>
                <Contact person={p} onChange={(patch) => updatePerson(index, patch)} who={t('role.witness')} />
              </div>
            ),
          )}
          {!claim.people.some((p) => p.role === 'witness') && <p className="text-sm text-slate-400">{t('start.people.noWitnesses')}</p>}
        </div>
      </Section>
    </div>
  )
}
