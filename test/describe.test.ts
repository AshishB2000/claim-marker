import { describe, expect, it } from 'vitest'
import { cap, conditionLabels, contactLine, displayName, driverName, driverShort, gaps, ownerLabel, personLine, vehicleName, vehicleOf, whose, yesNo, UNKNOWN_DRIVER, lookedUpLines } from '../src/claim/describe'
import { emptyClaim, newPerson, newVehicle, type Claim , type SceneContext } from '../src/claim/schema'

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

/**
 * The same sentences in Spanish, written out in full rather than composed by the test, so a
 * change to any of them has to be made here on purpose. Spanish is not English with the words
 * swapped: the year follows the model, "de el" contracts to "del", and nothing about a person
 * is gendered.
 */
describe('how the report names things in Spanish', () => {
  it('a vehicle by make, model and year, or by shape and colour', () => {
    expect(vehicleName(mine, 'es')).toBe('Toyota Camry 2022')
    expect(vehicleName(theirs, 'es')).toBe('camioneta SUV de color negro')
  })

  it('whose it is, and the vehicle with its owner in front', () => {
    expect(whose(mine, 'customer', 'es')).toBe('tu')
    expect(whose(theirs, 'customer', 'es')).toBe('el otro vehículo')
    expect(vehicleOf(mine, 'customer', 'es')).toBe('tu Toyota Camry 2022')
    expect(vehicleOf(theirs, 'customer', 'es')).toBe('el otro vehículo (camioneta SUV de color negro)')
    expect(ownerLabel(mine, 'customer', 'es')).toBe('Tu vehículo')
    expect(ownerLabel(theirs, 'customer', 'es')).toBe('Otro vehículo')
  })

  it('a person by what they were doing there, without gendering them', () => {
    expect(personLine({ ...newPerson('driver', 'a'), self: true }, vehicles, 'customer', 'es')).toBe('Tú, al volante de tu Toyota Camry 2022')
    expect(personLine({ ...newPerson('driver', 'b'), name: 'Dana Quinn' }, vehicles, 'customer', 'es')).toBe(
      'Dana Quinn, al volante del otro vehículo (camioneta SUV de color negro)',
    )
    expect(personLine(newPerson('driver', 'b'), vehicles, 'customer', 'es')).toBe('Quien conducía el otro vehículo (camioneta SUV de color negro)')
    expect(personLine({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER }, vehicles, 'customer', 'es')).toBe(
      'Quien conducía el otro vehículo (camioneta SUV de color negro) — se desconoce, se fue del lugar',
    )
    expect(personLine({ ...newPerson('passenger', 'a'), name: 'Sam Lee' }, vehicles, 'customer', 'es')).toBe('Sam Lee, viajaba en tu Toyota Camry 2022')
    expect(personLine(newPerson('passenger', 'a'), vehicles, 'customer', 'es')).toBe('Alguien que viajaba en tu Toyota Camry 2022')
    expect(personLine({ ...newPerson('pedestrian'), name: 'Jo' }, vehicles, 'customer', 'es')).toBe('Jo, a pie o en bicicleta')
    expect(personLine(newPerson('pedestrian'), vehicles, 'customer', 'es')).toBe('Alguien a pie o en bicicleta')
    expect(personLine(newPerson('witness'), vehicles, 'customer', 'es')).toBe('Alguien que vio lo que pasó')
    expect(personLine({ ...newPerson('witness'), name: 'Wit Ness' }, vehicles, 'customer', 'es')).toBe('Wit Ness, que vio lo que pasó')
  })

  it('a driver inside a group that already names the vehicle', () => {
    expect(driverShort({ ...newPerson('driver', 'a'), self: true }, 'customer', 'es')).toBe('Tú, al volante')
    expect(driverShort({ ...newPerson('driver', 'b'), name: 'Dana Quinn' }, 'customer', 'es')).toBe('Dana Quinn, al volante')
    expect(driverShort({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER }, 'customer', 'es')).toBe('Quien conducía — se desconoce, se fue del lugar')
    expect(driverShort(newPerson('driver', 'b'), 'customer', 'es')).toBe('Quien conducía — sin nombre')
    expect(driverName(undefined, 'customer', 'es')).toBeNull()
    expect(driverName({ ...newPerson('driver', 'a'), self: true }, 'customer', 'es')).toBe('Tú')
    expect(driverName({ ...newPerson('driver', 'b'), name: UNKNOWN_DRIVER }, 'customer', 'es')).toBe('Se desconoce — se fue del lugar')
    expect(driverName(newPerson('driver', 'b'), 'customer', 'es')).toBeNull()
  })

  it('shows the English marker for a driver who left, without changing what is stored', () => {
    expect(displayName(UNKNOWN_DRIVER, 'es')).toBe('Se desconoce — se fue del lugar')
    expect(displayName(UNKNOWN_DRIVER)).toBe(UNKNOWN_DRIVER)
    expect(displayName('Dana Quinn', 'es')).toBe('Dana Quinn')
  })

  it('contact details, yes and no, and a capital letter', () => {
    expect(contactLine({ ...newPerson('driver', 'b'), phone: '555 0199', licence: 'D1' }, 'es')).toBe('555 0199 · licencia D1')
    expect(contactLine({ ...newPerson('driver', 'b'), phone: '555 0199' }, 'es')).toBe('555 0199')
    expect(contactLine(newPerson('driver', 'b'), 'es')).toBe('')
    expect(yesNo(true, 'es')).toBe('Sí')
    expect(yesNo(false, 'es')).toBe('No')
    expect(yesNo(null, 'es')).toBeNull()
    expect(cap('lluvia')).toBe('Lluvia')
  })

  it('what is worth adding before sending', () => {
    const c: Claim = { ...emptyClaim(), vehicles }
    expect(gaps(c, 'es').map((g) => g.text)).toEqual([
      'Cuenta con tus palabras lo que pasó',
      'Quién conducía el otro vehículo (camioneta SUV de color negro), o su aseguradora',
      'Si se llamó a la policía',
      'Dónde tiene daños tu Toyota Camry 2022',
      'Una o dos fotos de los daños',
      'Si tu vehículo todavía se puede manejar',
      'Un teléfono o correo electrónico para contactarte',
    ])
    // the steps they point at are the same steps whatever the language
    expect(gaps(c, 'es').map((g) => g.step)).toEqual(gaps(c).map((g) => g.step))
  })

  it('conditions as labels, skipping what was not answered', () => {
    expect(conditionLabels({ weather: 'rain', road: 'wet', light: 'dark_lit' }, 'es')).toEqual(['Lluvia', 'Camino mojado', 'De noche, con alumbrado'])
    expect(conditionLabels({ weather: '', road: 'icy', light: '' }, 'es')).toEqual(['Camino con hielo'])
    expect(conditionLabels({ weather: '', road: '', light: '' }, 'es')).toEqual([])
  })
})

describe('what the record said, as the card and the report read it', () => {
  const ctx: SceneContext = {
    weather: { code: 61, label: 'Light rain', tempC: 11.4, precipMm: 0.3, windKph: 34 },
    sun: { altitude: 4, azimuth: 270 },
    road: { name: '5th Avenue', class: 'primary', lanes: 2, oneway: true, maxspeed: '25 mph', lit: true, junction: 'cross', controls: ['crossing', 'traffic_signals'] },
    source: 'open-meteo+osm',
    fetchedAt: '2026-09-07T22:10:00.000Z',
  }

  it('reads the weather, the road, the light with the low sun, and the street', () => {
    expect(lookedUpLines(ctx, { weather: 'rain', road: 'wet', light: 'dusk' })).toEqual([
      'Rain, 11 °C, wind 34 km/h',
      'Wet road',
      'dusk or dawn, the sun low in the west',
      '5th Avenue, 2 lanes, one-way, 25 mph, a crossroads, a pedestrian crossing, traffic lights',
    ])
  })

  it('follows the customer once they have changed an answer: the card is a receipt, not an argument', () => {
    expect(lookedUpLines(ctx, { weather: 'clear', road: '', light: '' })[0]).toBe('Clear, 11 °C, wind 34 km/h')
  })

  it('says it was dark from the sun alone when the record cannot say whether the street was lit', () => {
    const night = { ...ctx, sun: { altitude: -20, azimuth: 0 }, road: { ...ctx.road!, lit: null } }
    expect(lookedUpLines(night, { weather: 'rain', road: 'wet', light: '' })).toContain('After dark')
    // and not when the customer has answered it themselves
    expect(lookedUpLines(night, { weather: 'rain', road: 'wet', light: 'dark_lit' })).not.toContain('After dark')
  })

  it('reads in Spanish without English left in it', () => {
    const lines = lookedUpLines(ctx, { weather: 'rain', road: 'wet', light: 'dusk' }, 'es')
    expect(lines[0]).toBe('Lluvia, 11 °C, viento 34 km/h')
    expect(lines[2]).toBe('al atardecer o al amanecer, con el sol bajo hacia el oeste')
    expect(lines[3]).toContain('semáforo')
  })

  it('prints only what came back', () => {
    expect(lookedUpLines({ ...ctx, weather: null, road: null }, { weather: '', road: '', light: '' })).toEqual([])
  })
})
