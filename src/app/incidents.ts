/**
 * The invite: the two calls the page makes about an incident that has two accounts.
 *
 * `createIncident` is the customer's end — it hands the server the few facts both accounts
 * must share and gets back a link to show the other driver. `fetchSeed` is the other driver's
 * end, the first thing their page does when it is opened from that link.
 *
 * Both are ordinary `fetch`es that resolve `null` on any failure: an insurer who has not wired
 * up the endpoints gets a page that quietly does not offer the invite, rather than an error
 * about a feature nobody asked for.
 */
import { config, incidentUrl } from '../config'
import { parseSeed, type IncidentInvite, type IncidentSeed } from '../claim/seed'

const INC = /^INC-[A-Z0-9-]{4,32}$/

/**
 * `reference` is the insurer's own claim number, passed only when the report has already been
 * sent — inviting from the done page is the common case, and that report went out with no
 * incident in it, so naming it here is the only thing that can ever link the two.
 */
export async function createIncident(seed: IncidentSeed, reference?: string | null): Promise<IncidentInvite | null> {
  const url = incidentUrl('incidents')
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
      body: JSON.stringify(reference ? { ...seed, reference } : seed),
    })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<IncidentInvite>
    // the link is shown to a stranger and opened on their phone: it is http(s) or it is nothing
    const link = typeof body.url === 'string' ? new URL(body.url, window.location.href) : null
    if (!body.incident || !INC.test(body.incident) || !link || !/^https?:$/.test(link.protocol)) return null
    return { incident: body.incident, url: link.href, expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : '' }
  } catch {
    return null
  }
}

/** the shared facts the other driver's page starts from; parsed, never trusted */
export async function fetchSeed(incident: string, token: string): Promise<IncidentSeed | null> {
  const url = incidentUrl(`incidents/${encodeURIComponent(incident)}/seed`)
  if (!url) return null
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    return res.ok ? parseSeed(await res.json()) : null
  } catch {
    return null
  }
}
