/**
 * Sag: how far the bike settles into its travel under its own weight and
 * under the rider's.
 *
 * Three measurements per end, all taken at the same point (front: along the
 * fork tube or at the axle; rear: axle to a fixed mark on the tail):
 *
 *   L1  fully extended, wheel off the ground
 *   L2  bike on the ground under its own weight, no rider   (free / static sag)
 *   L3  rider on board in riding position, in full kit      (rider sag)
 *
 *   free sag  = L1 − L2
 *   rider sag = L1 − L3
 *
 * Rider sag is set with preload. Free sag is then the tell-tale for whether
 * the *spring* is right: preload only moves where the spring sits, it cannot
 * change how stiff it is. If you had to wind in a lot of preload to reach
 * the right rider sag, the bike will barely settle on its own — little free
 * sag — and that means the spring is too soft. The opposite (lots of free
 * sag, preload backed right off) means it is too stiff.
 *
 * Every number here is millimetres of *wheel* travel.
 */

import type { Axle, Bike, SagTargets } from './types.js'

export interface SagMeasurement {
  /** L1 — fully extended, wheel unloaded. */
  extended: number
  /** L2 — bike's own weight only. Optional: without it there is no free sag. */
  bikeOnly?: number
  /** L3 — with the rider aboard. */
  withRider: number
}

export type SagWindow = readonly [number, number]

export type RangeStatus = 'low' | 'ok' | 'high'

export type SpringVerdict = 'ok' | 'too-soft' | 'too-stiff' | 'unknown'

export interface SagResult {
  axle: Axle
  riderSag: number
  freeSag?: number
  riderSagTarget: SagWindow
  freeSagTarget?: SagWindow
  riderSagStatus: RangeStatus
  freeSagStatus?: RangeStatus
  springVerdict: SpringVerdict
  /**
   * True when the spring verdict can be trusted. Free sag only diagnoses the
   * spring once rider sag has been dialled to target with preload.
   */
  springVerdictReliable: boolean
  /**
   * How far rider sag has to move to reach the middle of its window, in mm
   * at the wheel. Positive means the bike is sagging too much and wants more
   * preload.
   *
   * Deliberately not converted into turns of the collar: that needs the
   * adjuster's thread pitch and, at the rear, the linkage ratio — two
   * numbers that vary by machine and are usually guessed. A wrong guess
   * produces a confident instruction that is simply wrong, whereas a
   * distance to close is checked the way sag is always checked, by
   * measuring it again.
   */
  sagChangeMm?: number
  notes: string[]
}

export class SagError extends Error {}

export function statusFor(value: number, [min, max]: SagWindow): RangeStatus {
  if (value < min) return 'low'
  if (value > max) return 'high'
  return 'ok'
}

function midpoint([min, max]: SagWindow): number {
  return (min + max) / 2
}

export function computeSag(m: SagMeasurement): { riderSag: number; freeSag?: number } {
  if (!Number.isFinite(m.extended) || !Number.isFinite(m.withRider)) {
    throw new SagError('Both the extended and rider measurements are needed.')
  }
  const riderSag = m.extended - m.withRider
  if (riderSag < 0) {
    throw new SagError(
      'Rider measurement is larger than the extended one — the two look swapped.',
    )
  }
  if (m.bikeOnly === undefined) return { riderSag }

  const freeSag = m.extended - m.bikeOnly
  if (freeSag < 0) {
    throw new SagError(
      'Bike-only measurement is larger than the extended one — the two look swapped.',
    )
  }
  if (freeSag > riderSag) {
    throw new SagError(
      'Free sag is greater than rider sag — the bike sank when the rider got off. Re-check L2 and L3.',
    )
  }
  return { riderSag, freeSag }
}

export function targetsFor(targets: SagTargets, axle: Axle): { rider: SagWindow; free: SagWindow } {
  return axle === 'front'
    ? { rider: targets.frontRider, free: targets.frontFree }
    : { rider: targets.rearRider, free: targets.rearFree }
}

/** Diagnose one end of the bike. */
export function analyseSag(args: {
  axle: Axle
  measurement: SagMeasurement
  targets: SagTargets
}): SagResult {
  const { axle, measurement, targets } = args
  const { riderSag, freeSag } = computeSag(measurement)
  const windows = targetsFor(targets, axle)

  const riderSagStatus = statusFor(riderSag, windows.rider)
  const freeSagStatus = freeSag === undefined ? undefined : statusFor(freeSag, windows.free)

  const notes: string[] = []

  // How far sag has to move, at the wheel. Which way to turn the collar
  // follows from the sign; how far to turn it is a question for the collar
  // and a tape measure, not for arithmetic on numbers nobody measured.
  let sagChangeMm: number | undefined
  if (riderSagStatus !== 'ok') {
    const wanted = midpoint(windows.rider)
    sagChangeMm = riderSag - wanted // positive: sagging too much
    notes.push(
      riderSagStatus === 'high'
        ? `Rider sag is ${fmt(riderSag - windows.rider[1])} mm over the top of the window — add preload.`
        : `Rider sag is ${fmt(windows.rider[0] - riderSag)} mm under the window — back preload off.`,
    )
  } else {
    notes.push('Rider sag is in the window — preload is where it should be.')
  }

  // Free sag reads the spring rate, but only once rider sag is on target.
  let springVerdict: SpringVerdict = 'unknown'
  let springVerdictReliable = false
  if (freeSagStatus) {
    springVerdict =
      freeSagStatus === 'low' ? 'too-soft' : freeSagStatus === 'high' ? 'too-stiff' : 'ok'
    springVerdictReliable = riderSagStatus === 'ok'

    if (springVerdict === 'too-soft') {
      notes.push(
        'Free sag is short: a lot of preload is holding the bike up, which points to a spring that is too soft for this rider.',
      )
    } else if (springVerdict === 'too-stiff') {
      notes.push(
        'Free sag is long: the bike settles a long way on its own with little preload, which points to a spring that is too stiff.',
      )
    } else {
      notes.push('Free sag is in the window — the spring rate suits the rider.')
    }

    if (!springVerdictReliable) {
      notes.push('Set rider sag with preload first, then re-check free sag before changing springs.')
    }
  } else {
    notes.push('Measure the bike on its own weight (L2) to get free sag and check the spring rate.')
  }

  const result: SagResult = {
    axle,
    riderSag,
    riderSagTarget: windows.rider,
    riderSagStatus,
    springVerdict,
    springVerdictReliable,
    notes,
  }
  if (freeSag !== undefined) {
    result.freeSag = freeSag
    result.freeSagTarget = windows.free
    result.freeSagStatus = freeSagStatus
  }
  if (sagChangeMm !== undefined) result.sagChangeMm = sagChangeMm
  return result
}

/** Convenience wrapper that takes the sag windows off a bike. */
export function analyseSagForBike(
  bike: Bike,
  axle: Axle,
  measurement: SagMeasurement,
): SagResult {
  return analyseSag({ axle, measurement, targets: bike.sagTargets })
}

/**
 * How to say the correction out loud.
 *
 * It names the direction and the distance to close, and stops there. Turning
 * that into "one and a half turns" needs the collar's thread pitch and the
 * linkage ratio, and a wrong assumption about either sends the rider
 * confidently the wrong distance. Re-measuring is both quicker and correct.
 */
export function describePreloadChange(result: SagResult): string | null {
  if (result.sagChangeMm === undefined) return null
  const mm = result.sagChangeMm
  if (Math.abs(mm) < 0.05) return null
  return mm > 0
    ? `Add preload until rider sag comes down ${fmt(mm)} mm, then measure again.`
    : `Back preload off until rider sag rises ${fmt(-mm)} mm, then measure again.`
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals)
}
