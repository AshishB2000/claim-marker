/**
 * The draft's own bookkeeping: which slot it lives in, what an old one grows into, the invite it
 * keeps, and conditions that stop following a place they no longer describe.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// the store only grows its `persist` API when there is a `window.localStorage` to persist to; node has neither
vi.hoisted(() => {
  const data = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
  Object.assign(globalThis, { window: { localStorage } })
})

import { draftName, useClaim } from '../src/claim/store'
import { partyDraftFor } from '../src/claim/seed'
import { partyFromUrl } from '../src/config'
import { emptyClaim } from '../src/claim/schema'

beforeEach(() => {
  useClaim.getState().reset()
})

const token = (sub: string) => `${Buffer.from(JSON.stringify({ sub, policy: '', exp: 1 })).toString('base64url')}.c2ln`

describe('where the draft is kept', () => {
  it('keeps the other driver’s apart from the customer’s, one per incident', () => {
    expect(draftName(null)).toBe('claim-marker/draft')
    expect(draftName('INC-AAAA1111')).toBe('claim-marker/draft/INC-AAAA1111')
  })

  it('reads the party from the URL, and only a party token names one', () => {
    expect(partyFromUrl(`?party=${token('party:INC-AAAA1111')}`)).toEqual({ token: token('party:INC-AAAA1111'), incident: 'INC-AAAA1111' })
    expect(partyFromUrl(`?party=${token('alice')}`)).toBeNull()
    expect(partyFromUrl('?party=not-a-token')).toBeNull()
    expect(partyFromUrl('')).toBeNull()
  })

  it('picks a party draft up again only when it is the other driver’s, for this incident', () => {
    const c = emptyClaim()
    expect(partyDraftFor(c, 'INC-AAAA1111')).toBe(false)
    c.incident.shared = 'INC-AAAA1111'
    // the inviting customer's own report names the incident too, and is not the other driver's
    expect(partyDraftFor(c, 'INC-AAAA1111')).toBe(false)
    c.reporter.party = 'other_party'
    expect(partyDraftFor(c, 'INC-AAAA1111')).toBe(true)
    expect(partyDraftFor(c, 'INC-BBBB2222')).toBe(false)
  })
})

describe('an old draft', () => {
  it('grows a reporter.party, so the scene step still offers the invite', () => {
    const { migrate, version } = useClaim.persist.getOptions()
    const old = { claim: { ...emptyClaim(), reporter: { name: 'Sam', phone: '', email: '', policy: '', policyholder: true } } }
    const out = migrate!(structuredClone(old), 7) as { claim: { reporter: { party: string; name: string } } }
    expect(out.claim.reporter.party).toBe('policyholder')
    expect(out.claim.reporter.name).toBe('Sam')
    expect(version).toBe(8)
  })
})

describe('the invite', () => {
  it('is kept beside `shared` and cleared with the report', () => {
    const invite = { incident: 'INC-AAAA1111', url: 'https://example.test/?party=x', expiresAt: '2026-09-20T00:00:00Z' }
    useClaim.getState().shareIncident(invite)
    expect(useClaim.getState().invite).toEqual(invite)
    expect(useClaim.getState().claim.incident.shared).toBe('INC-AAAA1111')
    expect(useClaim.persist.getOptions().partialize!(useClaim.getState())).toMatchObject({ invite })
    useClaim.getState().reset()
    expect(useClaim.getState().invite).toBeNull()
  })
})

describe('conditions the lookup filled', () => {
  it('go when a new place’s lookup has no answer for them, and stay when the customer gave them', () => {
    const s = useClaim.getState()
    s.sceneLookedUp('old', null, null, { weather: 'rain', road: 'wet', light: 'dusk' })
    useClaim.getState().setConditions({ road: 'dry' })
    // the new place: the record answers the light and nothing else
    useClaim.getState().sceneLookedUp('new', null, null, { light: 'daylight' })
    const { claim, autoConditions } = useClaim.getState()
    expect(claim.incident.conditions).toEqual({ weather: '', road: 'dry', light: 'daylight' })
    expect(autoConditions).toEqual({ road: 'user', light: 'auto' })
  })
})
