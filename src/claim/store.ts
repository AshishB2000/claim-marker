/**
 * The claim as it is being written, plus where the customer is in the flow. Persisted to
 * localStorage so a refresh, or a phone call in the middle, does not lose the claim; the
 * PNG attachments are the one thing left out, because they are hundreds of kB each and are
 * regenerated from the live scenes at submit time anyway.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseDamages, type Damage } from '../schema'
import type { Vehicle } from '../zones'
import { bearing, destination, distance, type LngLat } from '../geo'
import {
  KIND_INFO,
  MAX_PHOTOS,
  emptyClaim,
  newPerson,
  newVehicle,
  type Attestation,
  type Claim,
  type ClaimVehicle,
  type Condition,
  type Incident,
  type Kind,
  type Location,
  type Person,
  type PersonRole,
  type Police,
  type Property,
  type Reporter,
} from './schema'
import { shrink } from './photos'
import { fromFrame } from '../assist/frame'
import type { Scene } from '../assist/schema'
import { SIZE } from '../vehicles/bodies'
import { suggestDamage } from './suggest'

export const STEPS = ['kind', 'where', 'vehicles', 'people', 'scene', 'damage', 'review'] as const
export type Step = (typeof STEPS)[number]

export const STEP_TITLE: Record<Step, string> = {
  kind: 'What happened',
  where: 'Where and when',
  vehicles: 'The vehicles',
  people: 'People and injuries',
  scene: 'Show us',
  damage: 'The damage',
  review: 'Review and send',
}

/** the steps this kind of incident goes through: a hail claim has nothing to diagram */
export const stepsFor = (kind: Kind): Step[] => STEPS.filter((s) => s !== 'scene' || KIND_INFO[kind].diagram)

/**
 * Where the vehicles first appear around the location, before the customer drags them:
 * yours a few metres south facing north, the first other party east facing west, and so on
 * round the compass. `[bearing from the location, heading]`.
 */
const SPAWN: [number, number][] = [
  [180, 0],
  [90, 270],
  [270, 90],
  [0, 180],
]
const SPAWN_DISTANCE = 7
/** the approach arrow every vehicle starts with, so the map explains itself */
const APPROACH = 14

/** how far a car must travel before the drag drops another point into its trail */
const TRAIL_STEP = 2.5
/** a trail longer than this is noise, not a route */
const TRAIL_MAX = 40
/** the drag has to cover this much before it says anything about which way the car faces */
const TURN_MIN = 1.5
/** bumpers this close, or overlapping, is a collision */
const TOUCHING = 1.2

const nextId = (vehicles: ClaimVehicle[]) => {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i)
    if (!vehicles.some((v) => v.id === id)) return id
  }
  return `v${vehicles.length}`
}

export type ClaimState = {
  claim: Claim
  step: Step

  goto: (step: Step) => void
  next: () => void
  back: () => void

  setIncident: (patch: Partial<Omit<Incident, 'location' | 'kind'>>) => void
  /**
   * the kind decides who else is expected: a kind with no other party drops the other vehicles
   * and everyone in them; a collision with none listed gets one to fill in
   */
  setKind: (kind: Kind) => void
  /** changing where it happened un-places every vehicle: they belong to the old spot */
  setLocation: (location: Location | null) => void

  updateVehicle: (id: string, patch: Partial<Pick<ClaimVehicle, 'color' | 'make' | 'model' | 'year' | 'plate' | 'plateState' | 'vin' | 'owner' | 'insurer' | 'policy'>>) => void
  setCondition: (id: string, patch: Partial<Condition>) => void

  /** the driver of a vehicle, created on first edit; one per vehicle */
  setDriver: (vehicle: string, patch: Partial<Person>) => void
  addPerson: (role: PersonRole, vehicle?: string | null) => void
  updatePerson: (index: number, patch: Partial<Person>) => void
  removePerson: (index: number) => void
  setPolice: (patch: Partial<Police>) => void
  setProperty: (patch: Partial<Property>) => void
  setReporter: (patch: Partial<Reporter>) => void
  setAttestation: (patch: Partial<Attestation>) => void

  /** downscale and keep photographs; resolves to how many were kept */
  addPhotos: (files: Iterable<File>, of: string | null) => Promise<number>
  captionPhoto: (index: number, caption: string) => void
  removePhoto: (index: number) => void
  /** zone ids are per body, so a body change clears the damages marked on the old one */
  setBody: (id: string, body: Vehicle) => void
  addVehicle: () => void
  removeVehicle: (id: string) => void

  /** put every unplaced vehicle on the map around the location */
  placeVehicles: () => void
  /** a drag began: the trail restarts from where the car was standing */
  grabVehicle: (id: string) => void
  /** a drag is under way: the car moves, its trail grows, and it faces the way it is going */
  dragVehicle: (id: string, position: LngLat) => void
  /** a drag ended: tidy the trail and see whether it has run into anyone */
  dropVehicle: (id: string) => void
  moveVehicle: (id: string, position: LngLat) => void
  turnVehicle: (id: string, heading: number) => void
  setWaypoint: (id: string, index: number, position: LngLat) => void
  /** the customer tapped the map: the path grows towards the vehicle, in travel order */
  addWaypointAt: (id: string, position: LngLat) => void
  /** the assistant read the customer's words: place and turn the vehicles it recognised */
  applyScene: (scene: Scene) => void
  clearPath: (id: string) => void
  /** `manual` means the customer placed it, so it stops following the vehicles */
  setImpact: (impact: LngLat | null, manual?: boolean) => void
  /** true once the customer has placed or cleared the impact themselves */
  impactManual: boolean

  setDamages: (id: string, damages: Damage[]) => void
  /**
   * Who marked each vehicle's damage: `auto` means it was worked out from the point of impact
   * and follows it; `user` means the customer has marked that vehicle and it is theirs for good
   */
  autoDamage: Record<string, 'auto' | 'user'>

  submitted: (reference: string, submittedAt: string) => void
  reset: () => void
}

export const useClaim = create<ClaimState>()(
  persist(
    (set, get) => {
      const patchClaim = (fn: (c: Claim) => Partial<Claim>) => set((s) => ({ claim: { ...s.claim, ...fn(s.claim) } }))
      const mapVehicle = (id: string, fn: (v: ClaimVehicle) => ClaimVehicle) =>
        patchClaim((c) => ({ vehicles: c.vehicles.map((v) => (v.id === id ? fn(v) : v)) }))

      /**
       * Two cars close enough to have hit each other put the impact cross between them, with
       * no one having to ask for it. It keeps following the vehicles until the customer
       * places the cross themselves, and it never removes a cross they placed.
       */
      const autoImpact = () => {
        if (get().impactManual) return
        const hit = collision(get().claim.vehicles)
        patchClaim(() => ({ impact: hit }))
      }

      /**
       * Mark the panel each vehicle took the hit on, from the impact and the way it faces,
       * unless the customer has marked that vehicle themselves — their marks are never
       * touched. A mark made from the impact follows it: move the cars and it moves, lose the
       * impact and it goes.
       */
      const suggestDamages = () => {
        const { claim, autoDamage } = get()
        const next = { ...autoDamage }
        let changed = false
        const vehicles = claim.vehicles.map((v) => {
          if (next[v.id] === 'user' || (next[v.id] !== 'auto' && v.damages.length > 0)) return v
          const hit = claim.impact ? suggestDamage(v, claim.impact) : null
          if (hit) {
            if (next[v.id] !== 'auto') changed = true
            next[v.id] = 'auto'
            if (v.damages.length === 1 && v.damages[0].zone === hit.zone) return v
            changed = true
            return { ...v, damages: [hit] }
          }
          if (next[v.id] === 'auto') {
            delete next[v.id]
            changed = true
            return { ...v, damages: [] }
          }
          return v
        })
        if (changed) set({ autoDamage: next, claim: { ...claim, vehicles } })
      }

      /** the geometry moved: find the impact again, then the damage that follows from it */
      const settle = () => {
        autoImpact()
        suggestDamages()
      }

      return {
        claim: emptyClaim(),
        step: 'kind',
        impactManual: false,
        autoDamage: {},

        goto: (step) => set({ step }),
        next: () =>
          set((s) => {
            const steps = stepsFor(s.claim.incident.kind)
            return { step: steps[Math.min(steps.indexOf(s.step) + 1, steps.length - 1)] }
          }),
        back: () =>
          set((s) => {
            const steps = stepsFor(s.claim.incident.kind)
            return { step: steps[Math.max(steps.indexOf(s.step) - 1, 0)] }
          }),

        setIncident: (patch) => patchClaim((c) => ({ incident: { ...c.incident, ...patch } })),
        setKind: (kind) => {
          const { others } = KIND_INFO[kind]
          patchClaim((c) => {
            let vehicles = c.vehicles
            if (!others) vehicles = vehicles.filter((v) => v.role === 'insured')
            else if (kind === 'collision' && !vehicles.some((v) => v.role === 'other')) vehicles = [...vehicles, newVehicle(nextId(vehicles), 'other', 'suv', '#1c1f26')]
            const ids = new Set(vehicles.map((v) => v.id))
            return {
              incident: { ...c.incident, kind },
              vehicles,
              people: c.people.filter((p) => !p.vehicle || ids.has(p.vehicle)),
              attachments: { ...c.attachments, photos: c.attachments.photos.map((p) => (p.of && !ids.has(p.of) ? { ...p, of: null } : p)) },
              impact: others ? c.impact : null,
            }
          })
          suggestDamages()
        },
        setLocation: (location) => {
          patchClaim((c) => ({
            incident: { ...c.incident, location },
            vehicles: c.vehicles.map((v) => ({ ...v, position: null, path: [] })),
            impact: null,
          }))
          suggestDamages()
        },

        updateVehicle: (id, patch) => mapVehicle(id, (v) => ({ ...v, ...patch })),
        setBody: (id, body) => mapVehicle(id, (v) => (v.body === body ? v : { ...v, body, damages: [] })),
        addVehicle: () =>
          patchClaim((c) => ({ vehicles: [...c.vehicles, newVehicle(nextId(c.vehicles), 'other', 'sedan', '#e9ebee')] })),
        removeVehicle: (id) =>
          patchClaim((c) => {
            const vehicles = c.vehicles.filter((v) => v.id !== id || v.role === 'insured')
            if (vehicles.length === c.vehicles.length) return {}
            // the people in it and the photos of it went with it
            return {
              vehicles,
              people: c.people.filter((p) => p.vehicle !== id),
              attachments: { ...c.attachments, photos: c.attachments.photos.map((p) => (p.of === id ? { ...p, of: null } : p)) },
            }
          }),
        setCondition: (id, patch) => mapVehicle(id, (v) => ({ ...v, condition: { ...v.condition, ...patch } })),

        setDriver: (vehicle, patch) =>
          patchClaim((c) => {
            const i = c.people.findIndex((p) => p.role === 'driver' && p.vehicle === vehicle)
            const next = { ...(i >= 0 ? c.people[i] : newPerson('driver', vehicle)), ...patch }
            return { people: i >= 0 ? c.people.map((p, j) => (j === i ? next : p)) : [...c.people, next] }
          }),
        addPerson: (role, vehicle = null) => patchClaim((c) => ({ people: [...c.people, newPerson(role, vehicle)] })),
        updatePerson: (index, patch) => patchClaim((c) => ({ people: c.people.map((p, i) => (i === index ? { ...p, ...patch } : p)) })),
        removePerson: (index) => patchClaim((c) => ({ people: c.people.filter((_, i) => i !== index) })),
        setPolice: (patch) => patchClaim((c) => ({ police: { ...c.police, ...patch } })),
        setProperty: (patch) => patchClaim((c) => ({ property: { ...c.property, ...patch } })),
        setReporter: (patch) => patchClaim((c) => ({ reporter: { ...c.reporter, ...patch } })),
        setAttestation: (patch) => patchClaim((c) => ({ attestation: { ...c.attestation, ...patch } })),

        addPhotos: async (files, of) => {
          const room = MAX_PHOTOS - get().claim.attachments.photos.length
          const picked = Array.from(files).slice(0, Math.max(0, room))
          // a file the browser cannot decode is skipped, not fatal: the rest still land
          const shrunk = (await Promise.all(picked.map((f) => shrink(f).catch(() => null)))).filter((d): d is string => !!d)
          patchClaim((c) => ({
            attachments: {
              ...c.attachments,
              photos: [...c.attachments.photos, ...shrunk.map((data) => ({ data, of, caption: '' }))].slice(0, MAX_PHOTOS),
            },
          }))
          return shrunk.length
        },
        captionPhoto: (index, caption) =>
          patchClaim((c) => ({ attachments: { ...c.attachments, photos: c.attachments.photos.map((p, i) => (i === index ? { ...p, caption } : p)) } })),
        removePhoto: (index) => patchClaim((c) => ({ attachments: { ...c.attachments, photos: c.attachments.photos.filter((_, i) => i !== index) } })),

        placeVehicles: () => {
          const { location } = get().claim.incident
          if (!location) return
          const at: LngLat = [location.lng, location.lat]
          patchClaim((c) => ({
            vehicles: c.vehicles.map((v, i) => {
              if (v.position) return v
              const [from, heading] = SPAWN[i % SPAWN.length]
              const ring = Math.floor(i / SPAWN.length)
              const position = destination(at, from, SPAWN_DISTANCE + ring * 6)
              return { ...v, position, heading, path: [destination(position, (heading + 180) % 360, APPROACH)] }
            }),
          }))
        },
        grabVehicle: (id) =>
          mapVehicle(id, (v) => (v.position ? { ...v, path: [v.position] } : v)),

        dragVehicle: (id, position) => {
          mapVehicle(id, (v) => {
            const tail = v.path[v.path.length - 1]
            const travelled = tail ? distance(tail, position) : 0
            // the nose follows the drag, so a car reversed into a space still points the
            // way it was pushed rather than snapping to the last little wobble
            const heading = tail && travelled > TURN_MIN ? Math.round(bearing(tail, position)) : v.heading
            const path = tail && travelled > TRAIL_STEP && v.path.length < TRAIL_MAX ? [...v.path, position] : v.path
            return { ...v, position, heading, path }
          })
          settle()
        },

        dropVehicle: (id) => {
          // the last trail point is wherever the finger let go, which is where the car now
          // stands; keeping it would draw a zero-length final leg
          mapVehicle(id, (v) => {
            const tail = v.path[v.path.length - 1]
            const path = tail && v.position && distance(tail, v.position) < TRAIL_STEP ? v.path.slice(0, -1) : v.path
            return { ...v, path }
          })
          settle()
        },

        moveVehicle: (id, position) => {
          mapVehicle(id, (v) => ({ ...v, position }))
          settle()
        },
        turnVehicle: (id, heading) => {
          mapVehicle(id, (v) => ({ ...v, heading }))
          suggestDamages()
        },
        setWaypoint: (id, index, position) =>
          mapVehicle(id, (v) => ({ ...v, path: v.path.map((p, i) => (i === index ? position : p)) })),
        addWaypointAt: (id, position) => mapVehicle(id, (v) => ({ ...v, path: [...v.path, position] })),

        applyScene: (scene) => {
          const { location } = get().claim.incident
          // nothing usable came back: leave the diagram exactly as the customer had it
          // rather than re-running the impact and the damage over an unchanged scene
          if (!location || scene.vehicles.length === 0) return
          const at: LngLat = [location.lng, location.lat]
          const placed = new Map(scene.vehicles.map((p) => [p.id, p]))
          patchClaim((c) => ({
            vehicles: c.vehicles.map((v) => {
              const p = placed.get(v.id)
              return p ? { ...v, position: fromFrame(at, p.at), heading: p.heading, path: p.from.map((m) => fromFrame(at, m)) } : v
            }),
          }))
          // the words said where they hit; otherwise the geometry decides, as it does for a drag
          if (scene.impact) {
            set({ impactManual: true })
            patchClaim(() => ({ impact: fromFrame(at, scene.impact!) }))
            suggestDamages()
          } else {
            set({ impactManual: false })
            settle()
          }
        },
        clearPath: (id) => mapVehicle(id, (v) => ({ ...v, path: [] })),
        setImpact: (impact, manual = true) => {
          set({ impactManual: manual })
          patchClaim(() => ({ impact }))
          suggestDamages()
        },

        setDamages: (id, damages) => {
          const v = get().claim.vehicles.find((x) => x.id === id)
          // the marker echoes back a value it was handed; only a real edit makes the marks the customer's own
          const norm = (d: Damage[]) => JSON.stringify(v ? parseDamages(v.body, d).damages : d)
          if (v && norm(v.damages) !== norm(damages)) set((s) => ({ autoDamage: { ...s.autoDamage, [id]: 'user' } }))
          mapVehicle(id, (x) => ({ ...x, damages }))
        },

        submitted: (reference, submittedAt) => patchClaim(() => ({ reference, submittedAt })),
        reset: () => set({ claim: emptyClaim(), step: 'kind', impactManual: false, autoDamage: {} }),
      }
    },
    {
      name: 'claim-marker/draft',
      version: 4,
      // every section added since a draft was saved takes its default: v3 added the ground,
      // v4 the kind, the people, the police, the photos and the rest of the report
      migrate: (persisted) => {
        const s = persisted as { claim?: Partial<Claim> & { incident?: Partial<Incident>; vehicles?: Partial<ClaimVehicle>[] } }
        if (!s.claim) return persisted
        const base = emptyClaim()
        s.claim = {
          ...base,
          ...s.claim,
          incident: { ...base.incident, ...s.claim.incident },
          vehicles: (s.claim.vehicles ?? []).map((v) => ({ ...newVehicle(v.id ?? 'a', v.role ?? 'other', v.body ?? 'sedan', v.color ?? '#b9bec6'), ...v })),
          attachments: { ...base.attachments, ...s.claim.attachments },
        } as Claim
        return persisted
      },
      // the rendered PNGs are regenerated at submit time; the customer's photographs cannot be
      partialize: (s) => ({
        claim: { ...s.claim, attachments: { scene: null, damage: {}, photos: s.claim.attachments.photos } },
        step: s.step,
        impactManual: s.impactManual,
        autoDamage: s.autoDamage,
      }),
    },
  ),
)

/**
 * Where the closest pair of vehicles met, or null when none of them are touching. Distance is
 * between centres less half of each body's length, so a box truck counts as touching from
 * further out than a coupe does.
 */
function collision(vehicles: ClaimVehicle[]): LngLat | null {
  let best: { gap: number; at: LngLat } | null = null
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i]
      const b = vehicles[j]
      if (!a.position || !b.position) continue
      const apart = distance(a.position, b.position)
      const gap = apart - (SIZE[a.body].length + SIZE[b.body].length) / 2
      if (gap > TOUCHING) continue
      if (!best || gap < best.gap) {
        best = { gap, at: destination(a.position, bearing(a.position, b.position), apart / 2) }
      }
    }
  }
  return best?.at ?? null
}

export const insuredOf = (claim: Claim) => claim.vehicles.find((v) => v.role === 'insured') ?? claim.vehicles[0]
export const othersOf = (claim: Claim) => claim.vehicles.filter((v) => v.role !== 'insured')
export const vehicleLabel = (v: ClaimVehicle) => v.id.toUpperCase()
