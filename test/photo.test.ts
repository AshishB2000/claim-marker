import { describe, expect, it } from 'vitest'
import { pick } from '../src/vehicles/photo'

const page = (title: string, index: number, image = true) => ({ title, index, ...(image ? { thumbnail: { source: `https://img/${index}` }, pageimage: `${title}.jpg` } : {}) })

describe('the photo picked from a search', () => {
  it('takes the best-ranked page that names the make and has a picture', () => {
    // "2023 Kia Telluride": the town of Telluride outranks nothing, but it has no picture and no make
    const got = pick([page('Kia EV9', 3), page('Telluride', 2, false), page('Kia Telluride', 1)], 'Kia')
    expect(got?.url).toBe('https://img/1')
    expect(got?.credit?.href).toBe('https://commons.wikimedia.org/wiki/File:Kia%20Telluride.jpg')
  })

  it('skips list articles and falls back to any pictured page', () => {
    expect(pick([page('List of Ford vehicles', 1), page('Ford Explorer', 2)], 'Ford')?.url).toBe('https://img/2')
    // "Acura Integra" once redirected to Honda's page: still a picture of the car
    expect(pick([page('Honda Integra', 1)], 'Acura')?.url).toBe('https://img/1')
    expect(pick([page('List of Ford vehicles', 1)], 'Ford')).toBeNull()
    expect(pick([], 'Ford')).toBeNull()
  })
})
