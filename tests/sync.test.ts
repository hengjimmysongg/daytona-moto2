import { describe, expect, it } from 'vitest'
import { decideSync, isGarageEmpty, sideOf } from '../src/ui/sync'
import { createEmptyGarage } from '../src/core/storage'
import type { GarageData } from '../src/core/types'

function garage(overrides: Partial<GarageData> = {}): GarageData {
  return { ...createEmptyGarage(1000), ...overrides }
}

const bike = { id: 'bike1', name: 'Daytona', fork: {}, shock: {}, sagTargets: {}, createdAt: 1 } as never

describe('isGarageEmpty', () => {
  it('is true for a garage nobody has touched', () => {
    expect(isGarageEmpty(garage())).toBe(true)
  })

  it('is false as soon as anything is in it', () => {
    expect(isGarageEmpty(garage({ bikes: [bike] }))).toBe(false)
  })

  it('ignores preferences, which every garage has from the start', () => {
    const withPrefs = garage()
    withPrefs.preferences.pressureUnit = 'bar'
    expect(isGarageEmpty(withPrefs)).toBe(true)
  })
})

describe('decideSync', () => {
  it('does nothing when both sides are empty', () => {
    expect(decideSync({ updatedAt: 5, isEmpty: true }, { updatedAt: 1, isEmpty: true })).toBe('in-sync')
  })

  /**
   * The case that matters most: a browser opened for the first time stamps
   * its brand-new empty document with the current time, which is newer than
   * anything on the server. Comparing timestamps first would push that
   * emptiness over a season of real data.
   */
  it('takes the server’s data on a fresh browser, however new the empty local doc looks', () => {
    expect(
      decideSync({ updatedAt: Date.now(), isEmpty: true }, { updatedAt: 1000, isEmpty: false }),
    ).toBe('adopt-server')
  })

  it('pushes local data up to an empty server', () => {
    expect(
      decideSync({ updatedAt: 1000, isEmpty: false }, { updatedAt: 9999, isEmpty: true }),
    ).toBe('push-local')
  })

  it('takes whichever side is newer when both hold data', () => {
    expect(decideSync({ updatedAt: 10, isEmpty: false }, { updatedAt: 20, isEmpty: false })).toBe(
      'adopt-server',
    )
    expect(decideSync({ updatedAt: 30, isEmpty: false }, { updatedAt: 20, isEmpty: false })).toBe(
      'push-local',
    )
  })

  it('settles when the stamps match, so a push does not loop', () => {
    expect(decideSync({ updatedAt: 20, isEmpty: false }, { updatedAt: 20, isEmpty: false })).toBe(
      'in-sync',
    )
  })
})

describe('sideOf', () => {
  it('reads the stamp and the emptiness off a document', () => {
    expect(sideOf(garage({ updatedAt: 42 }))).toEqual({ updatedAt: 42, isEmpty: true })
  })
})
