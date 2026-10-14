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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { connection, supabase } from '../data/supabase'
import { isOutageStatus } from '../data/reachability'
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
import { createWriter } from './writer'

export interface Garage {
  data: GarageData
  /** Apply a change and write it. */
  update: (fn: (data: GarageData) => GarageData) => void
  /** Replace the whole garage, as an import does. */
  replace: (data: GarageData) => void
  /** True while a load is running. */
  loading: boolean
  /**
   * True once the log has been read for this rider. Until then the screen
   * has nothing real to show, and nothing on it may be written: an edit made
   * against the empty stand-in would overwrite the real log once it is sent.
   */
  loaded: boolean
  /** True while a write is in flight. */
  saving: boolean
  /**
   * Set when the log could not be read. The screen is empty because we do
   * not know what is in there — not because anything was lost.
   */
  loadError?: string
  /** Set when a change on screen has not reached the database yet. */
  saveError?: string
  /**
   * Set when the database refused a change outright. It will not be sent
   * again; the screen may now show something the database does not hold.
   */
  saveRefused?: string
  /** Read the log again — after sending anything still unsent. */
  reload: () => void
  /** Send whatever has not reached the database yet. */
  retrySave: () => void
}

/* ------------------------------------------------------------------ */
/* Failures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A request that failed, with the status a bare message would lose: 0 means
 * the request never got an answer the browser would show us, which is what
 * a down project and a dead connection both look like from here.
 */
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }

  /**
   * The database answered and said no — a constraint, a policy, a column it
   * does not have. Sending the same thing again gets the same answer. Not
   * 401 (a token that has just been refreshed can be a second early), 408
   * or 429, which do pass.
   */
  get refused(): boolean {
    return (
      this.status >= 400 &&
      this.status < 500 &&
      this.status !== 401 &&
      this.status !== 408 &&
      this.status !== 429
    )
  }
}

interface Result {
  error: { message: string } | null
  status: number
}

/** One failed result, worded for a rider. */
function asError(failed: Result & { error: { message: string } }): RequestError {
  // PostgREST's own words for a failed fetch are "TypeError: Failed to
  // fetch", and for a gateway error an HTML page; neither belongs on screen.
  if (failed.status === 0) return new RequestError('the database could not be reached', 0)
  if (isOutageStatus(failed.status)) {
    return new RequestError('the database is not responding', failed.status)
  }
  return new RequestError(failed.error.message, failed.status)
}

/**
 * The failure that matters among some results: one that may pass if tried
 * again comes before one that never will, because it is what stops the rest.
 */
function firstFailure(results: ReadonlyArray<Result>): RequestError | undefined {
  const failures = results
    .filter((result): result is Result & { error: { message: string } } => result.error !== null)
    .map(asError)
  return failures.find((failure) => !failure.refused) ?? failures[0]
}

/** No answer at all, or an answer on a down project's behalf. */
function isUnreachable(cause: unknown): boolean {
  return cause instanceof RequestError && (cause.status === 0 || isOutageStatus(cause.status))
}

function isRefusal(cause: unknown): boolean {
  return cause instanceof RequestError && cause.refused
}

/**
 * The rider's own access token, or a failure if there is not one to hand.
 *
 * Without one the client falls back to the publishable key, and row-level
 * security answers that quietly: a read comes back empty — a season that
 * looks loaded — and a delete matches nothing and looks done. That is the
 * state for up to a minute after an outage, while auth-js waits out a failed
 * refresh, so it has to count as not reachable yet rather than as an answer.
 */
async function accessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) {
    throw new RequestError('your sign-in could not be checked with the database', 0)
  }
  return data.session.access_token
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadGarage(): Promise<GarageData> {
  // Pinned to every query, so a retry inside the client after the token
  // lapses cannot quietly drop back to the publishable key either.
  const bearer = `Bearer ${await accessToken()}`
  const [bikes, tyres, days, sessions, prefs] = await Promise.all([
    supabase.from('bikes').select('*').order('created_at').setHeader('Authorization', bearer),
    supabase.from('tyres').select('*').order('created_at').setHeader('Authorization', bearer),
    supabase.from('track_days').select('*').order('date').setHeader('Authorization', bearer),
    supabase.from('sessions').select('*').order('number').setHeader('Authorization', bearer),
    supabase.from('preferences').select('*').setHeader('Authorization', bearer).maybeSingle(),
  ])

  const failure = firstFailure([bikes, tyres, days, sessions, prefs])
  if (failure) throw failure

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
  // Never as anyone else: see `accessToken`. Pinned to every write, so a
  // token that lapses between stages fails loudly instead of deleting
  // nothing as the publishable key and calling it done.
  const bearer = `Bearer ${await accessToken()}`
  const as = <B extends { setHeader(name: string, value: string): B }>(builder: B): B =>
    builder.setHeader('Authorization', bearer)
  const owned = (row: Row): Row => ({ ...row, user_id: userId })

  const bikes = diff(before.bikes, after.bikes)
  const tyres = diff(before.tyres, after.tyres)
  const days = diff(before.trackDays, after.trackDays)
  const sessions = diff(before.sessions, after.sessions)

  // Order matters in both directions: a session cannot reference a track day
  // that is not there yet, and a track day cannot be deleted while its
  // sessions still point at it. So each stage has to land before the next
  // starts. A stage that did not get through stops the rest, which would
  // only fail on the row it did not write, and the whole change goes again.
  // A stage the database refused does not: the rest still go, and the
  // refusal is reported once they have.
  const writes: PromiseLike<Result>[] = []
  let refusal: RequestError | undefined
  const land = async () => {
    const failure = firstFailure(await Promise.all(writes))
    writes.length = 0
    if (!failure) return
    if (!failure.refused) throw failure
    refusal ??= failure
  }

  if (sessions.removed.length) {
    writes.push(as(supabase.from('sessions').delete().in('id', sessions.removed)))
  }
  if (days.removed.length) {
    writes.push(as(supabase.from('track_days').delete().in('id', days.removed)))
  }
  await land()

  if (bikes.changed.length) {
    writes.push(as(supabase.from('bikes').upsert(bikes.changed.map((b) => owned(fromBike(b))))))
  }
  if (tyres.changed.length) {
    writes.push(as(supabase.from('tyres').upsert(tyres.changed.map((t) => owned(fromTyre(t))))))
  }
  await land()

  if (days.changed.length) {
    writes.push(
      as(supabase.from('track_days').upsert(days.changed.map((d) => owned(fromTrackDay(d))))),
    )
  }
  await land()

  if (sessions.changed.length) {
    writes.push(
      as(supabase.from('sessions').upsert(sessions.changed.map((s) => owned(fromSession(s))))),
    )
  }
  if (bikes.removed.length) {
    writes.push(as(supabase.from('bikes').delete().in('id', bikes.removed)))
  }
  if (tyres.removed.length) {
    writes.push(as(supabase.from('tyres').delete().in('id', tyres.removed)))
  }
  if (JSON.stringify(before.preferences) !== JSON.stringify(after.preferences)) {
    writes.push(
      as(supabase.from('preferences').upsert(owned(fromPreferences(after.preferences, Date.now())))),
    )
  }

  await land()
  if (refusal) throw refusal
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

/**
 * `stillWanted` lets a caller that has moved on stop this early: a load that
 * has been superseded must not keep retrying, and above all must not keep
 * refreshing the token — every refresh is an auth event, and auth events
 * start catch-ups.
 */
async function withRetries<T>(
  attempt: () => Promise<T>,
  stillWanted: () => boolean = () => true,
): Promise<T> {
  let last: unknown
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    try {
      return await attempt()
    } catch (cause) {
      last = cause
      // The same request gets the same "no".
      if (isRefusal(cause)) break
      const wait = RETRY_DELAYS_MS[index]
      if (wait === undefined) break
      await sleep(wait)
      if (!stillWanted()) break
      // A new token, in case the old one was the problem. Best effort: if
      // this fails the retry below will surface the real error. Not when
      // nothing answered, though: a token is not the problem then, and
      // refreshing against a server that is not there backs off for most of
      // half a minute before it gives up.
      if (!isUnreachable(cause)) {
        await supabase.auth.refreshSession().catch(() => undefined)
      }
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
  const [saveRefused, setSaveRefused] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  // One per signed-in rider, so a write can never land under somebody else.
  const writer = useMemo(
    () =>
      createWriter<GarageData>({
        save: (before, after) =>
          userId ? withRetries(() => save(before, after, userId)) : Promise.resolve(),
        final: isRefusal,
        onSaving: setSaving,
        onSettled: (failure) =>
          setSaveError(
            failure === undefined
              ? undefined
              : failure instanceof Error
                ? failure.message
                : 'Could not save that change.',
          ),
        onRefused: (cause) =>
          setSaveRefused(cause instanceof Error ? cause.message : 'it gave no reason'),
      }),
    [userId],
  )
  useEffect(() => () => writer.abandon(), [writer])

  // Which writer the log on screen was read for. Per writer rather than a
  // flag, so a new rider starts unloaded without a render in between.
  const [loadedFor, setLoadedFor] = useState<typeof writer | null>(null)
  const loaded = loadedFor === writer
  // Whether a load is running right now, for the catch-up below, which must
  // never start a second one over the first.
  const loadingNow = useRef(false)

  useEffect(() => {
    if (!userId) {
      const empty = createEmptyGarage()
      writer.reset(empty)
      setData(empty)
      setLoadError(undefined)
      setSaveRefused(undefined)
      setLoading(false)
      loadingNow.current = false
      return
    }
    let live = true
    setLoading(true)
    loadingNow.current = true
    const mark = writer.edits()
    void withRetries(loadGarage, () => live)
      .then((fresh) => {
        if (!live) return
        if (writer.pending() || writer.edits() !== mark) {
          // Read while a change was on its way, or after one was made, so
          // this copy may be older than the screen — even if the change has
          // landed since. Send anything unsent, then read again: replacing
          // the screen with this would undo the change, and the next edit to
          // that row would write the old values back.
          void writer.flush().then(() => {
            if (live && !writer.pending()) setAttempt((count) => count + 1)
          })
          return
        }
        writer.reset(fresh)
        setData(fresh)
        setLoadedFor(writer)
        setLoadError(undefined)
        setSaveRefused(undefined)
      })
      .catch((cause: unknown) => {
        if (!live) return
        // Leave `data` as it is. Replacing it with an empty garage would
        // show a rider an empty season and let them believe it.
        setLoadError(cause instanceof Error ? cause.message : 'Could not load your log.')
      })
      .finally(() => {
        if (!live) return
        setLoading(false)
        loadingNow.current = false
      })
    return () => {
      live = false
    }
  }, [writer, userId, attempt])

  // Never read over a change that has not been sent: send it first, and read
  // only once nothing is left. If it cannot be sent, the save note says so
  // and the screen keeps it.
  const reload = useCallback(() => {
    void writer.flush().then(() => {
      if (!writer.pending()) setAttempt((count) => count + 1)
    })
  }, [writer])

  /**
   * Show the change, then write it.
   *
   * A rider tapping a stepper in the pit lane should not wait on a round
   * trip per click, so the screen updates first. If the write fails the
   * error says so and the value stays on screen — losing what they typed
   * would be the worse of the two failures — and it goes out again with the
   * next edit, a retry, or the database coming back.
   */
  const commit = useCallback(
    (next: GarageData) => {
      setData(next)
      void writer.show(next)
    },
    [writer],
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

  const retrySave = useCallback(() => void writer.flush(), [writer])

  // When the database comes back, finish what it missed: send the changes it
  // never got, then read the log if it never arrived — in that order, and the
  // read only once nothing is left to send. Two things can mean it is back:
  // a request getting through, and auth-js refreshing the token it could not
  // refresh while it was away. The second can come up to a minute after the
  // first, and until it does every write would go out without the rider's
  // token, so both start the same catch-up.
  const loadErrorNow = useRef(loadError)
  loadErrorNow.current = loadError
  const catchUp = useCallback(() => {
    void writer.flush().then(() => {
      // A load already running will report for itself. Restarting it would
      // also loop: its own retries refresh the token, which comes back here.
      if (loadErrorNow.current && !loadingNow.current && !writer.pending()) {
        setAttempt((count) => count + 1)
      }
    })
  }, [writer])

  const reachable = useSyncExternalStore(connection.subscribe, connection.state)
  const wasUnreachable = useRef(false)
  useEffect(() => {
    if (reachable !== 'ok') {
      wasUnreachable.current = true
      return
    }
    if (!wasUnreachable.current) return
    wasUnreachable.current = false
    catchUp()
  }, [reachable, catchUp])

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session || (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN')) return
      // Out of the callback first: auth-js holds its lock while it runs, and
      // the catch-up asks it for the session.
      setTimeout(catchUp, 0)
    })
    return () => listener.subscription.unsubscribe()
  }, [catchUp])

  // "Keep this page open until the badge says Saved" — so ask before it
  // closes with something unsent.
  const unsent = saving || saveError !== undefined
  useEffect(() => {
    if (!unsent) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsent])

  return {
    data,
    update,
    replace,
    reload,
    retrySave,
    loading,
    loaded,
    saving,
    ...(loadError ? { loadError } : {}),
    ...(saveError ? { saveError } : {}),
    ...(saveRefused ? { saveRefused } : {}),
  }
}
