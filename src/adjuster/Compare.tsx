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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { compare, impactApart, type Row } from '../claim/compare'
import { deskVoice } from '../claim/describe'
import { findings, type Finding } from '../claim/plausibility'
import { distance, type LngLat } from '../geo'
import type { Claim, ClaimVehicle } from '../claim/schema'
import type { Lang } from '../i18n'
import { Icon } from '../app/icons'
import { MapScene, type MapSceneHandle } from '../map/MapScene'
import { usePlayback } from '../map/usePlayback'
import { ReportDocument } from '../app/ReportDocument'
import type { Receipt } from './Desk'

type Account = { receipt: Receipt; claim: Claim }

/**
 * The left-hand column is always the policyholder's. Which side a report is comes from its
 * **receipt** — the server sets `party` from the token it was sent with — never from the
 * document's own `reporter.party`, which is whatever the sender wrote. When neither receipt says
 * "policyholder" (or both do), the earlier `receivedAt` goes left instead — arbitrary, but
 * stable, and the reason this comment exists.
 */
function orderPair(reports: Account[]): [Account, Account] {
  const [first, second] = reports
  const firstIsPolicyholder = first.receipt.party === 'policyholder'
  const secondIsPolicyholder = second.receipt.party === 'policyholder'
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

/**
 * The other account's vehicles are drawn over the first as ghosts, and both accounts commonly
 * call their own car "a". The ids only have to be unique to name the one the camera chases —
 * `CarLayer` keeps the two sets apart itself — so the ghosts get a prefix here and the two
 * documents are left exactly as they were filed.
 */
const GHOST = 'other:'

/** the file name the desk's "Save video" offers, by the account it opens with */
const videoName = (reference: string, type: string) => `${reference}-both-accounts.${type.includes('mp4') ? 'mp4' : 'webm'}`

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
          <td className="px-4 py-2 align-top text-slate-500">
            {r.label}
            {r.seeded && <div className="text-xs text-slate-400">Seeded from the policyholder's account, not changed</div>}
          </td>
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
  // memoised on the prop itself: the ghosts are an identity `usePlayback` and `MapScene` both
  // key on, so rebuilding the array every render would rebuild the other account's timeline
  // and re-push its bodies with it
  const ghosts = useMemo(() => (reports.length >= 2 ? orderPair(reports)[1].claim.vehicles.map((v) => ({ ...v, id: GHOST + v.id })) : NO_VEHICLES), [reports])
  // one clock, two accounts: each side drives its own routes over its own duration, and the
  // moment of impact on that shared clock is what the two ticks under the map compare
  const play = usePlayback(pair?.[0].claim.vehicles ?? NO_VEHICLES, ghosts)
  const [follow, setFollow] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const map = useRef<MapSceneHandle>(null)
  // DEV only, like `window.__map` and the diagram step's own: the shared clock, so
  // `scripts/integration-smoke.mjs` can hold both accounts on a chosen frame
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { __play: play })
  }, [play])

  if (!pair) return null
  const [left, right] = pair
  const cmp = compare(left.claim, right.claim)
  const cross = impactGap(left.claim, right.claim)

  const leftLoc = left.claim.incident.location
  const rightLoc = right.claim.incident.location
  const center: LngLat | null = leftLoc ? [leftLoc.lng, leftLoc.lat] : rightLoc ? [rightLoc.lng, rightLoc.lat] : null
  const theirCar = ghosts.find((v) => v.role === 'insured' && v.position)
  const ticks = [
    { at: play.timeline.impactMs, color: '#0f172a', who: "the policyholder's account" },
    ...(ghosts.length > 0 ? [{ at: play.ghostTimeline.impactMs, color: '#94a3b8', who: "the other driver's account" }] : []),
  ]

  /** the same recorder the customer's page runs at send time, over both accounts; nothing leaves the desk */
  const save = async () => {
    setSaving(true)
    try {
      await map.current?.stop()
      const blob = await map.current?.record('cinematic')
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = videoName(left.receipt.reference, blob.type)
      a.click()
      // not revoked on the spot: a browser that starts the download a beat later would find nothing there
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-compare data-follow={follow ?? ''} className="space-y-6">
      {center && (
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-900/10">
          <div className="relative">
            <MapScene
              ref={map}
              center={center}
              style={left.claim.incident.surface}
              vehicles={left.claim.vehicles}
              ghosts={ghosts}
              ghostPoses={play.ghostPoses}
              impact={left.claim.impact}
              selected={null}
              interactive={false}
              lang={lang}
              poses={play.poses}
              mode={play.mode}
              clock={play.clock}
              follow={follow ?? undefined}
              onPlaybackStop={play.stop}
              className="h-[420px]"
            />
            {play.canPlay && (
              <div className="absolute top-3 right-3 flex gap-1.5 print:hidden">
                <button type="button" className="chip" onClick={play.playing ? play.stop : () => play.start()} aria-pressed={play.playing}>
                  {play.playing ? <Icon.stop /> : <Icon.play />} {play.playing ? 'Stop' : 'Play both'}
                </button>
                {!play.playing && (
                  <button type="button" className="chip" onClick={() => play.start('cinematic')}>
                    <Icon.film /> Watch both
                  </button>
                )}
              </div>
            )}
          </div>
          {play.canPlay && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-white px-4 py-3 print:hidden">
              <div className="relative min-w-[220px] flex-1">
                <input
                  type="range"
                  className="w-full"
                  aria-label="Scrub both accounts"
                  min={0}
                  max={Math.round(play.duration)}
                  step={20}
                  value={Math.round(play.clock)}
                  onChange={(e) => play.seek(Number(e.target.value))}
                />
                {ticks.map((tick) => (
                  <span
                    key={tick.who}
                    title={`Impact in ${tick.who} at ${(tick.at / 1000).toFixed(1)} s`}
                    data-impact-tick={tick.at.toFixed(0)}
                    className="pointer-events-none absolute -top-0.5 h-2.5 w-0.5 rounded-full"
                    style={{ left: `${(tick.at / play.duration) * 100}%`, background: tick.color }}
                  />
                ))}
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{(play.clock / 1000).toFixed(1)} s</span>
              <button type="button" className="chip" onClick={() => setFollow((f) => (f ? null : (theirCar?.id ?? null)))} disabled={!theirCar}>
                <Icon.film /> Swap
              </button>
              <span className="text-xs text-slate-500">Watching {follow ? "the other driver's car" : "the policyholder's car"}</span>
              <button type="button" className="chip ml-auto" onClick={save} disabled={saving}>
                {saving ? <Icon.spinner /> : <Icon.film />} {saving ? 'Saving…' : 'Save video'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <caption className="border-b border-slate-100 px-4 py-3 text-left text-sm font-medium text-slate-700">{impactApart(left.claim, right.claim)}</caption>
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
        <ReportDocument claim={left.claim} voice={deskVoice(left.receipt.party)} lang={lang} />
        <ReportDocument claim={right.claim} voice={deskVoice(right.receipt.party)} lang={lang} />
      </div>
    </div>
  )
}
