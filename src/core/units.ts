/**
 * Unit handling.
 *
 * Everything inside the app is stored in a single canonical unit so that
 * maths never has to guess: pressure in **bar**, temperature in **°C**,
 * length in **mm**, mass in **kg**. Conversion happens only at the edges
 * (input parsing and display), which keeps the calculators unit-free.
 */

export type PressureUnit = 'bar' | 'psi' | 'kPa'
export type TemperatureUnit = 'C' | 'F'
export type LengthUnit = 'mm' | 'in'
export type MassUnit = 'kg' | 'lb'

/** Standard atmospheric pressure, used to convert gauge <-> absolute. */
export const ATMOSPHERIC_BAR = 1.01325

const PSI_PER_BAR = 14.503773773022
const KPA_PER_BAR = 100
const MM_PER_INCH = 25.4
const KG_PER_LB = 0.45359237

/** Absolute zero offset: kelvin = celsius + this. */
export const KELVIN_OFFSET = 273.15

/* ------------------------------------------------------------------ */
/* Pressure                                                            */
/* ------------------------------------------------------------------ */

export function pressureToBar(value: number, from: PressureUnit): number {
  switch (from) {
    case 'bar':
      return value
    case 'psi':
      return value / PSI_PER_BAR
    case 'kPa':
      return value / KPA_PER_BAR
  }
}

export function pressureFromBar(bar: number, to: PressureUnit): number {
  switch (to) {
    case 'bar':
      return bar
    case 'psi':
      return bar * PSI_PER_BAR
    case 'kPa':
      return bar * KPA_PER_BAR
  }
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  return pressureFromBar(pressureToBar(value, from), to)
}

/**
 * Sensible number of decimals for a pressure readout. A tenth of a psi is
 * about all a paddock gauge resolves; bar needs two decimals to show the
 * same 0.01 bar steps riders actually dial in.
 */
export function pressureDecimals(unit: PressureUnit): number {
  return unit === 'bar' ? 2 : unit === 'psi' ? 1 : 0
}

/** The smallest adjustment worth showing the rider, per unit. */
export function pressureStep(unit: PressureUnit): number {
  return unit === 'bar' ? 0.01 : unit === 'psi' ? 0.1 : 1
}

export function formatPressure(bar: number, unit: PressureUnit, withUnit = true): string {
  const v = pressureFromBar(bar, unit)
  const text = v.toFixed(pressureDecimals(unit))
  return withUnit ? `${text} ${unit}` : text
}

/**
 * Signed delta, for "+0.15 bar" style readouts. A delta is a difference of
 * two gauge pressures, so it converts like a plain pressure (both scales are
 * linear through zero) but always carries an explicit sign.
 */
export function formatPressureDelta(barDelta: number, unit: PressureUnit, withUnit = true): string {
  const v = pressureFromBar(barDelta, unit)
  const decimals = pressureDecimals(unit)
  // Avoid rendering "-0.0" for a delta that rounds to nothing.
  const rounded = Number(v.toFixed(decimals))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  const text = `${sign}${Math.abs(rounded).toFixed(decimals)}`
  return withUnit ? `${text} ${unit}` : text
}

/* ------------------------------------------------------------------ */
/* Temperature                                                         */
/* ------------------------------------------------------------------ */

export function temperatureToC(value: number, from: TemperatureUnit): number {
  return from === 'C' ? value : ((value - 32) * 5) / 9
}

export function temperatureFromC(celsius: number, to: TemperatureUnit): number {
  return to === 'C' ? celsius : (celsius * 9) / 5 + 32
}

export function celsiusToKelvin(celsius: number): number {
  return celsius + KELVIN_OFFSET
}

export function formatTemperature(celsius: number, unit: TemperatureUnit, withUnit = true): string {
  const v = temperatureFromC(celsius, unit)
  const text = v.toFixed(unit === 'C' ? 0 : 0)
  return withUnit ? `${text}°${unit}` : text
}

/* ------------------------------------------------------------------ */
/* Length and mass                                                     */
/* ------------------------------------------------------------------ */

export function lengthToMm(value: number, from: LengthUnit): number {
  return from === 'mm' ? value : value * MM_PER_INCH
}

export function lengthFromMm(mm: number, to: LengthUnit): number {
  return to === 'mm' ? mm : mm / MM_PER_INCH
}

export function massToKg(value: number, from: MassUnit): number {
  return from === 'kg' ? value : value * KG_PER_LB
}

export function massFromKg(kg: number, to: MassUnit): number {
  return to === 'kg' ? kg : kg / KG_PER_LB
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value
  // Round-trip through a scaled integer to dodge binary float drift
  // (e.g. 2.35 / 0.05 landing on 46.99999999999999).
  const scaled = Math.round((value / step) * 1e9) / 1e9
  return Math.round(scaled) * step
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Parse loose rider input ("2,1", " 32 psi ") into a number, or null. */
export function parseNumber(input: string): number | null {
  const cleaned = input.trim().replace(',', '.').replace(/[^\d.+-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+' || cleaned === '.') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}
