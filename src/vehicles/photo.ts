/**
 * A photograph of the real make and model, so "2021 Toyota Camry" shows a 2021 Toyota Camry
 * rather than the generic 3D shape that stands in for it on the map.
 *
 * There is no free 3D model per make — those are commercial, trademarked and there would be
 * thousands — but Wikipedia has a photograph of nearly every car ever sold, and its page
 * image API is keyless and answers browser requests. Searching with the year usually lands
 * on the generation page ("Toyota Camry (XV70)" for 2021), so the photo is the right shape
 * of Camry too. Photos are Wikimedia Commons material and are credited where shown.
 *
 * An insurer that licenses studio renders (imagin.studio and the like — any make, any year,
 * in the customer's colour) sets `VITE_VEHICLE_PHOTO_URL` to a URL template with `{make}`,
 * `{model}`, `{year}` and `{color}` placeholders and the lookup is skipped entirely.
 */

const TEMPLATE: string | undefined = import.meta.env.VITE_VEHICLE_PHOTO_URL
const WIKI: string = import.meta.env.VITE_VEHICLE_PHOTO_API ?? 'https://en.wikipedia.org/w/api.php'

export type Photo = {
  url: string
  /** where the picture came from, for the credit line; null for a licensed provider */
  credit: { title: string; href: string } | null
}

type Page = { title: string; index?: number; thumbnail?: { source: string }; pageimage?: string }

const memory = new Map<string, Photo | null>()

/**
 * The photo for a vehicle, or null when nothing suitable exists. Cached for the session.
 * Throws only when the network does — a car with no picture is not an error.
 */
export async function photoFor(make: string, model: string, year: number | null, color: string, signal?: AbortSignal): Promise<Photo | null> {
  if (!make || !model) return null
  if (TEMPLATE) {
    const values: Record<string, string> = { make, model, year: String(year ?? ''), color: color.replace('#', '') }
    return { url: TEMPLATE.replace(/\{(make|model|year|color)\}/g, (_, k: string) => encodeURIComponent(values[k])), credit: null }
  }
  const key = `${make}|${model}|${year ?? ''}`
  const hit = memory.get(key)
  if (hit !== undefined) return hit
  try {
    const stored = sessionStorage.getItem(`claim-marker/photo/${key}`)
    if (stored) {
      const parsed = JSON.parse(stored) as Photo | null
      memory.set(key, parsed)
      return parsed
    }
  } catch {
    // storage is a convenience, not a requirement
  }
  const q = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: [year, make, model].filter(Boolean).join(' '),
    gsrlimit: '5',
    prop: 'pageimages',
    pithumbsize: '800',
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`${WIKI}?${q}`, { signal })
  if (!res.ok) throw new Error(`photo lookup: ${res.status}`)
  const json = (await res.json()) as { query?: { pages?: Record<string, Page> } }
  const photo = pick(Object.values(json.query?.pages ?? {}), make)
  memory.set(key, photo)
  try {
    sessionStorage.setItem(`claim-marker/photo/${key}`, JSON.stringify(photo))
  } catch {
    // ignore a full or disabled storage
  }
  return photo
}

/**
 * The best of the search results: in rank order, the first page with a picture whose title
 * names the make — "Kia Telluride", not the town of Telluride — and is not a list article.
 */
export function pick(pages: Page[], make: string): Photo | null {
  const m = make.toLowerCase()
  const ranked = [...pages].sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
  const page =
    ranked.find((p) => p.thumbnail && p.title.toLowerCase().includes(m) && !/^list of/i.test(p.title)) ??
    ranked.find((p) => p.thumbnail && !/^list of/i.test(p.title))
  if (!page?.thumbnail) return null
  return {
    url: page.thumbnail.source,
    credit: { title: page.title, href: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage ?? '')}` },
  }
}
