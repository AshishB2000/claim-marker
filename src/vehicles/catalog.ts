/**
 * Makes, models and years a customer can pick from, so nothing has to be typed.
 *
 * Models come live from the US Department of Transportation's vehicle database (NHTSA
 * vPIC), which is free, keyless and answers browser requests, filtered to passenger cars,
 * pickups and SUVs for the chosen make and year. When it is unreachable the well-known models
 * bundled below are offered instead, and "Other" always allows typing.
 */
import type { Vehicle } from '../zones'

const BASE: string = import.meta.env.VITE_VEHICLE_API_URL ?? 'https://vpic.nhtsa.dot.gov/api/vehicles'

/** the makes a claims form is likely to see, alphabetical */
export const MAKES = [
  'Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat',
  'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover',
  'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar', 'Porsche',
  'Ram', 'Rivian', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
] as const

const THIS_YEAR = new Date().getFullYear()
/** next year's models are on sale from the autumn; 1985 is old enough for anything still insured */
export const YEARS: number[] = Array.from({ length: THIS_YEAR + 2 - 1985 }, (_, i) => THIS_YEAR + 1 - i)

export const OTHER = 'Other'

/** what the customer sees when the database cannot be reached */
export const FALLBACK: Record<string, string[]> = {
  Acura: ['ILX', 'Integra', 'MDX', 'RDX', 'TLX'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale'],
  Audi: ['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron', 'TT'],
  BMW: ['2 Series', '3 Series', '4 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X7', 'i4', 'iX', 'M3', 'M4', 'Z4'],
  Buick: ['Enclave', 'Encore', 'Envision', 'Envista'],
  Cadillac: ['CT4', 'CT5', 'Escalade', 'Lyriq', 'XT4', 'XT5', 'XT6'],
  Chevrolet: ['Blazer', 'Bolt', 'Camaro', 'Colorado', 'Corvette', 'Equinox', 'Malibu', 'Silverado', 'Suburban', 'Tahoe', 'Trailblazer', 'Traverse', 'Trax'],
  Chrysler: ['300', 'Pacifica', 'Voyager'],
  Dodge: ['Challenger', 'Charger', 'Durango', 'Hornet'],
  Fiat: ['500', '500X'],
  Ford: ['Bronco', 'Bronco Sport', 'Edge', 'Escape', 'Expedition', 'Explorer', 'F-150', 'F-250', 'F-350', 'Maverick', 'Mustang', 'Mustang Mach-E', 'Ranger', 'Transit', 'Transit Connect'],
  Genesis: ['G70', 'G80', 'G90', 'GV70', 'GV80'],
  GMC: ['Acadia', 'Canyon', 'Sierra', 'Terrain', 'Yukon'],
  Honda: ['Accord', 'Civic', 'CR-V', 'Fit', 'HR-V', 'Odyssey', 'Passport', 'Pilot', 'Ridgeline'],
  Hyundai: ['Elantra', 'Ioniq 5', 'Ioniq 6', 'Kona', 'Palisade', 'Santa Cruz', 'Santa Fe', 'Sonata', 'Tucson', 'Venue'],
  Infiniti: ['Q50', 'QX50', 'QX60', 'QX80'],
  Jaguar: ['E-Pace', 'F-Pace', 'F-Type', 'XF'],
  Jeep: ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Renegade', 'Wagoneer', 'Wrangler'],
  Kia: ['Carnival', 'EV6', 'Forte', 'K5', 'Niro', 'Seltos', 'Sorento', 'Soul', 'Sportage', 'Telluride'],
  'Land Rover': ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'],
  Lexus: ['ES', 'GX', 'IS', 'LX', 'NX', 'RX', 'TX', 'UX'],
  Lincoln: ['Aviator', 'Corsair', 'Nautilus', 'Navigator'],
  Mazda: ['CX-30', 'CX-5', 'CX-50', 'CX-90', 'Mazda3', 'Mazda6', 'MX-5 Miata'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'CLA', 'E-Class', 'EQB', 'EQE', 'EQS', 'G-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Class', 'Sprinter'],
  Mini: ['Clubman', 'Cooper', 'Countryman'],
  Mitsubishi: ['Eclipse Cross', 'Mirage', 'Outlander', 'Outlander Sport'],
  Nissan: ['Altima', 'Ariya', 'Armada', 'Frontier', 'Kicks', 'Leaf', 'Murano', 'Pathfinder', 'Rogue', 'Sentra', 'Titan', 'Versa', 'Z'],
  Polestar: ['Polestar 2', 'Polestar 3'],
  Porsche: ['911', '718 Boxster', '718 Cayman', 'Cayenne', 'Macan', 'Panamera', 'Taycan'],
  Ram: ['1500', '2500', '3500', 'ProMaster'],
  Rivian: ['R1S', 'R1T'],
  Subaru: ['Ascent', 'BRZ', 'Crosstrek', 'Forester', 'Impreza', 'Legacy', 'Outback', 'Solterra', 'WRX'],
  Tesla: ['Cybertruck', 'Model 3', 'Model S', 'Model X', 'Model Y'],
  Toyota: ['4Runner', 'Camry', 'Corolla', 'Corolla Cross', 'GR86', 'Highlander', 'Land Cruiser', 'Prius', 'RAV4', 'Sequoia', 'Sienna', 'Supra', 'Tacoma', 'Tundra', 'Venza'],
  Volkswagen: ['Atlas', 'Golf', 'GTI', 'ID.4', 'Jetta', 'Passat', 'Taos', 'Tiguan'],
  Volvo: ['C40', 'S60', 'S90', 'V60', 'XC40', 'XC60', 'XC90'],
}

const memory = new Map<string, string[]>()

/** the vPIC vehicle types that are cars, pickups and SUVs; motorcycles and trailers are left out */
const TYPES = ['car', 'truck', 'multipurpose']

type Row = { Model_Name?: string }

async function fetchType(make: string, year: number, type: string, signal?: AbortSignal): Promise<string[]> {
  const url = `${BASE}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}/vehicletype/${type}?format=json`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`vehicle database: ${res.status}`)
  const json = (await res.json()) as { Results?: Row[] }
  return (json.Results ?? []).map((r) => r.Model_Name?.trim() ?? '').filter(Boolean)
}

/**
 * Models sold under `make` in `year`, alphabetical and de-duplicated. Cached for the session so
 * flipping between years and makes is instant the second time. Throws when the database is
 * unreachable; callers fall back to `FALLBACK`.
 */
export async function modelsFor(make: string, year: number, signal?: AbortSignal): Promise<string[]> {
  const key = `${make}|${year}`
  const hit = memory.get(key)
  if (hit) return hit
  try {
    const stored = sessionStorage.getItem(`claim-marker/models/${key}`)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      memory.set(key, parsed)
      return parsed
    }
  } catch {
    // storage is a convenience, not a requirement
  }
  const lists = await Promise.all(TYPES.map((t) => fetchType(make, year, t, signal)))
  const seen = new Set<string>()
  const models: string[] = []
  for (const name of lists.flat()) {
    const k = name.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      models.push(name)
    }
  }
  models.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  memory.set(key, models)
  try {
    sessionStorage.setItem(`claim-marker/models/${key}`, JSON.stringify(models))
  } catch {
    // ignore a full or disabled storage
  }
  return models
}

/**
 * Which of the seven bodies a model most likely is, from its name. Null when there is no
 * strong signal, so the customer's own choice stands.
 */
export function guessBody(model: string): Vehicle | null {
  const m = model.toLowerCase()
  const has = (re: RegExp) => re.test(m)
  if (has(/\b(cutaway|chassis|box truck|f-[456]50|f-600|e-[34]50|np[rs]|lcf)\b/)) return 'box_truck'
  if (has(/\b(f-?[123]50|f-?150|silverado|sierra|1500|2500|3500|tundra|tacoma|ranger|frontier|titan|colorado|canyon|ridgeline|maverick|gladiator|cybertruck|r1t|santa cruz|pickup)\b/)) return 'truck'
  if (has(/\b(transit|sienna|odyssey|pacifica|carnival|sedona|sprinter|promaster|express|savana|metris|nv\d{3,4}|voyager|caravan|town & country|quest|van)\b/)) return 'van'
  if (has(/\b(coupe|mustang|camaro|challenger|corvette|supra|gr86|86|brz|miata|mx-5|370z|350z|z\b|cayman|boxster|911|tt|m2|m4|z4|f-type|roadster|convertible|cabriolet|spyder)\b/)) return 'coupe'
  if (has(/\b(hatch|hatchback|golf|gti|fit|yaris|prius|leaf|bolt|veloster|impreza|i3|mini|cooper|fiesta|focus|spark|sonic|500|mirage|rio|accent|versa note|c-hr|kona n)\b/)) return 'hatchback'
  if (
    has(
      /\b(cr-v|hr-v|pilot|passport|rav4|highlander|4runner|sequoia|land cruiser|venza|corolla cross|explorer|escape|bronco|expedition|edge|tahoe|suburban|traverse|equinox|blazer|trailblazer|trax|yukon|acadia|terrain|wrangler|cherokee|compass|renegade|wagoneer|rogue|pathfinder|murano|armada|kicks|ariya|tucson|santa fe|palisade|kona|venue|ioniq 5|sportage|sorento|telluride|seltos|soul|niro|ev6|ev9|cx-\d+|outback|forester|crosstrek|ascent|solterra|x[1-7]|ix|gl[abces]|eq[bes]|g-class|q[3-8]|e-tron|rx|nx|gx|lx|ux|tx|xc\d0|c40|model x|model y|escalade|enclave|encore|envision|envista|navigator|aviator|corsair|nautilus|range rover|discovery|defender|evoque|velar|macan|cayenne|f-pace|e-pace|i-pace|outlander|eclipse cross|qx\d0|mdx|rdx|r1s|xt[456]|lyriq|durango|hornet|stelvio|tonale|gv[78]0|countryman|500x|suv|crossover|4x4)\b/,
    )
  )
    return 'suv'
  return null
}
