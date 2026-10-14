/**
 * The connection to the database, as the screen needs it.
 *
 * `src/data/reachability.ts` notices when requests stop getting through;
 * this keeps looking while they are not, so the note on screen clears by
 * itself once the database answers or the signal comes back, and looks
 * straight away when the device says it is back online.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { connection } from '../data/supabase'
import type { Reachability } from '../data/reachability'

/** How often to look again while something is wrong. */
const RECHECK_MS = 20_000

export interface Connection {
  state: Reachability
  /** True while a check is running, so a button can say so. */
  checking: boolean
  check: () => void
}

export function useConnection(): Connection {
  const state = useSyncExternalStore(connection.subscribe, connection.state)
  const checking = useSyncExternalStore(connection.subscribe, connection.checking)
  const check = useCallback(() => void connection.check(), [])

  // The device's own word on its signal is worth acting on at any time:
  // going offline should say so before the next save fails, not after.
  useEffect(() => {
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => {
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
    }
  }, [check])

  // Only while something is wrong: keep looking, and look again whenever
  // the rider comes back to the tab — a phone unlocked in the paddock.
  useEffect(() => {
    if (state === 'ok') return
    const timer = window.setInterval(check, RECHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state, check])

  return { state, checking, check }
}
