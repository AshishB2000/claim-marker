/**
 * How the report talks about its own contents — one place, so the people step, the review
 * and the summary an adjuster reads all say "Sam Lee, passenger in your 2022 Toyota Camry"
 * rather than each inventing a different fragment of it.
 *
 * Two voices, because the same document is read by two people. The customer is spoken to in
 * the second person — "your Camry", "You, driving" — which is right on a form they are
 * filling in and wrong on an adjuster's screen, where the person is not in the room and is
 * one of several parties. `voice: 'desk'` says "the policyholder's Camry" instead. Every
 * function defaults to `'customer'`, so the steps and the review are untouched; only
 * `ReportDocument` with `voice="desk"` asks for the other one.
 *
 * Two languages, for the customer only: the desk always reads English. Spanish is not English
 * with the words swapped — it puts the year after the model, contracts "de el" to "del", and
 * genders the people and the cars. A person's gender is unknowable from a claim form, so the
 * Spanish sentences are built around neutral constructions ("quien conducía", "alguien que
 * viajaba en…"); a car's is unknowable once it is "a black SUV" rather than a Camry, so the
 * other party's vehicle is named as "el otro vehículo (…)" and colours follow "de color".
 * Every function takes `lang` last and defaults to English, so English output is exactly
 * what it always was.
 */
import { translate, type Key, type Lang } from '../i18n'
import { PAINTS, paintLabel } from '../vehicles/paint'
import { VEHICLES } from '../zones'
import { KIND_INFO, LIGHT_LABEL, type Claim, type ClaimVehicle, type Conditions, type Person } from './schema'

/** who the sentence is being read by: the customer filling it in, or the desk reading it */
export type Voice = 'customer' | 'desk'

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const uncap = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** "de" before a noun phrase, contracting "de el" the way Spanish always does */
const de = (phrase: string) => (phrase.startsWith('el ') ? `del ${phrase.slice(3)}` : `de ${phrase}`)

/** "2022 Toyota Camry" / "Toyota Camry 2022", or "red sedan" / "sedán de color rojo" when the make is not known */
export function vehicleName(v: ClaimVehicle, lang: Lang = 'en'): string {
  if (lang === 'es') {
    const named = [v.make, v.model, v.year].filter(Boolean).join(' ')
    if (named) return named
    const paint = PAINTS.find((p) => p.hex === v.color.toLowerCase())?.id ?? 'custom'
    return `${uncap(translate('es', `body.${v.body}` as Key))} de color ${translate('es', `paint.${paint}` as Key).toLowerCase()}`
  }
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || `${paintLabel(v.color).toLowerCase()} ${VEHICLES[v.body].label.toLowerCase()}`
}

/** "your" for the customer's vehicle, "their" for anyone else's; "the policyholder's" / "the other party's" to the desk */
export const whose = (v: ClaimVehicle, voice: Voice = 'customer', lang: Lang = 'en') =>
  lang === 'es'
    ? v.role === 'insured'
      ? 'tu'
      : 'el otro vehículo'
    : voice === 'desk'
      ? v.role === 'insured'
        ? "the policyholder's"
        : "the other party's"
      : v.role === 'insured'
        ? 'your'
        : 'their'

/**
 * A vehicle with its owner in front: "your 2022 Toyota Camry", "tu Toyota Camry 2022", "el
 * otro vehículo (camioneta SUV de color negro)". Use this rather than putting `whose` and
 * `vehicleName` side by side in a step: in Spanish they do not simply sit side by side.
 */
export const vehicleOf = (v: ClaimVehicle, voice: Voice = 'customer', lang: Lang = 'en') =>
  lang === 'es'
    ? v.role === 'insured'
      ? `tu ${vehicleName(v, 'es')}`
      : `el otro vehículo (${vehicleName(v, 'es')})`
    : `${whose(v, voice)} ${vehicleName(v)}`

/** the tag beside a vehicle's name in a list */
export const ownerLabel = (v: ClaimVehicle, voice: Voice = 'customer', lang: Lang = 'en') =>
  lang === 'es'
    ? v.role === 'insured'
      ? 'Tu vehículo'
      : 'Otro vehículo'
    : voice === 'desk'
      ? v.role === 'insured'
        ? "Policyholder's vehicle"
        : "Other party's vehicle"
      : v.role === 'insured'
        ? 'Your vehicle'
        : 'Other vehicle'

/**
 * What goes in the name when the other driver drove off. This is data — it is stored in the
 * document in English whatever language the customer used — so it is displayed through
 * `displayName`, never shown raw.
 */
export const UNKNOWN_DRIVER = 'Unknown — left the scene'

/** a person's name as the customer should see it: the English marker for "left the scene" read in their language */
export const displayName = (name: string, lang: Lang = 'en') => (lang === 'es' && name === UNKNOWN_DRIVER ? 'Se desconoce — se fue del lugar' : name)

/** one line naming a person by what they were doing there */
export function personLine(p: Person, vehicles: ClaimVehicle[], voice: Voice = 'customer', lang: Lang = 'en'): string {
  const v = p.vehicle ? vehicles.find((x) => x.id === p.vehicle) : undefined
  if (lang === 'es') {
    const car = v ? vehicleOf(v, voice, 'es') : 'un vehículo'
    switch (p.role) {
      case 'driver':
        if (p.self) return `Tú, al volante ${de(car)}`
        if (p.name === UNKNOWN_DRIVER) return `Quien conducía ${car} — se desconoce, se fue del lugar`
        return p.name ? `${p.name}, al volante ${de(car)}` : `Quien conducía ${car}`
      case 'passenger':
        return p.name ? `${p.name}, viajaba en ${car}` : `Alguien que viajaba en ${car}`
      case 'pedestrian':
        return p.name ? `${p.name}, a pie o en bicicleta` : 'Alguien a pie o en bicicleta'
      case 'witness':
        return p.name ? `${p.name}, que vio lo que pasó` : 'Alguien que vio lo que pasó'
    }
  }
  const car = v ? vehicleOf(v, voice) : 'a vehicle'
  switch (p.role) {
    case 'driver':
      if (p.self) return voice === 'desk' ? `The policyholder, driving ${car}` : `You, driving ${car}`
      if (p.name === UNKNOWN_DRIVER) return `The driver of ${car} — unknown, they left the scene`
      return p.name ? `${p.name}, driving ${car}` : `The driver of ${car}`
    case 'passenger':
      return p.name ? `${p.name}, passenger in ${car}` : `A passenger in ${car}`
    case 'pedestrian':
      return p.name ? `${p.name}, on foot or a bike` : 'Someone on foot or a bike'
    case 'witness':
      return p.name ? `${p.name}, who saw it happen` : 'A witness'
  }
}

/** the driver inside a group already headed by the vehicle: "You, driving", "Dana Quinn, driving" */
export function driverShort(p: Person, voice: Voice = 'customer', lang: Lang = 'en'): string {
  if (lang === 'es') {
    if (p.self) return 'Tú, al volante'
    if (p.name === UNKNOWN_DRIVER) return 'Quien conducía — se desconoce, se fue del lugar'
    return p.name ? `${p.name}, al volante` : 'Quien conducía — sin nombre'
  }
  if (p.self) return voice === 'desk' ? 'The policyholder, driving' : 'You, driving'
  if (p.name === UNKNOWN_DRIVER) return 'The driver — unknown, they left the scene'
  return p.name ? `${p.name}, driving` : 'The driver — name not given'
}

/** the driver's name for a label/value row: the name, or why there is none */
export function driverName(p: Person | undefined, voice: Voice = 'customer', lang: Lang = 'en'): string | null {
  if (!p) return null
  if (p.self) return lang === 'es' ? 'Tú' : voice === 'desk' ? 'The policyholder' : 'You'
  if (p.name === UNKNOWN_DRIVER) return lang === 'es' ? 'Se desconoce — se fue del lugar' : 'Unknown — left the scene'
  return p.name || null
}

/** phone and licence, whichever were given */
export const contactLine = (p: Person, lang: Lang = 'en'): string =>
  [p.phone, p.licence && `${lang === 'es' ? 'licencia' : 'licence'} ${p.licence}`].filter(Boolean).join(' · ')

export const yesNo = (v: boolean | null, lang: Lang = 'en'): string | null =>
  v === null ? null : translate(lang, v ? 'common.yes' : 'common.no')

/** something worth adding before the report is sent, and the step it lives on */
export type Gap = { text: string; step: 'where' | 'vehicles' | 'people' | 'scene' | 'damage' | 'review' }

/**
 * What an adjuster would ring up to ask about, in the order they would ask. None of these
 * blocks sending — a report with gaps beats no report — but each is a call saved. Second
 * person throughout: this only ever runs for the customer, on their own review page.
 */
export function gaps(claim: Claim, lang: Lang = 'en'): Gap[] {
  const es = lang === 'es'
  const out: Gap[] = []
  const info = KIND_INFO[claim.incident.kind]
  const mine = claim.vehicles.find((v) => v.role === 'insured')
  const others = claim.vehicles.filter((v) => v.role !== 'insured')
  if (!claim.incident.description.trim())
    out.push({ text: es ? 'Cuenta con tus palabras lo que pasó' : 'Say what happened in your own words', step: info.diagram ? 'scene' : 'damage' })
  for (const v of others) {
    const driver = claim.people.find((p) => p.role === 'driver' && p.vehicle === v.id)
    if (!driver?.name && !v.insurer)
      out.push({ text: es ? `Quién conducía ${vehicleOf(v, 'customer', 'es')}, o su aseguradora` : `Who was driving ${vehicleOf(v)}, or their insurer`, step: 'people' })
  }
  if (claim.police.called === null) out.push({ text: es ? 'Si se llamó a la policía' : 'Whether the police were called', step: 'people' })
  if (mine && mine.damages.length === 0)
    out.push({ text: es ? `Dónde tiene daños ${vehicleOf(mine, 'customer', 'es')}` : `Where ${vehicleName(mine)} is damaged`, step: 'damage' })
  if (claim.attachments.photos.length === 0) out.push({ text: es ? 'Una o dos fotos de los daños' : 'A photo or two of the damage', step: 'damage' })
  if (mine && mine.condition.drivable === null)
    out.push({ text: es ? 'Si tu vehículo todavía se puede manejar' : 'Whether your car can still be driven', step: 'damage' })
  if (!claim.reporter.phone.trim() && !claim.reporter.email.trim())
    out.push({ text: es ? 'Un teléfono o correo electrónico para contactarte' : 'A phone number or email so we can reach you', step: 'review' })
  return out
}

/** the conditions as short readable labels: "Rain", "Wet road", "Dark, street lights on" */
export function conditionLabels(c: Conditions, lang: Lang = 'en'): string[] {
  if (lang === 'es') {
    return [
      c.weather && translate('es', `weather.${c.weather}`),
      c.road && translate('es', 'road.phrase', { road: translate('es', `road.${c.road}`).toLowerCase() }),
      c.light && translate('es', `light.${c.light}`),
    ].filter((s): s is string => !!s)
  }
  return [c.weather && cap(c.weather), c.road && `${cap(c.road)} road`, c.light && LIGHT_LABEL[c.light]].filter((s): s is string => !!s)
}
