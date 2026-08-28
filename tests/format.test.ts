import { describe, expect, it } from 'vitest'
import {
  fmtPressure,
  fmtPressureDelta,
  fmtTemp,
  pressureFromInput,
  pressureInputValue,
  pressureScale,
  pressureStepBar,
  tempFromInput,
  tempInputValue,
  todayIso,
} from '../src/ui/format'
import { defaultPreferences } from '../src/core/storage'
import type { Preferences } from '../src/core/types'

const psi: Preferences = { ...defaultPreferences(), pressureUnit: 'psi', temperatureUnit: 'F' }
const bar: Preferences = { ...defaultPreferences(), pressureUnit: 'bar', temperatureUnit: 'C' }

describe('pressure display', () => {
  it('shows a stored bar value in the rider’s unit', () => {
    expect(fmtPressure(2.2, psi)).toBe('31.9 psi')
    expect(fmtPressure(2.2, bar)).toBe('2.20 bar')
  })

  it('signs a delta', () => {
    expect(fmtPressureDelta(0.28, psi)).toBe('+4.1 psi')
    expect(fmtPressureDelta(-0.07, bar, false)).toBe('−0.07')
  })
})

/**
 * The pressure stepper formats a stored bar value into psi and reads the
 * rider's typing back the other way. When only the outbound half existed,
 * typing "31" into a psi field stored 31 bar — a wrong number that looked
 * right until it reached a calculation. These pin both directions together.
 */
describe('pressureScale', () => {
  it('round-trips a typed value back to the same stored pressure', () => {
    for (const prefs of [psi, bar]) {
      const scale = pressureScale(prefs)
      const stored = 2.2
      const typed = Number(scale.toDisplay(stored))
      expect(scale.fromDisplay(typed)).toBeCloseTo(stored, 2)
    }
  })

  it('reads what the rider types as their own unit, not as bar', () => {
    const scale = pressureScale(psi)
    // 31 psi is a normal front pressure; 31 bar is not a pressure at all.
    expect(scale.fromDisplay(31)).toBeCloseTo(2.137, 3)
  })

  it('is the identity when the rider already works in bar', () => {
    expect(pressureScale(bar).fromDisplay(2.2)).toBeCloseTo(2.2, 10)
  })

  it('formats a delta without a unit suffix, for the stepper caption', () => {
    expect(pressureScale(psi).formatDelta(0.28)).toBe('+4.1')
  })

  it('steps by one gauge increment of the rider’s unit', () => {
    expect(pressureStepBar(bar)).toBeCloseTo(0.01, 10)
    // 0.1 psi, expressed in bar.
    expect(pressureStepBar(psi)).toBeCloseTo(0.0069, 4)
  })
})

describe('input values', () => {
  it('renders an input at the resolution of the unit', () => {
    expect(pressureInputValue(2.2, psi)).toBe('31.9')
    expect(pressureInputValue(2.2, bar)).toBe('2.20')
    expect(pressureInputValue(undefined, psi)).toBe('')
  })

  it('round-trips temperature through the rider’s unit', () => {
    expect(tempInputValue(20, psi)).toBe('68')
    expect(tempFromInput(68, psi)).toBeCloseTo(20, 10)
    expect(fmtTemp(20, psi)).toBe('68°F')
    expect(fmtTemp(20, bar)).toBe('20°C')
  })

  it('converts a typed pressure into storage', () => {
    expect(pressureFromInput(31.9, psi)).toBeCloseTo(2.2, 2)
  })
})

describe('todayIso', () => {
  it('uses the local calendar date, not UTC', () => {
    // Late evening in a negative-offset zone is still "today" locally, and a
    // naive toISOString() would roll it to tomorrow.
    const local = new Date(2026, 2, 7, 23, 30)
    expect(todayIso(local)).toBe('2026-03-07')
  })
})
