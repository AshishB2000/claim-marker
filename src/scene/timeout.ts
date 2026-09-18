/**
 * A deadline for the lookups.
 *
 * The scene facts come from free public endpoints — Open-Meteo and a public Overpass mirror —
 * and a public Overpass mirror under load does not answer with an error, it simply does not
 * answer. Measured from this machine: one request in three hangs past thirty seconds. Without
 * a deadline the "we looked this up" card says "looking it up" for ever, on a page someone is
 * filling in at the roadside, which is worse than never having offered.
 *
 * `AbortSignal.any` is recent enough to be worth guarding: where it is missing the caller's own
 * signal is used alone, so an old browser loses the deadline and nothing else.
 */
export const LOOKUP_TIMEOUT = 8000

export function withDeadline(signal: AbortSignal | undefined, ms = LOOKUP_TIMEOUT): AbortSignal | undefined {
  try {
    const deadline = AbortSignal.timeout(ms)
    return signal ? AbortSignal.any([signal, deadline]) : deadline
  } catch {
    return signal
  }
}
