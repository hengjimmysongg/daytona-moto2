import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadGarage,
  memoryStorage,
  saveGarage,
  type StorageLike,
} from '../core/storage'
import type { GarageData } from '../core/types'

/**
 * `localStorage` exists but throws on write in a few browser modes, so probe
 * it once rather than discovering the problem when the rider saves their
 * first session. If it is unusable the app still runs, in memory, and says so.
 */
function resolveStorage(): { storage: StorageLike; persistent: boolean } {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = 'daytona-moto2:probe'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return { storage: localStorage, persistent: true }
    }
  } catch {
    // Private browsing, or storage disabled.
  }
  return { storage: memoryStorage(), persistent: false }
}

export interface Garage {
  data: GarageData
  /** Apply a change and persist it. */
  update: (fn: (data: GarageData) => GarageData) => void
  /** Replace the whole garage, as an import does. */
  replace: (data: GarageData) => void
  /** Set when the last read or write failed. */
  error?: string
  /** False when changes will be lost on reload. */
  persistent: boolean
}

export function useGarage(): Garage {
  const handle = useRef<{ storage: StorageLike; persistent: boolean } | null>(null)
  handle.current ??= resolveStorage()
  const { storage, persistent } = handle.current

  const initial = useRef<ReturnType<typeof loadGarage> | null>(null)
  initial.current ??= loadGarage(storage)

  const [data, setData] = useState<GarageData>(initial.current.data)
  const [error, setError] = useState<string | undefined>(initial.current.error)
  const firstRender = useRef(true)

  useEffect(() => {
    // Don't write on mount. If the stored record failed to parse, the rider
    // gets a chance to see the problem before an empty garage overwrites it.
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const result = saveGarage(storage, data)
    setError(result.error)
  }, [data, storage])

  const update = useCallback((fn: (current: GarageData) => GarageData) => {
    setData((current) => {
      const next = fn(current)
      if (next === current) return current
      // Every edit moves the document's clock, here in memory rather than on
      // the way to disk. Sync decides what to push by comparing this stamp
      // with the server's, so if only the stored copy moved, a change would
      // be saved locally and silently never leave the device.
      return { ...next, updatedAt: Date.now() }
    })
  }, [])

  const replace = useCallback((next: GarageData) => setData(next), [])

  return { data, update, replace, persistent, ...(error ? { error } : {}) }
}
