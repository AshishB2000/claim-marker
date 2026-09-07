/**
 * One store per widget instance — a module-level store would leak state between two
 * markers on the same page, and r3f's <Canvas> is a separate reconciler root that React
 * context does not cross, so the store object is passed down as a plain prop instead.
 */
import { createStore } from 'zustand/vanilla'
import { SCHEMA, damage, emptyValue, type ClaimValue, type Damage, type Severity } from '../schema'
import { nearestZone, zoneById, type V3, type Vehicle, type Zone } from '../zones'

export type Pending = { zone: Zone; point: V3 }

export type MarkerState = {
  vehicle: Vehicle
  damages: Damage[]
  /** index of the damage being edited, or null */
  selected: number | null
  /** a tap not yet given a severity */
  pending: Pending | null
  /** zone under the cursor, for the pre-tap tint */
  hovered: Zone | null

  pick: (point: V3) => void
  commit: (severity: Severity) => void
  edit: (index: number, patch: Partial<Pick<Damage, 'severity' | 'note'>>) => void
  remove: (index: number) => void
  select: (index: number | null) => void
  hover: (zone: Zone | null) => void
  load: (value: ClaimValue) => void
  value: () => ClaimValue
}

export type MarkerStore = ReturnType<typeof createMarkerStore>

export function createMarkerStore(initial: ClaimValue = emptyValue()) {
  return createStore<MarkerState>()((set, get) => ({
    vehicle: initial.vehicle,
    damages: initial.damages,
    selected: null,
    pending: null,
    hovered: null,

    pick: (point) => set({ pending: { zone: nearestZone(get().vehicle, point), point }, selected: null }),
    commit: (severity) => {
      const { pending, damages } = get()
      if (!pending) return
      set({
        damages: [...damages, damage(pending.zone.id, pending.point, severity)],
        pending: null,
        selected: damages.length,
      })
    },
    edit: (index, patch) =>
      set({ damages: get().damages.map((d, i) => (i === index ? { ...d, ...patch } : d)) }),
    remove: (index) =>
      set({ damages: get().damages.filter((_, i) => i !== index), selected: null }),
    select: (index) => set({ selected: index, pending: null }),
    hover: (zone) => set({ hovered: zone }),
    load: (value) => set({ vehicle: value.vehicle, damages: value.damages, selected: null, pending: null }),
    value: () => ({ schema: SCHEMA, vehicle: get().vehicle, damages: get().damages }),
  }))
}

/** the zone to tint: what you are editing, else what you just tapped, else what you are over */
export const activeZone = (s: MarkerState): Zone | null =>
  s.pending?.zone ??
  (s.selected !== null && s.damages[s.selected]
    ? zoneById(s.vehicle, s.damages[s.selected].zone) ?? null
    : s.hovered)
