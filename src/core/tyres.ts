/**
 * Tyre pressure maths.
 *
 * The working method at a track day is simple and this module encodes it:
 *
 *   1. You have a *hot* pressure you want the tyre to be at when it comes
 *      in — that is the number the tyre manufacturer's data sheet is really
 *      talking about, and the one that decides how the carcass works.
 *   2. You cannot set a hot pressure. You set a cold one and the tyre gets
 *      there by itself.
 *   3. So you measure the rise (hot − cold) in a session and use it to pick
 *      the cold pressure that will land on target next time out.
 *
 * All pressures are gauge pressure in bar (see `units.ts`).
 */

import { ATMOSPHERIC_BAR, celsiusToKelvin } from './units.js'
import type { Session, TyreRun, TyreWear } from './types.js'

/** Pressure rise across a session, bar. Undefined if either end is missing. */
export function pressureRise(run: Pick<TyreRun, 'coldPressure' | 'hotPressure'>): number | undefined {
  if (run.coldPressure === undefined || run.hotPressure === undefined) return undefined
  return run.hotPressure - run.coldPressure
}

export interface ColdRecommendation {
  /** Cold pressure to set next time out, bar. */
  coldPressure: number
  /** Change from the cold pressure that was run, bar. Positive = pump up. */
  change: number
  /** The rise the recommendation is based on, bar. */
  rise: number
  /** How many sessions the rise was averaged over. */
  basedOnSessions: number
  warnings: string[]
}

/**
 * Cold pressure to set so the tyre lands on `targetHot`.
 *
 * The rise is treated as a property of the tyre, bike and track on the day:
 * take what it did last time and shift the starting point by however far
 * the hot pressure missed. It is a one-step correction, not a model, which
 * is exactly how it is done in the paddock — and it self-corrects each
 * session because you re-measure the rise every time.
 */
export function recommendColdPressure(args: {
  ranCold: number
  measuredHot: number
  targetHot: number
  basedOnSessions?: number
}): ColdRecommendation {
  const rise = args.measuredHot - args.ranCold
  const coldPressure = args.targetHot - rise
  const warnings: string[] = []

  if (rise < 0) {
    warnings.push(
      'Hot pressure came back lower than cold — check the gauge, or the tyre for a leak. The recommendation is unreliable.',
    )
  }
  if (rise > 0.5) {
    warnings.push(
      'Very large pressure rise. The carcass is working hard: usually a sign the cold pressure is too low, or the tyre is over-loaded for the compound.',
    )
  }
  if (rise >= 0 && rise < 0.08) {
    warnings.push(
      'Almost no pressure rise. The tyre is not getting up to temperature — consider a lower cold pressure, a softer compound, or more time on the warmers.',
    )
  }
  if (coldPressure < 0.8 || coldPressure > 3.0) {
    warnings.push(
      'Recommended cold pressure is outside the range these tyres normally run. Re-check the readings before setting it.',
    )
  }

  return {
    coldPressure,
    change: coldPressure - args.ranCold,
    rise,
    basedOnSessions: args.basedOnSessions ?? 1,
    warnings,
  }
}

/**
 * Same recommendation, but averaging the rise over several sessions.
 *
 * One session's rise carries the noise of a red flag, a slow out-lap or a
 * gauge read a minute late. Two or three consistent sessions are a much
 * better predictor, so this is what the app uses once there is history.
 * Sessions are weighted evenly; pass them most-recent-first and cap `limit`
 * to keep stale conditions from dragging the answer around.
 */
export function recommendFromHistory(
  runs: ReadonlyArray<Pick<TyreRun, 'coldPressure' | 'hotPressure'>>,
  targetHot: number,
  limit = 3,
): ColdRecommendation | undefined {
  const usable = runs
    .map((run) => ({ run, rise: pressureRise(run) }))
    .filter((entry): entry is { run: (typeof runs)[number]; rise: number } => entry.rise !== undefined)
    .slice(0, limit)

  const latest = usable[0]
  if (!latest) return undefined

  const meanRise = usable.reduce((sum, entry) => sum + entry.rise, 0) / usable.length
  const ranCold = latest.run.coldPressure as number

  const recommendation = recommendColdPressure({
    ranCold,
    measuredHot: ranCold + meanRise,
    targetHot,
    basedOnSessions: usable.length,
  })

  if (usable.length > 1) {
    const spread = Math.max(...usable.map((e) => e.rise)) - Math.min(...usable.map((e) => e.rise))
    if (spread > 0.2) {
      recommendation.warnings.push(
        'Pressure rise has been inconsistent between sessions. Check that hot readings are taken at the same point after coming in.',
      )
    }
  }
  return recommendation
}

/**
 * What the gauge should read now for a tyre that was set to `setPressure`
 * when the air was `setAmbient`, and has since sat in `nowAmbient` without
 * being ridden or touched.
 *
 * Sealed volume, fixed air mass, so absolute pressure tracks absolute
 * temperature. Riders lose a lot of time chasing a "mystery" pressure gain
 * that is only the sun coming out between the morning sighting laps and the
 * first session; this tells them how much of a reading is just weather.
 */
export function ambientAdjustedPressure(
  setPressure: number,
  setAmbient: number,
  nowAmbient: number,
): number {
  const absolute = setPressure + ATMOSPHERIC_BAR
  const scaled = absolute * (celsiusToKelvin(nowAmbient) / celsiusToKelvin(setAmbient))
  return scaled - ATMOSPHERIC_BAR
}

/**
 * The reverse: what to set *now*, at `nowAmbient`, so the tyre holds the
 * same air mass it would have at `setPressure` and `referenceAmbient`.
 * Useful when a baseline cold pressure was written down on a cold morning
 * and is being reused on a hot afternoon.
 */
export function pressureAtReferenceAmbient(
  setPressure: number,
  referenceAmbient: number,
  nowAmbient: number,
): number {
  return ambientAdjustedPressure(setPressure, referenceAmbient, nowAmbient)
}

/* ------------------------------------------------------------------ */
/* Wear reading                                                        */
/* ------------------------------------------------------------------ */

export interface WearGuidance {
  wear: TyreWear
  label: string
  /** What the surface is telling you. */
  meaning: string
  /** What to try, most likely first. */
  actions: string[]
}

const WEAR_GUIDANCE: Record<TyreWear, WearGuidance> = {
  ok: {
    wear: 'ok',
    label: 'Clean and even',
    meaning: 'The tyre is being worked in its window. Nothing to chase here.',
    actions: ['Leave the pressures alone and note them as a baseline for this track and temperature.'],
  },
  graining: {
    wear: 'graining',
    label: 'Graining',
    meaning:
      'Small rolled-up beads of rubber across the surface. The tread is tearing at the top because it is sliding while too cold — the tyre is not reaching its working temperature.',
    actions: [
      'Drop cold pressure a little (0.05–0.1 bar) so the carcass flexes and builds heat.',
      'More time on the warmers, and get temperature into it earlier in the out-lap.',
      'If the track is cold, consider a softer compound.',
    ],
  },
  blistering: {
    wear: 'blistering',
    label: 'Blistering',
    meaning:
      'Bubbles or torn-out pockets. The rubber has gone past its working temperature and is overheating from the inside.',
    actions: [
      'Raise cold pressure slightly to cut carcass flex and heat build-up.',
      'Consider a harder compound for the track temperature.',
      'Look for a suspension setting that is overworking that end of the bike.',
    ],
  },
  tearing: {
    wear: 'tearing',
    label: 'Tearing',
    meaning:
      'Rubber pulled and rolled in the direction of travel. The carcass is moving too much under load and the surface cannot keep up.',
    actions: [
      'Raise cold pressure a little to support the carcass.',
      'Check damping at that end — a tyre gets torn up when the suspension is not controlling the load.',
      'Rear tearing on exits usually also means too little rear grip: check ride height and preload.',
    ],
  },
  'cold-tear': {
    wear: 'cold-tear',
    label: 'Cold tearing',
    meaning:
      'Coarse, ragged tearing with a dull surface — the tyre is being asked for grip below its working temperature.',
    actions: [
      'Lower cold pressure to build heat.',
      'Longer warmer time and a harder push in the opening laps.',
      'A softer compound if the track will not warm up.',
    ],
  },
  feathering: {
    wear: 'feathering',
    label: 'Feathering / cupping',
    meaning:
      'A saw-tooth edge to the tread blocks, most often on the front. Usually a chassis or damping issue rather than a compound one.',
    actions: [
      'Check front pressure first — feathering often follows pressure that is too high.',
      'Look at front rebound: too much of it stops the tyre following the surface.',
      'Check geometry and that the front is not being overloaded on entry.',
    ],
  },
  overheating: {
    wear: 'overheating',
    label: 'Overheating / greasy',
    meaning:
      'A shiny, smeared surface with no texture. The tyre is above its working range and the surface has gone off.',
    actions: [
      'Raise cold pressure to reduce heat generation in the carcass.',
      'Harder compound for these track temperatures.',
      'Shorter sessions, or ease off in the middle of a stint to let it recover.',
    ],
  },
  'worn-out': {
    wear: 'worn-out',
    label: 'Worn out',
    meaning: 'The tyre is at the end of its life. Setup readings taken on it are not worth much.',
    actions: [
      'Fit a fresh tyre before chasing any handling complaint.',
      'Retire this carcass in the tyre list so it stops appearing in recommendations.',
    ],
  },
}

export function wearGuidance(wear: TyreWear): WearGuidance {
  return WEAR_GUIDANCE[wear]
}

export function allWearOptions(): WearGuidance[] {
  return Object.values(WEAR_GUIDANCE)
}

/* ------------------------------------------------------------------ */
/* Tyre life                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sessions and heat cycles a tyre has seen, counted from the session log
 * rather than trusted to a hand-kept tally.
 *
 * A heat cycle is counted per session the tyre was actually run in — a
 * warmer-on/warmer-off, out and back. It is a rough measure of how much the
 * rubber has hardened, not a precise one.
 */
export function tyreUsage(sessions: ReadonlyArray<Session>, tyreId: string): {
  sessions: number
  heatCycles: number
  lastUsed?: number
} {
  let count = 0
  let lastUsed: number | undefined
  for (const session of sessions) {
    const used = session.tyres.front.tyreId === tyreId || session.tyres.rear.tyreId === tyreId
    if (!used) continue
    count += 1
    const when = session.startedAt ?? session.createdAt
    if (lastUsed === undefined || when > lastUsed) lastUsed = when
  }
  const usage: { sessions: number; heatCycles: number; lastUsed?: number } = {
    sessions: count,
    heatCycles: count,
  }
  if (lastUsed !== undefined) usage.lastUsed = lastUsed
  return usage
}
