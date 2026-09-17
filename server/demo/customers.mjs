/**
 * The three sample customers the demo portal signs a visitor in as, shaped exactly as
 * `POST /sessions` takes them: `{ customer, vehicles }`. Nobody here is real, and the policy
 * numbers are made up.
 *
 * Two vehicles on one policy is not padding: it is the case where the page asks "which of
 * your vehicles?" instead of filling the card, which is the part an insurer wants to see.
 *
 * No dependencies.
 */
export const CUSTOMERS = {
  'one-car': {
    label: 'Sam Lee',
    blurb: 'One car on the policy — a 2021 Toyota Camry. The page fills the card in for them.',
    customer: { id: 'one-car', policy: 'POL-4471', name: 'Sam Lee', phone: '555 0100', email: 'sam@example.com' },
    vehicles: [{ make: 'Toyota', model: 'Camry', year: 2021, plate: 'ABC 123', plateState: 'NY', vin: '4T1BF1FK5CU123456', color: '#b91c1c' }],
  },
  'two-vehicles': {
    label: 'Alex Rivera',
    blurb: 'Two vehicles on the policy — a Camry and an F-150. The page asks which one it was.',
    customer: { id: 'two-vehicles', policy: 'POL-8820', name: 'Alex Rivera', phone: '555 0142', email: 'alex@example.com' },
    vehicles: [
      { make: 'Toyota', model: 'Camry', year: 2019, plate: 'JPR 8841', plateState: 'NJ', vin: '4T1B11HK1KU123456', color: '#1d4ed8' },
      { make: 'Ford', model: 'F-150', year: 2020, plate: 'TRK 9', plateState: 'NJ', color: '#1c1f26' },
    ],
  },
  pickup: {
    label: 'Dana Brooks',
    blurb: 'A 2018 Chevrolet Silverado, no VIN on file — everything typed at the roadside.',
    customer: { id: 'pickup', policy: 'POL-3109', name: 'Dana Brooks', phone: '555 0177', email: 'dana@example.com' },
    vehicles: [{ make: 'Chevrolet', model: 'Silverado 1500', year: 2018, plate: 'DB 7720', plateState: 'PA', color: '#f8fafc' }],
  },
}
