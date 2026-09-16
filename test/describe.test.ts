import { describe, expect, it } from 'vitest'
import { conditionLabels, contactLine, driverName, driverShort, gaps, ownerLabel, personLine, vehicleName, whose, UNKNOWN_DRIVER } from '../src/claim/describe'
import { emptyClaim, newPerson, newVehicle, type Claim } from '../src/claim/schema'

const mine = { ...newVehicle('a', 'insured', 'sedan', '#b91c1c'), make: 'Toyota', model: 'Camry', year: 2022 }
const theirs = newVehicle('b', 'other', 'suv', '#1c1f26')
const vehicles = [mine, theirs]

describe('how the report names things', () => {
  it('a vehicle by make, model and year, or by colour and shape', () => {
    expect(vehicleName(mine)).toBe('2022 Toyota Camry')
    expect(vehicleName(theirs)).toBe('black suv')
  })

  it('a person by what they were doing there', () => {
    expect(personLine({ ...newPerson('driver', 'a'), self: true }, vehicles)).toBe('You, driving your 2022 Toyota Camry')
    expect(personLine({ ...newPerson('driver', 'b'), name: 'Dana Quinn' }, vehicles)).toBe('Dana Quinn, driving their black suv')
    expect(personLine(newPerson('driver', 'b'), vehicles)).toBe('The driver of their black suv')
    expect(personLine({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER }, vehicles)).toBe('The driver of their black suv — unknown, they left the scene')
    expect(personLine({ ...newPerson('passenger', 'a'), name: 'Sam Lee' }, vehicles)).toBe('Sam Lee, passenger in your 2022 Toyota Camry')
    expect(personLine(newPerson('passenger', 'a'), vehicles)).toBe('A passenger in your 2022 Toyota Camry')
    expect(personLine({ ...newPerson('pedestrian'), name: 'Jo' }, vehicles)).toBe('Jo, on foot or a bike')
    expect(personLine(newPerson('witness'), vehicles)).toBe('A witness')
    expect(personLine({ ...newPerson('witness'), name: 'Wit Ness' }, vehicles)).toBe('Wit Ness, who saw it happen')
  })

  it('a driver inside a group that already names the vehicle', () => {
    expect(driverShort({ ...newPerson('driver', 'a'), self: true })).toBe('You, driving')
    expect(driverShort({ ...newPerson('driver', 'b'), name: 'Dana Quinn' })).toBe('Dana Quinn, driving')
    expect(driverShort({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER })).toBe('The driver — unknown, they left the scene')
    expect(driverShort(newPerson('driver', 'b'))).toBe('The driver — name not given')
    expect(driverName(undefined)).toBeNull()
    expect(driverName({ ...newPerson('driver', 'a'), self: true })).toBe('You')
    expect(driverName({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER })).toBe('Unknown — left the scene')
    expect(driverName(newPerson('driver', 'b'))).toBeNull()
  })

  it('contact details, only what was given', () => {
    expect(contactLine({ ...newPerson('driver', 'b'), phone: '555 0199', licence: 'D1' })).toBe('555 0199 · licence D1')
    expect(contactLine({ ...newPerson('driver', 'b'), phone: '555 0199' })).toBe('555 0199')
    expect(contactLine(newPerson('driver', 'b'))).toBe('')
  })

  it('what is worth adding before sending, in the order an adjuster would ask', () => {
    const c: Claim = { ...emptyClaim(), vehicles }
    expect(gaps(c).map((g) => g.text)).toEqual([
      'Say what happened in your own words',
      'Who was driving their black suv, or their insurer',
      'Whether the police were called',
      'Where 2022 Toyota Camry is damaged',
      'A photo or two of the damage',
      'Whether your car can still be driven',
      'A phone number or email so we can reach you',
    ])
    // a complete report has none
    const full: Claim = {
      ...c,
      incident: { ...c.incident, description: 'He turned across me' },
      vehicles: [{ ...mine, damages: [{ zone: 'front_bumper', point: [0, 0.34, 1.24], severity: 'dent', note: '' }], condition: { ...mine.condition, drivable: true } }, { ...theirs, insurer: 'Acme' }],
      police: { ...c.police, called: false },
      reporter: { ...c.reporter, phone: '555' },
      attachments: { ...c.attachments, photos: [{ data: 'data:image/jpeg;base64,AAAA', of: null, caption: '' }] },
    }
    expect(gaps(full)).toEqual([])
    // a hail claim has no other driver to ask about, and the words go on the damage step
    const hail: Claim = { ...c, incident: { ...c.incident, kind: 'weather' }, vehicles: [mine] }
    expect(gaps(hail)[0]).toEqual({ text: 'Say what happened in your own words', step: 'damage' })
    expect(gaps(hail).some((g) => /driving/.test(g.text))).toBe(false)
  })

  it('speaks to the desk about a policyholder, not to a customer about themselves', () => {
    const self = { ...newPerson('driver', 'a'), self: true }
    const other = { ...newPerson('driver', 'b'), name: 'Dana Quinn' }

    expect(whose(mine, 'desk')).toBe("the policyholder's")
    expect(whose(theirs, 'desk')).toBe("the other party's")
    expect(ownerLabel(mine, 'desk')).toBe("Policyholder's vehicle")
    expect(ownerLabel(theirs, 'desk')).toBe("Other party's vehicle")
    expect(personLine(self, vehicles, 'desk')).toBe("The policyholder, driving the policyholder's 2022 Toyota Camry")
    expect(personLine(other, vehicles, 'desk')).toBe("Dana Quinn, driving the other party's black suv")
    expect(personLine({ ...newPerson('passenger', 'a'), name: 'Sam Lee' }, vehicles, 'desk')).toBe("Sam Lee, passenger in the policyholder's 2022 Toyota Camry")
    expect(driverShort(self, 'desk')).toBe('The policyholder, driving')
    expect(driverShort(other, 'desk')).toBe('Dana Quinn, driving')
    expect(driverName(self, 'desk')).toBe('The policyholder')
    expect(driverName(other, 'desk')).toBe('Dana Quinn')
    // someone who is not the customer reads the same whichever voice is asked for
    expect(driverShort({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER }, 'desk')).toBe('The driver — unknown, they left the scene')
    expect(personLine(newPerson('witness'), vehicles, 'desk')).toBe('A witness')

    // and the customer's own voice is exactly what it was
    expect(whose(mine)).toBe('your')
    expect(ownerLabel(mine)).toBe('Your vehicle')
    expect(personLine(self, vehicles)).toBe('You, driving your 2022 Toyota Camry')
    expect(driverShort(self)).toBe('You, driving')
    expect(driverName(self)).toBe('You')
  })

  it('conditions as labels, skipping what was not answered', () => {
    expect(conditionLabels({ weather: 'rain', road: 'wet', light: 'dark_lit' })).toEqual(['Rain', 'Wet road', 'Dark, street lights on'])
    expect(conditionLabels({ weather: '', road: 'icy', light: '' })).toEqual(['Icy road'])
    expect(conditionLabels({ weather: '', road: '', light: '' })).toEqual([])
  })
})
