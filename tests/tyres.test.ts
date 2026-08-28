import { describe, expect, it } from 'vitest'
import {
  ambientAdjustedPressure,
  pressureRise,
  recommendColdPressure,
  recommendFromHistory,
  tyreUsage,
  wearGuidance,
} from '../src/core/tyres'
import type { Session } from '../src/core/types'

describe('pressureRise', () => {
  it('is hot minus cold', () => {
    expect(pressureRise({ coldPressure: 1.9, hotPressure: 2.2 })).toBeCloseTo(0.3, 10)
  })

  it('is undefined when either end is missing', () => {
    expect(pressureRise({ coldPressure: 1.9 })).toBeUndefined()
    expect(pressureRise({ hotPressure: 2.2 })).toBeUndefined()
  })
})

describe('recommendColdPressure', () => {
  it('shifts the cold pressure by however far the hot pressure missed', () => {
    const result = recommendColdPressure({ ranCold: 1.9, measuredHot: 2.2, targetHot: 2.1 })
    expect(result.rise).toBeCloseTo(0.3, 10)
    expect(result.coldPressure).toBeCloseTo(1.8, 10)
    expect(result.change).toBeCloseTo(-0.1, 10)
    expect(result.warnings).toEqual([])
  })

  it('pumps the tyre up when it came back under target', () => {
    const result = recommendColdPressure({ ranCold: 1.7, measuredHot: 1.95, targetHot: 2.1 })
    expect(result.coldPressure).toBeCloseTo(1.85, 10)
    expect(result.change).toBeCloseTo(0.15, 10)
  })

  it('flags a hot reading below the cold one as a bad measurement', () => {
    const result = recommendColdPressure({ ranCold: 2.0, measuredHot: 1.9, targetHot: 2.1 })
    expect(result.warnings.join(' ')).toMatch(/leak|gauge/i)
  })

  it('flags a very large rise as an overworked carcass', () => {
    const result = recommendColdPressure({ ranCold: 1.4, measuredHot: 2.0, targetHot: 2.1 })
    expect(result.warnings.join(' ')).toMatch(/working hard|too low/i)
  })

  it('flags a tyre that never came up to temperature', () => {
    const result = recommendColdPressure({ ranCold: 2.1, measuredHot: 2.13, targetHot: 2.1 })
    expect(result.warnings.join(' ')).toMatch(/not getting up to temperature/i)
  })

  it('flags a recommendation that lands outside any sane pressure', () => {
    const result = recommendColdPressure({ ranCold: 1.0, measuredHot: 2.4, targetHot: 2.1 })
    expect(result.warnings.join(' ')).toMatch(/outside the range/i)
  })
})

describe('recommendFromHistory', () => {
  it('averages the rise across recent sessions', () => {
    const result = recommendFromHistory(
      [
        { coldPressure: 1.9, hotPressure: 2.2 }, // rise 0.30
        { coldPressure: 1.9, hotPressure: 2.1 }, // rise 0.20
      ],
      2.1,
    )
    expect(result?.basedOnSessions).toBe(2)
    expect(result?.rise).toBeCloseTo(0.25, 10)
    expect(result?.coldPressure).toBeCloseTo(1.85, 10)
  })

  it('ignores sessions with no pressure recorded', () => {
    const result = recommendFromHistory(
      [{ coldPressure: 1.9, hotPressure: 2.2 }, { coldPressure: 1.9 }, {}],
      2.1,
    )
    expect(result?.basedOnSessions).toBe(1)
    expect(result?.rise).toBeCloseTo(0.3, 10)
  })

  it('only looks at the most recent sessions', () => {
    const result = recommendFromHistory(
      [
        { coldPressure: 1.9, hotPressure: 2.2 },
        { coldPressure: 1.9, hotPressure: 2.2 },
        { coldPressure: 1.9, hotPressure: 2.2 },
        { coldPressure: 1.0, hotPressure: 2.5 }, // ancient outlier, must not count
      ],
      2.1,
      3,
    )
    expect(result?.basedOnSessions).toBe(3)
    expect(result?.rise).toBeCloseTo(0.3, 10)
  })

  it('warns when the rise has been all over the place', () => {
    const result = recommendFromHistory(
      [
        { coldPressure: 1.9, hotPressure: 2.5 },
        { coldPressure: 1.9, hotPressure: 2.0 },
      ],
      2.1,
    )
    expect(result?.warnings.join(' ')).toMatch(/inconsistent/i)
  })

  it('has nothing to say without a usable session', () => {
    expect(recommendFromHistory([{ coldPressure: 1.9 }], 2.1)).toBeUndefined()
    expect(recommendFromHistory([], 2.1)).toBeUndefined()
  })
})

describe('ambientAdjustedPressure', () => {
  it('scales absolute pressure with absolute temperature', () => {
    // 1.90 bar gauge set at 12 °C reads about 2.04 once the air hits 26 °C.
    expect(ambientAdjustedPressure(1.9, 12, 26)).toBeCloseTo(2.043, 3)
  })

  it('falls when the air cools', () => {
    expect(ambientAdjustedPressure(1.9, 26, 12)).toBeLessThan(1.9)
  })

  it('changes nothing when the air has not moved', () => {
    expect(ambientAdjustedPressure(1.9, 20, 20)).toBeCloseTo(1.9, 10)
  })

  it('is reversible', () => {
    const warmed = ambientAdjustedPressure(1.9, 12, 26)
    expect(ambientAdjustedPressure(warmed, 26, 12)).toBeCloseTo(1.9, 10)
  })
})

describe('wearGuidance', () => {
  it('reads graining as a tyre that is too cold', () => {
    const guidance = wearGuidance('graining')
    expect(guidance.meaning).toMatch(/cold|working temperature/i)
    expect(guidance.actions.join(' ')).toMatch(/drop cold pressure/i)
  })

  it('reads blistering as a tyre that is too hot', () => {
    expect(wearGuidance('blistering').actions.join(' ')).toMatch(/raise cold pressure/i)
  })
})

function session(id: string, front?: string, rear?: string, at = 1000): Session {
  return {
    id,
    trackDayId: 'day',
    number: 1,
    startedAt: at,
    conditions: {},
    setup: { fork: {}, shock: {} },
    tyres: {
      front: front ? { tyreId: front } : {},
      rear: rear ? { tyreId: rear } : {},
    },
    feedback: [],
    createdAt: at,
    updatedAt: at,
  }
}

describe('tyreUsage', () => {
  it('counts a session once even if the tyre is on both ends of the record', () => {
    const usage = tyreUsage([session('a', 'tyre1', 'tyre1', 100)], 'tyre1')
    expect(usage.sessions).toBe(1)
    expect(usage.heatCycles).toBe(1)
    expect(usage.lastUsed).toBe(100)
  })

  it('tracks the most recent outing', () => {
    const usage = tyreUsage(
      [session('a', 'tyre1', undefined, 100), session('b', 'tyre1', undefined, 500)],
      'tyre1',
    )
    expect(usage.sessions).toBe(2)
    expect(usage.lastUsed).toBe(500)
  })

  it('ignores tyres that were never fitted', () => {
    expect(tyreUsage([session('a', 'tyre1')], 'tyre2').sessions).toBe(0)
  })
})
