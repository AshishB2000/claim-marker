import { describe, expect, it } from 'vitest'
import { BAY, SHEET, lotLines, paperLines, styleFor } from '../src/map/styles'
import { distance, type LngLat } from '../src/geo'

const here: LngLat = [-73.9859, 40.7573]

const ends = (f: ReturnType<typeof paperLines>[number]) => (f.geometry.type === 'LineString' ? (f.geometry.coordinates as LngLat[]) : [])

describe('drawn grounds', () => {
  it('the blank sheet is squared paper centred on the incident', () => {
    const lines = paperLines(here)
    // a line every 5 m across ±SHEET, both ways
    expect(lines).toHaveLength(2 * (2 * (SHEET / 5) + 1))
    for (const l of lines) for (const p of ends(l)) expect(distance(here, p)).toBeLessThan(SHEET * Math.SQRT2 + 1)
    expect(lines.filter((l) => l.properties?.major)).toHaveLength(2 * (2 * (SHEET / 25) + 1))
  })

  it('the parking lot has bays a car fits in, back to back, with an aisle at the incident', () => {
    const lines = lotLines(here)
    // the nearest line is the edge of the aisle the incident sits in
    expect(Math.min(...lines.flatMap(ends).map((p) => distance(here, p)))).toBeCloseTo(BAY.aisle / 2, 1)
    // bay dividers are BAY.width apart and 2 × BAY.depth long
    const dividers = lines.filter((l) => {
      const [a, b] = ends(l)
      return Math.abs(distance(a, b) - 2 * BAY.depth) < 0.02
    })
    expect(dividers.length).toBeGreaterThan(100)
    const [a, b] = [ends(dividers[0])[0], ends(dividers[1])[0]]
    expect(distance(a, b)).toBeCloseTo(BAY.width, 1)
  })

  it('a drawn ground is a complete style with the lines inline; the maps stay raster', () => {
    for (const s of ['lot', 'paper'] as const) {
      const style = styleFor(s, here)
      expect(style.layers.map((l) => l.type)).toEqual(['background', 'line'])
      expect((style.sources.sheet as { type: string }).type).toBe('geojson')
    }
    expect(styleFor('satellite', here).layers[0].type).toBe('raster')
    expect(styleFor('streets', here).layers[0].type).toBe('raster')
  })
})
