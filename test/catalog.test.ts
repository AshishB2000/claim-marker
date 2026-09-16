import { describe, expect, it } from 'vitest'
import { guessBody, isVin, parseVin } from '../src/vehicles/catalog'

describe('the vehicle catalog', () => {
  it('knows a VIN by its shape', () => {
    expect(isVin('4T1BF1FK5CU123456')).toBe(true)
    expect(isVin(' 4t1bf1fk5cu123456 ')).toBe(true)
    expect(isVin('4T1BF1FK5CU12345')).toBe(false)
    expect(isVin('4T1BF1FK5CU12345O')).toBe(false)
  })

  it('reads what the database says about a VIN into the fields a card can fill', () => {
    expect(parseVin({ Make: 'TOYOTA', Model: 'Camry', ModelYear: '2012', BodyClass: 'Sedan/Saloon' })).toEqual({ make: 'Toyota', model: 'Camry', year: 2012, body: 'sedan' })
    expect(parseVin({ Make: 'FORD', Model: 'F-150', ModelYear: '2020', BodyClass: 'Pickup' })).toEqual({ make: 'Ford', model: 'F-150', year: 2020, body: 'truck' })
    expect(parseVin({ Make: 'HONDA', Model: 'CR-V', ModelYear: '2019', BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' })?.body).toBe('suv')
    // a make the list does not carry is kept, tidied; the body falls back to the model name
    expect(parseVin({ Make: 'SATURN', Model: 'Vue', ModelYear: '', BodyClass: '' })).toEqual({ make: 'Saturn', model: 'Vue', year: null, body: null })
    expect(parseVin({ Make: 'LOTUS', Model: 'Elise Convertible', ModelYear: '2005', BodyClass: '' })?.body).toBe('coupe')
    expect(parseVin({ Make: '', Model: '', ModelYear: '', BodyClass: '' })).toBeNull()
    expect(parseVin(undefined)).toBeNull()
  })

  it('guesses a body from a model name', () => {
    expect(guessBody('Camry')).toBeNull()
    expect(guessBody('RAV4')).toBe('suv')
    expect(guessBody('F-150')).toBe('truck')
  })
})
