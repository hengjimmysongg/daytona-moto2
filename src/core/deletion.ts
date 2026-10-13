/**
 * Removing a bike or a tyre, and what that leaves behind.
 *
 * Track days and sessions outlive the bike and tyres they point at. In
 * Postgres every one of those references is a foreign key with ON DELETE SET
 * NULL, so the database clears them itself when the row goes. The log in
 * memory has to clear them the same way: a day still holding the old id would
 * write it straight back on its next save, and the foreign key would turn
 * that save down.
 */

import type { GarageData, TyreRun } from './types.js'

/**
 * Remove a bike. Its track days stay, with no bike attached — `track_days.bike_id`
 * is set null, which is an empty id here. Its current setup lives on the bike
 * and goes with it.
 */
export function deleteBike(data: GarageData, bikeId: string): GarageData {
  return {
    ...data,
    bikes: data.bikes.filter((bike) => bike.id !== bikeId),
    trackDays: data.trackDays.map((day) => (day.bikeId === bikeId ? { ...day, bikeId: '' } : day)),
  }
}

/**
 * Remove a tyre, and every reference to it: the days it was fitted for
 * (`track_days.front_tyre_id` / `rear_tyre_id`) and the older sessions that
 * named it themselves (`sessions.front_tyre_id` / `rear_tyre_id`). A session
 * keeps the tyre model it recorded, as the database does.
 */
export function deleteTyre(data: GarageData, tyreId: string): GarageData {
  return {
    ...data,
    tyres: data.tyres.filter((tyre) => tyre.id !== tyreId),
    trackDays: data.trackDays.map((day) => {
      if (day.frontTyreId !== tyreId && day.rearTyreId !== tyreId) return day
      const next = { ...day }
      if (next.frontTyreId === tyreId) delete next.frontTyreId
      if (next.rearTyreId === tyreId) delete next.rearTyreId
      return next
    }),
    sessions: data.sessions.map((session) => {
      const { front, rear } = session.tyres
      if (front.tyreId !== tyreId && rear.tyreId !== tyreId) return session
      return {
        ...session,
        tyres: { front: withoutTyre(front, tyreId), rear: withoutTyre(rear, tyreId) },
      }
    }),
  }
}

function withoutTyre(run: TyreRun, tyreId: string): TyreRun {
  if (run.tyreId !== tyreId) return run
  const { tyreId: _removed, ...rest } = run
  return rest
}
