/**
 * What the inbox says as a whole, rather than one report at a time: how many arrived on each of
 * the last thirty days, what kind they were, which panels keep coming up, what hour of the day
 * they happen at, the weather and the light, how many hurt someone or left a car undrivable, and
 * how long people take to report.
 *
 * All of it is counted off the **receipts** the list endpoint already sends — no document is
 * fetched for a tile — and all of it is pure, so `test/insights.test.ts` runs in plain node and
 * `Insights.tsx` only draws. One row per accident: the caller hands in `inboxRows(...)`'s leads,
 * so the two accounts of one accident are counted once, exactly as they are one pin on the map.
 *
 * Desk only, like everything in this folder, and it says nothing about any of it: these are
 * counts an insurer already has in its own reporting, brought to the screen the adjuster is
 * already looking at. No fault, no liability, no cost.
 */
import { instantOf, KIND_INFO, LIGHT_LABEL, type Kind } from '../claim/schema'
import { zoneLabel } from '../zones'

/** the little of a receipt the tiles read; every field but `kind` and `at` may be missing on a receipt filed before it existed */
export type Counted = {
  receivedAt: string
  summary: {
    kind: string
    /** local date and time of the accident, `YYYY-MM-DDTHH:mm` */
    at: string
    hurt?: number
    drivable?: boolean | null
    /** the zone ids marked across this report's vehicles */
    panels?: string[]
    weather?: string
    light?: string
    utcOffset?: number | null
  }
}

/** one counted thing: what it is, what to call it, how many */
export type Bar = { id: string; label: string; n: number }

export type Insights = {
  total: number
  /** arrivals per day, oldest first — thirty entries whether or not anything came on a given day */
  days: { day: string; n: number }[]
  kinds: Bar[]
  panels: Bar[]
  /** how many happened in each hour of the day, 0–23, from the accident's own local clock */
  hours: number[]
  weather: Bar[]
  light: Bar[]
  hurt: number
  notDrivable: number
  /**
   * Minutes from the accident to the report arriving, the middle one. Only the reports whose
   * `at` names an instant are in it — without `utcOffset` a wall clock could be half a day out
   * either way, and a median made of that says nothing.
   */
  medianLag: number | null
}

/** which tile is holding the list, when one is */
export type Focus = { by: 'kind' | 'panel' | 'hour' | 'weather' | 'light'; id: string }

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** the hour the accident happened at, off its own local clock; null when the receipt does not say */
const hourOf = (at: string) => {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):/.exec(at)
  return m ? Number(m[1]) : null
}

/** count them, most first, ties by id so the order never wobbles between renders */
const tally = (ids: string[], label: (id: string) => string): Bar[] => {
  const seen = new Map<string, number>()
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
  return [...seen].map(([id, n]) => ({ id, label: label(id), n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2)
}

export function insightsOf(rows: Counted[], now: Date): Insights {
  // thirty days back to the desk's own midnight, so an empty day is a gap in the line rather
  // than a day the line skips
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 29)
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return { day: dayOf(d), n: 0 }
  })
  const byDay = new Map(days.map((d, i) => [d.day, i]))
  const hours = Array.from({ length: 24 }, () => 0)
  const lags: number[] = []
  let hurt = 0
  let notDrivable = 0

  for (const r of rows) {
    const arrived = new Date(r.receivedAt)
    const day = Number.isFinite(arrived.getTime()) ? byDay.get(dayOf(arrived)) : undefined
    if (day !== undefined) days[day].n++
    const hour = hourOf(r.summary.at)
    if (hour !== null) hours[hour]++
    if ((r.summary.hurt ?? 0) > 0) hurt++
    if (r.summary.drivable === false) notDrivable++
    const happened = instantOf(r.summary.at, r.summary.utcOffset ?? null)
    if (happened !== null && Number.isFinite(arrived.getTime())) lags.push(Math.round((arrived.getTime() - happened) / 60_000))
  }

  return {
    total: rows.length,
    days,
    kinds: tally(
      rows.map((r) => r.summary.kind),
      (id) => KIND_INFO[id as Kind]?.label ?? id,
    ),
    panels: tally(
      rows.flatMap((r) => [...new Set(r.summary.panels ?? [])]),
      zoneLabel,
    ),
    hours,
    weather: tally(
      rows.flatMap((r) => (r.summary.weather ? [r.summary.weather] : [])),
      cap,
    ),
    light: tally(
      rows.flatMap((r) => (r.summary.light ? [r.summary.light] : [])),
      (id) => LIGHT_LABEL[id as keyof typeof LIGHT_LABEL] ?? cap(id),
    ),
    hurt,
    notDrivable,
    medianLag: median(lags),
  }
}

/** does this receipt belong to the tile the desk is holding? */
export function inFocus(r: Counted, focus: Focus | null): boolean {
  if (!focus) return true
  const s = r.summary
  switch (focus.by) {
    case 'kind':
      return s.kind === focus.id
    case 'panel':
      return (s.panels ?? []).includes(focus.id)
    case 'hour':
      return hourOf(s.at) === Number(focus.id)
    case 'weather':
      return (s.weather ?? '') === focus.id
    case 'light':
      return (s.light ?? '') === focus.id
  }
}

/** what the chip that lets go of a tile says it is holding */
export function focusLabel(focus: Focus, of: Insights): string {
  if (focus.by === 'hour') return `${String(focus.id).padStart(2, '0')}:00`
  const bars = focus.by === 'kind' ? of.kinds : focus.by === 'panel' ? of.panels : focus.by === 'weather' ? of.weather : of.light
  return bars.find((b) => b.id === focus.id)?.label ?? focus.id
}

/** minutes as an adjuster would say them */
export function lagLabel(minutes: number): string {
  const m = Math.abs(minutes)
  if (m < 90) return `${Math.round(m)} min`
  if (m < 48 * 60) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} days`
}
