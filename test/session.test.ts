import { describe, expect, it } from 'vitest'
import { MAX_TTL, MIN_TTL, PARTY_TTL, sign, verify } from '../server/session.mjs'

const SECRET = 'a-secret-nobody-else-has'
const NOW = 1_800_000_000_000

describe('session tokens', () => {
  it('round-trips the customer and their policy', () => {
    const token = sign({ sub: 'cust-1', policy: 'POL-9' }, SECRET, 3600, undefined, NOW)
    expect(token.split('.')).toHaveLength(2)
    expect(verify(token, SECRET, NOW)).toEqual({ sub: 'cust-1', policy: 'POL-9', exp: NOW / 1000 + 3600 })
  })

  it('clamps the lifetime to something a session can be', () => {
    const short = verify(sign({ sub: 'a' }, SECRET, 1, undefined, NOW), SECRET, NOW)
    const long = verify(sign({ sub: 'a' }, SECRET, 999_999, undefined, NOW), SECRET, NOW)
    expect(short!.exp).toBe(NOW / 1000 + MIN_TTL)
    expect(long!.exp).toBe(NOW / 1000 + MAX_TTL)
  })

  it('stops working when it expires', () => {
    const token = sign({ sub: 'cust-1' }, SECRET, 60, undefined, NOW)
    expect(verify(token, SECRET, NOW + 59_000)).not.toBeNull()
    expect(verify(token, SECRET, NOW + 60_001)).toBeNull()
  })

  it('refuses a flipped signature, another secret, and garbage', () => {
    const token = sign({ sub: 'cust-1', policy: 'POL-9' }, SECRET, 3600, undefined, NOW)
    const [body, sig] = token.split('.')
    const flipped = `${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`
    expect(verify(flipped, SECRET, NOW)).toBeNull()
    expect(verify(token, 'some-other-secret', NOW)).toBeNull()
    for (const bad of ['', 'nonsense', `${body}.`, `.${sig}`, `${body}.${sig}.extra`, null, 42]) {
      expect(verify(bad as string, SECRET, NOW)).toBeNull()
    }
  })

  it('refuses a payload edited under a signature that was valid for the old one', () => {
    const token = sign({ sub: 'cust-1', policy: 'POL-9' }, SECRET, 3600, undefined, NOW)
    const [body, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const tampered = Buffer.from(JSON.stringify({ ...payload, policy: 'SOMEONE-ELSES' })).toString('base64url')
    expect(verify(`${tampered}.${sig}`, SECRET, NOW)).toBeNull()
    // and the same trick on the expiry
    const forever = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 10_000_000 })).toString('base64url')
    expect(verify(`${forever}.${sig}`, SECRET, NOW)).toBeNull()
  })
})

describe('a raised ttl cap for one call site', () => {
  it('does not raise MAX_TTL itself', () => {
    expect(MAX_TTL).toBe(86_400)
    expect(PARTY_TTL).toBe(72 * 3600)
  })

  it('the default cap still clamps at a day when no maximum is given', () => {
    const long = verify(sign({ sub: 'party:INC-1' }, SECRET, 999_999, undefined, NOW), SECRET, NOW)
    expect(long!.exp).toBe(NOW / 1000 + MAX_TTL)
  })

  it('a raised cap allows a lifetime beyond a day, up to PARTY_TTL', () => {
    const token = verify(sign({ sub: 'party:INC-1' }, SECRET, PARTY_TTL, PARTY_TTL, NOW), SECRET, NOW)
    expect(token!.exp).toBe(NOW / 1000 + PARTY_TTL)
  })

  it('a raised cap still clamps above its own maximum', () => {
    const over = verify(sign({ sub: 'party:INC-1' }, SECRET, PARTY_TTL + 999_999, PARTY_TTL, NOW), SECRET, NOW)
    expect(over!.exp).toBe(NOW / 1000 + PARTY_TTL)
  })

  it('MIN_TTL still applies under a raised cap', () => {
    const short = verify(sign({ sub: 'party:INC-1' }, SECRET, 1, PARTY_TTL, NOW), SECRET, NOW)
    expect(short!.exp).toBe(NOW / 1000 + MIN_TTL)
  })
})
