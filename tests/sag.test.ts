import { describe, expect, it } from 'vitest'
import { analyseSag, computeSag, describePreloadChange, SagError, statusFor } from '../src/core/sag'
import { TRACK_SAG_TARGETS } from '../src/data/presets'

describe('computeSag', () => {
  it('derives free and rider sag from the three measurements', () => {
    expect(computeSag({ extended: 500, bikeOnly: 472, withRider: 468 })).toEqual({
      freeSag: 28,
      riderSag: 32,
    })
  })

  it('works without the bike-only measurement', () => {
    expect(computeSag({ extended: 500, withRider: 468 })).toEqual({ riderSag: 32 })
  })

  it('rejects measurements that are the wrong way round', () => {
    expect(() => computeSag({ extended: 460, withRider: 500 })).toThrow(SagError)
    expect(() => computeSag({ extended: 500, bikeOnly: 460, withRider: 470 })).toThrow(/free sag/i)
  })
})

describe('statusFor', () => {
  it('treats the window as inclusive', () => {
    expect(statusFor(30, [30, 35])).toBe('ok')
    expect(statusFor(35, [30, 35])).toBe('ok')
    expect(statusFor(29.9, [30, 35])).toBe('low')
    expect(statusFor(35.1, [30, 35])).toBe('high')
  })
})

describe('analyseSag', () => {
  it('passes a front end that is on target', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, bikeOnly: 472, withRider: 468 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.riderSagStatus).toBe('ok')
    expect(result.freeSagStatus).toBe('ok')
    expect(result.springVerdict).toBe('ok')
    expect(result.springVerdictReliable).toBe(true)
    expect(result.sagChangeMm).toBeUndefined()
  })

  it('asks for preload when the bike sags too far, aiming at the middle of the window', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, withRider: 460 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.riderSag).toBe(40)
    expect(result.riderSagStatus).toBe('high')
    // Window is 30–35, so the target is 32.5 and the fork is 7.5 mm low.
    expect(result.sagChangeMm).toBeCloseTo(7.5, 6)
    expect(describePreloadChange(result)).toMatch(/^Add preload until rider sag comes down 7\.5 mm/)
  })

  it('asks for preload to come out when the bike sits too high', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, withRider: 480 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.riderSagStatus).toBe('low')
    expect(result.sagChangeMm).toBeCloseTo(-12.5, 6)
    expect(describePreloadChange(result)).toMatch(/^Back preload off until rider sag rises 12\.5 mm/)
  })

  it('reports the rear correction at the wheel, where it was measured', () => {
    const result = analyseSag({
      axle: 'rear',
      measurement: { extended: 400, withRider: 365 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.riderSag).toBe(35)
    // 35 mm of wheel sag against a 27.5 mm target. No linkage ratio is
    // applied, so the number stays the one the tape measure will confirm.
    expect(result.sagChangeMm).toBeCloseTo(7.5, 6)
    expect(describePreloadChange(result)).toContain('measure again')
  })

  it('reads a short free sag as a spring that is too soft', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, bikeOnly: 485, withRider: 468 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.freeSag).toBe(15)
    expect(result.riderSagStatus).toBe('ok')
    expect(result.springVerdict).toBe('too-soft')
    expect(result.springVerdictReliable).toBe(true)
  })

  it('reads a long free sag as a spring that is too stiff', () => {
    const result = analyseSag({
      axle: 'rear',
      measurement: { extended: 400, bikeOnly: 382, withRider: 373 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.freeSag).toBe(18)
    expect(result.riderSag).toBe(27)
    expect(result.springVerdict).toBe('too-stiff')
    expect(result.springVerdictReliable).toBe(true)
  })

  it('will not trust the spring verdict until rider sag is set', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, bikeOnly: 490, withRider: 458 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.riderSagStatus).toBe('high')
    expect(result.springVerdict).toBe('too-soft')
    expect(result.springVerdictReliable).toBe(false)
    expect(result.notes.join(' ')).toMatch(/rider sag with preload first/i)
  })

  it('says what is missing when free sag was not measured', () => {
    const result = analyseSag({
      axle: 'front',
      measurement: { extended: 500, withRider: 468 },
      targets: TRACK_SAG_TARGETS,
    })
    expect(result.springVerdict).toBe('unknown')
    expect(result.notes.join(' ')).toMatch(/L2/)
  })
})
