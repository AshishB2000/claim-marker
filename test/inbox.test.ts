import { describe, expect, it } from 'vitest'
import { inboxRows } from '../src/adjuster/inbox'

const r = (reference: string, receivedAt: string, extra: { incident?: string; party?: 'policyholder' | 'other_party' } = {}) => ({ reference, receivedAt, ...extra })

describe('the inbox groups the accounts of one accident', () => {
  it('puts both accounts of an incident in one row, led by the policyholder’s, where the first appeared', () => {
    const rows = inboxRows([
      r('INS-3', '2026-09-07T10:03', { incident: 'INC-AAAA', party: 'other_party' }),
      r('INS-2', '2026-09-07T10:02'),
      r('INS-1', '2026-09-07T10:01', { incident: 'INC-AAAA', party: 'policyholder' }),
    ])
    expect(rows.map((g) => g.lead.reference)).toEqual(['INS-1', 'INS-2'])
    expect(rows[0].accounts.map((a) => a.reference)).toEqual(['INS-3', 'INS-1'])
    expect(rows[1].accounts).toHaveLength(1)
  })

  it('leads with the earliest when no receipt says which is the policyholder’s', () => {
    const rows = inboxRows([r('INS-9', '2026-09-07T11:00', { incident: 'INC-BBBB' }), r('INS-8', '2026-09-07T09:00', { incident: 'INC-BBBB' })])
    expect(rows).toHaveLength(1)
    expect(rows[0].lead.reference).toBe('INS-8')
  })

  it('never groups two different incidents, or reports with none', () => {
    const rows = inboxRows([r('INS-1', 'a', { incident: 'INC-AAAA' }), r('INS-2', 'b', { incident: 'INC-BBBB' }), r('INS-3', 'c'), r('INS-4', 'd')])
    expect(rows.map((g) => g.accounts.length)).toEqual([1, 1, 1, 1])
  })
})
