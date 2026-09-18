import { useRef, useState } from 'react'
import { useClaim, type Step } from '../../claim/store'
import { makeReference, toDocument } from '../../claim/schema'
import type { MapSceneHandle } from '../../map/MapScene'
import type { DamageMarkerHandle } from '../../marker/DamageMarker'
import { Icon } from '../icons'
import { Field, YesNo } from '../ui'
import { submitClaim } from '../submit'
import { fraudNoticeFor } from '../../config'
import { ReportDocument } from '../ReportDocument'
import { assistOn, checkReport } from '../../assist/client'
import type { Check } from '../../assist/schema'
import { useLang, useT } from '../../i18n/useT'

/**
 * The optional second look: the report read back by the insurer's endpoint, as questions the
 * customer may answer or ignore. It never blocks sending — nothing here touches `canSend` —
 * because a claim held up by a machine's doubt is worse than a claim with a gap in it.
 */
function SecondLook() {
  const t = useT()
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
      setFailed(e instanceof Error ? e.message : t('scene.assist.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="eyebrow">{t('scene.check.title')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('scene.check.lead')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary btn-sm" onClick={run} disabled={busy}>
          {busy ? <Icon.spinner /> : <Icon.wand />}
          {busy ? t('scene.check.busy') : checks ? t('scene.check.again') : t('scene.check.run')}
        </button>
        {checks && !busy && (
          <button className="btn btn-ghost btn-sm" onClick={() => setChecks(null)}>
            {t('scene.check.dismiss')}
          </button>
        )}
      </div>
      {failed && !busy && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{failed}</p>}
      {checks && !busy && checks.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800">
          <Icon.check /> {t('scene.check.clear')}
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
                      {t('scene.check.goto')}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-400">{t('scene.check.disclaimer')}</p>
    </div>
  )
}

export function Review({ onSubmitted }: { onSubmitted: () => void }) {
  const t = useT()
  const lang = useLang()
  const claim = useClaim((s) => s.claim)
  const submitted = useClaim((s) => s.submitted)
  const setReporter = useClaim((s) => s.setReporter)
  const setAttestation = useClaim((s) => s.setAttestation)
  const map = useRef<MapSceneHandle>(null)
  const markers = useRef(new Map<string, DamageMarkerHandle>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // the other driver is naming their own insurer, not the policy this page was built for
  const party = claim.reporter.party === 'other_party'

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
      setError(e instanceof Error ? e.message : t('scene.send.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <ReportDocument claim={claim} edit lang={lang} mapRef={map} markers={markers} />

      {/* ── who to contact ───────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">{t('scene.contact.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('scene.contact.lead')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t('scene.contact.name')}>
            <input
              className="input"
              aria-label={t('scene.contact.name')}
              value={claim.reporter.name}
              onChange={(e) => setReporter({ name: e.target.value })}
              autoComplete="name"
            />
          </Field>
          <Field label={t('scene.contact.phone')}>
            <input
              className="input"
              type="tel"
              aria-label={t('scene.contact.phoneAria')}
              value={claim.reporter.phone}
              onChange={(e) => setReporter({ phone: e.target.value })}
              autoComplete="tel"
            />
          </Field>
          <Field label={t('scene.contact.email')}>
            <input
              className="input"
              type="email"
              aria-label={t('scene.contact.emailAria')}
              value={claim.reporter.email}
              onChange={(e) => setReporter({ email: e.target.value })}
              autoComplete="email"
            />
          </Field>
          <Field label={t(party ? 'scene.contact.policy.party' : 'scene.contact.policy')}>
            <input
              className="input uppercase"
              aria-label={t(party ? 'scene.contact.policyAria.party' : 'scene.contact.policyAria')}
              value={claim.reporter.policy}
              onChange={(e) => setReporter({ policy: e.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="mt-4">
          <span className="label">{t('scene.contact.policyholder')}</span>
          <YesNo name={t('scene.contact.policyholderAria')} value={claim.reporter.policyholder} onChange={(policyholder) => setReporter({ policyholder })} />
        </div>
      </div>

      {assistOn() && <SecondLook />}

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      {/* ── confirm and send ─────────────────────────────────────── */}
      <div className="card p-6">
        <h2 className="eyebrow">{t('scene.send.title')}</h2>
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">{fraudNoticeFor(lang)}</p>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={claim.attestation.agreed}
            onChange={(e) => setAttestation({ agreed: e.target.checked })}
            aria-label={t('scene.send.agreeAria')}
          />
          <span>{t('scene.send.agree')}</span>
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label={t('scene.send.signLabel')}>
            <input
              className="input max-w-md"
              aria-label={t('scene.send.signAria')}
              placeholder={claim.reporter.name || t('scene.send.signPlaceholder')}
              value={claim.attestation.name}
              onChange={(e) => setAttestation({ name: e.target.value })}
              autoComplete="name"
            />
          </Field>
          <button className="btn btn-primary" onClick={send} disabled={!canSend}>
            {busy ? <Icon.spinner /> : <Icon.check />}
            {busy ? t('scene.send.sending') : t('scene.send.send')}
          </button>
        </div>
        {!canSend && !busy && <p className="mt-2 text-xs text-slate-500">{t('scene.send.locked')}</p>}
      </div>
    </div>
  )
}
