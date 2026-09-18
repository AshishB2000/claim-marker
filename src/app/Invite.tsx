import { useState } from 'react'
import qrcode from 'qrcode-generator'
import { useClaim, othersOf } from '../claim/store'
import { seedOf } from '../claim/seed'
import { useT } from '../i18n/useT'
import { createIncident, type Invite as Made } from './incidents'
import { Icon } from './icons'

/**
 * "Ask the other driver to add their side."
 *
 * At the scene, both drivers are standing in the road with their phones out. This is the
 * moment to get the other side of the story: a QR code on this screen, their camera, and they
 * are filling in their own account on their own phone — no app, no account, no email address
 * anyone has to spell out over traffic noise.
 *
 * The code carries a link and a signed token and nothing else. What the other driver's page
 * then loads is the *seed* — where, when, the ground, and the shapes and colours of the cars
 * — and never this report: see `src/claim/seed.ts`.
 *
 * `qrcode-generator` is the one runtime dependency added for this. Hand-writing Reed–Solomon
 * encoding and mask selection is a week of work and a week of risk for a thing that is
 * completely solved; the library is MIT, has no dependencies of its own, and renders to an
 * SVG string we can drop straight into the page.
 */

/** error correction level M: readable with a thumb over a corner, which is how this gets scanned */
const QR_LEVEL = 'M'

export function Invite() {
  const claim = useClaim((s) => s.claim)
  const shareIncident = useClaim((s) => s.shareIncident)
  const t = useT()
  const [made, setMade] = useState<Made | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const ask = async () => {
    setBusy(true)
    setFailed(false)
    const seed = seedOf(claim.incident, othersOf(claim).map((v) => ({ body: v.body, color: v.color, make: v.make, model: v.model })))
    const invite = await createIncident(seed, claim.reference)
    setBusy(false)
    if (!invite) return setFailed(true)
    shareIncident(invite.incident)
    setMade(invite)
  }

  // the QR is drawn once per link: it is a pure function of the URL and nothing about it animates
  const svg = made ? qrSvg(made.url) : null

  if (!made) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold">{t('scene.invite.title')}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{t('scene.invite.lead')}</p>
        <button className="btn btn-secondary mt-3" onClick={ask} disabled={busy} data-invite>
          {busy ? <Icon.spinner /> : <Icon.share />}
          {busy ? t('scene.invite.making') : t('scene.invite.ask')}
        </button>
        {failed && <p className="mt-2 text-sm text-amber-800">{t('scene.invite.failed')}</p>}
      </div>
    )
  }

  return (
    <div className="card p-5 text-center" data-invite-made>
      <h3 className="font-semibold">{t('scene.invite.show')}</h3>
      <p className="mt-0.5 text-sm text-slate-500">{t('scene.invite.showLead')}</p>
      {svg && (
        <div
          className="mx-auto mt-4 w-fit rounded-xl bg-white p-3 ring-1 ring-slate-200 [&_svg]:size-44"
          // the library renders a complete SVG string; there is no user input in it — the URL
          // is escaped into the title attribute and the modules are plain rects
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <p className="mt-3 font-mono text-xs break-all text-slate-500" data-invite-url>
        {made.url}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {'share' in navigator && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void navigator.share({ url: made.url, title: t('scene.invite.shareTitle') }).catch(() => {})}
          >
            <Icon.share /> {t('scene.invite.share')}
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(made.url).then(() => setCopied(true)).catch(() => {})
          }}
        >
          <Icon.copy /> {copied ? t('scene.invite.copied') : t('scene.invite.copy')}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('scene.invite.note')}</p>
    </div>
  )
}

/** the link as an SVG QR code, sized by its own module count so it stays crisp at any width */
function qrSvg(url: string): string | null {
  try {
    // 0 asks the library to pick the smallest version the data fits in
    const code = qrcode(0, QR_LEVEL)
    code.addData(url)
    code.make()
    return code.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  } catch {
    return null
  }
}
