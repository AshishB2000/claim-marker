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
 */
import { paintLabel } from '../vehicles/paint'
import { VEHICLES } from '../zones'
import { KIND_INFO, LIGHT_LABEL, type Claim, type ClaimVehicle, type Conditions, type Person } from './schema'

/** who the sentence is being read by: the customer filling it in, or the desk reading it */
export type Voice = 'customer' | 'desk'

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** "2022 Toyota Camry", or "red sedan" when the make is not known */
export const vehicleName = (v: ClaimVehicle): string =>
  [v.year, v.make, v.model].filter(Boolean).join(' ') || `${paintLabel(v.color).toLowerCase()} ${VEHICLES[v.body].label.toLowerCase()}`

/** "your" / "their" to the customer, "the policyholder's" / "the other party's" to the desk */
export const whose = (v: ClaimVehicle, voice: Voice = 'customer') =>
  voice === 'desk' ? (v.role === 'insured' ? "the policyholder's" : "the other party's") : v.role === 'insured' ? 'your' : 'their'

/** the tag beside a vehicle's name in a list */
export const ownerLabel = (v: ClaimVehicle, voice: Voice = 'customer') =>
  voice === 'desk' ? (v.role === 'insured' ? "Policyholder's vehicle" : "Other party's vehicle") : v.role === 'insured' ? 'Your vehicle' : 'Other vehicle'

/** what goes in the name when the other driver drove off */
export const UNKNOWN_DRIVER = 'Unknown — left the scene'

/** one line naming a person by what they were doing there */
export function personLine(p: Person, vehicles: ClaimVehicle[], voice: Voice = 'customer'): string {
  const v = p.vehicle ? vehicles.find((x) => x.id === p.vehicle) : undefined
  const car = v ? `${whose(v, voice)} ${vehicleName(v)}` : 'a vehicle'
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
export function driverShort(p: Person, voice: Voice = 'customer'): string {
  if (p.self) return voice === 'desk' ? 'The policyholder, driving' : 'You, driving'
  if (p.name === UNKNOWN_DRIVER) return 'The driver — unknown, they left the scene'
  return p.name ? `${p.name}, driving` : 'The driver — name not given'
}

/** the driver's name for a label/value row: the name, or why there is none */
export const driverName = (p: Person | undefined, voice: Voice = 'customer'): string | null =>
  !p ? null : p.self ? (voice === 'desk' ? 'The policyholder' : 'You') : p.name === UNKNOWN_DRIVER ? 'Unknown — left the scene' : p.name || null

/** phone and licence, whichever were given */
export const contactLine = (p: Person): string => [p.phone, p.licence && `licence ${p.licence}`].filter(Boolean).join(' · ')

export const yesNo = (v: boolean | null): string | null => (v === null ? null : v ? 'Yes' : 'No')

/** something worth adding before the report is sent, and the step it lives on */
export type Gap = { text: string; step: 'where' | 'vehicles' | 'people' | 'scene' | 'damage' | 'review' }

/**
 * What an adjuster would ring up to ask about, in the order they would ask. None of these
 * blocks sending — a report with gaps beats no report — but each is a call saved. Second
 * person throughout: this only ever runs for the customer, on their own review page.
 */
export function gaps(claim: Claim): Gap[] {
  const out: Gap[] = []
  const info = KIND_INFO[claim.incident.kind]
  const mine = claim.vehicles.find((v) => v.role === 'insured')
  const others = claim.vehicles.filter((v) => v.role !== 'insured')
  if (!claim.incident.description.trim()) out.push({ text: 'Say what happened in your own words', step: info.diagram ? 'scene' : 'damage' })
  for (const v of others) {
    const driver = claim.people.find((p) => p.role === 'driver' && p.vehicle === v.id)
    if (!driver?.name && !v.insurer) out.push({ text: `Who was driving ${whose(v)} ${vehicleName(v)}, or their insurer`, step: 'people' })
  }
  if (claim.police.called === null) out.push({ text: 'Whether the police were called', step: 'people' })
  if (mine && mine.damages.length === 0) out.push({ text: `Where ${vehicleName(mine)} is damaged`, step: 'damage' })
  if (claim.attachments.photos.length === 0) out.push({ text: 'A photo or two of the damage', step: 'damage' })
  if (mine && mine.condition.drivable === null) out.push({ text: 'Whether your car can still be driven', step: 'damage' })
  if (!claim.reporter.phone.trim() && !claim.reporter.email.trim()) out.push({ text: 'A phone number or email so we can reach you', step: 'review' })
  return out
}

/** the conditions as short readable labels: "Rain", "Wet road", "Dark, street lights on" */
export function conditionLabels(c: Conditions): string[] {
  return [c.weather && cap(c.weather), c.road && `${cap(c.road)} road`, c.light && LIGHT_LABEL[c.light]].filter((s): s is string => !!s)
}
