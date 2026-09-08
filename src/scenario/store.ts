/** One store per widget instance, same reasoning as the marker's. */
import { createStore } from 'zustand/vanilla'
import type { Damage } from '../schema'
import type { Vehicle } from '../zones'
import { LAYOUTS, type LayoutId, type Point2 } from './layouts'
import {
  SCENARIO_SCHEMA,
  approach,
  emptyScenario,
  roundPoint,
  scenarioVehicle,
  seedVehicles,
  type Role,
  type ScenarioValue,
  type ScenarioVehicle,
} from './schema'

/** what the pointer is currently moving; the ground-plane driver dispatches on this */
export type Drag =
  | { kind: 'vehicle'; id: string }
  | { kind: 'heading'; id: string }
  | { kind: 'waypoint'; id: string; index: number }
  | { kind: 'impact' }

export type ScenarioState = ScenarioValue & {
  selected: string | null
  drag: Drag | null
  /** id of the vehicle whose damage marker is open over the diagram */
  marking: string | null

  setLayout: (layout: LayoutId) => void
  addVehicle: () => void
  removeVehicle: (id: string) => void
  select: (id: string | null) => void
  setRole: (id: string, role: Role) => void
  setBody: (id: string, body: Vehicle) => void
  setDamages: (id: string, damages: Damage[]) => void
  addWaypoint: (id: string) => void
  removeWaypoint: (id: string, index: number) => void
  setImpact: (p: Point2 | null) => void
  setNote: (note: string) => void
  mark: (id: string | null) => void
  startDrag: (drag: Drag) => void
  dragTo: (x: number, z: number) => void
  endDrag: () => void
  load: (value: ScenarioValue) => void
  value: () => ScenarioValue
}

export type ScenarioStore = ReturnType<typeof createScenarioStore>

const nextId = (vehicles: ScenarioVehicle[]) => {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i)
    if (!vehicles.some((v) => v.id === id)) return id
  }
  return `v${vehicles.length}`
}

export const vehicleLabel = (id: string) => id.toUpperCase()

export function createScenarioStore(initial?: ScenarioValue) {
  const seed = initial ?? { ...emptyScenario(), vehicles: seedVehicles('intersection') }

  return createStore<ScenarioState>()((set, get) => {
    const mapVehicle = (id: string, fn: (v: ScenarioVehicle) => ScenarioVehicle) =>
      set({ vehicles: get().vehicles.map((v) => (v.id === id ? fn(v) : v)) })

    return {
      ...seed,
      selected: null,
      drag: null,
      marking: null,

      setLayout: (layout) => set({ layout }),

      // new vehicles reuse the layout's two spawns, stepped back so they never land on top
      // of an existing one
      addVehicle: () => {
        const { vehicles, layout } = get()
        const i = vehicles.length
        const spawn = LAYOUTS[layout].spawns[i % 2]
        const position = approach(spawn.position, spawn.heading, 7 * Math.floor(i / 2))
        const id = nextId(vehicles)
        set({
          vehicles: [
            ...vehicles,
            scenarioVehicle({
              id,
              role: 'other',
              body: 'sedan',
              position,
              heading: spawn.heading,
              path: [approach(position, spawn.heading, 9)],
              damages: [],
            }),
          ],
          selected: id,
        })
      },

      removeVehicle: (id) =>
        set({
          vehicles: get().vehicles.filter((v) => v.id !== id),
          selected: null,
          marking: null,
        }),

      select: (id) => set({ selected: id }),
      setRole: (id, role) => mapVehicle(id, (v) => ({ ...v, role })),
      // zone ids are per body, so damages cannot survive a body change
      setBody: (id, body) => mapVehicle(id, (v) => ({ ...v, body, damages: [] })),
      setDamages: (id, damages) => mapVehicle(id, (v) => ({ ...v, damages })),

      // extend the path backwards along the leg it already has, so "add" continues the line
      // rather than guessing from the final heading
      addWaypoint: (id) =>
        mapVehicle(id, (v) => {
          const head = v.path[0] ?? v.position
          const after = v.path[1] ?? v.position
          const dx = after[0] - head[0]
          const dz = after[1] - head[1]
          const len = Math.hypot(dx, dz)
          const back: Point2 = len > 0.01 ? [head[0] - (dx / len) * 8, head[1] - (dz / len) * 8] : approach(head, v.heading, 8)
          return { ...v, path: [roundPoint(back), ...v.path] }
        }),

      removeWaypoint: (id, index) => mapVehicle(id, (v) => ({ ...v, path: v.path.filter((_, i) => i !== index) })),

      setImpact: (impact) => set({ impact }),
      setNote: (note) => set({ note }),
      mark: (marking) => set({ marking }),

      startDrag: (drag) => set({ drag, selected: 'id' in drag ? drag.id : get().selected }),
      endDrag: () => set({ drag: null }),

      dragTo: (x, z) => {
        const drag = get().drag
        if (!drag) return
        if (drag.kind === 'impact') return set({ impact: [x, z] })
        mapVehicle(drag.id, (v) => {
          if (drag.kind === 'vehicle') return { ...v, position: [x, z] }
          if (drag.kind === 'heading') return { ...v, heading: Math.atan2(x - v.position[0], z - v.position[1]) }
          return { ...v, path: v.path.map((p, i) => (i === drag.index ? ([x, z] as Point2) : p)) }
        })
      },

      // a controlled host re-sends the whole document on every edit — typing a note, say —
      // so a selection or an open damage overlay survives when its vehicle is still there
      load: (value) => {
        const { selected, marking } = get()
        const keep = (id: string | null) => (id !== null && value.vehicles.some((v) => v.id === id) ? id : null)
        set({
          layout: value.layout,
          vehicles: value.vehicles,
          impact: value.impact,
          note: value.note,
          selected: keep(selected),
          drag: null,
          marking: keep(marking),
        })
      },

      value: () => {
        const s = get()
        return {
          schema: SCENARIO_SCHEMA,
          layout: s.layout,
          vehicles: s.vehicles.map(scenarioVehicle),
          impact: s.impact ? roundPoint(s.impact) : null,
          note: s.note,
        }
      },
    }
  })
}
