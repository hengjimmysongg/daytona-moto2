import { describe, expect, it } from 'vitest'
import {
  analyseSag,
  computeSag,
  describePreloadChange,
  isSagRecorded,
  recordedFor,
  recordSag,
  SagError,
  statusFor,
  type SagMeasurement,
} from '../src/core/sag'
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

describe('recording a check against a session', () => {
  const check = (axle: 'front' | 'rear', measurement: SagMeasurement) =>
    analyseSag({ axle, measurement, targets: TRACK_SAG_TARGETS })

  it('writes rider and free sag for each end, to the tenth of a millimetre', () => {
    const front = check('front', { extended: 600.3, bikeOnly: 572.5, withRider: 567.1 })
    const rear = check('rear', { extended: 540, withRider: 512 })
    expect(recordSag(undefined, { front, rear })).toEqual({
      frontRider: 33.2,
      frontFree: 27.8,
      rearRider: 28,
    })
  })

  it('leaves an end that was not measured as the session had it', () => {
    const front = check('front', { extended: 600, withRider: 567 })
    expect(recordSag({ rearRider: 27, rearFree: 8 }, { front })).toEqual({
      frontRider: 33,
      rearRider: 27,
      rearFree: 8,
    })
  })

  it('drops an old free sag when the end is re-checked without L2', () => {
    // Otherwise the log would pair a new rider sag with a free sag from a
    // different check, and the spring verdict would come from both.
    const front = check('front', { extended: 600, withRider: 566 })
    expect(recordSag({ frontRider: 33, frontFree: 28 }, { front })).toEqual({ frontRider: 34 })
  })

  it('knows when a session already holds this check', () => {
    const front = check('front', { extended: 600, bikeOnly: 572, withRider: 567 })
    const recorded = recordSag(undefined, { front })
    expect(isSagRecorded(recorded, { front })).toBe(true)
    expect(isSagRecorded({ ...recorded, rearRider: 30 }, { front })).toBe(true)
    expect(isSagRecorded({ frontRider: 33 }, { front })).toBe(false)
    expect(isSagRecorded(undefined, { front })).toBe(false)
    expect(isSagRecorded(recorded, {})).toBe(false)
  })

  it('reads one end back out', () => {
    expect(recordedFor({ frontRider: 33, rearRider: 28, rearFree: 7 }, 'rear')).toEqual({
      rider: 28,
      free: 7,
    })
    expect(recordedFor({ rearRider: 28 }, 'front')).toEqual({})
    expect(recordedFor(undefined, 'front')).toEqual({})
  })
})
