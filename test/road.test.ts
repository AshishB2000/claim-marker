import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FeatureCollection, LineString } from 'geojson'
import { ALIGN_DEGREES, ALIGN_METRES, BUILDING_RADIUS, ROAD_RADIUS, alignToRoad, parseBuildings, parseRoad, roadQuery } from '../src/scene/road'
import { destination, type LngLat } from '../src/geo'

/**
 * The incident point every fixture is built around. Degrees are treated as metres-ish at the
 * equator (111.32 m per 0.001°) purely to keep the numbers in these fixtures readable; the
 * module under test uses the real spherical distance, it just happens to agree closely with
 * that approximation this close to lat 0.
 */
const AT: LngLat = [0, 0]

type Tags = Record<string, string>
const node = (id: number, [lng, lat]: LngLat, tags?: Tags) => ({ type: 'node', id, lat, lon: lng, tags })
const way = (id: number, nodes: number[], tags: Tags) => ({ type: 'way', id, nodes, tags })
const overpass = (elements: unknown[]) => ({ elements })

describe('parseRoad', () => {
  it('reads name, class, lanes, oneway, maxspeed and lit off the nearest way, with no junction nearby', () => {
    const json = overpass([
      node(1, [-0.001, 0]),
      node(2, [0.001, 0]),
      way(10, [1, 2], {
        highway: 'residential',
        name: 'Main Street',
        lanes: '2',
        oneway: 'yes',
        maxspeed: '25 mph',
        lit: 'yes',
      }),
    ])
    const result = parseRoad(json, AT)
    expect(result?.road).toEqual({
      name: 'Main Street',
      class: 'residential',
      lanes: 2,
      oneway: true,
      maxspeed: '25 mph',
      lit: true,
      junction: 'none',
      controls: [],
    })
  })

  it('an unnamed way with no lanes/maxspeed/lit tags reads as empty/null, not a crash', () => {
    const json = overpass([node(1, [-0.001, 0]), node(2, [0.001, 0]), way(10, [1, 2], { highway: 'residential' })])
    const result = parseRoad(json, AT)
    expect(result?.road).toEqual({
      name: '',
      class: 'residential',
      lanes: null,
      oneway: false,
      maxspeed: '',
      lit: null,
      junction: 'none',
      controls: [],
    })
  })

  it('four ways meeting at the incident is a crossroads', () => {
    const json = overpass([
      node(1, AT),
      node(2, [0, 0.001]),
      node(3, [0, -0.001]),
      node(4, [0.001, 0]),
      node(5, [-0.001, 0]),
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
      way(11, [1, 3], { highway: 'residential', name: 'Main Street' }),
      way(12, [1, 4], { highway: 'residential', name: 'Cross Avenue' }),
      way(13, [1, 5], { highway: 'residential', name: 'Cross Avenue' }),
    ])
    expect(parseRoad(json, AT)?.road.junction).toBe('cross')
  })

  it('a through road plus one branch, three ways at the incident, is a T', () => {
    const json = overpass([
      node(1, AT),
      node(2, [0, 0.001]),
      node(3, [0, -0.001]),
      node(4, [0.001, 0]),
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
      way(11, [1, 3], { highway: 'residential', name: 'Main Street' }),
      way(12, [1, 4], { highway: 'residential', name: 'Oak Street' }),
    ])
    expect(parseRoad(json, AT)?.road.junction).toBe('T')
  })

  it('two ways continuing the same line through the incident is not a junction', () => {
    const json = overpass([
      node(1, AT),
      node(2, [0, 0.001]),
      node(3, [0, -0.001]),
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
      way(11, [1, 3], { highway: 'residential', name: 'Main Street' }),
    ])
    expect(parseRoad(json, AT)?.road.junction).toBe('none')
  })

  it('two ways at right angles through the incident is a T', () => {
    const json = overpass([
      node(1, AT),
      node(2, [0, 0.001]),
      node(3, [0.001, 0]),
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
      way(11, [1, 3], { highway: 'residential', name: 'Cross Avenue' }),
    ])
    expect(parseRoad(json, AT)?.road.junction).toBe('T')
  })

  it('junction=roundabout on the nearest way wins over the arm count', () => {
    const json = overpass([
      node(1, [-0.0005, 0]),
      node(2, [0.0005, 0]),
      way(10, [1, 2], { highway: 'primary', junction: 'roundabout', name: 'Traffic Circle' }),
    ])
    expect(parseRoad(json, AT)?.road.junction).toBe('roundabout')
  })

  it('collects controls within 25 m, de-duplicated and sorted, and drops one 40 m away', () => {
    const json = overpass([
      node(1, [-0.001, 0]),
      node(2, [0.001, 0]),
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
      // ~11 m east
      node(20, [0.0001, 0], { highway: 'stop' }),
      // ~11 m north
      node(21, [0, 0.0001], { highway: 'traffic_signals' }),
      // a second traffic_signals node nearby, to prove de-duplication
      node(22, [0.00005, 0.0001], { highway: 'traffic_signals' }),
      // ~15.7 m, diagonally
      node(23, [-0.0001, -0.0001], { highway: 'crossing' }),
      // ~44 m east: outside the 25 m junction radius
      node(24, [0.0004, 0], { highway: 'give_way' }),
    ])
    expect(parseRoad(json, AT)?.road.controls).toEqual(['crossing', 'stop', 'traffic_signals'])
  })

  it('a footway is not a road: the response has nothing usable', () => {
    const json = overpass([node(1, [-0.001, 0]), node(2, [0.001, 0]), way(10, [1, 2], { highway: 'footway' })])
    expect(parseRoad(json, AT)).toBeNull()
  })

  it('a way missing one of its nodes in the node table is dropped, not crashed on', () => {
    const json = overpass([
      node(1, [-0.001, 0]),
      // node 2 is referenced by the way below but never sent
      way(10, [1, 2], { highway: 'residential', name: 'Main Street' }),
    ])
    expect(parseRoad(json, AT)).toBeNull()
  })

  it.each([{}, null, 'nonsense'])('nonsense input %j is null, not a throw', (input) => {
    expect(parseRoad(input, AT)).toBeNull()
  })

  it('of two parallel streets, the nearer one is the road', () => {
    const json = overpass([
      node(1, [-0.001, 0.0001]),
      node(2, [0.001, 0.0001]),
      way(10, [1, 2], { highway: 'residential', name: 'Near Street' }),
      node(3, [-0.001, -0.0003]),
      node(4, [0.001, -0.0003]),
      way(11, [3, 4], { highway: 'residential', name: 'Far Street' }),
    ])
    expect(parseRoad(json, AT)?.road.name).toBe('Near Street')
  })

  it('returns one LineString per kept way, coordinates and properties intact, footways excluded', () => {
    const json = overpass([
      node(1, [-0.001, 0]),
      node(2, [0.001, 0]),
      way(10, [1, 2], { highway: 'residential', name: 'Elm Street', lanes: '3' }),
      node(3, [-0.001, 0.0005]),
      node(4, [0.001, 0.0005]),
      way(11, [3, 4], { highway: 'primary', name: 'Oak Avenue' }),
      node(5, [0, 0]),
      node(6, [0, 0.0002]),
      way(12, [5, 6], { highway: 'footway' }),
    ])
    const result = parseRoad(json, AT)
    expect(result?.ways).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Elm Street', class: 'residential', lanes: 3 },
          geometry: { type: 'LineString', coordinates: [[-0.001, 0], [0.001, 0]] },
        },
        {
          type: 'Feature',
          properties: { name: 'Oak Avenue', class: 'primary', lanes: null },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-0.001, 0.0005],
              [0.001, 0.0005],
            ],
          },
        },
      ],
    })
  })
})

describe('roadQuery', () => {
  it('asks Overpass for ways and junction-control nodes within ROAD_RADIUS, body and skeleton back', () => {
    const q = roadQuery([-73.9857, 40.7484])
    expect(q).toContain(`around:${ROAD_RADIUS},40.7484,-73.9857`)
    expect(q).toContain('way[highway]')
    expect(q).toContain('traffic_signals|stop|give_way|crossing')
    expect(q.trim().endsWith('out body; >; out skel qt;')).toBe(true)
  })

  it('asks for buildings in the same query, further out', () => {
    const q = roadQuery([-73.9857, 40.7484])
    expect(q).toContain(`way[building](around:${BUILDING_RADIUS},40.7484,-73.9857)`)
    expect(BUILDING_RADIUS).toBeGreaterThan(ROAD_RADIUS)
  })
})

describe('parseBuildings', () => {
  /** a square building, closed the way OSM closes a way: the first node id again at the end */
  const block = (id: number, tags: Tags, at: LngLat = [0, 0]) => {
    const [lng, lat] = at
    const n = id * 10
    return [
      node(n + 1, [lng, lat]),
      node(n + 2, [lng + 0.0002, lat]),
      node(n + 3, [lng + 0.0002, lat + 0.0002]),
      node(n + 4, [lng, lat + 0.0002]),
      way(id, [n + 1, n + 2, n + 3, n + 4, n + 1], tags),
    ]
  }

  it('a closed building way becomes a polygon whose ring is closed', () => {
    const fc = parseBuildings(overpass(block(1, { building: 'yes' })))
    expect(fc.features).toHaveLength(1)
    const ring = fc.features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('takes the height in metres when the building has one, unit and all', () => {
    const fc = parseBuildings(overpass(block(1, { building: 'yes', height: '23.5 m', 'building:levels': '2' })))
    expect(fc.features[0].properties.height).toBe(23.5)
  })

  it('falls back to levels at 3.2 m a storey', () => {
    const fc = parseBuildings(overpass(block(1, { building: 'commercial', 'building:levels': '5' })))
    expect(fc.features[0].properties.height).toBeCloseTo(16, 5)
  })

  it('an untagged building, and one tagged with nonsense, get the default height', () => {
    const fc = parseBuildings(overpass([...block(1, { building: 'yes' }), ...block(2, { building: 'yes', height: '-4' }, [0.01, 0])]))
    expect(fc.features.map((f) => f.properties.height)).toEqual([8, 8])
  })

  it('leaves out everything that is not a closed building: roads, open ways, a way whose nodes are missing', () => {
    const road = block(1, { highway: 'residential' })
    const open = [node(21, [0.01, 0]), node(22, [0.0102, 0]), node(23, [0.0102, 0.0002]), node(24, [0.01, 0.0002]), way(2, [21, 22, 23, 24], { building: 'yes' })]
    const headless = [way(3, [901, 902, 903, 901], { building: 'yes' })]
    expect(parseBuildings(overpass([...road, ...open, ...headless])).features).toEqual([])
  })

  it('an answer with nothing in it, or no answer at all, is an empty collection rather than a throw', () => {
    expect(parseBuildings(overpass([]))).toEqual({ type: 'FeatureCollection', features: [] })
    expect(parseBuildings(null).features).toEqual([])
    expect(parseBuildings({ elements: 'not a list' }).features).toEqual([])
  })

  it('parseRoad carries the buildings out of the same answer', () => {
    const json = overpass([node(1, [-0.001, 0]), node(2, [0.001, 0]), way(10, [1, 2], { highway: 'residential' }), ...block(3, { building: 'yes' }, [0.0005, 0.0005])])
    const result = parseRoad(json, AT)
    expect(result?.road.class).toBe('residential')
    expect(result?.buildings.features).toHaveLength(1)
  })

  it('a road with no buildings around it still has the field, empty', () => {
    const json = overpass([node(1, [-0.001, 0]), node(2, [0.001, 0]), way(10, [1, 2], { highway: 'residential' })])
    expect(parseRoad(json, AT)?.buildings).toEqual({ type: 'FeatureCollection', features: [] })
  })

  // the recording the smoke walks against: if the real answer ever stops parsing into a city,
  // this fails here in milliseconds rather than as a grey-pixel assertion in a browser
  it('the recorded Times Square answer is a city: rings closed, heights real, towers tall', () => {
    const recorded = JSON.parse(readFileSync(new URL('../scripts/fixtures/overpass-times-square.json', import.meta.url), 'utf8'))
    const fc = parseBuildings(recorded)
    expect(fc.features.length).toBeGreaterThan(20)
    for (const f of fc.features) {
      const ring = f.geometry.coordinates[0]
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      expect(f.properties.height).toBeGreaterThan(0)
    }
    // Bank of America Tower is in there at 366 m, so the height tag is being read, not defaulted
    expect(Math.max(...fc.features.map((f) => f.properties.height))).toBeGreaterThan(100)
  })
})

describe('alignToRoad', () => {
  const wayFC = (...lines: LngLat[][]): FeatureCollection<LineString> => ({
    type: 'FeatureCollection',
    features: lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
  })

  // an east–west way through the origin: bearing() reads two points on the same
  // latitude as due east, 90°
  const eastWest = wayFC([
    [-0.001, 0],
    [0.001, 0],
  ])

  it('a car on the line and roughly along it gets the way\'s bearing', () => {
    expect(alignToRoad(eastWest, [0, 0], 90 - (ALIGN_DEGREES - 5))).toBeCloseTo(90, 3)
  })

  it('the same car facing the other way gets the reciprocal, not the forward bearing', () => {
    expect(alignToRoad(eastWest, [0, 0], 270 + (ALIGN_DEGREES - 5))).toBeCloseTo(270, 3)
  })

  it('a car off the line is null', () => {
    const off = destination([0, 0], 0, ALIGN_METRES + 7) // well north of the line
    expect(alignToRoad(eastWest, off, 90)).toBeNull()
  })

  it('a car on the line but broadside is null', () => {
    expect(alignToRoad(eastWest, [0, 0], 90 - (ALIGN_DEGREES + 60))).toBeNull()
  })

  it('no ways is null', () => {
    expect(alignToRoad(null, [0, 0], 90)).toBeNull()
  })

  it('of two ways under the car, the nearer one wins even when the farther one matches the heading better', () => {
    const p: LngLat = [0.01, 0.01]
    // through p, bearing ~70°
    const near = [destination(p, 250, 5), destination(p, 70, 5)]
    // 2 m north of p, bearing ~92° — a closer match to the 92° heading below, but farther away
    const q = destination(p, 0, 2)
    const far = [destination(q, 272, 5), destination(q, 92, 5)]
    const result = alignToRoad(wayFC(near, far), p, 92)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(70, 0)
  })
})
