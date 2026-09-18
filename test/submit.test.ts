import { describe, expect, it } from 'vitest'
import { deliver } from '../src/app/submit'
import { Rejected } from '../src/claim/outbox'
import { emptyClaim } from '../src/claim/schema'

const doc = { ...emptyClaim(), reference: 'CM-LOCAL1' }
const noWait = () => Promise.resolve()
const reply = (status: number, body = '') => new Response(body, { status })

describe('delivering the document', () => {
  it('posts once with the token and the idempotency key, and takes the server\'s reference', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return reply(201, JSON.stringify({ reference: 'INS-42' }))
    }
    const ref = await deliver(doc, { url: 'https://api.example/claims', token: 'tok', fetch: fetch as typeof globalThis.fetch, wait: noWait })
    expect(ref).toBe('INS-42')
    expect(calls).toHaveLength(1)
    const h = calls[0].init.headers as Record<string, string>
    expect(h.authorization).toBe('Bearer tok')
    expect(h['idempotency-key']).toBe('CM-LOCAL1')
    expect(JSON.parse(calls[0].init.body as string).reference).toBe('CM-LOCAL1')
  })

  it('keeps the page\'s reference when the server gives none', async () => {
    const fetch = async () => reply(200)
    expect(await deliver(doc, { url: 'u', token: null, fetch: fetch as typeof globalThis.fetch, wait: noWait })).toBe('CM-LOCAL1')
  })

  it('retries an outage with backoff, then gives up with a plain error', async () => {
    let n = 0
    const waits: number[] = []
    const flaky = async () => (++n < 3 ? reply(503) : reply(200, '{"reference":"INS-7"}'))
    expect(await deliver(doc, { url: 'u', token: null, fetch: flaky as typeof globalThis.fetch, wait: async (ms) => void waits.push(ms) })).toBe('INS-7')
    expect(waits).toEqual([1000, 3000])

    const down = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(deliver(doc, { url: 'u', token: null, fetch: down as typeof globalThis.fetch, wait: noWait, attempts: 2 })).rejects.toThrow('Failed to fetch')
  })

  it('does not retry a refusal', async () => {
    let n = 0
    const bad = async () => (n++, reply(422))
    await expect(deliver(doc, { url: 'u', token: null, fetch: bad as typeof globalThis.fetch, wait: noWait })).rejects.toBeInstanceOf(Rejected)
    expect(n).toBe(1)
  })

  it('treats "too busy" and "not yet authorised" as outages, not refusals', async () => {
    for (const status of [401, 408, 429]) {
      const always = async () => reply(status)
      await expect(deliver(doc, { url: 'u', token: null, fetch: always as typeof globalThis.fetch, wait: noWait, attempts: 2 })).rejects.not.toBeInstanceOf(Rejected)
    }
  })

  it('refuses a dead party token for good: nobody can renew it, so it is not an outage', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const party = `${b64({ sub: 'party:INC-TEST0001', policy: '', exp: 1 })}.c2ln`
    for (const status of [401, 403]) {
      let n = 0
      const dead = async () => (n++, reply(status))
      await expect(deliver(doc, { url: 'u', token: party, fetch: dead as typeof globalThis.fetch, wait: noWait })).rejects.toBeInstanceOf(Rejected)
      expect(n).toBe(1)
    }
    // a customer's own token is still waited on, because the host may renew it
    const customer = `${b64({ sub: 'alice', policy: 'POL-1', exp: 1 })}.c2ln`
    const always = async () => reply(401)
    await expect(deliver(doc, { url: 'u', token: customer, fetch: always as typeof globalThis.fetch, wait: noWait, attempts: 2 })).rejects.not.toBeInstanceOf(Rejected)
  })
})
