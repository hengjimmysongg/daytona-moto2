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
 *
 * What the server keeps is scoped to an account, so syncing means being
 * signed in. Signing in is not signing up for the app, though: the log
 * works with no account at all, and an account is what makes it the same
 * log on the next device.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GarageData } from '../core/types'

/**
 * The signed-in session, kept so a reload does not ask for a password
 * again. The email rides along so the app can say who is signed in without
 * a round trip it might not have the signal for.
 */
export const ACCOUNT_STORAGE = 'daytona-moto2:account'

export interface Account {
  email: string
  token: string
}

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

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

interface SignedIn {
  token: string
  user: { id: string; email: string }
}

async function authRequest(path: string, email: string, password: string): Promise<Account> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json().catch(() => null)) as ({ error?: string } & SignedIn) | null
  if (!response.ok || !body?.token) {
    throw new ApiError(body?.error ?? `Could not ${path} (${response.status})`, response.status)
  }
  return { email: body.user.email, token: body.token }
}

export function signUpRequest(email: string, password: string): Promise<Account> {
  return authRequest('signup', email, password)
}

export function signInRequest(email: string, password: string): Promise<Account> {
  return authRequest('login', email, password)
}

/** Best effort: the local sign-out is what matters, the server is courtesy. */
export async function signOutRequest(token: string): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
  } catch {
    // Offline. The token will expire on its own.
  }
}

export function pushSnapshot(key: string, data: GarageData): Promise<GarageData> {
  return request('/garage', key, { method: 'PUT', body: JSON.stringify(data) }) as Promise<GarageData>
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function readStoredAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Account>
    if (typeof parsed.token !== 'string' || typeof parsed.email !== 'string') return null
    return { token: parsed.token, email: parsed.email }
  } catch {
    // Unreadable or unparseable: treat it as signed out rather than
    // wedging the app on a corrupt value it cannot fix.
    return null
  }
}

function writeStoredAccount(account: Account | null): void {
  try {
    if (account) localStorage.setItem(ACCOUNT_STORAGE, JSON.stringify(account))
    else localStorage.removeItem(ACCOUNT_STORAGE)
  } catch {
    // Storage is unavailable; the sign-in simply will not survive a reload.
  }
}

export interface Sync {
  state: SyncState
  message?: string
  lastSyncedAt?: number
  /** The signed-in rider, or null when the log is on this device only. */
  account: Account | null
  /** True while a sign-up or sign-in is in flight. */
  signingIn: boolean
  /** Why the last sign-up or sign-in failed, if it did. */
  authError?: string
  signUp: (email: string, password: string) => Promise<boolean>
  signIn: (email: string, password: string) => Promise<boolean>
  signOut: () => void
  syncNow: () => void
}

/** How long to wait after the last edit before pushing. */
const PUSH_DEBOUNCE_MS = 1500

export function useSync(
  data: GarageData,
  replace: (data: GarageData) => void,
): Sync {
  const [account, setAccount] = useState<Account | null>(() => readStoredAccount())
  const [state, setState] = useState<SyncState>(account ? 'syncing' : 'disabled')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | undefined>(undefined)
  const [signingIn, setSigningIn] = useState(false)
  const [authError, setAuthError] = useState<string | undefined>(undefined)
  const key = account?.token ?? null

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

  const adopt = useCallback((next: Account | null) => {
    writeStoredAccount(next)
    // Forget what the last account had settled on, or the first push after
    // switching riders would be skipped as "already synced".
    settledAt.current = null
    started.current = null
    setAccount(next)
    setMessage(undefined)
    setAuthError(undefined)
  }, [])

  const attempt = useCallback(
    async (call: () => Promise<Account>): Promise<boolean> => {
      setSigningIn(true)
      setAuthError(undefined)
      try {
        adopt(await call())
        return true
      } catch (error) {
        setAuthError(
          error instanceof ApiError
            ? error.message
            : 'Could not reach the server. Your log is still safe on this device.',
        )
        return false
      } finally {
        setSigningIn(false)
      }
    },
    [adopt],
  )

  const signOut = useCallback(() => {
    // Local first: being signed out should not depend on having a signal.
    const token = account?.token
    adopt(null)
    setState('disabled')
    if (token) void signOutRequest(token)
  }, [account, adopt])

  return {
    state,
    account,
    signingIn,
    signUp: (email, password) => attempt(() => signUpRequest(email, password)),
    signIn: (email, password) => attempt(() => signInRequest(email, password)),
    signOut,
    syncNow: () => void run(),
    ...(message ? { message } : {}),
    ...(authError ? { authError } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }
}
