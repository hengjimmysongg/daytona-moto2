/**
 * Keeping the browser and the server in step.
 *
 * The app stays local-first. Every edit is written to `localStorage` exactly
 * as before, so a track day in a field with no signal still works — the
 * server is a place the log is *also* kept, not the place it lives. Sync is
 * a background errand that runs when there is a network and a key.
 *
 * Conflict handling is deliberately blunt: the newer document wins whole.
 * For one rider's log book, opened on one device at a time, that is the
 * behaviour you want and the only one worth explaining. It is not a
 * multi-writer merge and does not pretend to be — two devices editing the
 * same day at once will keep whichever synced last.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GarageData } from '../core/types'

export const API_KEY_STORAGE = 'daytona-moto2:apiKey'

export type SyncState =
  | 'disabled'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'unauthorised'
  | 'error'

export type SyncDecision = 'adopt-server' | 'push-local' | 'in-sync'

interface Side {
  updatedAt: number
  isEmpty: boolean
}

/**
 * Which way the data should move.
 *
 * Emptiness is checked before timestamps on purpose. A browser that has
 * never been used has a fresh `updatedAt` from the moment it created its
 * empty document, which would otherwise look "newer" than a server holding
 * a season of real data and wipe it.
 */
export function decideSync(local: Side, server: Side): SyncDecision {
  if (local.isEmpty && server.isEmpty) return 'in-sync'
  if (local.isEmpty) return 'adopt-server'
  if (server.isEmpty) return 'push-local'
  if (server.updatedAt > local.updatedAt) return 'adopt-server'
  if (local.updatedAt > server.updatedAt) return 'push-local'
  return 'in-sync'
}

export function isGarageEmpty(data: GarageData): boolean {
  return (
    data.bikes.length === 0 &&
    data.trackDays.length === 0 &&
    data.sessions.length === 0 &&
    data.tyres.length === 0
  )
}

export function sideOf(data: GarageData): Side {
  return { updatedAt: data.updatedAt, isEmpty: isGarageEmpty(data) }
}

/* ------------------------------------------------------------------ */
/* Talking to the API                                                  */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request(path: string, key: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }
  return response.json()
}

export function fetchSnapshot(key: string): Promise<GarageData> {
  return request('/garage', key) as Promise<GarageData>
}

export function pushSnapshot(key: string, data: GarageData): Promise<GarageData> {
  return request('/garage', key, { method: 'PUT', body: JSON.stringify(data) }) as Promise<GarageData>
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function readStoredKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE)
  } catch {
    return null
  }
}

function writeStoredKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key)
    else localStorage.removeItem(API_KEY_STORAGE)
  } catch {
    // Storage is unavailable; the key simply will not survive a reload.
  }
}

export interface Sync {
  state: SyncState
  message?: string
  lastSyncedAt?: number
  key: string | null
  setKey: (key: string | null) => void
  syncNow: () => void
}

/** How long to wait after the last edit before pushing. */
const PUSH_DEBOUNCE_MS = 1500

export function useSync(
  data: GarageData,
  replace: (data: GarageData) => void,
): Sync {
  const [key, setKeyState] = useState<string | null>(() => readStoredKey())
  const [state, setState] = useState<SyncState>(key ? 'syncing' : 'disabled')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>(undefined)

  // The latest document, readable from a timer without re-arming it on
  // every keystroke.
  const latest = useRef(data)
  latest.current = data

  // What the server last confirmed, so an unchanged document is not pushed
  // again and a push that comes straight back does not start a loop.
  const settledAt = useRef<number | null>(null)
  const inFlight = useRef(false)

  const run = useCallback(async () => {
    if (!key) {
      setState('disabled')
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setState('syncing')
    try {
      const server = await fetchSnapshot(key)
      const local = latest.current
      const decision = decideSync(sideOf(local), sideOf(server))

      if (decision === 'adopt-server') {
        replace(server)
        settledAt.current = server.updatedAt
      } else if (decision === 'push-local') {
        const saved = await pushSnapshot(key, local)
        settledAt.current = saved.updatedAt
      } else {
        settledAt.current = server.updatedAt
      }
      setState('synced')
      setMessage(undefined)
      setLastSyncedAt(Date.now())
    } catch (error) {
      if (error instanceof ApiError) {
        setState(error.status === 401 ? 'unauthorised' : 'error')
        setMessage(error.message)
      } else {
        // A failed fetch on a track day is the normal case, not a fault.
        setState('offline')
        setMessage('No connection. Your log is saved on this device and will sync later.')
      }
    } finally {
      inFlight.current = false
    }
  }, [key, replace])

  // Sync on load, and whenever the key changes.
  const started = useRef<string | null>(null)
  useEffect(() => {
    if (!key) {
      setState('disabled')
      return
    }
    if (started.current === key) return
    started.current = key
    void run()
  }, [key, run])

  // Push edits once they stop coming.
  useEffect(() => {
    if (!key) return
    if (settledAt.current === null) return
    if (data.updatedAt === settledAt.current) return
    const timer = setTimeout(() => void run(), PUSH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [data.updatedAt, key, run])

  const setKey = useCallback((next: string | null) => {
    writeStoredKey(next)
    settledAt.current = null
    started.current = null
    setKeyState(next)
    setMessage(undefined)
  }, [])

  return {
    state,
    key,
    setKey,
    syncNow: () => void run(),
    ...(message ? { message } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }
}
