/**
 * Who is signed in.
 *
 * Supabase Auth owns the passwords, the tokens and the refresh; this is the
 * thin React wrapper over it. Signing up is free and open — the log belongs
 * to whoever made it, and row-level security in Postgres is what enforces
 * that on every query.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Session as AuthSession } from '@supabase/supabase-js'
import { supabase } from '../data/supabase'

export interface Account {
  id: string
  email: string
}

export interface Auth {
  account: Account | null
  /** True until the stored session has been checked, so the UI can wait. */
  loading: boolean
  working: boolean
  error?: string
  /** A word from the server worth showing, such as "confirm your email". */
  notice?: string
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

function toAccount(session: AuthSession | null): Account | null {
  const user = session?.user
  return user ? { id: user.id, email: user.email ?? '' } : null
}

export function useAuth(): Auth {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setAccount(toAccount(data.session))
      setLoading(false)
    })
    // Covers a token refresh and a sign-out in another tab, not just our own
    // calls, so the two stay in step.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccount(toAccount(session))
      setLoading(false)
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
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.')
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
        await supabase.auth.signOut()
        return undefined
      }),
    [attempt],
  )

  return {
    account,
    loading,
    working,
    signUp,
    signIn,
    signOut,
    ...(error ? { error } : {}),
    ...(notice ? { notice } : {}),
  }
}
