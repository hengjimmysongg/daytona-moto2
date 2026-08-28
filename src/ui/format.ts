/**
 * Display formatting.
 *
 * The core stores canonical units; this is the only layer that knows what
 * the rider wants to read, and it is also where input in their unit gets
 * turned back into the canonical one.
 */

import {
  formatPressure,
  formatPressureDelta,
  massFromKg,
  pressureFromBar,
  pressureStep,
  pressureToBar,
  temperatureFromC,
  temperatureToC,
} from '../core/units'
import type { Preferences } from '../core/types'

export const DASH = '—'

export function fmtPressure(bar: number | undefined, prefs: Preferences): string {
  return bar === undefined ? DASH : formatPressure(bar, prefs.pressureUnit)
}

export function fmtPressureDelta(
  bar: number | undefined,
  prefs: Preferences,
  withUnit = true,
): string {
  return bar === undefined ? DASH : formatPressureDelta(bar, prefs.pressureUnit, withUnit)
}

export function fmtTemp(celsius: number | undefined, prefs: Preferences): string {
  if (celsius === undefined) return DASH
  return `${Math.round(temperatureFromC(celsius, prefs.temperatureUnit))}°${prefs.temperatureUnit}`
}

export function fmtMass(kg: number | undefined, prefs: Preferences): string {
  if (kg === undefined) return DASH
  return prefs.massUnit === 'kg'
    ? `${round(kg, 1)} kg`
    : `${round(massFromKg(kg, 'lb'), 0)} lb`
}

/** Canonical value shown in the rider's unit, as a bare number for an input. */
export function pressureInputValue(bar: number | undefined, prefs: Preferences): string {
  if (bar === undefined) return ''
  const decimals = prefs.pressureUnit === 'bar' ? 2 : prefs.pressureUnit === 'psi' ? 1 : 0
  return pressureFromBar(bar, prefs.pressureUnit).toFixed(decimals)
}

export function pressureFromInput(value: number, prefs: Preferences): number {
  return pressureToBar(value, prefs.pressureUnit)
}

/**
 * Display mapping for a pressure control: bar in the model, the rider's
 * unit on the screen and under their thumbs.
 */
export function pressureScale(prefs: Preferences): {
  toDisplay: (bar: number) => string
  fromDisplay: (value: number) => number
  formatDelta: (bar: number) => string
} {
  return {
    toDisplay: (bar) => pressureInputValue(bar, prefs),
    fromDisplay: (value) => pressureFromInput(value, prefs),
    formatDelta: (bar) => fmtPressureDelta(bar, prefs, false),
  }
}

/** One nudge of a pressure control, in bar. */
export function pressureStepBar(prefs: Preferences): number {
  return pressureToBar(pressureStep(prefs.pressureUnit), prefs.pressureUnit)
}

export function tempInputValue(celsius: number | undefined, prefs: Preferences): string {
  if (celsius === undefined) return ''
  return String(Math.round(temperatureFromC(celsius, prefs.temperatureUnit)))
}

export function tempFromInput(value: number, prefs: Preferences): number {
  return temperatureToC(value, prefs.temperatureUnit)
}

function round(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.0+$/, '')
}

/** `Sat 7 Mar 2026`, falling back to the raw string for anything odd. */
export function fmtDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function todayIso(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
