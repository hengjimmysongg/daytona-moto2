import { describe, expect, it } from 'vitest'
import {
  ATMOSPHERIC_BAR,
  clamp,
  convertPressure,
  formatPressure,
  formatPressureDelta,
  lengthFromMm,
  massToKg,
  parseNumber,
  pressureFromBar,
  pressureToBar,
  roundTo,
  temperatureFromC,
  temperatureToC,
} from '../src/core/units'
import { formatLapDelta, formatLapTime, parseLapTime } from '../src/core/laptime'

describe('pressure', () => {
  it('converts bar to psi at the known ratio', () => {
    expect(pressureFromBar(1, 'psi')).toBeCloseTo(14.5038, 3)
    expect(pressureFromBar(2.2, 'psi')).toBeCloseTo(31.908, 2)
  })

  it('round-trips through every unit', () => {
    for (const unit of ['bar', 'psi', 'kPa'] as const) {
      expect(pressureToBar(pressureFromBar(1.85, unit), unit)).toBeCloseTo(1.85, 10)
    }
  })

  it('converts between non-canonical units', () => {
    expect(convertPressure(30, 'psi', 'bar')).toBeCloseTo(2.0684, 3)
    expect(convertPressure(2, 'bar', 'kPa')).toBeCloseTo(200, 6)
  })

  it('formats to the resolution each unit is actually read at', () => {
    expect(formatPressure(2.2, 'bar')).toBe('2.20 bar')
    expect(formatPressure(2.2, 'psi')).toBe('31.9 psi')
  })

  it('signs deltas and never renders a negative zero', () => {
    expect(formatPressureDelta(0.1, 'bar')).toBe('+0.10 bar')
    expect(formatPressureDelta(-0.1, 'bar')).toBe('−0.10 bar')
    expect(formatPressureDelta(-0.0001, 'bar')).toBe('0.00 bar')
  })

  it('uses standard atmosphere for gauge/absolute work', () => {
    expect(ATMOSPHERIC_BAR).toBeCloseTo(1.01325, 5)
  })
})

describe('temperature', () => {
  it('converts both ways', () => {
    expect(temperatureToC(32, 'F')).toBeCloseTo(0, 10)
    expect(temperatureToC(212, 'F')).toBeCloseTo(100, 10)
    expect(temperatureFromC(20, 'F')).toBeCloseTo(68, 10)
  })

  it('is a no-op within celsius', () => {
    expect(temperatureToC(18, 'C')).toBe(18)
    expect(temperatureFromC(18, 'C')).toBe(18)
  })
})

describe('length and mass', () => {
  it('converts mm to inches', () => {
    expect(lengthFromMm(25.4, 'in')).toBeCloseTo(1, 10)
  })

  it('converts pounds to kilograms', () => {
    expect(massToKg(180, 'lb')).toBeCloseTo(81.6466, 3)
  })
})

describe('helpers', () => {
  it('rounds to a step without binary drift', () => {
    expect(roundTo(2.34, 0.05)).toBeCloseTo(2.35, 10)
    expect(roundTo(31.94, 0.1)).toBeCloseTo(31.9, 10)
    // The case that trips a naive implementation.
    expect(roundTo(2.35, 0.05)).toBeCloseTo(2.35, 10)
  })

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })

  it('parses the ways riders actually type numbers', () => {
    expect(parseNumber(' 32 psi ')).toBe(32)
    expect(parseNumber('2,1')).toBeCloseTo(2.1, 10)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('.')).toBeNull()
  })
})

describe('lap times', () => {
  it('parses the way riders write them', () => {
    expect(parseLapTime('1:52.34')).toBeCloseTo(112.34, 10)
    expect(parseLapTime('1.52.34')).toBeCloseTo(112.34, 10)
    expect(parseLapTime('112.34')).toBeCloseTo(112.34, 10)
    expect(parseLapTime('52.3')).toBeCloseTo(52.3, 10)
    expect(parseLapTime('1:52')).toBeCloseTo(112, 10)
    expect(parseLapTime(' 1:52.345 ')).toBeCloseTo(112.345, 10)
  })

  it('reads a dot by how many parts follow it', () => {
    // Three parts can only be minutes; two parts is a lap under a minute.
    expect(parseLapTime('1.52.34')).toBeCloseTo(112.34, 10)
    expect(parseLapTime('58.70')).toBeCloseTo(58.7, 10)
    expect(parseLapTime('112.34')).toBeCloseTo(112.34, 10)
  })

  it('rejects what is not a lap time', () => {
    expect(parseLapTime('')).toBeNull()
    expect(parseLapTime('fast')).toBeNull()
    // 72 seconds inside a minutes field is a typo, not a time.
    expect(parseLapTime('1:72.00')).toBeNull()
    expect(parseLapTime('1.72.00')).toBeNull()
  })

  it('formats back to the way riders read them', () => {
    expect(formatLapTime(112.34)).toBe('1:52.34')
    expect(formatLapTime(52.3)).toBe('52.30')
    expect(formatLapTime(63)).toBe('1:03.00')
    expect(formatLapTime(undefined)).toBe('—')
  })

  it('round-trips', () => {
    for (const text of ['1:52.34', '2:01.09', '58.70']) {
      expect(formatLapTime(parseLapTime(text) as number)).toBe(text)
    }
  })

  it('signs a gap', () => {
    expect(formatLapDelta(-0.34)).toBe('−0.34')
    expect(formatLapDelta(1.02)).toBe('+1.02')
    expect(formatLapDelta(0)).toBe('0.00')
  })
})
