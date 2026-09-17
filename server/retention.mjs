/**
 * How long a report is kept.
 *
 * A public instance that keeps strangers' photographs for ever is a liability, not an
 * archive, so a deployment says how many days it keeps reports (`RETAIN_DAYS`) and the server
 * forgets anything older. The age test is its own module so it can be tested without a
 * server, a clock or a disk; the sweep that acts on it is in `claim-server.mjs`.
 *
 * No dependencies.
 */
const DAY = 86_400_000

/**
 * True when a report received at `receivedAt` (an ISO timestamp) is more than `days` old.
 * Never true without a positive limit — unset means keep for ever — and never true for a
 * date that does not parse: a report nobody can date is not one to delete.
 */
export function expired(receivedAt, days, now = Date.now()) {
  const at = Date.parse(receivedAt)
  return days > 0 && Number.isFinite(at) && now - at > days * DAY
}
