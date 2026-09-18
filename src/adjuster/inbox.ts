/**
 * The desk's inbox rows. Every report is its own row, except that the accounts of one accident
 * — the policyholder's and the other driver's, filed under one `incident` — share a single row
 * that says how many accounts it holds. The row leads with the policyholder's report (the side
 * comes from the receipt, which the server sets from the token), or the earliest when no receipt
 * says so, and sits where the first of its reports appeared in the list the server sent.
 */
import type { Party } from '../claim/schema'

type Filed = { reference: string; receivedAt: string; incident?: string; party?: Party }

export type InboxRow<R extends Filed> = { lead: R; accounts: R[] }

const rank = (r: Filed) => (r.party === 'policyholder' ? 0 : 1)
const leads = (r: Filed, than: Filed) => rank(r) < rank(than) || (rank(r) === rank(than) && r.receivedAt < than.receivedAt)

export function inboxRows<R extends Filed>(receipts: R[]): InboxRow<R>[] {
  const rows: InboxRow<R>[] = []
  const byIncident = new Map<string, InboxRow<R>>()
  for (const r of receipts) {
    const row = r.incident ? byIncident.get(r.incident) : undefined
    if (row) {
      row.accounts.push(r)
      if (leads(r, row.lead)) row.lead = r
      continue
    }
    const fresh = { lead: r, accounts: [r] }
    if (r.incident) byIncident.set(r.incident, fresh)
    rows.push(fresh)
  }
  return rows
}
