/**
 * The spreadsheet export.
 *
 * The things worth pinning down: a field that would otherwise break a
 * parser, the columns a rider actually asked for, and the fact that the
 * numbers come out in the units they set.
 */

import { describe, expect, it } from 'vitest'
import { csvField, csvFilename, sessionCsv, sessionsCsv, toCsv, trackDayCsv } from '../src/core/csv'
import { createEmptyGarage } from '../src/core/storage'
import { EMPTY_SETUP } from '../src/core/types'
import type { GarageData, Session, TrackDay } from '../src/core/types'

function garage(): GarageData {
  const data = createEmptyGarage(1_700_000_000_000)
  data.bikes.push({
    id: 'bike_1',
    name: 'Daytona 675R',
    fork: {
      compression: { range: 20, unit: 'clicks' },
      rebound: { range: 20, unit: 'clicks' },
      preload: { range: 10, unit: 'turns' },
    },
    shock: {
      compressionLow: { range: 20, unit: 'clicks' },
      rebound: { range: 20, unit: 'clicks' },
      preload: { range: 10, unit: 'turns' },
    },
    sagTargets: { frontRider: [30, 35], frontFree: [20, 30], rearRider: [25, 30], rearFree: [5, 15] },
    createdAt: 1,
  })
  return data
}

function day(overrides: Partial<TrackDay> = {}): TrackDay {
  return {
    id: 'day_1',
    bikeId: 'bike_1',
    date: '2026-03-07',
    circuit: 'Daytona',
    createdAt: 1,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses_1',
    trackDayId: 'day_1',
    number: 1,
    conditions: {},
    setup: EMPTY_SETUP,
    tyres: { front: {}, rear: {} },
    feedback: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function header(csv: string): string[] {
  return csv.split('\r\n')[0]!.split(',')
}

function cell(csv: string, column: string, rowIndex = 1): string {
  const columns = header(csv)
  const index = columns.indexOf(column)
  expect(index, `column "${column}" should exist in: ${columns.join(' | ')}`).toBeGreaterThan(-1)
  // Naive split is fine here: these tests use values that need no quoting.
  return csv.split('\r\n')[rowIndex]!.split(',')[index]!
}

/* ------------------------------------------------------------------ */

describe('csvField', () => {
  it('leaves a plain value alone', () => {
    expect(csvField('Daytona')).toBe('Daytona')
    expect(csvField('')).toBe('')
  })

  it('quotes what would otherwise end the field early', () => {
    expect(csvField('Daytona, FL')).toBe('"Daytona, FL"')
    expect(csvField('line one\nline two')).toBe('"line one\nline two"')
    expect(csvField('he said "push"')).toBe('"he said ""push"""')
  })

  it('quotes padding, which some readers would eat', () => {
    expect(csvField(' leading')).toBe('" leading"')
  })
})

describe('toCsv', () => {
  it('writes CRLF rows and a trailing newline', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2\r\n')
  })
})

describe('columns', () => {
  it('carries compression, rebound and preload for both ends', () => {
    const data = garage()
    data.trackDays.push(day())
    data.sessions.push(
      session({
        setup: {
          fork: { compression: 8, rebound: 10, preload: 3 },
          shock: { compressionLow: 12, rebound: 14, preload: 2.5 },
        },
      }),
    )
    const csv = trackDayCsv(data, 'day_1')
    expect(cell(csv, 'Fork compression (clicks)')).toBe('8')
    expect(cell(csv, 'Fork rebound (clicks)')).toBe('10')
    expect(cell(csv, 'Fork preload (turns)')).toBe('3')
    expect(cell(csv, 'Shock low-speed compression (clicks)')).toBe('12')
    expect(cell(csv, 'Shock rebound (clicks)')).toBe('14')
    expect(cell(csv, 'Shock preload (turns)')).toBe('2.5')
  })

  it('carries the warmer set point and the pressure coming in, and the rise between', () => {
    const data = garage()
    data.preferences = { ...data.preferences, pressureUnit: 'bar', temperatureUnit: 'C' }
    data.trackDays.push(day())
    data.sessions.push(
      session({
        tyres: {
          front: { coldPressure: 2.1, hotPressure: 2.35, warmerTemp: 85, surfaceTemp: 72 },
          rear: { coldPressure: 1.7, hotPressure: 1.95, warmerTemp: 95 },
        },
      }),
    )
    const csv = trackDayCsv(data, 'day_1')
    expect(cell(csv, 'Front warmer (°C)')).toBe('85')
    expect(cell(csv, 'Front cold (bar)')).toBe('2.1')
    expect(cell(csv, 'Front hot off track (bar)')).toBe('2.35')
    expect(cell(csv, 'Front rise (bar)')).toBe('0.25')
    expect(cell(csv, 'Front surface temp (°C)')).toBe('72')
    expect(cell(csv, 'Rear warmer (°C)')).toBe('95')
    expect(cell(csv, 'Rear rise (bar)')).toBe('0.25')
  })

  it('writes pressures and temperatures in the rider’s own units', () => {
    const data = garage()
    data.preferences = { ...data.preferences, pressureUnit: 'psi', temperatureUnit: 'F' }
    data.trackDays.push(day())
    data.sessions.push(
      session({ tyres: { front: { coldPressure: 2 }, rear: {} }, conditions: { trackTemp: 30 } }),
    )
    const csv = trackDayCsv(data, 'day_1')
    expect(cell(csv, 'Front cold (psi)')).toBe('29')
    expect(cell(csv, 'Track temp (°F)')).toBe('86')
  })

  it('names the day, the bike and the session', () => {
    const data = garage()
    data.trackDays.push(day({ layout: 'Motorcycle course' }))
    data.sessions.push(session({ number: 3, laps: 9, bestLap: 112.34, averageLap: 114.9 }))
    const csv = trackDayCsv(data, 'day_1')
    expect(cell(csv, 'Date')).toBe('2026-03-07')
    expect(cell(csv, 'Circuit')).toBe('Daytona')
    expect(cell(csv, 'Bike')).toBe('Daytona 675R')
    expect(cell(csv, 'Session')).toBe('3')
    expect(cell(csv, 'Laps')).toBe('9')
    expect(cell(csv, 'Fastest lap')).toBe('1:52.34')
    expect(cell(csv, 'Average lap')).toBe('1:54.90')
    expect(cell(csv, 'Average lap (s)')).toBe('114.9')
  })
})

describe('scope', () => {
  it('exports every session of one day, in the order they ran', () => {
    const data = garage()
    data.trackDays.push(day(), day({ id: 'day_2', date: '2026-04-01', circuit: 'Barber' }))
    data.sessions.push(
      session({ id: 'ses_2', number: 2 }),
      session({ id: 'ses_1', number: 1 }),
      session({ id: 'ses_3', trackDayId: 'day_2', number: 1 }),
    )
    const rows = trackDayCsv(data, 'day_1').trimEnd().split('\r\n')
    expect(rows).toHaveLength(3) // header + two sessions
    expect(cell(trackDayCsv(data, 'day_1'), 'Session', 1)).toBe('1')
    expect(cell(trackDayCsv(data, 'day_1'), 'Session', 2)).toBe('2')
  })

  it('exports one session with the same columns, so the two stack', () => {
    const data = garage()
    data.trackDays.push(day())
    data.sessions.push(session({ id: 'ses_1', number: 1 }), session({ id: 'ses_2', number: 2 }))
    const one = sessionCsv(data, 'ses_2')
    expect(one.trimEnd().split('\r\n')).toHaveLength(2)
    expect(header(one)).toEqual(header(trackDayCsv(data, 'day_1')))
    expect(cell(one, 'Session')).toBe('2')
  })

  it('drops a session whose day has been deleted rather than throwing', () => {
    const data = garage()
    data.sessions.push(session({ trackDayId: 'day_gone' }))
    expect(sessionsCsv(data, data.sessions).trimEnd().split('\r\n')).toHaveLength(1)
  })
})

describe('csvFilename', () => {
  it('makes something safe and still readable', () => {
    expect(csvFilename(['2026-03-07', 'Daytona International Speedway', 'session 3'])).toBe(
      '2026-03-07-daytona-international-speedway-session-3.csv',
    )
    expect(csvFilename([undefined, ''])).toBe('track-day-log.csv')
  })
})
