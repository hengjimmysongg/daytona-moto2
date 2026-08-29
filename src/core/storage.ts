/**
 * Persistence.
 *
 * Everything lives on the rider's own device: a track day happens in a field
 * with no signal, and a log book that needs a network to open is no log book
 * at all. The store is a single JSON document in `localStorage`, with export
 * and import so a season's data can be backed up or moved to another phone.
 *
 * The storage handle is injected rather than reaching for `window`, which
 * keeps this module testable and makes it usable from a Node script.
 */

import type { GarageData, Preferences, Session, TrackDay } from './types'
import { SCHEMA_VERSION } from './types'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const STORAGE_KEY = 'daytona-moto2:garage'

export class ImportError extends Error {}

/**
 * Starting preferences: what a club racer at a US circuit reads off their
 * own gauges. Suspension stays in millimetres because clickers and ride
 * height are metric on every bike, whatever the country. All of it is
 * switchable in Settings.
 */
export function defaultPreferences(): Preferences {
  return {
    pressureUnit: 'psi',
    temperatureUnit: 'F',
    massUnit: 'lb',
    // Starting points only — replace with the hot pressures from your own
    // tyre's data sheet, which is the number that actually matters.
    targetHotPressure: { front: 2.2, rear: 1.9 },
  }
}

export function createEmptyGarage(now: number = Date.now()): GarageData {
  return {
    version: SCHEMA_VERSION,
    bikes: [],
    tyres: [],
    presets: [],
    trackDays: [],
    sessions: [],
    preferences: defaultPreferences(),
    updatedAt: now,
  }
}

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Load the garage, falling back to an empty one.
 *
 * A corrupt or half-written record must never leave the rider staring at a
 * blank screen with no way in, so parsing problems degrade to an empty
 * garage and are reported rather than thrown.
 */
export function loadGarage(storage: StorageLike): { data: GarageData; error?: string } {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch (error) {
    return { data: createEmptyGarage(), error: describe(error) }
  }
  if (raw === null) return { data: createEmptyGarage() }

  try {
    return { data: migrate(JSON.parse(raw)) }
  } catch (error) {
    return { data: createEmptyGarage(), error: describe(error) }
  }
}

/**
 * Persist the document exactly as given.
 *
 * `updatedAt` is set by whoever made the change, not here. Re-stamping on
 * the way to disk would leave the copy in memory and the copy on disk
 * disagreeing about when the document last changed, and sync compares
 * exactly that.
 */
export function saveGarage(storage: StorageLike, data: GarageData): { error?: string } {
  const next: GarageData = { ...data, version: SCHEMA_VERSION }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
    return {}
  } catch (error) {
    // Most often a full quota. Worth telling the rider, because the change
    // they just made is not actually saved.
    return { error: describe(error) }
  }
}

export function clearGarage(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY)
}

/* ------------------------------------------------------------------ */
/* Import / export                                                     */
/* ------------------------------------------------------------------ */

export function exportGarage(data: GarageData): string {
  return JSON.stringify({ ...data, version: SCHEMA_VERSION }, null, 2)
}

export function suggestExportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10)
  return `daytona-moto2-${stamp}.json`
}

/** Parse and validate a previously exported file. Throws `ImportError`. */
export function importGarage(json: string): GarageData {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return fail('That file is not valid JSON.')
  }
  return migrate(parsed)
}

/**
 * Bring a stored document up to the current schema.
 *
 * Version 1 is the first release, so there is nothing to move yet; the shape
 * check is the useful part, and the version switch is here so that a future
 * change has an obvious home rather than being bolted on in a hurry.
 */
export function migrate(raw: unknown): GarageData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('That file does not contain a garage.')
  }
  const doc = raw as Record<string, unknown>

  // Guard against importing the wrong file entirely. A document with none of
  // these keys is not a garage, and quietly reading it as an empty one would
  // replace a season of data with nothing.
  const looksLikeAGarage =
    typeof doc.version === 'number' ||
    ['bikes', 'tyres', 'presets', 'trackDays', 'sessions'].some((key) => key in doc)
  if (!looksLikeAGarage) return fail('That file does not contain a garage.')

  const version = typeof doc.version === 'number' ? doc.version : 0
  if (version > SCHEMA_VERSION) {
    return fail(
      `This file was written by a newer version of the app (schema ${version}). Update before importing it.`,
    )
  }

  const base = createEmptyGarage()
  const data: GarageData = {
    version: SCHEMA_VERSION,
    bikes: asArray(doc.bikes),
    tyres: asArray(doc.tyres),
    presets: asArray(doc.presets),
    trackDays: asArray(doc.trackDays),
    sessions: asArray(doc.sessions),
    preferences: mergePreferences(base.preferences, doc.preferences),
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
  }

  for (const bike of data.bikes) {
    if (!bike || typeof bike.id !== 'string') return fail('One of the bikes in this file has no id.')
  }
  return data
}

function mergePreferences(base: Preferences, raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return base
  const incoming = raw as Partial<Preferences>
  return {
    pressureUnit: incoming.pressureUnit ?? base.pressureUnit,
    temperatureUnit: incoming.temperatureUnit ?? base.temperatureUnit,
    massUnit: incoming.massUnit ?? base.massUnit,
    targetHotPressure: {
      front: incoming.targetHotPressure?.front ?? base.targetHotPressure.front,
      rear: incoming.targetHotPressure?.rear ?? base.targetHotPressure.rear,
    },
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function fail(message: string): never {
  throw new ImportError(message)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Sessions for one track day, in the order they were run. */
export function sessionsForDay(data: GarageData, trackDayId: string): Session[] {
  return data.sessions
    .filter((session) => session.trackDayId === trackDayId)
    .sort((a, b) => a.number - b.number)
}

/** Track days newest first. */
export function trackDaysByDate(data: GarageData): TrackDay[] {
  return [...data.trackDays].sort((a, b) => b.date.localeCompare(a.date))
}

/** The session immediately before this one on the same day, if any. */
export function previousSession(data: GarageData, session: Session): Session | undefined {
  const siblings = sessionsForDay(data, session.trackDayId)
  const index = siblings.findIndex((candidate) => candidate.id === session.id)
  return index > 0 ? siblings[index - 1] : undefined
}

/** A `StorageLike` backed by a plain object, for tests and Node scripts. */
export function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const store = new Map(Object.entries(seed))
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  }
}
