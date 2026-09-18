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
import type { FeatureCollection, LineString } from 'geojson'
import { bearing, destination, distance, type LngLat } from '../geo'
import {
  KIND_INFO,
  MAX_PHOTOS,
  STEPS,
  emptyClaim,
  newPerson,
  newVehicle,
  type Attestation,
  type Claim,
  type ClaimVehicle,
  type Condition,
  type Conditions,
  type Incident,
  type Kind,
  type Location,
  type Person,
  type PersonRole,
  type Photo,
  type Police,
  type Property,
  type Reporter,
  type SceneContext,
  type Step,
} from './schema'
import { photoDistances, shrink } from './photos'
import { applyPrefill, vehicleFromPolicy, type Prefill, type PrefillVehicle } from './prefill'
import { type IncidentSeed } from './seed'
import { readExif, type PhotoExif } from './exif'
import { fromFrame } from '../assist/frame'
import type { IntakeDraft, Scene } from '../assist/schema'
import { SIZE } from '../vehicles/bodies'
import { suggestDamage } from './suggest'
import type { Lang } from '../i18n'
import { PAINTS } from '../vehicles/paint'

// the flow's own steps live in the schema, where the assistant can name one without
// dragging the store in; everything here still imports them from the store as it did
export { STEPS, type Step }

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
/** a photograph that said nothing about itself */
const NO_EXIF: PhotoExif = { takenAt: null, utcOffset: null, at: null }

/** bumpers this close, or overlapping, is a collision */
const TOUCHING = 1.2

const nextId = (vehicles: ClaimVehicle[]) => {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i)
    if (!vehicles.some((v) => v.id === id)) return id
  }
  return `v${vehicles.length}`
}

/**
 * Which of an intake draft's proposals the customer left ticked, row for row with the "here is
 * what we understood" card in `Intake.tsx`. `vehicles` has one entry per `draft.vehicles`, in
 * the same order, because a draft can propose several; every other proposal is one row.
 */
export type IntakeTake = {
  kind: boolean
  when: boolean
  place: boolean
  conditions: boolean
  vehicles: boolean[]
  people: boolean
  police: boolean
  property: boolean
}

export type ClaimState = {
  claim: Claim
  step: Step
  /** the vehicles on the policy, from the host page; more than one is a pick on the vehicles step */
  policy: PrefillVehicle[]
  /** how the report left: sent, or waiting in the outbox for a signal; null until it has */
  delivery: 'sent' | 'queued' | null
  /** the language the customer is reading in; null until the host, the browser or they chose */
  lang: Lang | null
  setLang: (lang: Lang) => void

  /** what the host page knows already: fills what is empty, never what the customer typed */
  prefill: (p: Prefill) => void
  /** the customer chose which of the policy's vehicles it was */
  pickPolicyVehicle: (index: number) => void

  /**
   * The other driver's page, starting from the invite. Their own vehicle is the one to fill in
   * — role `insured`, which in their document means "the reporter's vehicle" — and the
   * inviting customer's own car arrives as the *other* one, as shape, colour, make and model
   * only. They never see the first report; the seed simply does not contain it.
   */
  seedFromIncident: (incident: string, seed: IncidentSeed) => void
  /** the customer invited the other driver: both accounts will name this incident */
  shareIncident: (incident: string) => void

  goto: (step: Step) => void
  next: () => void
  back: () => void

  setIncident: (patch: Partial<Omit<Incident, 'location' | 'kind'>>) => void
  /**
   * one of the three condition selects, answered by the customer. Separate from `setIncident`
   * because touching a select is what takes it away from the lookup for good.
   */
  setConditions: (patch: Partial<Conditions>) => void
  /**
   * Who answered each of the three condition selects: `auto` means the lookup filled it and it
   * still follows the place and the time; `user` means the customer has set it and it is theirs.
   * Exactly `autoDamage`'s bargain, for the conditions.
   */
  autoConditions: Partial<Record<keyof Conditions, 'auto' | 'user'>>
  /**
   * the place and hour `incident.context` was looked up for. It not matching `sceneKey` of the
   * incident is what "still looking it up" means — a derived flag, not a second piece of state
   * to keep in step.
   */
  contextKey: string | null
  /**
   * The ways around the incident as GeoJSON, for the diagram to draw the road the cars are
   * standing on. Not part of `claim/1` and not persisted: it is 60 m of public map, cheap to
   * ask for again, and the document records the road in words instead.
   */
  roadWays: FeatureCollection<LineString> | null
  /** what the public record answered for `key`, the conditions to fill from it, and the ways to draw */
  sceneLookedUp: (key: string, context: SceneContext | null, utcOffset: number | null, fill: Partial<Conditions>, ways?: FeatureCollection<LineString> | null) => void
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
  /**
   * What each kept photograph said about itself, index for index with `attachments.photos`.
   * In memory only: it holds the raw position the document deliberately never sees, and a
   * reload is not a reason to write coordinates to disk. A reopened draft keeps the distances
   * already worked out; they simply stop following the place and the time.
   */
  photoExif: (PhotoExif | null)[]
  captionPhoto: (index: number, caption: string) => void
  removePhoto: (index: number) => void
  /** the panel a photo shows, set when a mark read off it is added; the caption stays the customer's */
  tagPhoto: (index: number, zone: string) => void
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
  /**
   * "Just tell us what happened": one account, applied piece by piece. Fills only what is
   * empty, the same bargain as `prefill` — except `kind`, an explicit choice, and the
   * description, which is the customer's own words and always theirs to keep.
   */
  applyIntake: (draft: IntakeDraft, take: IntakeTake, transcript: string) => void
  /** the intake draft's place, in words, for the Where step's search box to start from; never coordinates */
  placeQuery: string | null
  /** true once, after `applyIntake`, when the draft had enough in it to draw the diagram itself */
  drawFromWords: boolean
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

  submitted: (reference: string, submittedAt: string, delivery: 'sent' | 'queued') => void
  /** a queued report left the outbox and the server named it */
  delivered: (local: string, reference: string) => void
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

      /**
       * The place or the time changed, so every photograph is now a different distance from the
       * incident. Only the ones whose metadata is still in memory move; the rest keep the
       * numbers they were given, which is what a draft reopened tomorrow has.
       */
      const rePlacePhotos = () => {
        const { claim, photoExif } = get()
        if (photoExif.every((e) => !e)) return
        const { incident } = claim
        let changed = false
        const photos = claim.attachments.photos.map((p, i) => {
          const exif = photoExif[i]
          if (!exif) return p
          const next: Photo = {
            data: p.data,
            of: p.of,
            caption: p.caption,
            ...('shows' in p ? { shows: p.shows } : {}),
            ...('hash' in p ? { hash: p.hash } : {}),
            ...photoDistances(exif, incident),
          }
          if (JSON.stringify(next) !== JSON.stringify(p)) changed = true
          return next
        })
        if (changed) patchClaim((c) => ({ attachments: { ...c.attachments, photos } }))
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
        autoConditions: {},
        contextKey: null,
        roadWays: null,
        photoExif: [],
        policy: [],
        delivery: null,
        lang: null,
        placeQuery: null,
        drawFromWords: false,
        // the document says which language its free text is in, so the desk knows what it is reading
        setLang: (lang) => set((s) => ({ lang, claim: { ...s.claim, incident: { ...s.claim.incident, language: lang } } })),

        prefill: (p) => set((s) => ({ policy: p.vehicles ?? [], claim: s.claim.reference ? s.claim : applyPrefill(s.claim, p) })),
        pickPolicyVehicle: (index) => {
          const p = get().policy[index]
          if (p) mapVehicle(insuredOf(get().claim).id, (v) => vehicleFromPolicy(v, p, true))
        },

        seedFromIncident: (incident, seed) => {
          const mine = newVehicle('a', 'insured', 'sedan', '#b9bec6')
          const theirs = seed.vehicles.map((v, i) => ({
            ...newVehicle(String.fromCharCode(98 + i), 'other', v.body, v.color),
            make: v.make,
            model: v.model,
          }))
          set((s) => ({
            contextKey: null,
            roadWays: null,
            photoExif: [],
            claim: {
              ...s.claim,
              reporter: { ...s.claim.reporter, party: 'other_party' },
              incident: { ...s.claim.incident, shared: incident, location: seed.location, at: seed.at, utcOffset: seed.utcOffset, surface: seed.surface, context: null },
              vehicles: [mine, ...theirs],
              people: [],
            },
          }))
        },
        shareIncident: (incident) => patchClaim((c) => ({ incident: { ...c.incident, shared: incident } })),

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

        setIncident: (patch) => {
          // a new time is a new hour to ask about, and the old answer was about the old one
          if (patch.at !== undefined && patch.at !== get().claim.incident.at) set({ contextKey: null, roadWays: null })
          patchClaim((c) => ({ incident: { ...c.incident, ...patch, ...(patch.at !== undefined && patch.at !== c.incident.at ? { context: null, utcOffset: null } : {}) } }))
          if (patch.at !== undefined) rePlacePhotos()
        },
        setConditions: (patch) => {
          set((s) => ({ autoConditions: { ...s.autoConditions, ...Object.fromEntries(Object.keys(patch).map((k) => [k, 'user' as const])) } }))
          patchClaim((c) => ({ incident: { ...c.incident, conditions: { ...c.incident.conditions, ...patch } } }))
        },
        sceneLookedUp: (key, context, utcOffset, fill, ways = null) => {
          const next = { ...get().autoConditions }
          const conditions = { ...get().claim.incident.conditions }
          // one key at a time so the union of the three value types never has to be widened
          const take = <K extends keyof Conditions>(k: K) => {
            const v = fill[k]
            if (v === undefined) return
            // never over an answer the customer gave, and never over one that was already there
            // before anything looked anything up: a filled select is theirs unless we filled it
            if (next[k] === 'user' || (!next[k] && conditions[k])) return
            next[k] = 'auto'
            conditions[k] = v
          }
          take('weather')
          take('road')
          take('light')
          set({ contextKey: key, autoConditions: next, roadWays: ways })
          patchClaim((c) => ({ incident: { ...c.incident, context, utcOffset, conditions } }))
          // the zone the lookup resolved can move every photograph's clock relative to the crash
          rePlacePhotos()
        },
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
          // the looked-up scene belonged to the old spot, exactly as the vehicles' positions did
          set({ contextKey: null, roadWays: null })
          patchClaim((c) => ({
            incident: { ...c.incident, location, context: null, utcOffset: null },
            vehicles: c.vehicles.map((v) => ({ ...v, position: null, path: [] })),
            impact: null,
          }))
          rePlacePhotos()
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
          // the EXIF comes off the original bytes first: `shrink` re-encodes through a canvas
          // and everything the photograph knew about itself goes with it
          const read = await Promise.all(
            picked.map(async (f) => {
              const exif = await f
                .arrayBuffer()
                .then(readExif)
                .catch(() => NO_EXIF)
              // a file the browser cannot decode is skipped, not fatal: the rest still land
              const small = await shrink(f).catch(() => null)
              return small ? { ...small, exif } : null
            }),
          )
          const kept = read.filter((x): x is { data: string; hash: string | null; exif: PhotoExif } => !!x)
          const { incident } = get().claim
          set((s) => {
            // a draft reopened from storage has photos and no EXIF beside them; pad rather
            // than let every later photograph read the wrong one's metadata
            const pad: (PhotoExif | null)[] = Array(Math.max(0, s.claim.attachments.photos.length - s.photoExif.length)).fill(null)
            return { photoExif: [...s.photoExif, ...pad, ...kept.map((k) => k.exif)].slice(0, MAX_PHOTOS) }
          })
          patchClaim((c) => ({
            attachments: {
              ...c.attachments,
              photos: [...c.attachments.photos, ...kept.map((k) => ({ data: k.data, of, caption: '', ...(k.hash ? { hash: k.hash } : {}), ...photoDistances(k.exif, incident) }))].slice(0, MAX_PHOTOS),
            },
          }))
          return kept.length
        },
        captionPhoto: (index, caption) =>
          patchClaim((c) => ({ attachments: { ...c.attachments, photos: c.attachments.photos.map((p, i) => (i === index ? { ...p, caption } : p)) } })),
        removePhoto: (index) => {
          set((s) => ({ photoExif: s.photoExif.filter((_, i) => i !== index) }))
          patchClaim((c) => ({ attachments: { ...c.attachments, photos: c.attachments.photos.filter((_, i) => i !== index) } }))
        },
        tagPhoto: (index, zone) =>
          patchClaim((c) => ({ attachments: { ...c.attachments, photos: c.attachments.photos.map((p, i) => (i === index ? { ...p, shows: zone } : p)) } })),

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
        applyIntake: (draft, take, transcript) => {
          if (take.kind && draft.kind) get().setKind(draft.kind)
          if (take.when && draft.when) get().setIncident({ at: draft.when })

          if (take.place && draft.place) set({ placeQuery: draft.place })

          if (take.conditions && draft.conditions) {
            const cur = get().claim.incident.conditions
            const patch: Partial<Conditions> = {}
            const fill = <K extends keyof Conditions>(k: K) => {
              const v = draft.conditions?.[k]
              if (v && !cur[k]) patch[k] = v
            }
            fill('weather')
            fill('road')
            fill('light')
            if (Object.keys(patch).length) get().setConditions(patch)
          }

          // body and colour have no "empty" value of their own to test against — unlike make,
          // model and year, every vehicle is created with some shape and some paint. This only
          // ever runs from the Kind step, before the customer can have chosen either for real,
          // so overwriting them here is safe; `vehicleFromPolicy` in prefill.ts makes the same
          // call for the same reason.
          const fillVehicle = (id: string, dv: NonNullable<IntakeDraft['vehicles']>[number]) => {
            const v = get().claim.vehicles.find((x) => x.id === id)
            if (!v) return
            const hex = dv.color ? PAINTS.find((p) => p.id === dv.color)?.hex : undefined
            get().updateVehicle(id, {
              make: v.make || dv.make || v.make,
              model: v.model || dv.model || v.model,
              year: v.year ?? dv.year ?? v.year,
              ...(hex ? { color: hex } : {}),
            })
            if (dv.body) get().setBody(id, dv.body)
          }

          if (draft.vehicles) {
            // mirrors the cap `Vehicles.tsx` enforces on "Add a vehicle"
            const MAX_VEHICLES = 6
            let otherIndex = 0
            draft.vehicles.forEach((dv, i) => {
              if (!take.vehicles[i]) return
              if (dv.role === 'insured') {
                fillVehicle(insuredOf(get().claim).id, dv)
                return
              }
              const existing = othersOf(get().claim)[otherIndex]
              otherIndex++
              if (existing) {
                fillVehicle(existing.id, dv)
              } else if (get().claim.vehicles.length < MAX_VEHICLES) {
                get().addVehicle()
                const added = othersOf(get().claim).at(-1)
                if (added) fillVehicle(added.id, dv)
              }
            })
          }

          if (take.people && draft.people?.length) {
            for (const dp of draft.people) {
              // the draft only knows "insured" or "other", never which of several other
              // vehicles: the first one is the best guess with nothing more to go on
              const vehicle = dp.vehicle === 'insured' ? insuredOf(get().claim).id : dp.vehicle === 'other' ? (othersOf(get().claim)[0]?.id ?? null) : null
              get().addPerson(dp.role, vehicle)
              get().updatePerson(get().claim.people.length - 1, { injured: dp.injured, injury: dp.injury ?? '' })
            }
          }

          if (take.police && draft.police) {
            const cur = get().claim.police
            const patch: Partial<Police> = {}
            if (cur.called === null) patch.called = draft.police.called
            if (!cur.report && draft.police.report) patch.report = draft.police.report
            if (Object.keys(patch).length) get().setPolice(patch)
          }

          if (take.property && draft.property && !get().claim.property.description) get().setProperty({ description: draft.property })

          // their own words, verbatim — never the model's summary — because this is their
          // statement and what they sign; there is no row to untick it by, the same as there
          // is none for the transcript itself
          if (transcript.trim()) get().setIncident({ description: transcript.trim() })

          set({ drawFromWords: !!(draft.vehicles?.length && draft.description) })
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

        submitted: (reference, submittedAt, delivery) => set((s) => ({ delivery, claim: { ...s.claim, reference, submittedAt } })),
        delivered: (local, reference) =>
          set((s) => (s.claim.reference === local ? { delivery: 'sent', claim: { ...s.claim, reference } } : {})),
        // starting over keeps the language: it is how the customer is reading, not part of the report
        reset: () =>
          set((s) => {
            const claim = emptyClaim()
            claim.incident.language = s.lang ?? 'en'
            return {
              claim,
              step: 'kind',
              impactManual: false,
              autoDamage: {},
              autoConditions: {},
              contextKey: null,
              roadWays: null,
              photoExif: [],
              delivery: null,
              placeQuery: null,
              drawFromWords: false,
            }
          }),
      }
    },
    {
      name: 'claim-marker/draft',
      version: 7,
      // every section added since a draft was saved takes its default: v3 added the ground,
      // v4 the kind, the people, the police, the photos and the rest of the report, v5 the
      // policy's vehicles and how the report left, v6 the language (null: not chosen yet),
      // v7 the looked-up scene. `contextKey` and `roadWays` are deliberately not persisted:
      // a reopened draft asks the two keyless endpoints again, which redraws the roads and
      // costs nothing, rather than carrying a cache that can only go stale
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
        // the replay is re-recorded at send time like the PNGs; a few MB of video is no draft
        claim: { ...s.claim, attachments: { scene: null, replay: null, damage: {}, photos: s.claim.attachments.photos } },
        step: s.step,
        impactManual: s.impactManual,
        autoDamage: s.autoDamage,
        autoConditions: s.autoConditions,
        policy: s.policy,
        delivery: s.delivery,
        lang: s.lang,
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

/**
 * What the looked-up scene is keyed on: the place to four decimals — about eleven metres, far
 * finer than the weather changes and finer than a junction is wide — and the hour, because
 * that is the resolution the archive answers in. Nudging the pin a metre does not ask again.
 * Null when there is nothing yet to ask about.
 */
export const sceneKey = (incident: Pick<Incident, 'location' | 'at'>): string | null =>
  incident.location && incident.at ? `${incident.location.lng.toFixed(4)},${incident.location.lat.toFixed(4)},${incident.at.slice(0, 13)}` : null
