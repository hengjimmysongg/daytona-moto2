/**
 * The SQLite database.
 *
 * One driver, two homes. libSQL speaks SQLite over a local file during
 * development and over HTTP to a hosted database in production, so the
 * schema, the SQL and the tests are the same in both places.
 *
 * That split is not a preference, it is a constraint: a serverless function
 * gets a container that is thrown away, with a filesystem to match. A plain
 * SQLite file written inside one is gone by the next request and invisible
 * to every other concurrently running instance. Turso is the same engine
 * with somewhere durable to keep the file.
 */

import { createClient, type Client, type InValue } from '@libsql/client'

export type Db = Client

/** Where the database lives when nothing is configured: a real local file. */
export const DEFAULT_LOCAL_URL = 'file:./data/tracker.db'

export interface DbConfig {
  url: string
  authToken?: string
}

export function readDbConfig(env: Record<string, string | undefined>): DbConfig {
  const url = env.TURSO_DATABASE_URL ?? env.DATABASE_URL ?? DEFAULT_LOCAL_URL
  const authToken = env.TURSO_AUTH_TOKEN
  return authToken ? { url, authToken } : { url }
}

export function createDb(config: DbConfig): Db {
  return createClient(config)
}

/**
 * The schema.
 *
 * Session numbers are the queryable part of this app — the whole point of
 * putting a log book in a database is being able to ask "what was the fork
 * doing on the sessions that went quickest" — so every adjuster and every
 * pressure gets its own column rather than hiding in a JSON blob.
 *
 * The blobs that remain are the ones nothing sorts or filters on: a bike's
 * adjuster ranges, its sag windows, and the list of feedback codes, which is
 * genuinely a list.
 *
 * Every row is scoped by `garage_id`, which is the unit of ownership.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bikes (
     id              TEXT PRIMARY KEY,
     garage_id       TEXT NOT NULL,
     name            TEXT NOT NULL,
     make            TEXT,
     model           TEXT,
     year            INTEGER,
     rider_weight_kg REAL,
     fork            TEXT NOT NULL,
     shock           TEXT NOT NULL,
     sag_targets     TEXT NOT NULL,
     notes           TEXT,
     created_at      INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS bikes_garage ON bikes (garage_id)`,

  `CREATE TABLE IF NOT EXISTS track_days (
     id         TEXT PRIMARY KEY,
     garage_id  TEXT NOT NULL,
     bike_id    TEXT NOT NULL,
     date       TEXT NOT NULL,
     circuit    TEXT NOT NULL,
     layout     TEXT,
     organiser  TEXT,
     notes      TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS track_days_garage ON track_days (garage_id, date)`,

  `CREATE TABLE IF NOT EXISTS tyres (
     id          TEXT PRIMARY KEY,
     garage_id   TEXT NOT NULL,
     axle        TEXT NOT NULL CHECK (axle IN ('front', 'rear')),
     make        TEXT NOT NULL,
     model       TEXT NOT NULL,
     compound    TEXT,
     size        TEXT,
     slick       INTEGER,
     label       TEXT,
     sessions    INTEGER NOT NULL DEFAULT 0,
     heat_cycles INTEGER NOT NULL DEFAULT 0,
     retired     INTEGER NOT NULL DEFAULT 0,
     notes       TEXT,
     created_at  INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS tyres_garage ON tyres (garage_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id           TEXT PRIMARY KEY,
     garage_id    TEXT NOT NULL,
     track_day_id TEXT NOT NULL,
     number       INTEGER NOT NULL,
     started_at   INTEGER,
     laps         INTEGER,
     best_lap     REAL,
     average_lap  REAL,

     ambient_temp REAL,
     track_temp   REAL,
     condition    TEXT,
     windy        INTEGER,
     conditions_notes TEXT,

     fork_compression   REAL,
     fork_rebound       REAL,
     fork_preload       REAL,
     fork_height        REAL,
     fork_oil_height    REAL,
     shock_compression_low  REAL,
     shock_compression_high REAL,
     shock_rebound      REAL,
     shock_preload      REAL,
     shock_ride_height  REAL,

     sag_front_rider REAL,
     sag_front_free  REAL,
     sag_rear_rider  REAL,
     sag_rear_free   REAL,

     front_tyre_id       TEXT,
     front_tyre_model    TEXT,
     front_cold          REAL,
     front_cold_ambient  REAL,
     front_hot           REAL,
     front_warmer_temp   REAL,
     front_surface_temp  REAL,
     front_wear          TEXT,

     rear_tyre_id       TEXT,
     rear_tyre_model    TEXT,
     rear_cold          REAL,
     rear_cold_ambient  REAL,
     rear_hot           REAL,
     rear_warmer_temp   REAL,
     rear_surface_temp  REAL,
     rear_wear          TEXT,

     feedback     TEXT NOT NULL DEFAULT '[]',
     notes        TEXT,
     changes_made TEXT,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_garage ON sessions (garage_id, track_day_id, number)`,

  `CREATE TABLE IF NOT EXISTS preferences (
     garage_id        TEXT PRIMARY KEY,
     pressure_unit    TEXT NOT NULL,
     temperature_unit TEXT NOT NULL,
     mass_unit        TEXT NOT NULL,
     target_hot_front REAL NOT NULL,
     target_hot_rear  REAL NOT NULL,
     updated_at       INTEGER NOT NULL
   )`,
]

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) {
    await db.execute(statement)
  }
}

/* ------------------------------------------------------------------ */
/* Connection reuse                                                    */
/* ------------------------------------------------------------------ */

interface Cached {
  db: Db
  ready: Promise<void>
  key: string
}

let cached: Cached | null = null

/**
 * The database for this process, migrated once.
 *
 * A warm serverless container serves many requests, so both the connection
 * and the one-off migration are held in module scope. The migration is
 * stored as a promise rather than a flag so that concurrent first requests
 * wait on the same run instead of racing to create the same tables.
 *
 * A *failed* migration is not kept. Against a local file that distinction
 * never comes up, but the first request into a cold container runs the
 * schema over the network, against a hosted database that may still be
 * waking up — precisely the moment a call is most likely to fail. Caching
 * that rejection would hand every later request the same stale error for as
 * long as the container lives, leaving the site broken while the database is
 * perfectly healthy. Dropping it costs one retry and cures itself.
 */
export async function getDb(env: Record<string, string | undefined> = process.env): Promise<Db> {
  const config = readDbConfig(env)
  const key = `${config.url}|${config.authToken ?? ''}`
  if (!cached || cached.key !== key) {
    const db = createDb(config)
    const entry: Cached = { db, key, ready: Promise.resolve() }
    // The rejection handler is attached after `entry` exists so it can
    // recognise its own cache slot: by the time a failure lands, a later
    // request may already have replaced it, and clearing someone else's
    // connection would undo a recovery that has already succeeded.
    entry.ready = migrate(db).catch((error: unknown) => {
      if (cached === entry) cached = null
      throw error
    })
    cached = entry
  }
  const active = cached
  await active.ready
  return active.db
}

/** Drop the cached connection. Tests use this; nothing else should need it. */
export function resetDbCache(): void {
  cached = null
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** SQLite has no boolean type; it stores 0 and 1. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true
}

export function fromBool(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0
}

export function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** JSON columns, parsed defensively — a bad row must not take the API down. */
export function toJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function nullable(value: unknown): InValue {
  return value === undefined ? null : (value as InValue)
}
