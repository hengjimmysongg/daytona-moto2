/**
 * Suspension setups: describing them, comparing them, and checking them
 * against what the hardware can actually do.
 *
 * The value of a log book is the diff. "We went a second quicker" is only
 * useful next to "and here is the one thing we changed", so this module
 * turns two setups into a plain-language list of changes, each with what
 * that change does to the bike.
 *
 * Two conventions run through the whole app, and both are chosen because
 * they start from a hard stop you can find in the pit lane without a manual:
 *
 *   damping  — **clicks out from fully closed**. Fewer clicks out is more
 *              damping. Turning the adjuster *in* makes it firmer.
 *   preload  — **turns in from fully soft**. More turns is more preload.
 *
 * Fork oil height is the odd one out and follows the workshop convention:
 * millimetres measured *down* from the top of the fully compressed tube with
 * the spring removed, so a smaller number means more oil and a firmer end of
 * the stroke.
 */

import type { AdjusterSpec, Bike, SuspensionSetup } from './types'
import { EMPTY_SETUP } from './types'

export type SetupGroup = 'fork' | 'shock' | 'sag' | 'geometry'

export interface SetupField {
  key: string
  label: string
  group: SetupGroup
  unit: 'clicks' | 'turns' | 'mm'
  /** Short reminder of which way the numbers run. */
  convention?: string
  /** What the bike does when this number goes up. */
  increaseEffect?: string
  /** What the bike does when this number goes down. */
  decreaseEffect?: string
  get(setup: SuspensionSetup): number | undefined
  set(setup: SuspensionSetup, value: number | undefined): SuspensionSetup
  adjuster?(bike: Bike): AdjusterSpec | undefined
}

/** Immutably write a value into a nested setup branch. */
function withValue<K extends 'fork' | 'shock'>(
  setup: SuspensionSetup,
  branch: K,
  key: keyof SuspensionSetup[K],
  value: number | undefined,
): SuspensionSetup {
  const next = { ...setup, [branch]: { ...setup[branch] } } as SuspensionSetup
  const target = next[branch] as Record<string, number | undefined>
  if (value === undefined) delete target[key as string]
  else target[key as string] = value
  return next
}

export const SETUP_FIELDS: SetupField[] = [
  {
    key: 'fork.compression',
    label: 'Fork compression',
    group: 'fork',
    unit: 'clicks',
    convention: 'clicks out from fully closed',
    increaseEffect: 'softer front — dives more, absorbs bumps better',
    decreaseEffect: 'firmer front — holds up under brakes, less compliance',
    get: (s) => s.fork.compression,
    set: (s, v) => withValue(s, 'fork', 'compression', v),
    adjuster: (b) => b.fork.compression,
  },
  {
    key: 'fork.rebound',
    label: 'Fork rebound',
    group: 'fork',
    unit: 'clicks',
    convention: 'clicks out from fully closed',
    increaseEffect: 'front returns faster — more lively, can feel loose',
    decreaseEffect: 'front returns slower — settled, but can pack down over bumps',
    get: (s) => s.fork.rebound,
    set: (s, v) => withValue(s, 'fork', 'rebound', v),
    adjuster: (b) => b.fork.rebound,
  },
  {
    key: 'fork.preload',
    label: 'Fork preload',
    group: 'fork',
    unit: 'turns',
    convention: 'turns in from fully soft',
    increaseEffect: 'front rides higher, less sag, more support on entry',
    decreaseEffect: 'front rides lower, more sag, more initial compliance',
    get: (s) => s.fork.preload,
    set: (s, v) => withValue(s, 'fork', 'preload', v),
    adjuster: (b) => b.fork.preload,
  },
  {
    key: 'fork.height',
    label: 'Fork height in clamps',
    group: 'fork',
    unit: 'mm',
    convention: 'mm of tube showing above the top triple clamp',
    increaseEffect: 'front end lower — quicker steering, more front load, less stability',
    decreaseEffect: 'front end higher — slower steering, more stability',
    get: (s) => s.fork.height,
    set: (s, v) => withValue(s, 'fork', 'height', v),
  },
  {
    key: 'fork.oilHeight',
    label: 'Fork oil height',
    group: 'fork',
    unit: 'mm',
    convention: 'mm from the top of the compressed tube — smaller means more oil',
    increaseEffect: 'less oil — softer at the end of the stroke, easier to bottom',
    decreaseEffect: 'more oil — firmer at the end of the stroke, resists bottoming',
    get: (s) => s.fork.oilHeight,
    set: (s, v) => withValue(s, 'fork', 'oilHeight', v),
  },
  {
    key: 'shock.compressionLow',
    label: 'Shock low-speed compression',
    group: 'shock',
    unit: 'clicks',
    convention: 'clicks out from fully closed',
    increaseEffect: 'softer rear on throttle — squats more, more mechanical grip',
    decreaseEffect: 'firmer rear on throttle — holds height on exit, less squat',
    get: (s) => s.shock.compressionLow,
    set: (s, v) => withValue(s, 'shock', 'compressionLow', v),
    adjuster: (b) => b.shock.compressionLow,
  },
  {
    key: 'shock.compressionHigh',
    label: 'Shock high-speed compression',
    group: 'shock',
    unit: 'turns',
    convention: 'turns out from fully closed',
    increaseEffect: 'softer over kerbs and sharp bumps',
    decreaseEffect: 'firmer over kerbs — more control, harsher hits',
    get: (s) => s.shock.compressionHigh,
    set: (s, v) => withValue(s, 'shock', 'compressionHigh', v),
    adjuster: (b) => b.shock.compressionHigh,
  },
  {
    key: 'shock.rebound',
    label: 'Shock rebound',
    group: 'shock',
    unit: 'clicks',
    convention: 'clicks out from fully closed',
    increaseEffect: 'rear returns faster — more drive, can feel unsettled',
    decreaseEffect: 'rear returns slower — settled, but packs down over bumps',
    get: (s) => s.shock.rebound,
    set: (s, v) => withValue(s, 'shock', 'rebound', v),
    adjuster: (b) => b.shock.rebound,
  },
  {
    key: 'shock.preload',
    label: 'Shock preload',
    group: 'shock',
    unit: 'turns',
    convention: 'turns in from fully soft',
    increaseEffect: 'less rear sag, rear sits higher, quicker steering',
    decreaseEffect: 'more rear sag, rear sits lower, slower steering',
    get: (s) => s.shock.preload,
    set: (s, v) => withValue(s, 'shock', 'preload', v),
    adjuster: (b) => b.shock.preload,
  },
  {
    key: 'shock.rideHeight',
    label: 'Rear ride height',
    group: 'shock',
    unit: 'mm',
    convention: 'mm of shock/linkage rod length, or a measured height',
    increaseEffect: 'rear higher — quicker steering, more weight on the front',
    decreaseEffect: 'rear lower — slower steering, more stability, more rear grip',
    get: (s) => s.shock.rideHeight,
    set: (s, v) => withValue(s, 'shock', 'rideHeight', v),
  },
]

export const SETUP_FIELDS_BY_KEY: ReadonlyMap<string, SetupField> = new Map(
  SETUP_FIELDS.map((field) => [field.key, field]),
)

export function fieldsInGroup(group: SetupGroup): SetupField[] {
  return SETUP_FIELDS.filter((field) => field.group === group)
}

/* ------------------------------------------------------------------ */
/* Diffing                                                             */
/* ------------------------------------------------------------------ */

export interface SetupChange {
  field: SetupField
  from: number | undefined
  to: number | undefined
  /** to − from, when both sides are present. */
  delta: number | undefined
  /** "Fork compression 12 → 10 clicks out". */
  summary: string
  /** What that change does to the bike, in plain language. */
  effect?: string
}

function formatAmount(value: number, unit: SetupField['unit']): string {
  const rounded = Math.round(value * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')
  const plural = Math.abs(rounded) === 1 ? unit.replace(/s$/, '') : unit
  return `${text} ${plural}`
}

/** Every field that differs between two setups, in display order. */
export function diffSetups(before: SuspensionSetup, after: SuspensionSetup): SetupChange[] {
  const changes: SetupChange[] = []
  for (const field of SETUP_FIELDS) {
    const from = field.get(before)
    const to = field.get(after)
    if (from === to) continue
    if (from === undefined && to === undefined) continue

    const delta = from !== undefined && to !== undefined ? to - from : undefined
    let summary: string
    if (from === undefined) {
      summary = `${field.label} set to ${formatAmount(to as number, field.unit)}`
    } else if (to === undefined) {
      summary = `${field.label} cleared (was ${formatAmount(from, field.unit)})`
    } else {
      summary = `${field.label} ${trim(from)} → ${trim(to)} ${field.unit}`
    }

    const change: SetupChange = { field, from, to, delta, summary }
    if (delta !== undefined && delta !== 0) {
      const effect = delta > 0 ? field.increaseEffect : field.decreaseEffect
      if (effect) change.effect = `${formatAmount(Math.abs(delta), field.unit)} — ${effect}`
    }
    changes.push(change)
  }
  return changes
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/** One-line summary of a diff, for a session list. */
export function summariseDiff(changes: ReadonlyArray<SetupChange>): string {
  if (changes.length === 0) return 'No setup change'
  if (changes.length === 1) return (changes[0] as SetupChange).summary
  return `${changes.length} changes: ${changes.map((c) => c.field.label).join(', ')}`
}

/**
 * Changing several things at once means you learn nothing from the lap time,
 * because you cannot tell which change did what. The app does not stop you,
 * but it does say so.
 */
export function isSingleChange(changes: ReadonlyArray<SetupChange>): boolean {
  return changes.length <= 1
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface SetupWarning {
  key: string
  message: string
}

/**
 * Check a setup against the adjuster ranges recorded for the bike. Catches
 * the transposed digit ("22 clicks out" on an 18-click adjuster) before it
 * goes in the log book and gets copied forward for the rest of the season.
 */
export function validateSetup(bike: Bike, setup: SuspensionSetup): SetupWarning[] {
  const warnings: SetupWarning[] = []
  for (const field of SETUP_FIELDS) {
    const value = field.get(setup)
    if (value === undefined) continue
    const spec = field.adjuster?.(bike)
    if (!spec) continue
    if (value < 0) {
      warnings.push({ key: field.key, message: `${field.label} cannot be negative.` })
    } else if (value > spec.range) {
      warnings.push({
        key: field.key,
        message: `${field.label} is ${trim(value)} but this adjuster only has ${spec.range} ${spec.unit}.`,
      })
    }
  }
  return warnings
}

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

export function cloneSetup(setup: SuspensionSetup): SuspensionSetup {
  return {
    fork: { ...setup.fork },
    shock: { ...setup.shock },
    ...(setup.sag ? { sag: { ...setup.sag } } : {}),
    ...(setup.geometry ? { geometry: { ...setup.geometry } } : {}),
  }
}

export function emptySetup(): SuspensionSetup {
  return cloneSetup(EMPTY_SETUP)
}

/** True when nothing at all has been filled in. */
export function isSetupEmpty(setup: SuspensionSetup): boolean {
  return SETUP_FIELDS.every((field) => field.get(setup) === undefined)
}
