/**
 * What the desk's map is given, and the two filters that come with it: the receipts that carry
 * a place, as one GeoJSON collection, how far back to look, and what the view currently holds.
 * All of it is pure — `test/pins.test.ts` holds it to that — so `DeskMap.tsx` only draws.
 *
 * A receipt filed before the server put `lng`/`lat` on its summary has no place, and a report
 * with no place is simply not on the map: it stays in the list like any other.
 */
import type { FeatureCollection, Point } from 'geojson'

/** the little of a receipt the map reads */
export type Placed = {
  reference: string
  status: string
  receivedAt: string
  signals?: unknown[]
  summary: { lng?: number | null; lat?: number | null; hurt?: number; drivable?: boolean | null }
}

/** the view, as MapLibre's `getBounds().toArray()` flattens: west, south, east, north */
export type Bounds = [number, number, number, number]

export type Range = 'all' | 'today' | 'week' | 'month'

export const RANGE_LABEL: Record<Range, string> = { all: 'Any time', today: 'Today', week: '7 days', month: '30 days' }

/** where a receipt says it happened, or null when it does not say */
export function placeOf(r: Placed): [number, number] | null {
  const { lng, lat } = r.summary
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}

/** the earliest arrival still inside this range; null is every report there is */
export function rangeStart(range: Range, now: Date): Date | null {
  if (range === 'all') return null
  // "today" is the desk's own day, from midnight — not the last twenty-four hours
  if (range === 'today') {
    const from = new Date(now)
    from.setHours(0, 0, 0, 0)
    return from
  }
  return new Date(now.getTime() - (range === 'week' ? 7 : 30) * 86_400_000)
}

export function inRange(receivedAt: string, range: Range, now: Date): boolean {
  const from = rangeStart(range, now)
  const at = new Date(receivedAt).getTime()
  return !from || (Number.isFinite(at) && at >= from.getTime())
}

/** in the view: west is greater than east when it crosses the antimeridian, which is a view, not an error */
export function inBounds([lng, lat]: [number, number], [west, south, east, north]: Bounds): boolean {
  const acrossLng = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east
  return acrossLng && lat >= south && lat <= north
}

/** what the list keeps when it is showing only what the map is showing; a report with no place is not on the map */
export function inView(r: Placed, bounds: Bounds): boolean {
  const at = placeOf(r)
  return !!at && inBounds(at, bounds)
}

/**
 * The receipts as points. The properties are what the layers paint by: the status, whether
 * anyone was hurt or the car cannot be driven (both make the point bigger), and how many things
 * the server has seen before (a ring). MapLibre expressions read primitives, so `signals` is a
 * count and `notDrivable` a flag rather than the tri-state the receipt carries.
 */
export function pins(receipts: Placed[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: receipts.flatMap((r) => {
      const at = placeOf(r)
      if (!at) return []
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: at },
          properties: {
            reference: r.reference,
            status: r.status,
            hurt: r.summary.hurt ?? 0,
            notDrivable: r.summary.drivable === false,
            signals: r.signals?.length ?? 0,
          },
        },
      ]
    }),
  }
}
