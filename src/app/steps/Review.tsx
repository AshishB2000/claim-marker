import { useRef, useState } from 'react'
import { useClaim, type Step } from '../../claim/store'
import { makeReference, toDocument } from '../../claim/schema'
import type { MapSceneHandle } from '../../map/MapScene'
import type { DamageMarkerHandle } from '../../marker/DamageMarker'
import { Icon } from '../icons'
import { Field, YesNo } from '../ui'
import { submitClaim } from '../submit'
import { config } from '../../config'
import { ReportDocument } from '../ReportDocument'
import { assistOn, checkReport } from '../../assist/client'
import type { Check } from '../../assist/schema'

/**
 * The optional second look: the report read back by the insurer's endpoint, as questions the
 * customer may answer or ignore. It never blocks sending — nothing here touches `canSend` —
 * because a claim held up by a machine's doubt is worse than a claim with a gap in it.
 */
function SecondLook() {
  const claim = useClaim((s) => s.claim)
  const goto = useClaim((s) => s.goto)
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setFailed(null)
    try {
      setChecks(await checkReport(claim))
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The assistant could not answer.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="eyebrow">A second look</h2>
      <p className="mt-1 text-sm text-slate-500">
        We can read your report back and point out anything a claims handler would ring up to ask about. Nothing here stops you sending.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
          {busy ? <Icon.spinner /> : <Icon.wand />}
          {busy ? 'Reading it over…' : checks ? 'Check it again' : 'Check it over for me'}
        </button>
        {checks && !busy && (
          <button className="btn btn-ghost btn-sm" onClick={() => setChecks(null)}>
            Dismiss
          </button>
        )}
      </div>
      {failed && !busy && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
      {checks && !busy && checks.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800">
          <Icon.check /> Nothing stood out.
        </p>
      )}
      {checks && !busy && checks.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
              <span>
                {c.text}
                {c.step && (
                  <>
                    {' '}
                    <button className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline" onClick={() => goto(c.step as Step)}>
                      Go to that step
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-400">Read by AI. It does not decide anything about your claim, and it never looks at who is at fault.</p>
    </div>
  )
}

export function Review({ onSubmitted }: { onSubmitted: () => void }) {
  const claim = useClaim((s) => s.claim)
  const submitted = useClaim((s) => s.submitted)
  const setReporter = useClaim((s) => s.setReporter)
  const setAttestation = useClaim((s) => s.setAttestation)
  const map = useRef<MapSceneHandle>(null)
  const markers = useRef(new Map<string, DamageMarkerHandle>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSend = !busy && claim.attestation.agreed && claim.attestation.name.trim().length > 1

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const damage: Record<string, string> = {}
      for (const [id, h] of markers.current) {
        const png = h.export().png
        if (png) damage[id] = png
      }
      const submittedAt = new Date().toISOString()
      // the attestation is stamped at the moment of sending, and only then
      const doc = toDocument({
        ...claim,
        reference: makeReference(),
        submittedAt,
        attestation: { ...claim.attestation, at: submittedAt },
        attachments: { ...claim.attachments, scene: map.current?.export() ?? null, damage },
      })
      const { reference, delivery } = await submitClaim(doc)
      setAttestation({ at: submittedAt })
      submitted(reference, submittedAt, delivery)
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <ReportDocument claim={claim} edit mapRef={map} markers={markers} />

      {/* ── who to contact ───────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">How do we reach you?</h2>
        <p className="mt-1 text-sm text-slate-500">A claims handler will call or email about this report.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Your name">
            <input className="input" aria-label="Your name" value={claim.reporter.name} onChange={(e) => setReporter({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" aria-label="Your phone" value={claim.reporter.phone} onChange={(e) => setReporter({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" aria-label="Your email" value={claim.reporter.email} onChange={(e) => setReporter({ email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label="Policy number, if you have it">
            <input className="input uppercase" aria-label="Policy number" value={claim.reporter.policy} onChange={(e) => setReporter({ policy: e.target.value })} autoComplete="off" />
          </Field>
        </div>
        <div className="mt-4">
          <span className="label">Are you the policyholder?</span>
          <YesNo name="Are you the policyholder" value={claim.reporter.policyholder} onChange={(policyholder) => setReporter({ policyholder })} />
        </div>
      </div>

      {assistOn() && <SecondLook />}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      {/* ── confirm and send ─────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">Confirm and send</h2>
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">{config.fraudNotice}</p>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={claim.attestation.agreed} onChange={(e) => setAttestation({ agreed: e.target.checked })} aria-label="I confirm this report is true" />
          <span>I confirm that what I have said in this report is true and complete to the best of my knowledge.</span>
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Type your full name to sign">
            <input className="input max-w-md" aria-label="Signature" placeholder={claim.reporter.name || 'Your full name'} value={claim.attestation.name} onChange={(e) => setAttestation({ name: e.target.value })} autoComplete="name" />
          </Field>
          <button className="btn btn-primary" onClick={send} disabled={!canSend}>
            {busy ? <Icon.spinner /> : <Icon.check />}
            {busy ? 'Sending…' : 'Send my report'}
          </button>
        </div>
        {!canSend && !busy && <p className="mt-2 text-xs text-slate-500">Tick the box and sign to send.</p>}
      </div>
    </div>
  )
}
