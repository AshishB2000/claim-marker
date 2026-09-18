/**
 * Two complete accounts of one accident, laid side by side for the desk: one map with both,
 * where they agree and where they do not, what each diagram says about itself, and the two
 * documents in full. Everything shown here is either `compare()`'s own words or `findings()`'s
 * — this file adds exactly one check of its own, the two accounts' point of impact against each
 * other, and otherwise only arranges what those two modules already say.
 *
 * The same rule `compare.ts` keeps applies here: a difference is a difference, not a verdict.
 * This never says who is right, and the short list of words that would turn a difference into
 * an accusation — the one `compare.ts` keeps out of its own source — is kept out of this file
 * on the same terms: not in the code, not in a message, not in a comment, this one included.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { compare, type Row } from '../claim/compare'
import { findings, type Finding } from '../claim/plausibility'
import { distance, type LngLat } from '../geo'
import type { Claim, ClaimVehicle } from '../claim/schema'
import type { Lang } from '../i18n'
import { Icon } from '../app/icons'
import { MapScene } from '../map/MapScene'
import type { CarPose } from '../map/carLayer'
import { durationOf, posesAt } from '../map/playback'
import { ease, HOLD_MS } from '../map/usePlayback'
import { ReportDocument } from '../app/ReportDocument'
import type { Receipt } from './Desk'

type Account = { receipt: Receipt; claim: Claim }

/**
 * The left-hand column is always the policyholder's. Their document says so directly through
 * `reporter.party` on every report but the rare one filed before there were two accounts; when
 * neither side says "policyholder" (or, stranger still, both do), the earlier `receivedAt`
 * goes left instead — arbitrary, but stable, and the reason this comment exists.
 */
function orderPair(reports: Account[]): [Account, Account] {
  const [first, second] = reports
  const firstIsPolicyholder = first.claim.reporter.party === 'policyholder'
  const secondIsPolicyholder = second.claim.reporter.party === 'policyholder'
  if (firstIsPolicyholder !== secondIsPolicyholder) return firstIsPolicyholder ? [first, second] : [second, first]
  return first.receipt.receivedAt <= second.receipt.receivedAt ? [first, second] : [second, first]
}

/**
 * How far apart the two accounts' own point of impact can be and still read as the same point.
 * The only check in this file that is not already in `compare.ts` or `plausibility.ts`: both of
 * those work on one document at a time, and this is the one thing worth asking across both.
 */
const IMPACT_GAP_METRES = 40

function impactGap(a: Claim, b: Claim): Finding | null {
  if (!a.impact || !b.impact) return null
  const gap = distance(a.impact, b.impact)
  if (gap <= IMPACT_GAP_METRES) return null
  return {
    code: 'impact_gap',
    level: 'look',
    text: `The two accounts mark the point of impact ${Math.round(gap)} m apart.`,
    evidence: `policyholder's account at ${a.impact[1].toFixed(5)}, ${a.impact[0].toFixed(5)}; the other driver's at ${b.impact[1].toFixed(5)}, ${b.impact[0].toFixed(5)}`,
  }
}

function FindingsCard({ heading, items }: { heading: string; items: Finding[] }) {
  if (items.length === 0) return null
  return (
    <div className="card px-6 py-5">
      <h3 className="eyebrow">{heading}</h3>
      <ul className="mt-3 space-y-3 text-sm">
        {items.map((f) => (
          <li key={`${f.code}:${f.text}`} className="flex items-start gap-2.5">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${f.level === 'look' ? 'bg-amber-500' : 'bg-slate-300'}`} />
            <span>
              {f.text} <span className="text-slate-500">{f.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const NO_VEHICLES: ClaimVehicle[] = []

/** a ghost vehicle at its current pose: position and heading replaced, path (and everything else) kept so the dashed route still draws */
function withPoses(vehicles: ClaimVehicle[], poses: CarPose[]): ClaimVehicle[] {
  const byId = new Map(poses.map((p) => [p.id, p]))
  return vehicles.map((v) => {
    const p = byId.get(v.id)
    return p ? { ...v, position: p.position, heading: p.heading } : v
  })
}

/**
 * Both accounts' playback from one clock: each side runs out its own route over its own
 * duration, so the two versions of the same seconds move together and the shorter route holds
 * its last pose (`posesAt` clamps past t=1) while the longer one keeps going, rather than the
 * two snapping into lockstep.
 */
function usePlayBoth(left: ClaimVehicle[], right: ClaimVehicle[]) {
  const [frame, setFrame] = useState<{ left: CarPose[]; right: CarPose[] } | null>(null)
  const raf = useRef(0)
  const hold = useRef(0)

  const stop = () => {
    cancelAnimationFrame(raf.current)
    clearTimeout(hold.current)
    setFrame(null)
  }

  const start = () => {
    cancelAnimationFrame(raf.current)
    clearTimeout(hold.current)
    const leftMs = durationOf(left)
    const rightMs = durationOf(right)
    const longestMs = Math.max(leftMs, rightMs)
    const t0 = performance.now()
    const tick = (now: number) => {
      const elapsed = now - t0
      setFrame({ left: posesAt(left, ease(Math.min(1, elapsed / leftMs))), right: posesAt(right, ease(Math.min(1, elapsed / rightMs))) })
      if (elapsed < longestMs) raf.current = requestAnimationFrame(tick)
      else hold.current = window.setTimeout(stop, HOLD_MS)
    }
    raf.current = requestAnimationFrame(tick)
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      clearTimeout(hold.current)
    },
    [],
  )

  return { frame, playing: frame !== null, toggle: () => (frame !== null ? stop() : start()) }
}

function RowGroup({ heading, rows }: { heading: string; rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <>
      <tr>
        <th colSpan={4} className="bg-slate-50 px-4 py-1.5 text-left text-xs font-semibold text-slate-500">
          {heading}
        </th>
      </tr>
      {rows.map((r) => (
        <tr key={r.key} className="border-b border-slate-100 last:border-b-0">
          <td className="px-4 py-2 align-top text-slate-500">{r.label}</td>
          <td className="px-4 py-2 align-top">{r.a}</td>
          <td className="px-4 py-2 align-top">{r.b}</td>
          <td className="px-4 py-2 align-top text-slate-500">{r.gap ?? ''}</td>
        </tr>
      ))}
    </>
  )
}

export function Compare({ reports, lang }: { reports: Account[]; lang?: Lang }): ReactNode {
  // called unconditionally, before the `reports.length < 2` guard below, so the hook count
  // never varies across renders (react/rules-of-hooks) — the pair itself may be null
  const pair = reports.length >= 2 ? orderPair(reports) : null
  const play = usePlayBoth(pair?.[0].claim.vehicles ?? NO_VEHICLES, pair?.[1].claim.vehicles ?? NO_VEHICLES)
  if (!pair) return null
  const [left, right] = pair
  const cmp = compare(left.claim, right.claim)
  const cross = impactGap(left.claim, right.claim)

  const leftLoc = left.claim.incident.location
  const rightLoc = right.claim.incident.location
  const center: LngLat | null = leftLoc ? [leftLoc.lng, leftLoc.lat] : rightLoc ? [rightLoc.lng, rightLoc.lat] : null
  const canPlayBoth = [...left.claim.vehicles, ...right.claim.vehicles].some((v) => v.position && v.path.length > 0)

  return (
    <div data-compare className="space-y-6">
      {center && (
        <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-900/10">
          <MapScene
            center={center}
            style={left.claim.incident.surface}
            vehicles={left.claim.vehicles}
            ghosts={play.frame ? withPoses(right.claim.vehicles, play.frame.right) : right.claim.vehicles}
            impact={left.claim.impact}
            selected={null}
            interactive={false}
            lang={lang}
            poses={play.frame?.left ?? null}
            className="h-[420px]"
          />
          {canPlayBoth && (
            <button type="button" className="chip absolute top-3 right-3 print:hidden" onClick={play.toggle} aria-pressed={play.playing}>
              {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? 'Stop' : 'Play both'}
            </button>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500"></th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">The policyholder's account</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">The other driver's account</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Gap</th>
            </tr>
          </thead>
          <tbody>
            <RowGroup heading="Differ" rows={cmp.differ} />
            <RowGroup heading="Agree" rows={cmp.agree} />
          </tbody>
        </table>
        {cmp.unmatched.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-500">Unmatched</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {cmp.unmatched.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <FindingsCard heading="Between the two accounts" items={cross ? [cross] : []} />
      <FindingsCard heading="From the policyholder's account" items={findings(left.claim)} />
      <FindingsCard heading="From the other driver's account" items={findings(right.claim)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReportDocument claim={left.claim} voice="desk" lang={lang} />
        <ReportDocument claim={right.claim} voice="desk" lang={lang} />
      </div>
    </div>
  )
}
