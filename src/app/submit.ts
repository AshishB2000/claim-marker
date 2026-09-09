import type { Claim } from '../claim/schema'

/**
 * Hands the finished document to the insurer. With `VITE_SUBMIT_URL` set it is POSTed as
 * JSON; without it the page behaves as if it had been, so the flow can be tried end to end
 * before anything is wired up.
 */
export async function submitClaim(doc: Claim): Promise<void> {
  const url = import.meta.env.VITE_SUBMIT_URL as string | undefined
  if (url) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) })
    if (!res.ok) throw new Error(`We could not send your report (${res.status}). Please try again.`)
  } else {
    await new Promise((r) => setTimeout(r, 900))
  }
  // the page that embeds this one can listen instead of, or as well as, receiving the POST
  window.dispatchEvent(new CustomEvent('claim:submitted', { detail: doc }))
}

export const BRAND: string = (import.meta.env.VITE_BRAND as string | undefined) ?? 'claim-marker'

/**
 * The fraud notice above the signature. The wording is state-mandated and varies, so an insurer
 * sets `VITE_FRAUD_NOTICE`; the default is the common form of it.
 */
export const FRAUD_NOTICE: string =
  (import.meta.env.VITE_FRAUD_NOTICE as string | undefined) ??
  'Any person who knowingly and with intent to defraud any insurance company or other person files a statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material thereto, commits a fraudulent insurance act, which is a crime and subjects such person to criminal and civil penalties.'
