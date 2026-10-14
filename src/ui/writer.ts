/**
 * Writing the log.
 *
 * One loop closes the gap between what the database is known to hold and
 * what the screen shows. An edit made while a write is out is folded into
 * the next write instead of racing it, and a write that fails leaves the gap
 * open, so the next attempt — another edit, a retry, the database coming
 * back — sends it again rather than diffing past it.
 *
 * Plain TypeScript, no React and no Supabase, so it can be tested in Node:
 * the hook in `store.ts` hands it the actual write.
 */

export interface Writer<T> {
  /** The screen now shows `next`: write it, or fold it into the write running. */
  show: (next: T) => Promise<void>
  /** Write whatever has not landed yet, or join the write already running. */
  flush: () => Promise<void>
  /** The database holds exactly `loaded`. Abandons any write in progress. */
  reset: (loaded: T) => void
  /** Stop after the write in flight, which cannot be called back. */
  abandon: () => void
  /** True when something on screen has not reached the database yet. */
  pending: () => boolean
  /**
   * How many edits have been accepted, ever. A read of the log that started
   * before this moved may be older than the screen even when nothing is
   * pending any more — the edit landed while the read was on its way.
   */
  edits: () => number
}

export interface WriterOptions<T> {
  /** Write the difference between two states. Rejects if any of it failed. */
  save: (before: T, after: T) => Promise<void>
  /**
   * True for a failure that sending again cannot fix: the database answered
   * and said no. Holding such a change would hold every later change behind
   * it, so the writer moves past it and reports it instead.
   */
  final?: (cause: unknown) => boolean
  onSaving: (saving: boolean) => void
  /**
   * After a loop ends, or whenever nothing is left to send: `undefined` when
   * everything on screen is in the database, else why it is not.
   */
  onSettled: (failure: unknown) => void
  /** A change the database refused for good. It will not be sent again. */
  onRefused?: (cause: unknown) => void
}

/**
 * Nothing can be written until `reset` has said what the database holds.
 * Diffing against a guess — the empty log on screen before it has loaded —
 * would turn a one-field edit into a whole-row overwrite of the real thing.
 */
export function createWriter<T>(options: WriterOptions<T>): Writer<T> {
  let stored: T | undefined
  let shown: T | undefined
  let running: Promise<void> | null = null
  let edits = 0
  // Bumped whenever the loop must stop. A loop from before it has an idea of
  // what is stored that no longer holds — after a sign-out, diffing the empty
  // signed-out log against it would read as "delete everything" — so it may
  // finish the request in flight but must not act on the result.
  let generation = 0

  const loop = async (mine: number): Promise<void> => {
    // Let `flush` record this loop before any of it can finish.
    await undefined
    let failure: { cause: unknown } | undefined
    while (shown !== stored) {
      const base = stored as T
      const target = shown as T
      try {
        await options.save(base, target)
      } catch (cause) {
        if (generation !== mine) return
        if (options.final?.(cause)) {
          // What could land has landed; the rest never will. Carry on from
          // here so later edits are not stuck behind it.
          stored = target
          options.onRefused?.(cause)
          continue
        }
        failure = { cause: cause ?? new Error('The change could not be saved.') }
        break
      }
      if (generation !== mine) return
      stored = target
    }
    if (generation !== mine) return
    running = null
    options.onSaving(false)
    options.onSettled(failure?.cause)
  }

  const flush = (): Promise<void> => {
    if (running) return running
    if (shown === stored) {
      // Nothing to send, so nothing can be failing to send.
      options.onSettled(undefined)
      return Promise.resolve()
    }
    options.onSaving(true)
    running = loop(generation)
    return running
  }

  const abandon = () => {
    generation += 1
    if (running) {
      running = null
      options.onSaving(false)
    }
  }

  return {
    show: (next) => {
      if (stored === undefined) return Promise.resolve()
      shown = next
      edits += 1
      return flush()
    },
    flush,
    reset: (loaded) => {
      abandon()
      stored = loaded
      shown = loaded
      options.onSettled(undefined)
    },
    abandon,
    pending: () => shown !== stored,
    edits: () => edits,
  }
}
