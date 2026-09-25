import { describe, expect, it } from 'vitest'
import {
  adjusterConvention,
  adjusterStep,
  cloneSetup,
  diffSetups,
  fieldsInGroup,
  SETUP_FIELDS,
  emptySetup,
  isSetupEmpty,
  isSingleChange,
  SETUP_FIELDS_BY_KEY,
  summariseDiff,
  validateSetup,
} from '../src/core/setup'
import { newBike } from '../src/data/presets'
import type { AdjusterUnitPref, Bike, SuspensionSetup } from '../src/core/types'

/** A bike with real adjuster ranges, for the validation tests. */
function testBike(): Bike {
  const b = newBike('Test', 0)
  b.fork.compression.range = 18
  b.fork.rebound.range = 18
  b.fork.preload.range = 8
  b.shock.compressionLow.range = 18
  b.shock.rebound.range = 18
  b.shock.preload.range = 10
  return b
}

const bike = testBike()

const base: SuspensionSetup = {
  fork: { compression: 12, rebound: 10, preload: 4, height: 5 },
  shock: { compressionLow: 12, rebound: 10, preload: 3, rideHeight: 0 },
}

describe('diffSetups', () => {
  it('finds nothing between identical setups', () => {
    expect(diffSetups(base, cloneSetup(base))).toEqual([])
  })

  it('reports a damping change with its direction and effect', () => {
    const after = { ...base, fork: { ...base.fork, compression: 10 } }
    const changes = diffSetups(base, after)
    expect(changes).toHaveLength(1)
    const change = changes[0]!
    expect(change.field.key).toBe('fork.compression')
    expect(change.delta).toBe(-2)
    expect(change.summary).toBe('Fork compression 12 → 10 clicks')
    // Fewer clicks out from closed is more damping.
    expect(change.effect).toMatch(/firmer front/)
  })

  it('reads more clicks out as softer', () => {
    const after = { ...base, fork: { ...base.fork, compression: 14 } }
    expect(diffSetups(base, after)[0]!.effect).toMatch(/softer front/)
  })

  it('reads raising the forks through the clamps as a lower front end', () => {
    const after = { ...base, fork: { ...base.fork, height: 8 } }
    expect(diffSetups(base, after)[0]!.effect).toMatch(/front end lower.*quicker steering/)
  })

  it('reads more oil (a smaller oil height) as firmer at the end of the stroke', () => {
    const before = { ...base, fork: { ...base.fork, oilHeight: 100 } }
    const after = { ...base, fork: { ...base.fork, oilHeight: 90 } }
    expect(diffSetups(before, after)[0]!.effect).toMatch(/more oil.*firmer/)
  })

  it('handles a value being filled in or cleared', () => {
    const withValue = { ...base, shock: { ...base.shock, compressionHigh: 2 } }
    expect(diffSetups(base, withValue)[0]!.summary).toBe('Shock high-speed compression set to 2 turns')
    expect(diffSetups(withValue, base)[0]!.summary).toBe(
      'Shock high-speed compression cleared (was 2 turns)',
    )
  })

  it('picks up several changes at once', () => {
    const after: SuspensionSetup = {
      fork: { ...base.fork, compression: 10, preload: 5 },
      shock: { ...base.shock, rideHeight: 2 },
    }
    const changes = diffSetups(base, after)
    expect(changes).toHaveLength(3)
    expect(isSingleChange(changes)).toBe(false)
    expect(summariseDiff(changes)).toMatch(/^3 changes:/)
  })

  it('summarises the no-change and single-change cases', () => {
    expect(summariseDiff([])).toBe('No setup change')
    const one = diffSetups(base, { ...base, fork: { ...base.fork, rebound: 9 } })
    expect(isSingleChange(one)).toBe(true)
    expect(summariseDiff(one)).toBe('Fork rebound 10 → 9 clicks')
  })
})

describe('field metadata', () => {
  it('gives every field a short label for use under a section heading', () => {
    for (const field of SETUP_FIELDS) {
      expect(field.shortLabel, field.key).toBeTruthy()
      expect(field.shortLabel.length, field.key).toBeLessThanOrEqual(field.label.length)
    }
  })

  it('keeps short labels unique inside a group, since that is all you see there', () => {
    for (const group of ['fork', 'shock'] as const) {
      const labels = fieldsInGroup(group).map((field) => field.shortLabel)
      expect(new Set(labels).size, group).toBe(labels.length)
    }
  })

  it('nudges damping by a click and preload by a quarter turn', () => {
    expect(SETUP_FIELDS_BY_KEY.get('fork.compression')!.step).toBe(1)
    expect(SETUP_FIELDS_BY_KEY.get('shock.preload')!.step).toBe(0.25)
  })
})

describe('field accessors', () => {
  it('writes without mutating the setup it was given', () => {
    const field = SETUP_FIELDS_BY_KEY.get('shock.rebound')!
    const next = field.set(base, 8)
    expect(field.get(next)).toBe(8)
    expect(field.get(base)).toBe(10)
    expect(next).not.toBe(base)
    // The branch that was written is copied; the untouched one is shared,
    // which is safe precisely because every write copies before it writes.
    expect(next.shock).not.toBe(base.shock)
    expect(next.fork).toBe(base.fork)
  })

  it('removes the key when given undefined', () => {
    const field = SETUP_FIELDS_BY_KEY.get('fork.preload')!
    const next = field.set(base, undefined)
    expect(field.get(next)).toBeUndefined()
    expect('preload' in next.fork).toBe(false)
  })
})

describe('validateSetup', () => {
  it('accepts a setup inside the adjuster ranges', () => {
    expect(validateSetup(bike, base)).toEqual([])
  })

  it('catches a value past the end of the adjuster', () => {
    const warnings = validateSetup(bike, { ...base, fork: { ...base.fork, compression: 25 } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/only has 18 clicks/)
  })

  it('catches a negative value', () => {
    const warnings = validateSetup(bike, { ...base, shock: { ...base.shock, rebound: -1 } })
    expect(warnings[0]!.message).toMatch(/cannot be negative/)
  })

  it('says nothing about fields with no adjuster hardware recorded', () => {
    expect(validateSetup(bike, { ...base, fork: { ...base.fork, height: 999 } })).toEqual([])
  })
})

describe('emptySetup', () => {
  it('starts blank and reports itself as blank', () => {
    expect(isSetupEmpty(emptySetup())).toBe(true)
    expect(isSetupEmpty(base)).toBe(false)
  })

  it('is a fresh object each time', () => {
    const a = emptySetup()
    a.fork.compression = 10
    expect(emptySetup().fork.compression).toBeUndefined()
  })
})

describe('adjuster unit and direction (per bike, per adjuster)', () => {
  /** A bike whose fork compression is recorded a particular way. */
  const withCompression = (pref: AdjusterUnitPref): Bike => ({
    ...newBike('Test', 0),
    adjusterUnits: { 'fork.compression': pref },
  })

  it('shows an adjuster in the unit chosen for it on this bike', () => {
    const after = { ...base, fork: { ...base.fork, compression: 10 } }
    const turns = withCompression({ unit: 'turns', direction: 'hard-to-soft' })
    expect(diffSetups(base, after, turns)[0]!.summary).toBe('Fork compression 12 → 10 turns')
    const halfTurns = withCompression({ unit: 'half-turns', direction: 'hard-to-soft' })
    expect(diffSetups(base, after, halfTurns)[0]!.summary).toBe('Fork compression 12 → 10 half turns')
  })

  it('records each adjuster in its own unit — preload need not match the clickers', () => {
    const after = { ...base, fork: { ...base.fork, preload: 5 } }
    // Compression in half turns leaves preload on its own default of turns.
    const halfClickers = withCompression({ unit: 'half-turns', direction: 'hard-to-soft' })
    expect(diffSetups(base, after, halfClickers)[0]!.summary).toBe('Fork preload 4 → 5 turns')
    // And preload itself can be recorded in clicks on a bike that counts it that way.
    const preloadClicks: Bike = {
      ...newBike('Test', 0),
      adjusterUnits: { 'fork.preload': { unit: 'clicks', direction: 'hard-to-soft' } },
    }
    expect(diffSetups(base, after, preloadClicks)[0]!.summary).toBe('Fork preload 4 → 5 clicks')
  })

  it('reverses firmer/softer when the adjuster is recorded from fully open', () => {
    const after = { ...base, fork: { ...base.fork, compression: 10 } }
    const hard = withCompression({ unit: 'clicks', direction: 'hard-to-soft' })
    const soft = withCompression({ unit: 'clicks', direction: 'soft-to-hard' })
    // Counted out from closed, dropping two clicks is more damping — firmer.
    expect(diffSetups(base, after, hard)[0]!.effect).toMatch(/firmer front/)
    // Counted in from open, the same smaller number is less damping — softer.
    expect(diffSetups(base, after, soft)[0]!.effect).toMatch(/softer front/)
  })

  it('does not reverse a non-damping field like ride height', () => {
    const after = { ...base, shock: { ...base.shock, rideHeight: 2 } }
    const hard = withCompression({ unit: 'clicks', direction: 'hard-to-soft' })
    const soft = withCompression({ unit: 'clicks', direction: 'soft-to-hard' })
    expect(diffSetups(base, after, hard)[0]!.effect).toBe(diffSetups(base, after, soft)[0]!.effect)
  })

  it('writes the convention for the chosen unit and direction', () => {
    const field = SETUP_FIELDS_BY_KEY.get('fork.compression')!
    const turns = withCompression({ unit: 'turns', direction: 'hard-to-soft' })
    expect(adjusterConvention(field, turns)).toBe('turns out from fully closed — more is softer')
    const soft = withCompression({ unit: 'clicks', direction: 'soft-to-hard' })
    expect(adjusterConvention(field, soft)).toBe('clicks in from fully open — more is firmer')
  })

  it('steps clicks whole, turns by a quarter, half turns by a half', () => {
    const field = SETUP_FIELDS_BY_KEY.get('fork.compression')!
    expect(adjusterStep(field, withCompression({ unit: 'clicks', direction: 'hard-to-soft' }))).toBe(1)
    expect(adjusterStep(field, withCompression({ unit: 'turns', direction: 'hard-to-soft' }))).toBe(0.25)
    expect(adjusterStep(field, withCompression({ unit: 'half-turns', direction: 'hard-to-soft' }))).toBe(0.5)
  })

  it('defaults to clicks out from fully closed when the bike has chosen nothing', () => {
    const field = SETUP_FIELDS_BY_KEY.get('fork.compression')!
    expect(adjusterConvention(field, newBike('Test', 0))).toBe(
      'clicks out from fully closed — more is softer',
    )
    expect(adjusterConvention(field, undefined)).toBe('clicks out from fully closed — more is softer')
  })
})
