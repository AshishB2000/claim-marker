/** The colours a claimant is offered. Real car paints, ordered by how common they are. */
export const PAINTS = [
  { id: 'white', label: 'White', hex: '#e9ebee' },
  { id: 'black', label: 'Black', hex: '#1c1f26' },
  { id: 'silver', label: 'Silver', hex: '#b9bec6' },
  { id: 'grey', label: 'Grey', hex: '#5f6672' },
  { id: 'blue', label: 'Blue', hex: '#1d4ed8' },
  { id: 'navy', label: 'Dark blue', hex: '#1e3358' },
  { id: 'red', label: 'Red', hex: '#b91c1c' },
  { id: 'burgundy', label: 'Burgundy', hex: '#6b1d2c' },
  { id: 'green', label: 'Green', hex: '#166534' },
  { id: 'beige', label: 'Beige', hex: '#c9b79c' },
  { id: 'brown', label: 'Brown', hex: '#5c3d2e' },
  { id: 'orange', label: 'Orange', hex: '#ea580c' },
  { id: 'yellow', label: 'Yellow', hex: '#eab308' },
] as const

export type PaintId = (typeof PAINTS)[number]['id']

export const paintLabel = (hex: string) => PAINTS.find((p) => p.hex === hex.toLowerCase())?.label ?? 'Custom'
