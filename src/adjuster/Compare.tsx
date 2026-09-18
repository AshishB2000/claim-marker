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
import type { ReactNode } from 'react'
import { compare, type Row } from '../claim/compare'
import { findings, type Finding } from '../claim/plausibility'
import { distance, type LngLat } from '../geo'
import type { Claim } from '../claim/schema'
import type { Lang } from '../i18n'
import { MapScene } from '../map/MapScene'
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
  if (reports.length < 2) return null
  const [left, right] = orderPair(reports)
  const cmp = compare(left.claim, right.claim)
  const cross = impactGap(left.claim, right.claim)

  const leftLoc = left.claim.incident.location
  const rightLoc = right.claim.incident.location
  const center: LngLat | null = leftLoc ? [leftLoc.lng, leftLoc.lat] : rightLoc ? [rightLoc.lng, rightLoc.lat] : null

  return (
    <div data-compare className="space-y-6">
      {center && (
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-900/10">
          <MapScene
            center={center}
            style={left.claim.incident.surface}
            vehicles={left.claim.vehicles}
            ghosts={right.claim.vehicles}
            impact={left.claim.impact}
            selected={null}
            interactive={false}
            lang={lang}
            className="h-[420px]"
          />
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
