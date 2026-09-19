import { describe, expect, it } from 'vitest'
import { CARD_OFFSET, cardPlacement, cardsOf } from '../src/marker/cards'
import { toWorld } from '../src/vehicles/bodies'
import { VEHICLE_IDS, zoneById, zonesOf, type V3, type Vehicle } from '../src/zones'
import type { Photo } from '../src/claim/schema'

const zone = (body: Vehicle, id: string) => zoneById(body, id)!
const len = (v: V3) => Math.hypot(...v)
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

describe('cardPlacement', () => {
  it('stands the card 0.6 m out from the anchor, in metres: the kit-unit anchor goes through toWorld first', () => {
    // the sedan's front bumper: (0, 0.34, 1.24) in the kit is (0, 0.34, 2.373) in metres
    const { position, normal } = cardPlacement('sedan', zone('sedan', 'front_bumper'))
    expect(position[0]).toBeCloseTo(0, 6)
    expect(position[1]).toBeCloseTo(0.4251, 3)
    expect(position[2]).toBeCloseTo(2.9673, 3)
    expect(len(normal)).toBeCloseTo(1, 9)
    // anchor + normal × offset, exactly
    const anchor = toWorld('sedan', zone('sedan', 'front_bumper').anchor)
    position.forEach((n, i) => expect(n).toBeCloseTo(anchor[i] + normal[i] * CARD_OFFSET, 9))
  })

  it('points out of the panel the way the frame says: the nose +Z, the car’s left +X, the roof up', () => {
    const n = (id: string) => cardPlacement('sedan', zone('sedan', id)).normal
    expect(n('front_bumper')[2]).toBeGreaterThan(0.9)
    expect(n('rear_bumper')[2]).toBeLessThan(-0.9)
    expect(n('left_front_door')[0]).toBeGreaterThan(0.5)
    expect(n('right_front_door')[0]).toBeLessThan(-0.5)
    const roof = n('roof')
    expect(roof[1]).toBeGreaterThan(Math.abs(roof[0]))
    expect(roof[1]).toBeGreaterThan(Math.abs(roof[2]))
  })

  it('every zone of every body: a unit normal, the card 0.6 m from its anchor and never lower than it, so never in the floor', () => {
    for (const body of VEHICLE_IDS)
      for (const z of zonesOf(body)) {
        const anchor = toWorld(body, z.anchor)
        const { position, normal } = cardPlacement(body, z)
        expect(len(normal), `${body} ${z.id}`).toBeCloseTo(1, 9)
        expect(len(sub(position, anchor)), `${body} ${z.id}`).toBeCloseTo(CARD_OFFSET, 9)
        expect(position[1], `${body} ${z.id}`).toBeGreaterThanOrEqual(anchor[1])
        // outward: farther from the middle of the body than the panel it belongs to
        expect(len(position), `${body} ${z.id}`).toBeGreaterThan(len(anchor))
      }
  })
})

describe('cardsOf', () => {
  const photo = (of: string | null, shows?: string): Photo => ({ data: `data:image/jpeg;base64,${of}${shows}`, of, caption: '', ...(shows ? { shows } : {}) })

  it('takes only this vehicle’s photos that show a panel, keeping each one’s place on the claim as its id', () => {
    const photos = [photo(null), photo('a', 'hood'), photo('a'), photo('b', 'hood'), photo('a', 'roof')]
    expect(cardsOf(photos, 'a')).toEqual([
      { id: 1, dataUrl: photos[1].data, shows: 'hood' },
      { id: 4, dataUrl: photos[4].data, shows: 'roof' },
    ])
    expect(cardsOf(photos, 'c')).toEqual([])
  })
})
