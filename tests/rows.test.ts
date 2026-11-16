import { describe, expect, it } from 'vitest'
import { fromBike, toBike } from '../src/data/rows'

describe('toBike', () => {
  // What a bike row looked like before the shock's compression adjusters
  // were merged: these are still in the database until each bike is saved.
  const oldRow = {
    id: 'b',
    name: 'R6',
    fork: { compression: { range: 18, unit: 'clicks' } },
    shock: {
      compressionLow: { range: 20, unit: 'clicks' },
      compressionHigh: { range: 3, unit: 'turns' },
      rebound: { range: 20, unit: 'clicks' },
      preload: { range: 10, unit: 'turns' },
    },
    sag_targets: {},
    adjuster_units: { 'shock.compressionLow': { unit: 'turns', direction: 'soft-to-hard' } },
    current_setup: { fork: { compression: 10 }, shock: { compressionLow: 12, rebound: 9 } },
    created_at: 0,
  }

  it('reads an old compressionLow adjuster, unit and current value as compression', () => {
    const bike = toBike(oldRow)
    expect(bike.shock.compression).toEqual({ range: 20, unit: 'clicks' })
    expect(bike.adjusterUnits).toEqual({ 'shock.compression': { unit: 'turns', direction: 'soft-to-hard' } })
    expect(bike.currentSetup?.shock).toEqual({ compression: 12, rebound: 9 })
  })

  it('writes the bike back without the old keys', () => {
    const row = fromBike(toBike(oldRow))
    expect(row.shock).not.toHaveProperty('compressionLow')
    expect(row.shock).not.toHaveProperty('compressionHigh')
    expect(row.adjuster_units).not.toHaveProperty(['shock.compressionLow'])
  })
})

describe('sag readings', () => {
  const row = {
    id: 'b',
    name: 'R6',
    fork: {},
    shock: {},
    sag_targets: {},
    created_at: 0,
  }

  it('round-trips a check, including a half-finished one', () => {
    const sagReadings = { front: { extended: 600, bikeOnly: 572.5, withRider: 567 }, rear: { extended: 540 } }
    const written = fromBike({ ...toBike(row), sagReadings })
    expect(written.sag_readings).toEqual(sagReadings)
    expect(toBike(written).sagReadings).toEqual(sagReadings)
  })

  it('reads the column default, and a row from before the column, as no readings', () => {
    expect(toBike({ ...row, sag_readings: {} })).not.toHaveProperty('sagReadings')
    expect(toBike(row)).not.toHaveProperty('sagReadings')
  })

  it('writes no readings as the empty object the column expects, never null', () => {
    expect(fromBike(toBike(row)).sag_readings).toEqual({})
  })
})
