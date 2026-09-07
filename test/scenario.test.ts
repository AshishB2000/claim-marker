import { describe, expect, it } from 'vitest'
import { BAY, LANE, LAYOUTS, LAYOUT_IDS, bayCentres, type LayoutId } from '../src/scenario/layouts'
import {
  SCENARIO_SCHEMA,
  emptyScenario,
  parseScenario,
  seedVehicles,
  type ScenarioValue,
} from '../src/scenario/schema'
import { createScenarioStore } from '../src/scenario/store'

const sample = (): ScenarioValue => ({
  ...emptyScenario('intersection'),
  vehicles: seedVehicles('intersection'),
  impact: [0.6, 1.2],
  note: 'He turned across me',
})

describe('scenario round-trip', () => {
  it('export → load → export is identical', () => {
    const store = createScenarioStore(sample())
    const first = store.getState().value()

    store.getState().load(parseScenario(first).value)
    const second = store.getState().value()

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('survives a trip through JSON text', () => {
    const first = sample()
    const { value } = parseScenario(JSON.parse(JSON.stringify(first)))
    expect(JSON.stringify(value)).toBe(JSON.stringify(sample()))
  })

  it('normalises coordinate precision so the round trip is stable', () => {
    const noisy = {
      ...emptyScenario(),
      vehicles: [
        { id: 'a', role: 'insured', body: 'sedan', position: [0.1 + 0.2, 1], heading: 1 / 3, path: [], damages: [] },
      ],
    }
    const once = parseScenario(noisy).value
    const twice = parseScenario(once).value
    expect(once.vehicles[0].position[0]).toBe(0.3)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
})

describe('parseScenario rejects bad input', () => {
  it.each([
    ['not an object', 7],
    ['null', null],
    ['wrong schema', { schema: 'claim-scenario/2', layout: 'intersection' }],
    ['the marker schema', { schema: 'claim-marker/1', vehicle: 'sedan', damages: [] }],
    ['unknown layout', { schema: SCENARIO_SCHEMA, layout: 'roundabout' }],
    ['vehicles not an array', { schema: SCENARIO_SCHEMA, layout: 'straight', vehicles: {} }],
  ])('throws on %s', (_label, input) => {
    expect(() => parseScenario(input)).toThrow()
  })

  it('drops malformed vehicles and keeps the rest of the diagram', () => {
    const { value, rejected } = parseScenario({
      schema: SCENARIO_SCHEMA,
      layout: 'straight',
      vehicles: [
        { id: 'a', role: 'insured', body: 'sedan', position: [1, 2], heading: 0, path: [], damages: [] },
        { id: 'b', body: 'hovercraft', position: [1, 2], heading: 0 },
        { id: 'c', body: 'sedan', position: [1], heading: 0 },
        { id: 'd', body: 'sedan', position: [1, 2], heading: Number.NaN },
        { id: '', body: 'sedan', position: [1, 2], heading: 0 },
        null,
      ],
    })
    expect(value.vehicles.map((v) => v.id)).toEqual(['a'])
    expect(rejected).toBe(5)
  })

  it('defaults an unknown role, a missing path and a bad impact', () => {
    const { value } = parseScenario({
      schema: SCENARIO_SCHEMA,
      layout: 'straight',
      vehicles: [{ id: 'a', role: 'witness', body: 'suv', position: [0, 0], heading: 0 }],
      impact: 'somewhere',
    })
    expect(value.vehicles[0].role).toBe('other')
    expect(value.vehicles[0].path).toEqual([])
    expect(value.impact).toBeNull()
    expect(value.note).toBe('')
  })

  // the payoff of per-body zone sets: a single-cab pickup has no rear door to damage
  it('drops a damage whose zone does not exist on that body', () => {
    const { value } = parseScenario({
      schema: SCENARIO_SCHEMA,
      layout: 'straight',
      vehicles: [
        {
          id: 'a',
          role: 'other',
          body: 'truck',
          position: [0, 0],
          heading: 0,
          path: [],
          damages: [
            { zone: 'right_bed_side', point: [0.65, 0.62, -0.8], severity: 'dent', note: '' },
            { zone: 'right_rear_door', point: [0.65, 0.5, -0.32], severity: 'dent', note: '' },
          ],
        },
      ],
    })
    expect(value.vehicles[0].damages.map((d) => d.zone)).toEqual(['right_bed_side'])
  })
})

describe('layouts', () => {
  it('every id has a label and two spawns', () => {
    for (const id of LAYOUT_IDS) {
      expect(LAYOUTS[id].label).toBeTruthy()
      expect(LAYOUTS[id].spawns).toHaveLength(2)
    }
  })

  // right-hand traffic: a vehicle sits one lane offset to its own right of the centre line.
  // Right = up × forward, so for heading h it is (cos h, −sin h) in [x, z].
  it.each(['intersection', 't_junction', 'straight'] as LayoutId[])('%s spawns both vehicles in the correct lane', (id) => {
    for (const { position, heading } of LAYOUTS[id].spawns) {
      const lateral = position[0] * Math.cos(heading) + position[1] * -Math.sin(heading)
      expect(lateral).toBeCloseTo(LANE, 6)
    }
  })

  it('parks the second parking-lot vehicle inside a bay', () => {
    const [, parked] = LAYOUTS.parking_lot.spawns
    expect(bayCentres()).toContain(parked.position[0])
    expect(parked.position[1]).toBeCloseTo(BAY.laneHalf + BAY.depth / 2, 6)
  })

  it('gives every seeded vehicle a path, so the travel arrow shows immediately', () => {
    for (const id of LAYOUT_IDS) {
      for (const v of seedVehicles(id)) expect(v.path.length).toBeGreaterThan(0)
    }
  })
})

describe('store', () => {
  const withTwo = () => createScenarioStore(sample())

  it('turns the nose toward a dragged heading handle', () => {
    const store = withTwo()
    const id = store.getState().vehicles[0].id
    store.getState().select(id)
    store.getState().startDrag({ kind: 'heading', id })
    // drag to a point due east of the vehicle
    const [x, z] = store.getState().vehicles[0].position
    store.getState().dragTo(x + 5, z)
    expect(store.getState().vehicles[0].heading).toBeCloseTo(Math.PI / 2, 6)
  })

  it('moves only the dragged vehicle, and leaves its path alone', () => {
    const store = withTwo()
    const [a, b] = store.getState().vehicles
    const pathBefore = JSON.stringify(a.path)
    store.getState().startDrag({ kind: 'vehicle', id: a.id })
    store.getState().dragTo(12, -3)
    const after = store.getState().vehicles
    expect(after[0].position).toEqual([12, -3])
    expect(JSON.stringify(after[0].path)).toBe(pathBefore)
    expect(after[1].position).toEqual(b.position)
  })

  it('extends the path backwards along the leg it already has', () => {
    const store = withTwo()
    const id = store.getState().vehicles[0].id
    const before = store.getState().vehicles[0].path.length
    store.getState().addWaypoint(id)
    const path = store.getState().vehicles[0].path
    expect(path).toHaveLength(before + 1)
    // the new point is the earliest, and further from the vehicle than the old first one
    const pos = store.getState().vehicles[0].position
    const dist = (p: number[]) => Math.hypot(p[0] - pos[0], p[1] - pos[1])
    expect(dist(path[0])).toBeGreaterThan(dist(path[1]))
  })

  it('clears damages when the body changes, since zone ids are per body', () => {
    const store = withTwo()
    const id = store.getState().vehicles[0].id
    store.getState().setDamages(id, [{ zone: 'hood', point: [0, 0.76, 0.78], severity: 'dent', note: '' }])
    expect(store.getState().vehicles[0].damages).toHaveLength(1)
    store.getState().setBody(id, 'truck')
    expect(store.getState().vehicles[0].damages).toEqual([])
  })

  it('never reuses an id that is still taken', () => {
    const store = withTwo()
    store.getState().addVehicle()
    store.getState().addVehicle()
    const ids = store.getState().vehicles.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reuses a freed id after a removal', () => {
    const store = withTwo()
    store.getState().removeVehicle('a')
    store.getState().addVehicle()
    expect(store.getState().vehicles.map((v) => v.id).sort()).toEqual(['a', 'b'])
  })
})
