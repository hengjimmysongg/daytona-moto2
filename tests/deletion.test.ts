import { describe, expect, it } from 'vitest'
import { deleteBike, deleteTyre } from '../src/core/deletion'
import { createEmptyGarage } from '../src/core/storage'
import { newBike } from '../src/data/presets'
import { fromSession, fromTrackDay, toSession, toTrackDay } from '../src/data/rows'
import type { GarageData, Session, TrackDay, Tyre } from '../src/core/types'

function day(id: string, bikeId: string, tyres: Partial<TrackDay> = {}): TrackDay {
  return { id, bikeId, date: '2026-03-07', circuit: 'Daytona', createdAt: 0, ...tyres }
}

function session(id: string, trackDayId: string, tyres: Session['tyres']): Session {
  return {
    id,
    trackDayId,
    number: 1,
    conditions: {},
    setup: { fork: {}, shock: {} },
    tyres,
    feedback: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function tyre(id: string, axle: Tyre['axle']): Tyre {
  return { id, axle, model: { make: 'Dunlop', model: 'KR' }, sessions: 0, heatCycles: 0, createdAt: 0 }
}

describe('deleteBike', () => {
  const data: GarageData = {
    ...createEmptyGarage(0),
    bikes: [
      { ...newBike('Race bike', 0), id: 'race' },
      { ...newBike('Spare', 0), id: 'spare' },
    ],
    trackDays: [day('d1', 'race'), day('d2', 'spare'), day('d3', 'race')],
    sessions: [session('s1', 'd1', { front: {}, rear: {} })],
  }

  it('removes the bike and leaves the others', () => {
    expect(deleteBike(data, 'race').bikes.map((bike) => bike.id)).toEqual(['spare'])
  })

  it('keeps its track days, with no bike attached', () => {
    const next = deleteBike(data, 'race')
    expect(next.trackDays.map((d) => [d.id, d.bikeId])).toEqual([
      ['d1', ''],
      ['d2', 'spare'],
      ['d3', ''],
    ])
    // Untouched days stay the same objects, so nothing else is rewritten.
    expect(next.trackDays[1]).toBe(data.trackDays[1])
    expect(next.sessions).toBe(data.sessions)
  })

  it('writes the cleared day with a null bike_id, which the foreign key accepts', () => {
    const cleared = deleteBike(data, 'race').trackDays[0]!
    expect(fromTrackDay(cleared).bike_id).toBeNull()
  })

  it('matches what Postgres holds once ON DELETE SET NULL has run', () => {
    const cleared = deleteBike(data, 'race').trackDays[0]!
    const inDatabase = { ...fromTrackDay(data.trackDays[0]!), bike_id: null }
    expect(cleared).toEqual(toTrackDay(inDatabase))
  })
})

describe('deleteTyre', () => {
  const data: GarageData = {
    ...createEmptyGarage(0),
    tyres: [tyre('f1', 'front'), tyre('r1', 'rear'), tyre('f2', 'front')],
    trackDays: [
      day('d1', 'bike', { frontTyreId: 'f1', rearTyreId: 'r1' }),
      day('d2', 'bike', { frontTyreId: 'f2', rearTyreId: 'r1' }),
    ],
    sessions: [
      // An older session that named its own carcass, from before tyres moved
      // to the day.
      session('s1', 'd1', {
        front: { tyreId: 'f1', model: { make: 'Dunlop', model: 'KR' }, coldPressure: 2.0 },
        rear: { tyreId: 'r1', coldPressure: 1.7 },
      }),
      session('s2', 'd2', { front: { coldPressure: 2.1 }, rear: {} }),
    ],
  }

  it('removes the tyre and leaves the others', () => {
    expect(deleteTyre(data, 'f1').tyres.map((t) => t.id)).toEqual(['r1', 'f2'])
  })

  it('unfits it from every day it was on, and only on that axle', () => {
    const next = deleteTyre(data, 'f1')
    expect(next.trackDays[0]).not.toHaveProperty('frontTyreId')
    expect(next.trackDays[0]!.rearTyreId).toBe('r1')
    expect(next.trackDays[1]).toBe(data.trackDays[1])
  })

  it('clears it from both axles of every day', () => {
    const next = deleteTyre(data, 'r1')
    expect(next.trackDays.map((d) => d.rearTyreId)).toEqual([undefined, undefined])
    expect(next.trackDays.map((d) => d.frontTyreId)).toEqual(['f1', 'f2'])
  })

  it('clears the id a session recorded, and keeps the rest of the run', () => {
    const next = deleteTyre(data, 'f1')
    expect(next.sessions[0]!.tyres.front).toEqual({
      model: { make: 'Dunlop', model: 'KR' },
      coldPressure: 2.0,
    })
    expect(next.sessions[0]!.tyres.rear).toBe(data.sessions[0]!.tyres.rear)
    expect(next.sessions[1]).toBe(data.sessions[1])
  })

  it('writes the cleared rows with null tyre ids, which the foreign keys accept', () => {
    const next = deleteTyre(data, 'f1')
    expect(fromTrackDay(next.trackDays[0]!).front_tyre_id).toBeNull()
    expect(fromSession(next.sessions[0]!).front_tyre_id).toBeNull()
  })

  it('matches what Postgres holds once ON DELETE SET NULL has run', () => {
    const next = deleteTyre(data, 'r1')
    const dayRow = { ...fromTrackDay(data.trackDays[0]!), rear_tyre_id: null }
    const sessionRow = { ...fromSession(data.sessions[0]!), rear_tyre_id: null }
    expect(next.trackDays[0]).toEqual(toTrackDay(dayRow))
    expect(next.sessions[0]).toEqual(toSession(sessionRow))
  })
})
