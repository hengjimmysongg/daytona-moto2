/**
 * Between Postgres rows and the domain model.
 *
 * The split is the one the schema makes: anything a rider would sort or
 * filter on -- every adjuster, every pressure, every temperature -- is its
 * own column, so the log is queryable in SQL and not just in this app. Only
 * what nothing queries on stays as jsonb: a bike's adjuster ranges, its sag
 * windows, and the list of feedback codes, which is genuinely a list.
 *
 * Units are canonical on both sides: bar, °C, mm, kg. What the rider reads
 * is a display preference and never reaches the database.
 */

import { EMPTY_SETUP } from '../core/types.js'
import type {
  Bike,
  ForkSpec,
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
import type { MassUnit, PressureUnit, TemperatureUnit } from '../core/units.js'

/** A row as PostgREST hands it back. */
export type Row = Record<string, unknown>

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** jsonb, read defensively: one bad row must not blank the whole log. */
function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

/** Drop the keys that are `undefined`, which Postgres wants as null. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

export function toBike(row: Row): Bike {
  return {
    id: String(row.id),
    name: String(row.name),
    ...defined({
      make: text(row.make),
      model: text(row.model),
      year: num(row.year),
      riderWeightKg: num(row.rider_weight_kg),
      notes: text(row.notes),
    }),
    fork: json<ForkSpec>(row.fork, {} as ForkSpec),
    shock: json<ShockSpec>(row.shock, {} as ShockSpec),
    sagTargets: json<SagTargets>(row.sag_targets, {} as SagTargets),
    createdAt: Number(row.created_at),
  }
}

export function toTyre(row: Row): Tyre {
  const model: TyreModel = {
    make: String(row.make),
    model: String(row.model),
    ...defined({
      compound: text(row.compound),
      size: text(row.size),
      slick: bool(row.slick),
    }),
  }
  return {
    id: String(row.id),
    axle: row.axle === 'rear' ? 'rear' : 'front',
    model,
    sessions: Number(row.sessions ?? 0),
    heatCycles: Number(row.heat_cycles ?? 0),
    ...defined({
      label: text(row.label),
      retired: bool(row.retired),
      notes: text(row.notes),
    }),
    createdAt: Number(row.created_at),
  }
}

export function toTrackDay(row: Row): TrackDay {
  return {
    id: String(row.id),
    bikeId: String(row.bike_id ?? ''),
    date: String(row.date),
    circuit: String(row.circuit),
    ...defined({
      layout: text(row.layout),
      organiser: text(row.organiser),
      notes: text(row.notes),
    }),
    createdAt: Number(row.created_at),
  }
}

function toTyreRun(row: Row, side: 'front' | 'rear'): TyreRun {
  return defined({
    tyreId: text(row[`${side}_tyre_id`]),
    model: json<TyreModel | undefined>(row[`${side}_tyre_model`], undefined),
    coldPressure: num(row[`${side}_cold`]),
    coldAtAmbient: num(row[`${side}_cold_ambient`]),
    hotPressure: num(row[`${side}_hot`]),
    warmerTemp: num(row[`${side}_warmer_temp`]),
    surfaceTemp: num(row[`${side}_surface_temp`]),
    wear: text(row[`${side}_wear`]) as TyreWear | undefined,
  })
}

export function toSession(row: Row): Session {
  const sag = defined({
    frontRider: num(row.sag_front_rider),
    frontFree: num(row.sag_front_free),
    rearRider: num(row.sag_rear_rider),
    rearFree: num(row.sag_rear_free),
  })
  return {
    id: String(row.id),
    trackDayId: String(row.track_day_id),
    number: Number(row.number),
    ...defined({
      startedAt: num(row.started_at),
      laps: num(row.laps),
      bestLap: num(row.best_lap),
      averageLap: num(row.average_lap),
      notes: text(row.notes),
      changesMade: text(row.changes_made),
    }),
    conditions: defined({
      ambientTemp: num(row.ambient_temp),
      trackTemp: num(row.track_temp),
      condition: text(row.condition) as Session['conditions']['condition'],
      windy: bool(row.windy),
      notes: text(row.conditions_notes),
    }),
    setup: {
      fork: defined({
        compression: num(row.fork_compression),
        rebound: num(row.fork_rebound),
        preload: num(row.fork_preload),
        height: num(row.fork_height),
        oilHeight: num(row.fork_oil_height),
      }),
      shock: defined({
        compressionLow: num(row.shock_compression_low),
        compressionHigh: num(row.shock_compression_high),
        rebound: num(row.shock_rebound),
        preload: num(row.shock_preload),
        rideHeight: num(row.shock_ride_height),
      }),
      ...(Object.keys(sag).length > 0 ? { sag } : {}),
    },
    tyres: { front: toTyreRun(row, 'front'), rear: toTyreRun(row, 'rear') },
    feedback: json<string[]>(row.feedback, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toPreferences(row: Row, fallback: Preferences): Preferences {
  return {
    pressureUnit: (text(row.pressure_unit) as PressureUnit) ?? fallback.pressureUnit,
    temperatureUnit: (text(row.temperature_unit) as TemperatureUnit) ?? fallback.temperatureUnit,
    massUnit: (text(row.mass_unit) as MassUnit) ?? fallback.massUnit,
    targetHotPressure: {
      front: num(row.target_hot_front) ?? fallback.targetHotPressure.front,
      rear: num(row.target_hot_rear) ?? fallback.targetHotPressure.rear,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * `null` rather than `undefined` throughout: an absent key leaves the old
 * value in place on an upsert, which would make clearing a field impossible.
 */
function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

export function fromBike(bike: Bike): Row {
  return {
    id: bike.id,
    name: bike.name,
    make: orNull(bike.make),
    model: orNull(bike.model),
    year: orNull(bike.year),
    rider_weight_kg: orNull(bike.riderWeightKg),
    fork: bike.fork,
    shock: bike.shock,
    sag_targets: bike.sagTargets,
    notes: orNull(bike.notes),
    created_at: bike.createdAt,
  }
}

export function fromTyre(tyre: Tyre): Row {
  return {
    id: tyre.id,
    axle: tyre.axle,
    make: tyre.model.make,
    model: tyre.model.model,
    compound: orNull(tyre.model.compound),
    size: orNull(tyre.model.size),
    slick: orNull(tyre.model.slick),
    label: orNull(tyre.label),
    sessions: tyre.sessions,
    heat_cycles: tyre.heatCycles,
    retired: tyre.retired ?? false,
    notes: orNull(tyre.notes),
    created_at: tyre.createdAt,
  }
}

export function fromTrackDay(day: TrackDay): Row {
  return {
    id: day.id,
    bike_id: day.bikeId === '' ? null : day.bikeId,
    date: day.date,
    circuit: day.circuit,
    layout: orNull(day.layout),
    organiser: orNull(day.organiser),
    notes: orNull(day.notes),
    created_at: day.createdAt,
  }
}

export function fromSession(session: Session): Row {
  const setup = session.setup ?? EMPTY_SETUP
  const sag = setup.sag ?? {}
  const side = (axle: 'front' | 'rear'): Row => {
    const run = session.tyres[axle]
    return {
      [`${axle}_tyre_id`]: orNull(run.tyreId),
      [`${axle}_tyre_model`]: orNull(run.model),
      [`${axle}_cold`]: orNull(run.coldPressure),
      [`${axle}_cold_ambient`]: orNull(run.coldAtAmbient),
      [`${axle}_hot`]: orNull(run.hotPressure),
      [`${axle}_warmer_temp`]: orNull(run.warmerTemp),
      [`${axle}_surface_temp`]: orNull(run.surfaceTemp),
      [`${axle}_wear`]: orNull(run.wear),
    }
  }
  return {
    id: session.id,
    track_day_id: session.trackDayId,
    number: session.number,
    started_at: orNull(session.startedAt),
    laps: orNull(session.laps),
    best_lap: orNull(session.bestLap),
    average_lap: orNull(session.averageLap),

    ambient_temp: orNull(session.conditions.ambientTemp),
    track_temp: orNull(session.conditions.trackTemp),
    condition: orNull(session.conditions.condition),
    windy: orNull(session.conditions.windy),
    conditions_notes: orNull(session.conditions.notes),

    fork_compression: orNull(setup.fork.compression),
    fork_rebound: orNull(setup.fork.rebound),
    fork_preload: orNull(setup.fork.preload),
    fork_height: orNull(setup.fork.height),
    fork_oil_height: orNull(setup.fork.oilHeight),
    shock_compression_low: orNull(setup.shock.compressionLow),
    shock_compression_high: orNull(setup.shock.compressionHigh),
    shock_rebound: orNull(setup.shock.rebound),
    shock_preload: orNull(setup.shock.preload),
    shock_ride_height: orNull(setup.shock.rideHeight),

    sag_front_rider: orNull(sag.frontRider),
    sag_front_free: orNull(sag.frontFree),
    sag_rear_rider: orNull(sag.rearRider),
    sag_rear_free: orNull(sag.rearFree),

    ...side('front'),
    ...side('rear'),

    feedback: session.feedback,
    notes: orNull(session.notes),
    changes_made: orNull(session.changesMade),
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

export function fromPreferences(prefs: Preferences, now: number): Row {
  return {
    pressure_unit: prefs.pressureUnit,
    temperature_unit: prefs.temperatureUnit,
    mass_unit: prefs.massUnit,
    target_hot_front: prefs.targetHotPressure.front,
    target_hot_rear: prefs.targetHotPressure.rear,
    updated_at: now,
  }
}
