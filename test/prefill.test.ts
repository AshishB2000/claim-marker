import { describe, expect, it } from 'vitest'
import { applyPrefill, parsePrefill, policyVehicleLabel, vehicleFromPolicy } from '../src/claim/prefill'
import { emptyClaim, newVehicle } from '../src/claim/schema'
import { damage } from '../src/schema'

describe('prefill from the host page', () => {
  it('reads what is usable and drops the rest', () => {
    const p = parsePrefill({
      reporter: { name: '  Sam Lee ', email: 'SAM@EXAMPLE.COM', policy: 'pol-9', policyholder: true, phone: 7 },
      vehicles: [
        { make: 'Toyota', model: 'Camry', year: 2021, plate: 'abc 123', plateState: 'ny', vin: '4t1bf1fk5cu123456', color: '#B91C1C', body: 'sedan' },
        { make: 'Ford', model: 'F-150', year: 'new', color: 'red', body: 'spaceship' },
        {},
        'nonsense',
      ],
      somethingElse: true,
    })
    expect(p).toEqual({
      reporter: { name: 'Sam Lee', email: 'sam@example.com', policy: 'POL-9', policyholder: true },
      vehicles: [
        { make: 'Toyota', model: 'Camry', year: 2021, plate: 'ABC 123', plateState: 'NY', vin: '4T1BF1FK5CU123456', color: '#b91c1c', body: 'sedan' },
        { make: 'Ford', model: 'F-150' },
      ],
    })
    expect(parsePrefill(null)).toEqual({})
    expect(parsePrefill({ vehicles: 'x', reporter: 4 })).toEqual({})
  })

  it('caps the policy at six vehicles and strings at a sane length', () => {
    const p = parsePrefill({ vehicles: Array.from({ length: 9 }, (_, i) => ({ make: `M${i}` })), reporter: { name: 'x'.repeat(500) } })
    expect(p.vehicles).toHaveLength(6)
    expect(p.reporter?.name).toHaveLength(120)
  })

  it('fills only what is empty unless the customer picked it', () => {
    const v = { ...newVehicle('a', 'insured', 'sedan', '#b9bec6'), make: 'Honda', model: 'Civic' }
    const filled = vehicleFromPolicy(v, { make: 'Toyota', model: 'RAV4', year: 2020, plate: 'ABC 123' })
    expect([filled.make, filled.model, filled.year, filled.plate]).toEqual(['Honda', 'Civic', 2020, 'ABC 123'])
    const picked = vehicleFromPolicy(v, { make: 'Toyota', model: 'RAV4', year: 2020 }, true)
    expect([picked.make, picked.model, picked.year, picked.body]).toEqual(['Toyota', 'RAV4', 2020, 'suv'])
  })

  it('a change of shape clears damage marked on the old one', () => {
    const v = { ...newVehicle('a', 'insured', 'sedan', '#b9bec6'), damages: [damage('front_bumper', [0, 0, 1], 'dent')] }
    expect(vehicleFromPolicy(v, { body: 'sedan' }, true).damages).toHaveLength(1)
    expect(vehicleFromPolicy(v, { body: 'suv' }, true).damages).toHaveLength(0)
  })

  it('a single policy vehicle fills the insured card; several are left for the pick', () => {
    const claim = { ...emptyClaim(), reporter: { name: 'Typed Already', phone: '', email: '', policy: '', policyholder: null, party: 'policyholder' as const } }
    const one = applyPrefill(claim, { reporter: { name: 'Sam', phone: '555' }, vehicles: [{ make: 'Kia', model: 'Soul' }] })
    expect(one.reporter).toMatchObject({ name: 'Typed Already', phone: '555' })
    expect(one.vehicles[0]).toMatchObject({ role: 'insured', make: 'Kia', model: 'Soul', body: 'suv' })
    const two = applyPrefill(claim, { vehicles: [{ make: 'Kia' }, { make: 'Ford' }] })
    expect(two.vehicles[0].make).toBe('')
  })

  it('names a policy vehicle for the pick', () => {
    expect(policyVehicleLabel({ year: 2021, make: 'Toyota', model: 'Camry', plate: 'ABC 123' })).toBe('2021 Toyota Camry · ABC 123')
    expect(policyVehicleLabel({ plate: 'ABC 123' })).toBe('ABC 123')
    expect(policyVehicleLabel({ color: '#000000' })).toBe('A vehicle on the policy')
  })
})
