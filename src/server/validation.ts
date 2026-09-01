/**
 * What the API will accept.
 *
 * These are input shapes, deliberately not the domain types: a caller
 * inserting a session from a shell script should not have to invent a
 * timestamp, an id or a session number, so the required set is only what
 * genuinely cannot be worked out from context. Everything else is filled in
 * by `build*` below.
 *
 * Units are the canonical ones and are not negotiable at the boundary:
 * pressures in **bar**, temperatures in **°C**, lengths in **mm**, weights
 * in **kg**. The display unit a rider prefers is a browser setting and has
 * no business in the database.
 */

import { z } from 'zod'
import { newId } from '../core/id.js'
import { TRACK_SAG_TARGETS } from '../data/presets.js'
import type { Bike, Session, TrackDay, Tyre } from '../core/types.js'

/**
 * A required string whose message covers being missing as well as being
 * empty. Attaching the message only to `.min(1)` leaves the far more common
 * case — the field simply not being there — answered with zod's generic
 * "expected string, received undefined", which tells a caller nothing.
 */
function requiredString(message: string) {
  return z.string({ error: message }).min(1, message)
}

const adjuster = z.object({
  range: z.number().nonnegative(),
  unit: z.enum(['clicks', 'turns', 'mm', 'lines']),
  mmPerTurn: z.number().positive().optional(),
})

const sagWindow = z.tuple([z.number(), z.number()])

/**
 * Credentials.
 *
 * Only the shape is checked here — whether the address looks like one and
 * the password is long enough is `checkCredentials`, which owns the wording
 * a person actually reads.
 */
export const credentialsInput = z.object({
  email: z.string(),
  password: z.string(),
})

export const bikeInput = z.object({
  id: z.string().min(1).optional(),
  name: requiredString('A bike needs a name.'),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  riderWeightKg: z.number().positive().optional(),
  fork: z
    .object({
      springRate: z.number().positive().optional(),
      travel: z.number().positive().optional(),
      compression: adjuster,
      rebound: adjuster,
      preload: adjuster,
    })
    .optional(),
  shock: z
    .object({
      springRate: z.number().positive().optional(),
      travel: z.number().positive().optional(),
      motionRatio: z.number().positive().optional(),
      compressionLow: adjuster,
      compressionHigh: adjuster.optional(),
      rebound: adjuster,
      preload: adjuster,
    })
    .optional(),
  sagTargets: z
    .object({
      frontRider: sagWindow,
      frontFree: sagWindow,
      rearRider: sagWindow,
      rearFree: sagWindow,
    })
    .optional(),
  notes: z.string().optional(),
})

export const trackDayInput = z.object({
  id: z.string().min(1).optional(),
  bikeId: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
    .optional(),
  circuit: requiredString('A track day needs a circuit.'),
  layout: z.string().optional(),
  organiser: z.string().optional(),
  notes: z.string().optional(),
})

const tyreModel = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  compound: z.string().optional(),
  size: z.string().optional(),
  slick: z.boolean().optional(),
})

export const tyreInput = z.object({
  id: z.string().min(1).optional(),
  axle: z.enum(['front', 'rear']),
  model: tyreModel,
  label: z.string().optional(),
  sessions: z.number().int().nonnegative().optional(),
  heatCycles: z.number().int().nonnegative().optional(),
  retired: z.boolean().optional(),
  notes: z.string().optional(),
})

/** A pressure in bar. Rejects a psi value typed into a bar field. */
const pressureBar = z
  .number()
  .positive()
  .max(
    6,
    'Pressures are in bar. A value this high looks like psi — 31 psi is about 2.14 bar.',
  )

const tyreRunInput = z.object({
  tyreId: z.string().optional(),
  model: tyreModel.optional(),
  coldPressure: pressureBar.optional(),
  coldAtAmbient: z.number().optional(),
  hotPressure: pressureBar.optional(),
  warmerTemp: z.number().optional(),
  surfaceTemp: z.number().optional(),
  wear: z
    .enum(['ok', 'graining', 'blistering', 'tearing', 'cold-tear', 'feathering', 'overheating', 'worn-out'])
    .optional(),
})

const setupInput = z.object({
  fork: z
    .object({
      compression: z.number().optional(),
      rebound: z.number().optional(),
      preload: z.number().optional(),
      height: z.number().optional(),
      oilHeight: z.number().optional(),
    })
    .optional(),
  shock: z
    .object({
      compressionLow: z.number().optional(),
      compressionHigh: z.number().optional(),
      rebound: z.number().optional(),
      preload: z.number().optional(),
      rideHeight: z.number().optional(),
    })
    .optional(),
  sag: z
    .object({
      frontRider: z.number().optional(),
      frontFree: z.number().optional(),
      rearRider: z.number().optional(),
      rearFree: z.number().optional(),
    })
    .optional(),
})

export const sessionInput = z.object({
  id: z.string().min(1).optional(),
  trackDayId: requiredString('A session belongs to a track day.'),
  number: z.number().int().positive().optional(),
  startedAt: z.number().int().optional(),
  laps: z.number().int().nonnegative().optional(),
  bestLap: z.number().positive().optional(),
  averageLap: z.number().positive().optional(),
  conditions: z
    .object({
      ambientTemp: z.number().optional(),
      trackTemp: z.number().optional(),
      condition: z.enum(['dry', 'damp', 'wet', 'mixed']).optional(),
      windy: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  setup: setupInput.optional(),
  tyres: z.object({ front: tyreRunInput.optional(), rear: tyreRunInput.optional() }).optional(),
  feedback: z.array(z.string()).optional(),
  notes: z.string().optional(),
  changesMade: z.string().optional(),
})

export const preferencesInput = z.object({
  pressureUnit: z.enum(['bar', 'psi', 'kPa']).optional(),
  temperatureUnit: z.enum(['C', 'F']).optional(),
  massUnit: z.enum(['kg', 'lb']).optional(),
  targetHotPressure: z
    .object({ front: pressureBar.optional(), rear: pressureBar.optional() })
    .optional(),
})

/* ------------------------------------------------------------------ */
/* Building domain objects from validated input                        */
/* ------------------------------------------------------------------ */

const DEFAULT_FORK: NonNullable<z.infer<typeof bikeInput>['fork']> = {
  travel: 120,
  compression: { range: 18, unit: 'clicks' },
  rebound: { range: 18, unit: 'clicks' },
  preload: { range: 8, unit: 'turns', mmPerTurn: 1 },
}

const DEFAULT_SHOCK: NonNullable<z.infer<typeof bikeInput>['shock']> = {
  travel: 130,
  motionRatio: 2.6,
  compressionLow: { range: 18, unit: 'clicks' },
  rebound: { range: 18, unit: 'clicks' },
  preload: { range: 10, unit: 'turns', mmPerTurn: 1.5 },
}

export function buildBike(input: z.infer<typeof bikeInput>, existing?: Bike, now = Date.now()): Bike {
  return {
    id: input.id ?? existing?.id ?? newId('bike'),
    name: input.name,
    ...pick('make', input.make ?? existing?.make),
    ...pick('model', input.model ?? existing?.model),
    ...pick('year', input.year ?? existing?.year),
    ...pick('riderWeightKg', input.riderWeightKg ?? existing?.riderWeightKg),
    fork: input.fork ?? existing?.fork ?? DEFAULT_FORK,
    shock: input.shock ?? existing?.shock ?? DEFAULT_SHOCK,
    sagTargets: input.sagTargets ?? existing?.sagTargets ?? TRACK_SAG_TARGETS,
    ...pick('notes', input.notes ?? existing?.notes),
    createdAt: existing?.createdAt ?? now,
  }
}

export function buildTrackDay(
  input: z.infer<typeof trackDayInput>,
  bikeId: string,
  existing?: TrackDay,
  now = Date.now(),
): TrackDay {
  return {
    id: input.id ?? existing?.id ?? newId('day'),
    bikeId,
    date: input.date ?? existing?.date ?? isoDate(now),
    circuit: input.circuit,
    ...pick('layout', input.layout ?? existing?.layout),
    ...pick('organiser', input.organiser ?? existing?.organiser),
    ...pick('notes', input.notes ?? existing?.notes),
    createdAt: existing?.createdAt ?? now,
  }
}

export function buildTyre(input: z.infer<typeof tyreInput>, existing?: Tyre, now = Date.now()): Tyre {
  return {
    id: input.id ?? existing?.id ?? newId('tyre'),
    axle: input.axle,
    model: input.model,
    ...pick('label', input.label ?? existing?.label),
    sessions: input.sessions ?? existing?.sessions ?? 0,
    heatCycles: input.heatCycles ?? existing?.heatCycles ?? 0,
    ...((input.retired ?? existing?.retired) ? { retired: true } : {}),
    ...pick('notes', input.notes ?? existing?.notes),
    createdAt: existing?.createdAt ?? now,
  }
}

export function buildSession(
  input: z.infer<typeof sessionInput>,
  number: number,
  existing?: Session,
  now = Date.now(),
): Session {
  const setup = input.setup ?? {}
  return {
    id: input.id ?? existing?.id ?? newId('session'),
    trackDayId: input.trackDayId,
    number,
    ...pick('startedAt', input.startedAt ?? existing?.startedAt ?? now),
    ...pick('laps', input.laps ?? existing?.laps),
    ...pick('bestLap', input.bestLap ?? existing?.bestLap),
    ...pick('averageLap', input.averageLap ?? existing?.averageLap),
    conditions: { ...existing?.conditions, ...input.conditions },
    setup: {
      fork: { ...existing?.setup.fork, ...setup.fork },
      shock: { ...existing?.setup.shock, ...setup.shock },
      ...(setup.sag || existing?.setup.sag
        ? { sag: { ...existing?.setup.sag, ...setup.sag } }
        : {}),
    },
    tyres: {
      front: { ...existing?.tyres.front, ...input.tyres?.front },
      rear: { ...existing?.tyres.rear, ...input.tyres?.rear },
    },
    feedback: input.feedback ?? existing?.feedback ?? [],
    ...pick('notes', input.notes ?? existing?.notes),
    ...pick('changesMade', input.changesMade ?? existing?.changesMade),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function pick<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Zod issues turned into something a caller can act on. */
export function formatIssues(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }))
}
