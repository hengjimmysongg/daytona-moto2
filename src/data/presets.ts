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

export interface BikeTemplate {
  key: string
  name: string
  description: string
  build(now?: number): Bike
}

function template(
  key: string,
  name: string,
  description: string,
  bike: Omit<Bike, 'id' | 'name' | 'createdAt'>,
): BikeTemplate {
  return {
    key,
    name,
    description,
    build: (now = Date.now()) => ({ id: newId('bike'), name, createdAt: now, ...bike }),
  }
}

export const BIKE_TEMPLATES: BikeTemplate[] = [
  template(
    'daytona-675r',
    'Triumph Daytona 675R',
    'Öhlins NIX30 fork and TTX36 shock, as fitted to the R. Check your own clicker counts.',
    {
      make: 'Triumph',
      model: 'Daytona 675R',
      fork: {
        travel: 120,
        compression: { range: 20, unit: 'clicks' },
        rebound: { range: 20, unit: 'clicks' },
        preload: { range: 12, unit: 'turns' },
      },
      shock: {
        travel: 130,
        compressionLow: { range: 20, unit: 'clicks' },
        compressionHigh: { range: 3, unit: 'turns' },
        rebound: { range: 20, unit: 'clicks' },
        preload: { range: 10, unit: 'turns' },
      },
      sagTargets: TRACK_SAG_TARGETS,
      notes:
        'Damping counted in clicks out from fully closed. Preload in turns in from fully soft.',
    },
  ),
  template(
    'moto2-765',
    'Moto2 (Triumph 765)',
    'Prototype chassis on Öhlins, with the wider adjustment range a race kit gives you.',
    {
      make: 'Triumph',
      model: '765 Moto2',
      fork: {
        travel: 120,
        compression: { range: 30, unit: 'clicks' },
        rebound: { range: 30, unit: 'clicks' },
        preload: { range: 15, unit: 'turns' },
      },
      shock: {
        travel: 130,
        compressionLow: { range: 30, unit: 'clicks' },
        compressionHigh: { range: 4, unit: 'turns' },
        rebound: { range: 30, unit: 'clicks' },
        preload: { range: 12, unit: 'turns' },
      },
      sagTargets: TRACK_SAG_TARGETS,
      notes: 'Ride height recorded as shock/linkage rod length.',
    },
  ),
  template(
    'sportbike',
    'Sportbike (track)',
    'A neutral starting template for any 600 or 1000 on stock adjustable suspension.',
    {
      fork: {
        travel: 120,
        compression: { range: 18, unit: 'clicks' },
        rebound: { range: 18, unit: 'clicks' },
        preload: { range: 8, unit: 'turns' },
      },
      shock: {
        travel: 130,
        compressionLow: { range: 18, unit: 'clicks' },
        rebound: { range: 18, unit: 'clicks' },
        preload: { range: 10, unit: 'turns' },
      },
      sagTargets: TRACK_SAG_TARGETS,
    },
  ),
]

/* ------------------------------------------------------------------ */
/* Circuits                                                            */
/* ------------------------------------------------------------------ */

export interface CircuitPreset {
  name: string
  layout?: string
  country: string
}

/** Suggestions for the circuit box. Anything can be typed instead. */
export const CIRCUITS: CircuitPreset[] = [
  { name: 'Daytona International Speedway', layout: 'Motorcycle course', country: 'US' },
  { name: 'Barber Motorsports Park', country: 'US' },
  { name: 'Road Atlanta', country: 'US' },
  { name: 'Circuit of the Americas', country: 'US' },
  { name: 'Laguna Seca', country: 'US' },
  { name: 'Road America', country: 'US' },
  { name: 'New Jersey Motorsports Park', layout: 'Thunderbolt', country: 'US' },
  { name: 'Virginia International Raceway', layout: 'Full course', country: 'US' },
  { name: 'Willow Springs', country: 'US' },
  { name: 'Sonoma Raceway', country: 'US' },
  { name: 'Donington Park', layout: 'National', country: 'GB' },
  { name: 'Silverstone', layout: 'GP', country: 'GB' },
  { name: 'Brands Hatch', layout: 'Indy', country: 'GB' },
  { name: 'Cadwell Park', country: 'GB' },
  { name: 'Mugello', country: 'IT' },
  { name: 'Jerez', country: 'ES' },
  { name: 'Portimão', country: 'PT' },
  { name: 'Assen', country: 'NL' },
]

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
