/**
 * Session tokens: short-lived, signed, and tied to a customer.
 *
 * The static `CLAIM_TOKEN` is a shared secret — everyone who loads the page gets the same
 * one, and a report arrives with no idea whose it is. A session token is minted per customer
 * by the insurer's backend (`POST /sessions`), handed to the page with the prefill, and
 * carried back on the document, so the claim server can file the report against the policy
 * it came from and refuse one whose session has run out.
 *
 *   base64url({"sub":"cust-1","policy":"POL-9","exp":1789456123}).base64url(hmac-sha256)
 *
 * Not a JWT on purpose. A JWT carries the algorithm in the token, and an algorithm in the
 * token is how `alg: none` happens. There is one algorithm here and it is not negotiable.
 * A backend that wants to verify or mint these itself needs six lines and no library, which
 * is the point.
 *
 * No dependencies: node's own crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** shorter than a minute is a mistake; longer than a day is not a session */
export const MIN_TTL = 60
export const MAX_TTL = 86_400

const b64 = (data) => Buffer.from(data).toString('base64url')
const mac = (body, secret) => createHmac('sha256', secret).update(body).digest()

/** the signed token, and the epoch second it stops working */
export function sign({ sub, policy = '' }, secret, ttlSeconds, now = Date.now()) {
  const ttl = Math.min(MAX_TTL, Math.max(MIN_TTL, Math.floor(Number(ttlSeconds) || 0)))
  const exp = Math.floor(now / 1000) + ttl
  const body = b64(JSON.stringify({ sub: String(sub), policy: String(policy), exp }))
  return `${body}.${b64(mac(body, secret))}`
}

/**
 * The payload, or null: a token of the wrong shape, signed with another secret, tampered
 * with, or past its expiry. The signature is compared in constant time, after a length
 * check, because `timingSafeEqual` throws on a length mismatch.
 */
export function verify(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, signature] = parts
  const expected = b64(mac(body, secret))
  if (signature.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null
  if (typeof payload.sub !== 'string' || !payload.sub) return null
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
  if (payload.exp * 1000 <= now) return null
  return { sub: payload.sub, policy: typeof payload.policy === 'string' ? payload.policy : '', exp: payload.exp }
}
