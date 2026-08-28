/**
 * The domain model for a track day log book.
 *
 * Shape of the data, top down:
 *
 *   Bike            a machine, with the adjuster hardware that defines what
 *                   "3 clicks out" or "half a turn of preload" actually means
 *   TrackDay        one day at one circuit, on one bike
 *   Session         one time out on track: the setup you ran, the tyres and
 *                   pressures you ran them at, and what the bike did
 *
 * Every measurement is stored in the canonical units from `units.ts`
 * (bar / °C / mm / kg). The unit a rider prefers is a display preference
 * and lives in `Preferences`, never in the data itself.
 */

import type { LengthUnit, MassUnit, PressureUnit, TemperatureUnit } from './units'

/** Milliseconds since epoch. */
export type Timestamp = number

/** ISO date, `YYYY-MM-DD`, in the circuit's local calendar. */
export type IsoDate = string

export type Axle = 'front' | 'rear'

/* ------------------------------------------------------------------ */
/* Bike                                                                */
/* ------------------------------------------------------------------ */

/**
 * How a single adjuster behaves, so the app can validate a value and
 * translate between the units printed on the part and millimetres of spring
 * preload.
 */
export interface AdjusterSpec {
  /** Total clicks or turns available, counted from fully closed / fully in. */
  range: number
  /** `clicks` for damping needles, `turns` for threaded preload collars. */
  unit: 'clicks' | 'turns' | 'mm' | 'lines'
  /**
   * For preload adjusters only: millimetres of spring preload gained per
   * turn of the collar. This is the thread pitch of the adjuster.
   */
  mmPerTurn?: number
}

export interface ForkSpec {
  /** Spring rate in N/mm, per leg. */
  springRate?: number
  travel?: number
  compression: AdjusterSpec
  rebound: AdjusterSpec
  preload: AdjusterSpec
}

export interface ShockSpec {
  /** Spring rate in N/mm. */
  springRate?: number
  /** Rear wheel travel in mm. */
  travel?: number
  /**
   * Rear wheel travel divided by shock stroke. A millimetre of preload at
   * the shock moves rear wheel sag by roughly this much, so the app needs it
   * to turn "I want 4 mm less sag" into "turn the collar this far".
   * Typical sportbike linkage: 2.5–3.0.
   */
  motionRatio?: number
  compressionLow: AdjusterSpec
  compressionHigh?: AdjusterSpec
  rebound: AdjusterSpec
  preload: AdjusterSpec
}

/** Sag windows this bike is judged against, in mm of wheel travel. */
export interface SagTargets {
  frontRider: [number, number]
  frontFree: [number, number]
  rearRider: [number, number]
  rearFree: [number, number]
}

export interface Bike {
  id: string
  name: string
  make?: string
  model?: string
  year?: number
  /** Rider weight in full kit, in kg — the number sag is measured with. */
  riderWeightKg?: number
  fork: ForkSpec
  shock: ShockSpec
  sagTargets: SagTargets
  notes?: string
  createdAt: Timestamp
}

/* ------------------------------------------------------------------ */
/* Suspension setup                                                    */
/* ------------------------------------------------------------------ */

/**
 * A complete suspension setting.
 *
 * Damping values are **clicks out from fully closed** — screw the adjuster
 * all the way in (clockwise, gently, until it stops) and count back out.
 * That is the convention every manual and every suspension tech uses, and
 * mixing it up with "clicks from soft" is the single most common way a
 * setup sheet becomes worthless.
 *
 * Preload is **turns in from fully soft** for the same reason: it is
 * repeatable from a hard stop you can find in the pit lane.
 */
export interface SuspensionSetup {
  fork: {
    compression?: number
    rebound?: number
    preload?: number
    /** mm of fork tube showing above the top triple clamp. */
    height?: number
    oilHeight?: number
  }
  shock: {
    compressionLow?: number
    compressionHigh?: number
    rebound?: number
    preload?: number
    /** Ride height, mm — length of the shock/linkage rod or a measured height. */
    rideHeight?: number
  }
  /** Measured sag for this setup, if it was checked. */
  sag?: {
    frontRider?: number
    frontFree?: number
    rearRider?: number
    rearFree?: number
  }
  geometry?: {
    /** Distance from rear axle to swingarm pivot, mm. */
    swingarmLength?: number
    steeringDamper?: number
  }
}

export const EMPTY_SETUP: SuspensionSetup = { fork: {}, shock: {} }

/** A named setup you can load as a starting point, e.g. "Daytona dry base". */
export interface SetupPreset {
  id: string
  bikeId: string
  name: string
  setup: SuspensionSetup
  notes?: string
  createdAt: Timestamp
}

/* ------------------------------------------------------------------ */
/* Tyres                                                               */
/* ------------------------------------------------------------------ */

export interface TyreModel {
  make: string
  model: string
  /** e.g. "SC1", "SC2", "K-slick", "medium". */
  compound?: string
  size?: string
  slick?: boolean
}

/**
 * A physical tyre — the one on the rim, not the model. Tracking these
 * individually is what makes heat cycles and "how many sessions on this
 * front" answerable.
 */
export interface Tyre {
  id: string
  axle: Axle
  model: TyreModel
  label?: string
  /** Cumulative sessions run on this carcass. */
  sessions: number
  /** Cumulative warmer/track heat cycles. */
  heatCycles: number
  retired?: boolean
  notes?: string
  createdAt: Timestamp
}

/** Pressures and temperatures for one axle in one session. */
export interface TyreRun {
  tyreId?: string
  model?: TyreModel
  /** Gauge pressure set in the pits before going out, bar. */
  coldPressure?: number
  /** Air temperature the cold pressure was set at, °C. */
  coldAtAmbient?: number
  /** Gauge pressure measured immediately on coming in, bar. */
  hotPressure?: number
  /** Tyre warmer set point, °C. */
  warmerTemp?: number
  /** Tyre surface temperature measured on return, °C. */
  surfaceTemp?: number
  wear?: TyreWear
}

/** What the surface of the tyre looks like after a session. */
export type TyreWear =
  | 'ok'
  | 'graining'
  | 'blistering'
  | 'tearing'
  | 'cold-tear'
  | 'feathering'
  | 'overheating'
  | 'worn-out'

/* ------------------------------------------------------------------ */
/* Sessions and track days                                             */
/* ------------------------------------------------------------------ */

export type TrackCondition = 'dry' | 'damp' | 'wet' | 'mixed'

export interface Conditions {
  ambientTemp?: number
  trackTemp?: number
  condition?: TrackCondition
  windy?: boolean
  notes?: string
}

/**
 * A handling complaint, as a code the advice engine understands.
 * See `advice.ts` for the full catalogue and what each one means.
 */
export type FeedbackCode = string

export interface Session {
  id: string
  trackDayId: string
  /** Session number within the day, 1-based. */
  number: number
  startedAt?: Timestamp
  laps?: number
  /** Best lap in seconds. */
  bestLap?: number
  /** Representative/average lap in seconds. */
  averageLap?: number
  conditions: Conditions
  setup: SuspensionSetup
  tyres: {
    front: TyreRun
    rear: TyreRun
  }
  /** Handling complaints selected from the catalogue. */
  feedback: FeedbackCode[]
  notes?: string
  /** Free-text record of what was changed before going out. */
  changesMade?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface TrackDay {
  id: string
  bikeId: string
  date: IsoDate
  /** Circuit name, e.g. "Daytona International Speedway". */
  circuit: string
  /** Layout, e.g. "Motorcycle course (3.51 mi)". */
  layout?: string
  organiser?: string
  notes?: string
  createdAt: Timestamp
}

/* ------------------------------------------------------------------ */
/* Preferences and the persisted document                              */
/* ------------------------------------------------------------------ */

export interface Preferences {
  pressureUnit: PressureUnit
  temperatureUnit: TemperatureUnit
  lengthUnit: LengthUnit
  massUnit: MassUnit
  /** Hot pressure the rider is aiming for, bar, per axle. */
  targetHotPressure: { front: number; rear: number }
}

/** Bumped whenever the persisted shape changes; see `storage.ts`. */
export const SCHEMA_VERSION = 1

export interface GarageData {
  version: number
  bikes: Bike[]
  tyres: Tyre[]
  presets: SetupPreset[]
  trackDays: TrackDay[]
  sessions: Session[]
  preferences: Preferences
  updatedAt: Timestamp
}
