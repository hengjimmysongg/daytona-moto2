/**
 * Who is signed in.
 *
 * Supabase Auth owns the passwords, the tokens and the refresh; this is the
 * thin React wrapper over it. Signing up is free and open — the log belongs
 * to whoever made it, and row-level security in Postgres is what enforces
 * that on every query.
 */

import { useCallback, useEffect, useState } from 'react'
import { isAuthRetryableFetchError, type Session as AuthSession } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase } from '../data/supabase'

export interface Account {
  id: string
  email: string
}

export interface Auth {
  account: Account | null
  /** True until the stored session has been checked, so the UI can wait. */
  loading: boolean
  working: boolean
  /**
   * True while the rider is here from a password-reset email and owes us a new
   * password. It rides on a real (recovery) session, so it has to be checked
   * before `account` or the app would just open behind the form.
   */
  recovering: boolean
  /**
   * True when this device holds a sign-in that could not be checked because
   * the database did not answer. The rider is still signed in — the stored
   * session is kept, and opens the log once a refresh gets through — so this
   * must not be read as signed out, or they are shown "Create an account".
   */
  unreachable: boolean
  error?: string
  /** A word from the server worth showing, such as "confirm your email". */
  notice?: string
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** Email a link that brings the rider back in `recovering`. */
  resetPassword: (email: string) => Promise<void>
  /** Set a new password for the recovery session, which ends `recovering`. */
  updatePassword: (password: string) => Promise<void>
}

function toAccount(session: AuthSession | null): Account | null {
  const user = session?.user
  return user ? { id: user.id, email: user.email ?? '' } : null
}

export function useAuth(): Auth {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    void supabase.auth.getSession().then(({ data, error: failed }) => {
      if (!live) return
      setAccount(toAccount(data.session))
      // An expired token that could not be refreshed comes back as no
      // session plus this error. The session is still stored; only the
      // server was missing.
      setUnreachable(!data.session && isAuthRetryableFetchError(failed))
      setLoading(false)
    })
    // Covers a token refresh and a sign-out in another tab, not just our own
    // calls, so the two stay in step.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setAccount(toAccount(session))
      if (session || event === 'SIGNED_OUT') setUnreachable(false)
      setLoading(false)
      // A reset link signs the rider in on a recovery session; hold them at the
      // new-password form instead of opening the app behind it.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => {
      live = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const attempt = useCallback(async (run: () => Promise<string | undefined>) => {
    setWorking(true)
    setError(undefined)
    setNotice(undefined)
    try {
      setNotice(await run())
    } catch (cause) {
      // auth-js reports a request that got no answer in the browser's own
      // words — "Failed to fetch", "Load failed" — which say nothing to a
      // rider. Whether it was the signal or the database, the note above the
      // form says which.
      setError(
        isAuthRetryableFetchError(cause)
          ? 'Could not reach the database. Try again in a moment.'
          : cause instanceof Error
            ? cause.message
            : 'Something went wrong. Try again.',
      )
    } finally {
      setWorking(false)
    }
  }, [])

  const signUp = useCallback(
    (email: string, password: string) =>
      attempt(async () => {
        const { data, error: failed } = await supabase.auth.signUp({ email, password })
        if (failed) throw failed
        // With email confirmation switched on there is no session yet, and
        // saying so beats a form that looks like it did nothing.
        return data.session ? undefined : 'Account created. Check your email to confirm it, then sign in.'
      }),
    [attempt],
  )

  const signIn = useCallback(
    (email: string, password: string) =>
      attempt(async () => {
        const { error: failed } = await supabase.auth.signInWithPassword({ email, password })
        if (failed) throw failed
        return undefined
      }),
    [attempt],
  )

  const signOut = useCallback(
    () =>
      attempt(async () => {
        const { error: failed } = await supabase.auth.signOut()
        // With the server out of reach and a token it could not refresh,
        // auth-js keeps the sign-in and does nothing. Signing out on this
        // device is still the rider's call, so forget it here and start the
        // page over; the server forgets it when the token runs out.
        if (failed && isAuthRetryableFetchError(failed)) {
          try {
            if (window.localStorage.getItem(AUTH_STORAGE_KEY) !== null) {
              window.localStorage.removeItem(AUTH_STORAGE_KEY)
              window.location.reload()
            }
          } catch {
            // No storage to clear: nothing was kept on this device to begin with.
          }
        }
        return undefined
      }),
    [attempt],
  )

  const resetPassword = useCallback(
    (email: string) =>
      attempt(async () => {
        // The link lands back on whatever origin sent it — localhost in dev,
        // the deployed site in production — so no URL is hard-coded here. The
        // origin still has to be allow-listed in Supabase Auth's URL settings.
        const { error: failed } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (failed) throw failed
        // Say the same thing whether or not the address has an account, so this
        // can't be used to find out who has signed up.
        return 'If that email has an account, a link to set a new password is on its way.'
      }),
    [attempt],
  )

  const updatePassword = useCallback(
    (password: string) =>
      attempt(async () => {
        const { error: failed } = await supabase.auth.updateUser({ password })
        if (failed) throw failed
        // The recovery session is now an ordinary one — let the app open.
        setRecovering(false)
        return undefined
      }),
    [attempt],
  )

  return {
    account,
    loading,
    working,
    recovering,
    unreachable,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    ...(error ? { error } : {}),
    ...(notice ? { notice } : {}),
  }
}
