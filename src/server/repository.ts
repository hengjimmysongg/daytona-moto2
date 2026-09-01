/**
 * Reading and writing the log book.
 *
 * Rows in, domain objects out. The mapping lives here alone so that the
 * router never touches SQL and the calculators in `src/core` never learn
 * that a database exists.
 *
 * Updates are read-modify-write rather than generated partial UPDATE
 * statements: a log book is small, the merge rules live in one readable
 * place, and a PATCH that only mentions two fields cannot accidentally
 * blank out the rest.
 */

import type { Row } from '@libsql/client'
import {
  fromBool,
  nullable,
  toBool,
  toJson,
  toNumber,
  toText,
  type Db,
} from './db.js'
import type {
  Bike,
  ForkSpec,
  GarageData,
  Preferences,
  SagTargets,
  Session,
  ShockSpec,
  TrackDay,
  Tyre,
  TyreModel,
  TyreRun,
  TyreWear,
} from '../core/types.js'
import { SCHEMA_VERSION } from '../core/types.js'
import { defaultPreferences } from '../core/storage.js'

/* ------------------------------------------------------------------ */
/* Bikes                                                               */
/* ------------------------------------------------------------------ */

function rowToBike(row: Row): Bike {
  return {
    id: String(row.id),
    name: String(row.name),
    ...optional('make', toText(row.make)),
    ...optional('model', toText(row.model)),
    ...optional('year', toNumber(row.year)),
    ...optional('riderWeightKg', toNumber(row.rider_weight_kg)),
    fork: toJson<ForkSpec>(row.fork, {
      compression: { range: 0, unit: 'clicks' },
      rebound: { range: 0, unit: 'clicks' },
      preload: { range: 0, unit: 'turns' },
    }),
    shock: toJson<ShockSpec>(row.shock, {
      compressionLow: { range: 0, unit: 'clicks' },
      rebound: { range: 0, unit: 'clicks' },
      preload: { range: 0, unit: 'turns' },
    }),
    sagTargets: toJson<SagTargets>(row.sag_targets, {
      frontRider: [30, 35],
      frontFree: [25, 30],
      rearRider: [25, 30],
      rearFree: [5, 10],
    }),
    ...optional('notes', toText(row.notes)),
    createdAt: Number(row.created_at),
  }
}

const BIKE_UPSERT = `
  INSERT INTO bikes (id, garage_id, name, make, model, year, rider_weight_kg,
                     fork, shock, sag_targets, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, make = excluded.make, model = excluded.model,
    year = excluded.year, rider_weight_kg = excluded.rider_weight_kg,
    fork = excluded.fork, shock = excluded.shock,
    sag_targets = excluded.sag_targets, notes = excluded.notes`

function bikeArgs(garageId: string, bike: Bike) {
  return [
    bike.id,
    garageId,
    bike.name,
    nullable(bike.make),
    nullable(bike.model),
    nullable(bike.year),
    nullable(bike.riderWeightKg),
    JSON.stringify(bike.fork),
    JSON.stringify(bike.shock),
    JSON.stringify(bike.sagTargets),
    nullable(bike.notes),
    bike.createdAt,
  ]
}

export async function listBikes(db: Db, garageId: string): Promise<Bike[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM bikes WHERE garage_id = ? ORDER BY created_at',
    args: [garageId],
  })
  return result.rows.map(rowToBike)
}

export async function getBike(db: Db, garageId: string, id: string): Promise<Bike | undefined> {
  const result = await db.execute({
    sql: 'SELECT * FROM bikes WHERE garage_id = ? AND id = ?',
    args: [garageId, id],
  })
  const row = result.rows[0]
  return row ? rowToBike(row) : undefined
}

export async function saveBike(db: Db, garageId: string, bike: Bike): Promise<Bike> {
  await db.execute({ sql: BIKE_UPSERT, args: bikeArgs(garageId, bike) })
  return bike
}

/* ------------------------------------------------------------------ */
/* Track days                                                          */
/* ------------------------------------------------------------------ */

function rowToTrackDay(row: Row): TrackDay {
  return {
    id: String(row.id),
    bikeId: String(row.bike_id),
    date: String(row.date),
    circuit: String(row.circuit),
    ...optional('layout', toText(row.layout)),
    ...optional('organiser', toText(row.organiser)),
    ...optional('notes', toText(row.notes)),
    createdAt: Number(row.created_at),
  }
}

const TRACK_DAY_UPSERT = `
  INSERT INTO track_days (id, garage_id, bike_id, date, circuit, layout, organiser, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    bike_id = excluded.bike_id, date = excluded.date, circuit = excluded.circuit,
    layout = excluded.layout, organiser = excluded.organiser, notes = excluded.notes`

function trackDayArgs(garageId: string, day: TrackDay) {
  return [
    day.id,
    garageId,
    day.bikeId,
    day.date,
    day.circuit,
    nullable(day.layout),
    nullable(day.organiser),
    nullable(day.notes),
    day.createdAt,
  ]
}

export async function listTrackDays(db: Db, garageId: string): Promise<TrackDay[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM track_days WHERE garage_id = ? ORDER BY date DESC, created_at DESC',
    args: [garageId],
  })
  return result.rows.map(rowToTrackDay)
}

export async function getTrackDay(
  db: Db,
  garageId: string,
  id: string,
): Promise<TrackDay | undefined> {
  const result = await db.execute({
    sql: 'SELECT * FROM track_days WHERE garage_id = ? AND id = ?',
    args: [garageId, id],
  })
  const row = result.rows[0]
  return row ? rowToTrackDay(row) : undefined
}

export async function saveTrackDay(db: Db, garageId: string, day: TrackDay): Promise<TrackDay> {
  await db.execute({ sql: TRACK_DAY_UPSERT, args: trackDayArgs(garageId, day) })
  return day
}

/* ------------------------------------------------------------------ */
/* Tyres                                                               */
/* ------------------------------------------------------------------ */

function rowToTyre(row: Row): Tyre {
  const model: TyreModel = {
    make: String(row.make),
    model: String(row.model),
    ...optional('compound', toText(row.compound)),
    ...optional('size', toText(row.size)),
    ...(row.slick === null || row.slick === undefined ? {} : { slick: toBool(row.slick) }),
  }
  return {
    id: String(row.id),
    axle: row.axle === 'rear' ? 'rear' : 'front',
    model,
    ...optional('label', toText(row.label)),
    sessions: Number(row.sessions ?? 0),
    heatCycles: Number(row.heat_cycles ?? 0),
    ...(toBool(row.retired) ? { retired: true } : {}),
    ...optional('notes', toText(row.notes)),
    createdAt: Number(row.created_at),
  }
}

const TYRE_UPSERT = `
  INSERT INTO tyres (id, garage_id, axle, make, model, compound, size, slick,
                     label, sessions, heat_cycles, retired, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    axle = excluded.axle, make = excluded.make, model = excluded.model,
    compound = excluded.compound, size = excluded.size, slick = excluded.slick,
    label = excluded.label, sessions = excluded.sessions,
    heat_cycles = excluded.heat_cycles, retired = excluded.retired, notes = excluded.notes`

function tyreArgs(garageId: string, tyre: Tyre) {
  return [
    tyre.id,
    garageId,
    tyre.axle,
    tyre.model.make,
    tyre.model.model,
    nullable(tyre.model.compound),
    nullable(tyre.model.size),
    fromBool(tyre.model.slick),
    nullable(tyre.label),
    tyre.sessions,
    tyre.heatCycles,
    tyre.retired ? 1 : 0,
    nullable(tyre.notes),
    tyre.createdAt,
  ]
}

export async function listTyres(db: Db, garageId: string): Promise<Tyre[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM tyres WHERE garage_id = ? ORDER BY created_at',
    args: [garageId],
  })
  return result.rows.map(rowToTyre)
}

export async function getTyre(db: Db, garageId: string, id: string): Promise<Tyre | undefined> {
  const result = await db.execute({
    sql: 'SELECT * FROM tyres WHERE garage_id = ? AND id = ?',
    args: [garageId, id],
  })
  const row = result.rows[0]
  return row ? rowToTyre(row) : undefined
}

export async function saveTyre(db: Db, garageId: string, tyre: Tyre): Promise<Tyre> {
  await db.execute({ sql: TYRE_UPSERT, args: tyreArgs(garageId, tyre) })
  return tyre
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function tyreRun(row: Row, prefix: 'front' | 'rear'): TyreRun {
  const model = toJson<TyreModel | null>(row[`${prefix}_tyre_model`], null)
  return {
    ...optional('tyreId', toText(row[`${prefix}_tyre_id`])),
    ...(model ? { model } : {}),
    ...optional('coldPressure', toNumber(row[`${prefix}_cold`])),
    ...optional('coldAtAmbient', toNumber(row[`${prefix}_cold_ambient`])),
    ...optional('hotPressure', toNumber(row[`${prefix}_hot`])),
    ...optional('warmerTemp', toNumber(row[`${prefix}_warmer_temp`])),
    ...optional('surfaceTemp', toNumber(row[`${prefix}_surface_temp`])),
    ...optional('wear', toText(row[`${prefix}_wear`]) as TyreWear | undefined),
  }
}

function rowToSession(row: Row): Session {
  const sag = {
    ...optional('frontRider', toNumber(row.sag_front_rider)),
    ...optional('frontFree', toNumber(row.sag_front_free)),
    ...optional('rearRider', toNumber(row.sag_rear_rider)),
    ...optional('rearFree', toNumber(row.sag_rear_free)),
  }
  return {
    id: String(row.id),
    trackDayId: String(row.track_day_id),
    number: Number(row.number),
    ...optional('startedAt', toNumber(row.started_at)),
    ...optional('laps', toNumber(row.laps)),
    ...optional('bestLap', toNumber(row.best_lap)),
    ...optional('averageLap', toNumber(row.average_lap)),
    conditions: {
      ...optional('ambientTemp', toNumber(row.ambient_temp)),
      ...optional('trackTemp', toNumber(row.track_temp)),
      ...optional('condition', toText(row.condition) as Session['conditions']['condition']),
      ...(row.windy === null || row.windy === undefined ? {} : { windy: toBool(row.windy) }),
      ...optional('notes', toText(row.conditions_notes)),
    },
    setup: {
      fork: {
        ...optional('compression', toNumber(row.fork_compression)),
        ...optional('rebound', toNumber(row.fork_rebound)),
        ...optional('preload', toNumber(row.fork_preload)),
        ...optional('height', toNumber(row.fork_height)),
        ...optional('oilHeight', toNumber(row.fork_oil_height)),
      },
      shock: {
        ...optional('compressionLow', toNumber(row.shock_compression_low)),
        ...optional('compressionHigh', toNumber(row.shock_compression_high)),
        ...optional('rebound', toNumber(row.shock_rebound)),
        ...optional('preload', toNumber(row.shock_preload)),
        ...optional('rideHeight', toNumber(row.shock_ride_height)),
      },
      ...(Object.keys(sag).length > 0 ? { sag } : {}),
    },
    tyres: { front: tyreRun(row, 'front'), rear: tyreRun(row, 'rear') },
    feedback: toJson<string[]>(row.feedback, []),
    ...optional('notes', toText(row.notes)),
    ...optional('changesMade', toText(row.changes_made)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

const SESSION_COLUMNS = [
  'id', 'garage_id', 'track_day_id', 'number', 'started_at', 'laps', 'best_lap', 'average_lap',
  'ambient_temp', 'track_temp', 'condition', 'windy', 'conditions_notes',
  'fork_compression', 'fork_rebound', 'fork_preload', 'fork_height', 'fork_oil_height',
  'shock_compression_low', 'shock_compression_high', 'shock_rebound', 'shock_preload',
  'shock_ride_height',
  'sag_front_rider', 'sag_front_free', 'sag_rear_rider', 'sag_rear_free',
  'front_tyre_id', 'front_tyre_model', 'front_cold', 'front_cold_ambient', 'front_hot',
  'front_warmer_temp', 'front_surface_temp', 'front_wear',
  'rear_tyre_id', 'rear_tyre_model', 'rear_cold', 'rear_cold_ambient', 'rear_hot',
  'rear_warmer_temp', 'rear_surface_temp', 'rear_wear',
  'feedback', 'notes', 'changes_made', 'created_at', 'updated_at',
] as const

const SESSION_UPSERT = `
  INSERT INTO sessions (${SESSION_COLUMNS.join(', ')})
  VALUES (${SESSION_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT(id) DO UPDATE SET ${SESSION_COLUMNS
    .filter((column) => column !== 'id' && column !== 'garage_id' && column !== 'created_at')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')}`

function sessionArgs(garageId: string, session: Session) {
  const { setup, tyres, conditions } = session
  const sag = setup.sag ?? {}
  return [
    session.id,
    garageId,
    session.trackDayId,
    session.number,
    nullable(session.startedAt),
    nullable(session.laps),
    nullable(session.bestLap),
    nullable(session.averageLap),

    nullable(conditions.ambientTemp),
    nullable(conditions.trackTemp),
    nullable(conditions.condition),
    fromBool(conditions.windy),
    nullable(conditions.notes),

    nullable(setup.fork.compression),
    nullable(setup.fork.rebound),
    nullable(setup.fork.preload),
    nullable(setup.fork.height),
    nullable(setup.fork.oilHeight),
    nullable(setup.shock.compressionLow),
    nullable(setup.shock.compressionHigh),
    nullable(setup.shock.rebound),
    nullable(setup.shock.preload),
    nullable(setup.shock.rideHeight),

    nullable(sag.frontRider),
    nullable(sag.frontFree),
    nullable(sag.rearRider),
    nullable(sag.rearFree),

    ...tyreRunArgs(tyres.front),
    ...tyreRunArgs(tyres.rear),

    JSON.stringify(session.feedback ?? []),
    nullable(session.notes),
    nullable(session.changesMade),
    session.createdAt,
    session.updatedAt,
  ]
}

function tyreRunArgs(run: TyreRun) {
  return [
    nullable(run.tyreId),
    run.model ? JSON.stringify(run.model) : null,
    nullable(run.coldPressure),
    nullable(run.coldAtAmbient),
    nullable(run.hotPressure),
    nullable(run.warmerTemp),
    nullable(run.surfaceTemp),
    nullable(run.wear),
  ]
}

export async function listSessions(
  db: Db,
  garageId: string,
  filter: { trackDayId?: string } = {},
): Promise<Session[]> {
  const result = filter.trackDayId
    ? await db.execute({
        sql: 'SELECT * FROM sessions WHERE garage_id = ? AND track_day_id = ? ORDER BY number',
        args: [garageId, filter.trackDayId],
      })
    : await db.execute({
        sql: 'SELECT * FROM sessions WHERE garage_id = ? ORDER BY track_day_id, number',
        args: [garageId],
      })
  return result.rows.map(rowToSession)
}

export async function getSession(
  db: Db,
  garageId: string,
  id: string,
): Promise<Session | undefined> {
  const result = await db.execute({
    sql: 'SELECT * FROM sessions WHERE garage_id = ? AND id = ?',
    args: [garageId, id],
  })
  const row = result.rows[0]
  return row ? rowToSession(row) : undefined
}

export async function saveSession(db: Db, garageId: string, session: Session): Promise<Session> {
  await db.execute({ sql: SESSION_UPSERT, args: sessionArgs(garageId, session) })
  return session
}

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

/** When this garage was last written, by anything. */
export async function getGarageUpdatedAt(db: Db, garageId: string): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT updated_at FROM preferences WHERE garage_id = ?',
    args: [garageId],
  })
  return toNumber(result.rows[0]?.updated_at) ?? 0
}

export async function getPreferences(db: Db, garageId: string): Promise<Preferences> {
  const result = await db.execute({
    sql: 'SELECT * FROM preferences WHERE garage_id = ?',
    args: [garageId],
  })
  const row = result.rows[0]
  if (!row) return defaultPreferences()
  const base = defaultPreferences()
  return {
    pressureUnit: (toText(row.pressure_unit) as Preferences['pressureUnit']) ?? base.pressureUnit,
    temperatureUnit:
      (toText(row.temperature_unit) as Preferences['temperatureUnit']) ?? base.temperatureUnit,
    massUnit: (toText(row.mass_unit) as Preferences['massUnit']) ?? base.massUnit,
    targetHotPressure: {
      front: toNumber(row.target_hot_front) ?? base.targetHotPressure.front,
      rear: toNumber(row.target_hot_rear) ?? base.targetHotPressure.rear,
    },
  }
}

export async function savePreferences(
  db: Db,
  garageId: string,
  preferences: Preferences,
  updatedAt: number = Date.now(),
): Promise<Preferences> {
  await db.execute({
    sql: `INSERT INTO preferences (garage_id, pressure_unit, temperature_unit, mass_unit,
                                   target_hot_front, target_hot_rear, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(garage_id) DO UPDATE SET
            pressure_unit = excluded.pressure_unit,
            temperature_unit = excluded.temperature_unit,
            mass_unit = excluded.mass_unit,
            target_hot_front = excluded.target_hot_front,
            target_hot_rear = excluded.target_hot_rear,
            updated_at = excluded.updated_at`,
    args: [
      garageId,
      preferences.pressureUnit,
      preferences.temperatureUnit,
      preferences.massUnit,
      preferences.targetHotPressure.front,
      preferences.targetHotPressure.rear,
      updatedAt,
    ],
  })
  return preferences
}

/* ------------------------------------------------------------------ */
/* Deleting                                                            */
/* ------------------------------------------------------------------ */

const TABLES = ['bikes', 'track_days', 'tyres', 'sessions'] as const
export type Table = (typeof TABLES)[number]

export async function deleteRow(
  db: Db,
  garageId: string,
  table: Table,
  id: string,
): Promise<boolean> {
  const result = await db.execute({
    sql: `DELETE FROM ${table} WHERE garage_id = ? AND id = ?`,
    args: [garageId, id],
  })
  return result.rowsAffected > 0
}

/**
 * Deleting a track day takes its sessions with it. Sessions are meaningless
 * without the day they were run on, and leaving them behind would quietly
 * grow a pile of rows nothing can reach.
 */
export async function deleteTrackDayCascade(
  db: Db,
  garageId: string,
  id: string,
): Promise<boolean> {
  const results = await db.batch(
    [
      { sql: 'DELETE FROM sessions WHERE garage_id = ? AND track_day_id = ?', args: [garageId, id] },
      { sql: 'DELETE FROM track_days WHERE garage_id = ? AND id = ?', args: [garageId, id] },
    ],
    'write',
  )
  return (results[1]?.rowsAffected ?? 0) > 0
}

/* ------------------------------------------------------------------ */
/* Whole-garage snapshot                                               */
/* ------------------------------------------------------------------ */

/**
 * The whole garage, with a timestamp the browser can compare against its own.
 *
 * `updatedAt` is the high-water mark of the last client push (kept on the
 * preferences row) and every row's own stamp. Both halves are needed: the
 * push stamp lets a client recognise its own writes coming back and settle,
 * while the row stamps mean a session inserted straight through the REST
 * API still reads as newer and gets pulled down.
 */
export async function getSnapshot(db: Db, garageId: string): Promise<GarageData> {
  const [bikes, trackDays, tyres, sessions, preferences, pushedAt] = await Promise.all([
    listBikes(db, garageId),
    listTrackDays(db, garageId),
    listTyres(db, garageId),
    listSessions(db, garageId),
    getPreferences(db, garageId),
    getGarageUpdatedAt(db, garageId),
  ])
  const updatedAt = Math.max(
    0,
    pushedAt,
    ...sessions.map((session) => session.updatedAt),
    ...trackDays.map((day) => day.createdAt),
    ...bikes.map((bike) => bike.createdAt),
    ...tyres.map((tyre) => tyre.createdAt),
  )
  return {
    version: SCHEMA_VERSION,
    bikes,
    tyres,
    presets: [],
    trackDays,
    sessions,
    preferences,
    updatedAt,
  }
}

/**
 * Replace everything in one garage.
 *
 * This is what the web client pushes when it syncs. It runs as a single
 * write transaction: rows that are gone from the incoming document are
 * deleted, and everything else is upserted, so a half-applied sync cannot
 * leave a session pointing at a track day that no longer exists.
 */
export async function putSnapshot(
  db: Db,
  garageId: string,
  data: GarageData,
  now: number = Date.now(),
): Promise<GarageData> {
  const keep = (table: Table, ids: string[]) =>
    ids.length === 0
      ? { sql: `DELETE FROM ${table} WHERE garage_id = ?`, args: [garageId] }
      : {
          sql: `DELETE FROM ${table} WHERE garage_id = ? AND id NOT IN (${ids
            .map(() => '?')
            .join(', ')})`,
          args: [garageId, ...ids],
        }

  await db.batch(
    [
      keep('sessions', data.sessions.map((session) => session.id)),
      keep('track_days', data.trackDays.map((day) => day.id)),
      keep('tyres', data.tyres.map((tyre) => tyre.id)),
      keep('bikes', data.bikes.map((bike) => bike.id)),
      ...data.bikes.map((bike) => ({ sql: BIKE_UPSERT, args: bikeArgs(garageId, bike) })),
      ...data.trackDays.map((day) => ({
        sql: TRACK_DAY_UPSERT,
        args: trackDayArgs(garageId, day),
      })),
      ...data.tyres.map((tyre) => ({ sql: TYRE_UPSERT, args: tyreArgs(garageId, tyre) })),
      ...data.sessions.map((session) => ({
        sql: SESSION_UPSERT,
        args: sessionArgs(garageId, session),
      })),
    ],
    'write',
  )
  await savePreferences(db, garageId, data.preferences, Math.max(data.updatedAt, now))
  return getSnapshot(db, garageId)
}

/* ------------------------------------------------------------------ */

/** Include a key only when it has a value, so `exactOptionalPropertyTypes`-
 *  style optional fields stay absent rather than becoming `undefined`. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}
