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

import type { Client, InValue } from '@libsql/client'

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

/** The schemes a database somewhere else is reached over. */
const REMOTE_SCHEMES = ['libsql:', 'https:', 'http:', 'wss:', 'ws:']

/**
 * Is this database over the network rather than on this disk?
 *
 * Two things turn on the answer: which half of the driver can serve it, and
 * whether a deployment has been given a real database at all.
 */
export function isRemoteUrl(url: string): boolean {
  const scheme = url.toLowerCase()
  return REMOTE_SCHEMES.some((remote) => scheme.startsWith(remote))
}

/**
 * Open a connection, loading only the half of the driver that can serve it.
 *
 * `@libsql/client` ships two builds. The default one embeds SQLite as a
 * native binary, which is what reads a local file. The `web` one speaks
 * HTTP and nothing else, which is all a hosted database needs.
 *
 * Choosing between them at runtime, by URL, is what makes this deployable
 * without ceremony: a serverless bundle that never evaluates the native
 * build cannot be broken by it — no binary to trace, unpack, or match to
 * the host's libc, and a shorter cold start for not trying.
 */
export async function createDb(config: DbConfig): Promise<Db> {
  if (isRemoteUrl(config.url)) {
    const { createClient } = await import('@libsql/client/web')
    return createClient(config)
  }
  const { createClient } = await import('@libsql/client')
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
  // Accounts. A user's id *is* their garage id, so every table below is
  // already scoped to its owner and nothing else had to change to make the
  // log private per person.
  `CREATE TABLE IF NOT EXISTS users (
     id            TEXT PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   )`,

  // The token itself is never here — only its SHA-256 — so a dump of this
  // table cannot be replayed as a set of live sign-ins.
  `CREATE TABLE IF NOT EXISTS auth_tokens (
     token_hash TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens (user_id)`,

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

interface Connection {
  key: string
  db: Promise<Db>
  ready: Promise<void>
}

let cached: Connection | null = null

/**
 * The database for this process, migrated once.
 *
 * A warm serverless container serves many requests, so both the connection
 * and the one-off migration are held in module scope. Both are stored as
 * promises rather than values so that concurrent first requests wait on the
 * same run instead of racing to create the same tables.
 */
export async function getDb(env: Record<string, string | undefined> = process.env): Promise<Db> {
  const config = readDbConfig(env)
  const key = `${config.url}|${config.authToken ?? ''}`
  const connection = cached?.key === key ? cached : open(config, key)
  await connection.ready
  return connection.db
}

function open(config: DbConfig, key: string): Connection {
  const db = createDb(config)
  const connection: Connection = { key, db, ready: db.then(migrate) }
  cached = connection
  // An unreachable database at cold start must not follow the container
  // around for the rest of its life. Forget a failed attempt so the next
  // request makes a fresh one instead of replaying the same error.
  connection.ready.catch(() => {
    if (cached === connection) cached = null
  })
  return connection
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
