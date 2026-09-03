/**
 * The log, in Postgres.
 *
 * Every read and write goes straight to Supabase — there is no local copy,
 * so what you see is what is stored, and a second device sees it the moment
 * it loads.
 *
 * The views keep the whole-document API they had (`update(fn)` returning a
 * new `GarageData`) because that is the shape the domain code is written
 * against. What changed is underneath: the document is diffed against the
 * one it replaced, and only the rows that actually moved are written. An
 * edit to one adjuster is one UPDATE, not a rewrite of the season.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../data/supabase'
import {
  fromBike,
  fromPreferences,
  fromSession,
  fromTrackDay,
  fromTyre,
  toBike,
  toPreferences,
  toSession,
  toTrackDay,
  toTyre,
  type Row,
} from '../data/rows'
import { createEmptyGarage, defaultPreferences } from '../core/storage'
import { SCHEMA_VERSION, type GarageData } from '../core/types'

export interface Garage {
  data: GarageData
  /** Apply a change and write it. */
  update: (fn: (data: GarageData) => GarageData) => void
  /** Replace the whole garage, as an import does. */
  replace: (data: GarageData) => void
  /** True until the first load finishes. */
  loading: boolean
  /** True while a write is in flight. */
  saving: boolean
  /**
   * Set when the log could not be read. The screen is empty because we do
   * not know what is in there — not because anything was lost.
   */
  loadError?: string
  /** Set when a change on screen has not reached the database. */
  saveError?: string
  /** Try the failed load again. */
  reload: () => void
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadGarage(): Promise<GarageData> {
  const [bikes, tyres, days, sessions, prefs] = await Promise.all([
    supabase.from('bikes').select('*').order('created_at'),
    supabase.from('tyres').select('*').order('created_at'),
    supabase.from('track_days').select('*').order('date'),
    supabase.from('sessions').select('*').order('number'),
    supabase.from('preferences').select('*').maybeSingle(),
  ])

  for (const result of [bikes, tyres, days, sessions, prefs]) {
    if (result.error) throw new Error(result.error.message)
  }

  const fallback = defaultPreferences()
  return {
    version: SCHEMA_VERSION,
    bikes: (bikes.data ?? []).map((row) => toBike(row as Row)),
    tyres: (tyres.data ?? []).map((row) => toTyre(row as Row)),
    presets: [],
    trackDays: (days.data ?? []).map((row) => toTrackDay(row as Row)),
    sessions: (sessions.data ?? []).map((row) => toSession(row as Row)),
    preferences: prefs.data ? toPreferences(prefs.data as Row, fallback) : fallback,
    updatedAt: Date.now(),
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

interface Identified {
  id: string
}

/**
 * What changed in one collection: the rows to write, and the ids to remove.
 *
 * Equality is by serialised value. These are small objects of plain data, and
 * the alternative — writing every row on every keystroke — is worse than the
 * cost of stringifying a few dozen of them.
 */
function diff<T extends Identified>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
): { changed: T[]; removed: string[] } {
  const was = new Map(before.map((item) => [item.id, JSON.stringify(item)]))
  const changed = after.filter((item) => was.get(item.id) !== JSON.stringify(item))
  const alive = new Set(after.map((item) => item.id))
  const removed = before.filter((item) => !alive.has(item.id)).map((item) => item.id)
  return { changed, removed }
}

async function save(before: GarageData, after: GarageData, userId: string): Promise<void> {
  const owned = (row: Row): Row => ({ ...row, user_id: userId })

  const bikes = diff(before.bikes, after.bikes)
  const tyres = diff(before.tyres, after.tyres)
  const days = diff(before.trackDays, after.trackDays)
  const sessions = diff(before.sessions, after.sessions)

  // Order matters in both directions: a session cannot reference a track day
  // that is not there yet, and a track day cannot be deleted while its
  // sessions still point at it.
  const writes: PromiseLike<{ error: { message: string } | null }>[] = []

  if (sessions.removed.length) {
    writes.push(supabase.from('sessions').delete().in('id', sessions.removed))
  }
  if (days.removed.length) {
    writes.push(supabase.from('track_days').delete().in('id', days.removed))
  }
  await Promise.all(writes)
  writes.length = 0

  if (bikes.changed.length) {
    writes.push(supabase.from('bikes').upsert(bikes.changed.map((b) => owned(fromBike(b)))))
  }
  if (tyres.changed.length) {
    writes.push(supabase.from('tyres').upsert(tyres.changed.map((t) => owned(fromTyre(t)))))
  }
  await Promise.all(writes)
  writes.length = 0

  if (days.changed.length) {
    writes.push(supabase.from('track_days').upsert(days.changed.map((d) => owned(fromTrackDay(d)))))
  }
  await Promise.all(writes)
  writes.length = 0

  if (sessions.changed.length) {
    writes.push(supabase.from('sessions').upsert(sessions.changed.map((s) => owned(fromSession(s)))))
  }
  if (bikes.removed.length) {
    writes.push(supabase.from('bikes').delete().in('id', bikes.removed))
  }
  if (tyres.removed.length) {
    writes.push(supabase.from('tyres').delete().in('id', tyres.removed))
  }
  if (JSON.stringify(before.preferences) !== JSON.stringify(after.preferences)) {
    writes.push(
      supabase
        .from('preferences')
        .upsert(owned(fromPreferences(after.preferences, Date.now()))),
    )
  }

  const results = await Promise.all(writes)
  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(failed.error.message)
}

/* ------------------------------------------------------------------ */
/* Retrying                                                            */
/* ------------------------------------------------------------------ */

/**
 * Try again before giving up.
 *
 * Two failures here are routine and both pass on their own: a phone coming
 * back onto signal, and a freshly refreshed token whose `iat` is a second
 * ahead of the clock that checks it — Supabase mints tokens on one machine
 * and validates them on another, and the check allows no leeway. Telling a
 * rider in the pit lane to "try again" for either is passing on our problem.
 *
 * Three attempts over about four seconds covers both without making a real
 * failure take noticeably longer to report.
 */
const RETRY_DELAYS_MS = [800, 3000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    try {
      return await attempt()
    } catch (cause) {
      last = cause
      const wait = RETRY_DELAYS_MS[index]
      if (wait === undefined) break
      await sleep(wait)
      // A new token, in case the old one was the problem. Best effort: if
      // this fails the retry below will surface the real error.
      await supabase.auth.refreshSession().catch(() => undefined)
    }
  }
  throw last
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function useGarage(userId: string | null): Garage {
  const [data, setData] = useState<GarageData>(() => createEmptyGarage())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  // The last state known to be in the database, so a write knows what moved.
  const stored = useRef<GarageData>(data)

  useEffect(() => {
    if (!userId) {
      const empty = createEmptyGarage()
      stored.current = empty
      setData(empty)
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    void withRetries(loadGarage)
      .then((loaded) => {
        if (!live) return
        stored.current = loaded
        setData(loaded)
        setLoadError(undefined)
      })
      .catch((cause: unknown) => {
        if (!live) return
        // Leave `data` as it is. Replacing it with an empty garage would
        // show a rider an empty season and let them believe it.
        setLoadError(cause instanceof Error ? cause.message : 'Could not load your log.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [userId, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  /**
   * Show the change, then write it.
   *
   * A rider tapping a stepper in the pit lane should not wait on a round
   * trip per click, so the screen updates first. If the write fails the
   * error says so and the value stays on screen — losing what they typed
   * would be the worse of the two failures.
   */
  const commit = useCallback(
    (next: GarageData) => {
      setData(next)
      if (!userId) return
      const previous = stored.current
      stored.current = next
      setSaving(true)
      void withRetries(() => save(previous, next, userId))
        .then(() => setSaveError(undefined))
        .catch((cause: unknown) => {
          setSaveError(cause instanceof Error ? cause.message : 'Could not save that change.')
        })
        .finally(() => setSaving(false))
    },
    [userId],
  )

  const update = useCallback(
    (fn: (current: GarageData) => GarageData) => {
      setData((current) => {
        const next = fn(current)
        if (next === current) return current
        const stamped = { ...next, updatedAt: Date.now() }
        commit(stamped)
        return stamped
      })
    },
    [commit],
  )

  const replace = useCallback((next: GarageData) => commit(next), [commit])

  return {
    data,
    update,
    replace,
    reload,
    loading,
    saving,
    ...(loadError ? { loadError } : {}),
    ...(saveError ? { saveError } : {}),
  }
}
