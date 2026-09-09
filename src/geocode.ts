/**
 * Address search and reverse lookup through Photon (komoot), an OpenStreetMap geocoder built
 * for as-you-type queries and usable without a key. Swap the base URL for a keyed provider
 * if the insurer has one; the shape returned here is all the app knows about.
 */
import type { LngLat } from './geo'

const BASE = import.meta.env.VITE_GEOCODER_URL ?? 'https://photon.komoot.io'

export type Place = {
  /** the short name a customer would recognise */
  name: string
  /** the full line to show under it */
  address: string
  lng: number
  lat: number
}

type Feature = {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | undefined>
}

function toPlace(f: Feature): Place | null {
  const p = f.properties
  const [lng, lat] = f.geometry.coordinates
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const name = p.name ?? street ?? p.city ?? ''
  if (!name) return null
  const parts = [name, street !== name ? street : '', p.district ?? p.locality, p.city, p.state, p.postcode, p.country]
  const address = parts.filter((s, i, a) => s && a.indexOf(s) === i).join(', ')
  return { name, address, lng, lat }
}

async function photon(path: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`${BASE}${path}`, { signal })
  if (!res.ok) throw new Error(`geocoder: ${res.status}`)
  const json = (await res.json()) as { features?: Feature[] }
  const seen = new Set<string>()
  const out: Place[] = []
  for (const f of json.features ?? []) {
    const place = toPlace(f)
    if (place && !seen.has(place.address)) {
      seen.add(place.address)
      out.push(place)
    }
  }
  return out
}

/** suggestions for a partial address, biased towards `near` when known */
export function searchPlaces(query: string, near?: LngLat | null, signal?: AbortSignal): Promise<Place[]> {
  const q = new URLSearchParams({ q: query, limit: '6', lang: 'en' })
  if (near) {
    q.set('lon', String(near[0]))
    q.set('lat', String(near[1]))
  }
  return photon(`/api/?${q}`, signal)
}

/** the nearest address to a point, for "use my location" and for a dragged pin */
export async function reversePlace([lng, lat]: LngLat, signal?: AbortSignal): Promise<Place | null> {
  const q = new URLSearchParams({ lon: String(lng), lat: String(lat), lang: 'en' })
  const places = await photon(`/reverse?${q}`, signal)
  return places[0] ?? null
}
