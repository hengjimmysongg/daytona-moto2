/**
 * The log as a spreadsheet.
 *
 * One row per session, because that is the unit a rider compares: the
 * question a track day log exists to answer is "what was different about
 * the session that went quickest", and that only sorts and filters if every
 * session is a row and every data point is a column.
 *
 * Values come out in the rider's own units with the unit named in the
 * header, so a column of pressures in a spreadsheet reads the same way as
 * the same column on the phone.
 */

import { FEEDBACK_BY_CODE } from './advice.js'
import { formatLapTime } from './laptime.js'
import { SETUP_FIELDS } from './setup.js'
import { pressureRise } from './tyres.js'
import { pressureDecimals, pressureFromBar, temperatureFromC } from './units.js'
import type { Bike, GarageData, Preferences, Session, TrackDay, TyreRun } from './types.js'

/* ------------------------------------------------------------------ */
/* Writing CSV                                                         */
/* ------------------------------------------------------------------ */

/**
 * Quote a field if it could otherwise be misread.
 *
 * A comma, a quote or a newline all end a field early in something's
 * parser; a leading or trailing space gets eaten by others. Quoting those
 * and doubling embedded quotes is the whole of RFC 4180 that matters here.
 */
export function csvField(value: string): string {
  if (value === '') return ''
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim()
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  // CRLF, because that is what a spreadsheet on Windows expects and what
  // every other reader tolerates.
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

interface Row {
  day: TrackDay
  session: Session
  bike: Bike | undefined
  prefs: Preferences
}

interface Column {
  header: (prefs: Preferences) => string
  value: (row: Row) => string
}

/** Numbers keep their precision here; a spreadsheet is not a phone screen. */
function num(value: number | undefined, decimals = 2): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  return String(Number(value.toFixed(decimals)))
}

function pressure(bar: number | undefined, prefs: Preferences): string {
  if (bar === undefined) return ''
  return num(pressureFromBar(bar, prefs.pressureUnit), pressureDecimals(prefs.pressureUnit))
}

function temp(celsius: number | undefined, prefs: Preferences): string {
  return celsius === undefined ? '' : num(temperatureFromC(celsius, prefs.temperatureUnit), 1)
}

function tyreName(run: TyreRun, data: GarageData): string {
  const model = run.model ?? data.tyres.find((tyre) => tyre.id === run.tyreId)?.model
  if (!model) return ''
  return [model.make, model.model, model.compound].filter(Boolean).join(' ')
}

/**
 * The axle block, twice over.
 *
 * Warmer set point and the pressure measured coming in are the two ends of
 * the only question worth asking about a pressure: what it rose to, and
 * therefore what to set next time.
 */
function tyreColumns(axle: 'front' | 'rear', data: GarageData): Column[] {
  const side = axle === 'front' ? 'Front' : 'Rear'
  const run = (row: Row): TyreRun => row.session.tyres[axle]
  return [
    { header: () => `${side} tyre`, value: (row) => tyreName(run(row), data) },
    {
      header: (prefs) => `${side} cold (${prefs.pressureUnit})`,
      value: (row) => pressure(run(row).coldPressure, row.prefs),
    },
    {
      header: (prefs) => `${side} cold set at (°${prefs.temperatureUnit})`,
      value: (row) => temp(run(row).coldAtAmbient, row.prefs),
    },
    {
      header: (prefs) => `${side} warmer (°${prefs.temperatureUnit})`,
      value: (row) => temp(run(row).warmerTemp, row.prefs),
    },
    {
      header: (prefs) => `${side} hot off track (${prefs.pressureUnit})`,
      value: (row) => pressure(run(row).hotPressure, row.prefs),
    },
    {
      header: (prefs) => `${side} rise (${prefs.pressureUnit})`,
      // A rise is a difference of two gauge pressures, and every pressure
      // scale here is linear through zero, so it converts like a pressure.
      value: (row) => pressure(pressureRise(run(row)), row.prefs),
    },
    {
      header: (prefs) => `${side} surface temp (°${prefs.temperatureUnit})`,
      value: (row) => temp(run(row).surfaceTemp, row.prefs),
    },
    { header: () => `${side} wear`, value: (row) => run(row).wear ?? '' },
  ]
}

function columns(data: GarageData): Column[] {
  return [
    { header: () => 'Date', value: (row) => row.day.date },
    { header: () => 'Circuit', value: (row) => row.day.circuit },
    { header: () => 'Layout', value: (row) => row.day.layout ?? '' },
    { header: () => 'Bike', value: (row) => row.bike?.name ?? '' },
    { header: () => 'Session', value: (row) => String(row.session.number) },
    { header: () => 'Laps', value: (row) => num(row.session.laps, 0) },
    // Both paces, and both in seconds beside them: `1:52.34` is what a rider
    // reads, and a spreadsheet cannot sort or average it.
    { header: () => 'Fastest lap', value: (row) => (row.session.bestLap ? formatLapTime(row.session.bestLap) : '') },
    { header: () => 'Fastest lap (s)', value: (row) => num(row.session.bestLap, 2) },
    { header: () => 'Average lap', value: (row) => (row.session.averageLap ? formatLapTime(row.session.averageLap) : '') },
    { header: () => 'Average lap (s)', value: (row) => num(row.session.averageLap, 2) },
    {
      header: (prefs) => `Air temp (°${prefs.temperatureUnit})`,
      value: (row) => temp(row.session.conditions.ambientTemp, row.prefs),
    },
    {
      header: (prefs) => `Track temp (°${prefs.temperatureUnit})`,
      value: (row) => temp(row.session.conditions.trackTemp, row.prefs),
    },
    { header: () => 'Condition', value: (row) => row.session.conditions.condition ?? '' },
    {
      header: () => 'Windy',
      value: (row) => (row.session.conditions.windy === undefined ? '' : row.session.conditions.windy ? 'yes' : 'no'),
    },

    // Compression, rebound, preload and the rest, front and rear, straight
    // off the same catalogue the editor renders — so a field added there
    // becomes a column here without anyone remembering to do it.
    ...SETUP_FIELDS.map((field): Column => ({
      header: () => `${field.label} (${field.unit})`,
      value: (row) => num(field.get(row.session.setup), 2),
    })),

    ...tyreColumns('front', data),
    ...tyreColumns('rear', data),

    {
      header: () => 'Feedback',
      value: (row) =>
        row.session.feedback.map((code) => FEEDBACK_BY_CODE.get(code)?.label ?? code).join('; '),
    },
    { header: () => 'Changes made', value: (row) => row.session.changesMade ?? '' },
    { header: () => 'Notes', value: (row) => row.session.notes ?? '' },
  ]
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

function rowsFor(data: GarageData, sessions: ReadonlyArray<Session>): Row[] {
  const days = new Map(data.trackDays.map((day) => [day.id, day]))
  const bikes = new Map(data.bikes.map((bike) => [bike.id, bike]))
  return sessions.flatMap((session) => {
    const day = days.get(session.trackDayId)
    if (!day) return []
    return [{ day, session, bike: bikes.get(day.bikeId), prefs: data.preferences }]
  })
}

/** The given sessions as a sheet, header row included. */
export function sessionsCsv(data: GarageData, sessions: ReadonlyArray<Session>): string {
  const cols = columns(data)
  const rows = rowsFor(data, sessions).sort(
    (a, b) => a.day.date.localeCompare(b.day.date) || a.session.number - b.session.number,
  )
  return toCsv([
    cols.map((column) => column.header(data.preferences)),
    ...rows.map((row) => cols.map((column) => column.value(row))),
  ])
}

/** Every session of one track day, in the order they were run. */
export function trackDayCsv(data: GarageData, trackDayId: string): string {
  return sessionsCsv(
    data,
    data.sessions.filter((session) => session.trackDayId === trackDayId),
  )
}

/** One session, with the same columns, so the two exports stack. */
export function sessionCsv(data: GarageData, sessionId: string): string {
  return sessionsCsv(
    data,
    data.sessions.filter((session) => session.id === sessionId),
  )
}

/** Everything, for a season in one sheet. */
export function garageCsv(data: GarageData): string {
  return sessionsCsv(data, data.sessions)
}

/* ------------------------------------------------------------------ */
/* Filenames                                                           */
/* ------------------------------------------------------------------ */

/** Safe on every filesystem, and still readable in a downloads folder. */
export function csvFilename(parts: ReadonlyArray<string | undefined>): string {
  const slug = parts
    .filter((part): part is string => Boolean(part))
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'track-day-log'}.csv`
}
