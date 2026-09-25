/**
 * Starting points, not gospel.
 *
 * Every number here is a plausible template meant to be edited to match the
 * hardware actually on the bike. Adjuster ranges differ between model years
 * and between a stock cartridge and whatever the previous owner fitted, so
 * the app treats all of this as a first draft the rider corrects.
 */

import { newId } from '../core/id.js'
import type { Bike, SagTargets, TyreModel } from '../core/types.js'

/**
 * Sag windows for a sportbike set up for track riding, in mm of wheel travel.
 *
 * Rider sag is what preload sets. Free sag is the cross-check on the spring:
 * the front carries a lot of the bike's own weight so it settles a long way
 * unladen, while a rear spring stiff enough to carry a rider barely moves
 * under the bike alone — hence the very different windows.
 */
export const TRACK_SAG_TARGETS: SagTargets = {
  frontRider: [30, 35],
  frontFree: [25, 30],
  rearRider: [25, 30],
  rearFree: [5, 10],
}

/** A little more sag, for a bike that also has to work on the road. */
export const ROAD_SAG_TARGETS: SagTargets = {
  frontRider: [35, 40],
  frontFree: [25, 30],
  rearRider: [30, 35],
  rearFree: [5, 15],
}

/**
 * A new bike, from a name alone.
 *
 * A bike is only an identity to hang track days and setups on. The adjuster
 * ranges start unset (`range: 0` — no limit and no "impossible setting" check
 * until the rider fills them in), and per-adjuster units default to clicks for
 * damping and turns for preload. Everything is editable afterwards in the
 * bike editor; adding one asks for nothing but a name.
 */
export function newBike(name: string, now: number = Date.now()): Bike {
  return {
    id: newId('bike'),
    name,
    fork: {
      compression: { range: 0, unit: 'clicks' },
      rebound: { range: 0, unit: 'clicks' },
      preload: { range: 0, unit: 'turns' },
    },
    shock: {
      compressionLow: { range: 0, unit: 'clicks' },
      rebound: { range: 0, unit: 'clicks' },
      preload: { range: 0, unit: 'turns' },
    },
    sagTargets: TRACK_SAG_TARGETS,
    createdAt: now,
  }
}

/* ------------------------------------------------------------------ */
/* Circuits                                                            */
/* ------------------------------------------------------------------ */

export interface CircuitPreset {
  name: string
}

/** Suggestions for the circuit box. Anything can be typed instead. */
export const CIRCUITS: CircuitPreset[] = [{ name: 'YCC' }, { name: 'Speedster' }]

/* ------------------------------------------------------------------ */
/* Tyres                                                               */
/* ------------------------------------------------------------------ */

/**
 * Common track rubber, for the tyre picker.
 *
 * No pressures are attached to these on purpose. The right cold pressure
 * depends on the tyre, the track temperature and the bike, and the number
 * that matters is the *hot* pressure on the manufacturer's data sheet — put
 * that in Settings and let the app work back to a cold pressure from what
 * your tyres actually did last session.
 */
export const TYRE_MODELS: TyreModel[] = [
  { make: 'Pirelli', model: 'Diablo Superbike', compound: 'SC1', slick: true },
  { make: 'Pirelli', model: 'Diablo Superbike', compound: 'SC2', slick: true },
  { make: 'Pirelli', model: 'Diablo Supercorsa SP', slick: false },
  { make: 'Dunlop', model: 'KR451/KR448', slick: true },
  { make: 'Dunlop', model: 'Q5', slick: false },
  { make: 'Michelin', model: 'Power Slick', slick: true },
  { make: 'Michelin', model: 'Power Cup', slick: false },
  { make: 'Bridgestone', model: 'V02 slick', slick: true },
  { make: 'Bridgestone', model: 'R11', slick: false },
  { make: 'Metzeler', model: 'Racetec RR', slick: false },
]

export function describeTyre(model: TyreModel | undefined): string {
  if (!model) return 'No tyre recorded'
  return [model.make, model.model, model.compound].filter(Boolean).join(' ')
}
