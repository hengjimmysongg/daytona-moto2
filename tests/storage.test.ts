import { describe, expect, it } from 'vitest'
import {
  clearGarage,
  createEmptyGarage,
  defaultPreferences,
  exportGarage,
  ImportError,
  importGarage,
  loadGarage,
  memoryStorage,
  previousSession,
  reconcileCurrentSetup,
  saveGarage,
  sessionsForDay,
  setBikeCurrentSetup,
  STORAGE_KEY,
  suggestExportFilename,
  trackDaysByDate,
} from '../src/core/storage'
import { newBike } from '../src/data/presets'
import { SCHEMA_VERSION } from '../src/core/types'
import type { GarageData, Session, TrackDay } from '../src/core/types'

function session(id: string, trackDayId: string, number: number): Session {
  return {
    id,
    trackDayId,
    number,
    conditions: {},
    setup: { fork: {}, shock: {} },
    tyres: { front: {}, rear: {} },
    feedback: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

function day(id: string, date: string): TrackDay {
  return { id, bikeId: 'bike', date, circuit: 'Daytona', createdAt: 0 }
}

describe('load and save', () => {
  it('starts with an empty garage when there is nothing stored', () => {
    const { data, error } = loadGarage(memoryStorage())
    expect(error).toBeUndefined()
    expect(data.bikes).toEqual([])
    expect(data.version).toBe(SCHEMA_VERSION)
  })

  it('round-trips a garage', () => {
    const storage = memoryStorage()
    const data = createEmptyGarage(0)
    data.trackDays.push(day('day1', '2026-03-07'))
    saveGarage(storage, data)

    const loaded = loadGarage(storage).data
    expect(loaded.trackDays).toHaveLength(1)
    expect(loaded.trackDays[0]!.circuit).toBe('Daytona')
  })

  it('stamps the schema version but leaves updatedAt to the caller', () => {
    const storage = memoryStorage()
    saveGarage(storage, { ...createEmptyGarage(0), version: 0, updatedAt: 4242 })
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) as string)
    expect(stored.version).toBe(SCHEMA_VERSION)
    // Re-stamping here would make the stored copy disagree with the one in
    // memory, and sync compares exactly this number.
    expect(stored.updatedAt).toBe(4242)
  })

  it('degrades to an empty garage rather than blowing up on a corrupt record', () => {
    const { data, error } = loadGarage(memoryStorage({ [STORAGE_KEY]: '{ not json' }))
    expect(data.bikes).toEqual([])
    expect(error).toBeTruthy()
  })

  it('reports a storage that refuses to write instead of losing it silently', () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(saveGarage(failing, createEmptyGarage(0)).error).toMatch(/Quota/)
  })

  it('reports a storage that refuses to read', () => {
    const blocked = {
      getItem: () => {
        throw new Error('access denied')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    const { data, error } = loadGarage(blocked)
    expect(error).toMatch(/access denied/)
    expect(data.bikes).toEqual([])
  })

  it('clears', () => {
    const storage = memoryStorage()
    saveGarage(storage, createEmptyGarage(0))
    clearGarage(storage)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('import and export', () => {
  it('round-trips through the export format', () => {
    const data = createEmptyGarage(0)
    data.trackDays.push(day('day1', '2026-03-07'))
    data.preferences.pressureUnit = 'bar'

    const imported = importGarage(exportGarage(data))
    expect(imported.trackDays).toHaveLength(1)
    expect(imported.preferences.pressureUnit).toBe('bar')
  })

  it('exports something a human can read', () => {
    expect(exportGarage(createEmptyGarage(0))).toContain('\n  "bikes"')
  })

  it('rejects a file that is not JSON', () => {
    expect(() => importGarage('nope')).toThrow(ImportError)
  })

  it('rejects JSON that is not a garage', () => {
    expect(() => importGarage('[1, 2, 3]')).toThrow(/does not contain a garage/)
    expect(() => importGarage('null')).toThrow(ImportError)
    // Some other app's JSON, which would otherwise import as an empty garage
    // and wipe a season of data.
    expect(() => importGarage('{"totally":"unrelated"}')).toThrow(/does not contain a garage/)
  })

  it('refuses a file from a newer version of the app', () => {
    expect(() => importGarage(JSON.stringify({ version: 99, bikes: [] }))).toThrow(/newer version/)
  })

  it('rejects a bike with no id, which would break every lookup', () => {
    expect(() => importGarage(JSON.stringify({ version: 1, bikes: [{ name: 'nameless' }] }))).toThrow(
      /no id/,
    )
  })

  it('fills in anything an older or hand-edited file left out', () => {
    const imported = importGarage(JSON.stringify({ version: 1 }))
    expect(imported.sessions).toEqual([])
    expect(imported.preferences.pressureUnit).toBe('psi')
    expect(imported.preferences.targetHotPressure.front).toBeGreaterThan(0)
  })

  it('keeps the preferences a file did set', () => {
    const imported = importGarage(
      JSON.stringify({ version: 1, preferences: { pressureUnit: 'bar' } }),
    )
    expect(imported.preferences.pressureUnit).toBe('bar')
    // The unit the file did not name comes from the defaults, whatever
    // those currently are.
    expect(imported.preferences.temperatureUnit).toBe(defaultPreferences().temperatureUnit)
  })

  it('ignores the suspension prefs an older file carried, now that they live per bike', () => {
    const imported = importGarage(
      JSON.stringify({
        version: 1,
        preferences: { suspensionUnit: 'half-turns', adjusterDirection: 'soft-to-hard', pressureUnit: 'bar' },
      }),
    )
    expect(imported.preferences.pressureUnit).toBe('bar')
    expect('suspensionUnit' in imported.preferences).toBe(false)
    expect('adjusterDirection' in imported.preferences).toBe(false)
  })

  it('suggests a dated filename', () => {
    expect(suggestExportFilename(new Date('2026-03-07T12:00:00Z'))).toBe('daytona-moto2-2026-03-07.json')
  })
})

describe('current setup helpers', () => {
  const bike = { ...newBike('Bike', 0), id: 'bike' }
  const withComp = (id: string, trackDayId: string, number: number, compression: number): Session => ({
    id,
    trackDayId,
    number,
    conditions: {},
    setup: { fork: { compression }, shock: {} },
    tyres: { front: {}, rear: {} },
    feedback: [],
    createdAt: 0,
    updatedAt: 0,
  })

  it('setBikeCurrentSetup sets one bike, and is a no-op when the value already matches', () => {
    const data: GarageData = { ...createEmptyGarage(0), bikes: [bike] }
    const set = setBikeCurrentSetup(data, 'bike', { fork: { compression: 10 }, shock: {} })
    expect(set.bikes[0]!.currentSetup?.fork.compression).toBe(10)
    expect(setBikeCurrentSetup(set, 'bike', { fork: { compression: 10 }, shock: {} })).toBe(set)
  })

  it('setBikeCurrentSetup leaves other bikes untouched', () => {
    const other = { ...newBike('Other', 0), id: 'other' }
    const data: GarageData = { ...createEmptyGarage(0), bikes: [bike, other] }
    const set = setBikeCurrentSetup(data, 'bike', { fork: { compression: 10 }, shock: {} })
    expect(set.bikes[1]!.currentSetup).toBeUndefined()
  })

  it('reconcileCurrentSetup follows the most recent session (later day, higher number)', () => {
    const data: GarageData = {
      ...createEmptyGarage(0),
      bikes: [bike],
      trackDays: [day('d1', '2026-03-01'), day('d2', '2026-03-08')],
      sessions: [withComp('a', 'd1', 1, 12), withComp('b', 'd2', 1, 8), withComp('c', 'd2', 2, 10)],
    }
    expect(reconcileCurrentSetup(data, 'bike').bikes[0]!.currentSetup?.fork.compression).toBe(10)
  })

  it('reconcileCurrentSetup leaves a bike with no sessions on its manual current setup', () => {
    const manual = { ...bike, currentSetup: { fork: { compression: 5 }, shock: {} } }
    const data: GarageData = { ...createEmptyGarage(0), bikes: [manual] }
    expect(reconcileCurrentSetup(data, 'bike')).toBe(data)
    expect(reconcileCurrentSetup(data, 'bike').bikes[0]!.currentSetup?.fork.compression).toBe(5)
  })
})

describe('migrate backfills day tyres from older logs', () => {
  it('lifts the fitted tyre from sessions onto the day for a pre-v2 file', () => {
    const imported = importGarage(
      JSON.stringify({
        version: 1,
        trackDays: [{ id: 'd', bikeId: 'b', date: '2026-03-07', circuit: 'YCC', createdAt: 0 }],
        sessions: [
          {
            id: 's',
            trackDayId: 'd',
            number: 1,
            conditions: {},
            setup: { fork: {}, shock: {} },
            tyres: { front: { tyreId: 'tyreF' }, rear: { tyreId: 'tyreR' } },
            feedback: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
    )
    expect(imported.trackDays[0]!.frontTyreId).toBe('tyreF')
    expect(imported.trackDays[0]!.rearTyreId).toBe('tyreR')
  })

  it('leaves a current-schema file, whose tyres are already on the day, alone', () => {
    const imported = importGarage(
      JSON.stringify({
        version: SCHEMA_VERSION,
        trackDays: [
          { id: 'd', bikeId: 'b', date: '2026-03-07', circuit: 'YCC', createdAt: 0, frontTyreId: 'onDay' },
        ],
        sessions: [
          {
            id: 's',
            trackDayId: 'd',
            number: 1,
            conditions: {},
            setup: { fork: {}, shock: {} },
            tyres: { front: { tyreId: 'legacy' }, rear: {} },
            feedback: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
    )
    expect(imported.trackDays[0]!.frontTyreId).toBe('onDay')
  })
})

describe('queries', () => {
  const data: GarageData = {
    ...createEmptyGarage(0),
    trackDays: [day('day1', '2026-03-07'), day('day2', '2026-05-01')],
    sessions: [
      session('s3', 'day1', 3),
      session('s1', 'day1', 1),
      session('s2', 'day1', 2),
      session('other', 'day2', 1),
    ],
  }

  it('returns a day’s sessions in the order they were run', () => {
    expect(sessionsForDay(data, 'day1').map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('sorts track days newest first', () => {
    expect(trackDaysByDate(data).map((d) => d.id)).toEqual(['day2', 'day1'])
  })

  it('finds the session before a given one', () => {
    const second = sessionsForDay(data, 'day1')[1]!
    expect(previousSession(data, second)?.id).toBe('s1')
  })

  it('has no previous session for the first one out', () => {
    const first = sessionsForDay(data, 'day1')[0]!
    expect(previousSession(data, first)).toBeUndefined()
  })
})
