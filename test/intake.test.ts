import { beforeEach, describe, expect, it } from 'vitest'
import type { IntakeDraft } from '../src/assist/schema'
import { useClaim, type IntakeTake } from '../src/claim/store'

const allTake = (draft: IntakeDraft): IntakeTake => ({
  kind: true,
  when: true,
  place: true,
  conditions: true,
  vehicles: (draft.vehicles ?? []).map(() => true),
  people: true,
  police: true,
  property: true,
})

beforeEach(() => {
  useClaim.getState().reset()
})

describe('applyIntake: "Just tell us what happened", applied piece by piece', () => {
  it('fills an empty field and leaves one the customer already typed alone', () => {
    const insured = useClaim.getState().claim.vehicles.find((v) => v.role === 'insured')!
    useClaim.getState().updateVehicle(insured.id, { make: 'Honda' })

    const draft: IntakeDraft = { vehicles: [{ role: 'insured', make: 'Toyota', model: 'Camry' }] }
    useClaim.getState().applyIntake(draft, allTake(draft), 'it happened')

    const mine = useClaim.getState().claim.vehicles.find((v) => v.role === 'insured')!
    expect(mine.make).toBe('Honda')
    expect(mine.model).toBe('Camry')
  })

  it('leaves a field untouched when the customer unticks its row', () => {
    const draft: IntakeDraft = { kind: 'theft' }
    useClaim.getState().applyIntake(draft, { ...allTake(draft), kind: false }, 'stolen overnight')
    expect(useClaim.getState().claim.incident.kind).toBe('collision')
  })

  it('sets the description to the transcript verbatim, never the draft’s own summary', () => {
    const draft: IntakeDraft = { description: 'A model-written summary.' }
    useClaim.getState().applyIntake(draft, allTake(draft), 'my own words about what happened')
    expect(useClaim.getState().claim.incident.description).toBe('my own words about what happened')
  })

  it('adds an other vehicle beyond the ones already on the claim', () => {
    const before = useClaim.getState().claim.vehicles.length
    const draft: IntakeDraft = {
      vehicles: [
        { role: 'other', make: 'Ford' },
        { role: 'other', make: 'Honda' },
      ],
    }
    useClaim.getState().applyIntake(draft, allTake(draft), 'two other cars were there')
    const vehicles = useClaim.getState().claim.vehicles
    // one draft entry fills the other vehicle already on the claim; the second adds a new one
    expect(vehicles).toHaveLength(before + 1)
    expect(vehicles.some((v) => v.make === 'Ford')).toBe(true)
    expect(vehicles.some((v) => v.make === 'Honda')).toBe(true)
  })

  it('lands a person with vehicle "insured" in the insured vehicle, with no name', () => {
    const draft: IntakeDraft = { people: [{ role: 'driver', vehicle: 'insured', injured: false }] }
    useClaim.getState().applyIntake(draft, allTake(draft), 'I was driving')
    const insured = useClaim.getState().claim.vehicles.find((v) => v.role === 'insured')!
    const people = useClaim.getState().claim.people
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ role: 'driver', vehicle: insured.id, name: '', injured: false })
  })

  it('adds people only to a claim that has none yet, so a second run adds no one twice', () => {
    const draft: IntakeDraft = { people: [{ role: 'driver', vehicle: 'insured', injured: true, injury: 'sore neck' }] }
    useClaim.getState().applyIntake(draft, allTake(draft), 'I hurt my neck')
    useClaim.getState().applyIntake(draft, allTake(draft), 'I hurt my neck')
    expect(useClaim.getState().claim.people).toHaveLength(1)
    expect(useClaim.getState().claim.people[0].injury).toBe('sore neck')
  })

  it('leaves the people the customer already entered alone', () => {
    useClaim.getState().addPerson('witness')
    const draft: IntakeDraft = { people: [{ role: 'driver', vehicle: 'insured', injured: false }] }
    useClaim.getState().applyIntake(draft, allTake(draft), 'I was driving')
    expect(useClaim.getState().claim.people.map((p) => p.role)).toEqual(['witness'])
  })

  it('fills police and conditions only where the customer left them empty', () => {
    useClaim.getState().setPolice({ called: true })
    const draft: IntakeDraft = { police: { called: false, report: 'RPT-1' }, conditions: { weather: 'rain' } }
    useClaim.getState().applyIntake(draft, allTake(draft), 'it rained')
    const { police, incident } = useClaim.getState().claim
    expect(police.called).toBe(true) // theirs already; the draft's answer is dropped
    expect(police.report).toBe('RPT-1') // was empty, so this fills it
    expect(incident.conditions.weather).toBe('rain')
  })

  it('sets placeQuery and drawFromWords from the draft, never coordinates', () => {
    const draft: IntakeDraft = {
      place: 'Main St and 3rd Ave',
      vehicles: [{ role: 'insured', make: 'Toyota' }],
      description: 'we collided at the intersection',
    }
    useClaim.getState().applyIntake(draft, allTake(draft), 'we collided at the intersection')
    expect(useClaim.getState().placeQuery).toBe('Main St and 3rd Ave')
    expect(useClaim.getState().drawFromWords).toBe(true)
  })

  it('leaves drawFromWords false without both a vehicle and a description in the draft', () => {
    const draft: IntakeDraft = { place: 'somewhere' }
    useClaim.getState().applyIntake(draft, allTake(draft), 'somewhere')
    expect(useClaim.getState().drawFromWords).toBe(false)
  })

  it('reset() clears placeQuery and drawFromWords', () => {
    const draft: IntakeDraft = { place: 'somewhere', vehicles: [{ role: 'insured' }], description: 'x' }
    useClaim.getState().applyIntake(draft, allTake(draft), 'x')
    expect(useClaim.getState().placeQuery).not.toBeNull()
    useClaim.getState().reset()
    expect(useClaim.getState().placeQuery).toBeNull()
    expect(useClaim.getState().drawFromWords).toBe(false)
  })
})
