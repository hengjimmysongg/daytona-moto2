import { describe, expect, it } from 'vitest'
import { createWriter, type WriterOptions } from '../src/ui/writer'

interface Log {
  rows: string[]
}

const log = (...rows: string[]): Log => ({ rows })

/**
 * A database that records each write as "before -> after" and can be told to
 * fail, or to hold a write open until released.
 */
function database() {
  const writes: string[] = []
  const settled: unknown[] = []
  const saving: boolean[] = []
  let failing = false
  let held: (() => void) | undefined

  const options: WriterOptions<Log> = {
    save: async (before, after) => {
      writes.push(`${before.rows.join(',')} -> ${after.rows.join(',')}`)
      if (held === undefined && failing) throw new Error('the database could not be reached')
      if (held !== undefined) {
        await new Promise<void>((resolve) => {
          held = resolve
        })
      }
      if (failing) throw new Error('the database could not be reached')
    },
    onSaving: (value) => saving.push(value),
    onSettled: (failure) => settled.push(failure instanceof Error ? failure.message : failure),
  }

  return {
    options,
    writes,
    settled,
    saving,
    fail: (value: boolean) => {
      failing = value
    },
    /** Hold the next write open until `release` is called. */
    hold: () => {
      held = () => undefined
    },
    release: () => {
      const resolve = held
      held = undefined
      resolve?.()
    },
  }
}

/** A writer that has been told what the database holds. */
function started(options: WriterOptions<Log>, stored: Log) {
  const writer = createWriter(options)
  writer.reset(stored)
  return writer
}

/** Let every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createWriter', () => {
  it('writes each change against what the database holds', async () => {
    const db = database()
    const writer = started(db.options, log())
    await writer.show(log('a'))
    await writer.show(log('a', 'b'))
    expect(db.writes).toEqual([' -> a', 'a -> a,b'])
    expect(db.settled.slice(1)).toEqual([undefined, undefined])
    expect(writer.pending()).toBe(false)
  })

  it('folds edits made during a write into the next one, in order', async () => {
    const db = database()
    const writer = started(db.options, log())
    db.hold()
    const first = writer.show(log('a'))
    await settle()
    void writer.show(log('a', 'b'))
    void writer.show(log('a', 'b', 'c'))
    db.release()
    await first
    // One write for the first edit, then one for both edits made meanwhile.
    expect(db.writes).toEqual([' -> a', 'a -> a,b,c'])
  })

  it('sends a failed change again with the next attempt instead of diffing past it', async () => {
    const db = database()
    const writer = started(db.options, log('a'))
    db.fail(true)
    await writer.show(log('a', 'b'))
    expect(db.settled.at(-1)).toBe('the database could not be reached')
    expect(writer.pending()).toBe(true)

    db.fail(false)
    await writer.flush()
    expect(db.writes.at(-1)).toBe('a -> a,b')
    expect(db.settled.at(-1)).toBeUndefined()
    expect(writer.pending()).toBe(false)
  })

  it('carries a failed change along with the next edit', async () => {
    const db = database()
    const writer = started(db.options, log('a'))
    db.fail(true)
    await writer.show(log('a', 'b'))
    db.fail(false)
    await writer.show(log('a', 'b', 'c'))
    expect(db.writes.at(-1)).toBe('a -> a,b,c')
  })

  it('does nothing when there is nothing to write, and says nothing is failing', async () => {
    const db = database()
    const writer = started(db.options, log('a'))
    db.settled.length = 0
    await writer.flush()
    expect(db.writes).toEqual([])
    expect(db.saving).toEqual([])
    expect(db.settled).toEqual([undefined])
  })

  it('reports saving while a loop runs, and only once it has finished', async () => {
    const db = database()
    const writer = started(db.options, log())
    db.hold()
    const done = writer.show(log('a'))
    expect(db.saving).toEqual([true])
    await settle()
    void writer.show(log('a', 'b'))
    db.release()
    await done
    expect(db.saving).toEqual([true, false])
  })

  it('never acts on a write from before a sign-out — no "delete everything"', async () => {
    const db = database()
    const writer = started(db.options, log('mine'))
    db.hold()
    const inFlight = writer.show(log('mine', 'new'))
    await settle()
    // Signed out while that write was out: the screen is now an empty log.
    writer.reset(log())
    db.release()
    await inFlight
    await settle()
    // The write already sent finishes, but nothing follows it: diffing the
    // empty log against the old one would have deleted every row.
    expect(db.writes).toEqual(['mine -> mine,new'])
    // Only the resets speak: the abandoned loop reports nothing.
    expect(db.settled).toEqual([undefined, undefined])
    expect(writer.pending()).toBe(false)
  })

  it('starts afresh after a reset rather than waiting on the abandoned loop', async () => {
    const db = database()
    const writer = started(db.options, log('old'))
    db.hold()
    void writer.show(log('old', 'x'))
    await settle()
    writer.reset(log('loaded'))
    db.release()
    await writer.show(log('loaded', 'y'))
    expect(db.writes).toEqual(['old -> old,x', 'loaded -> loaded,y'])
    expect(db.settled).toEqual([undefined, undefined, undefined])
  })

  it('reports a rejection with no reason as a failure, not a success', async () => {
    const db = database()
    const writer = started({ ...db.options, save: () => Promise.reject(undefined) }, log())
    await writer.show(log('a'))
    expect(db.settled.at(-1)).toBe('The change could not be saved.')
  })

  it('writes nothing until it has been told what the database holds', async () => {
    // Before the log has loaded the screen shows a stand-in empty log; a
    // one-field edit to that, diffed and sent, would overwrite the real row.
    const db = database()
    const writer = createWriter(db.options)
    await writer.show(log('edited-defaults'))
    await writer.flush()
    expect(db.writes).toEqual([])
    expect(writer.pending()).toBe(false)

    writer.reset(log('real'))
    await writer.show(log('real', 'b'))
    expect(db.writes).toEqual(['real -> real,b'])
  })

  it('clears a failure when a reset leaves nothing to send', async () => {
    const db = database()
    const writer = started(db.options, log('a'))
    db.fail(true)
    await writer.show(log('a', 'b'))
    expect(db.settled.at(-1)).toBe('the database could not be reached')
    writer.reset(log('a', 'b'))
    expect(db.settled.at(-1)).toBeUndefined()
  })

  it('moves past a change the database refused, reports it, and keeps writing', async () => {
    const refusals: unknown[] = []
    const db = database()
    let refuse = true
    const writer = started(
      {
        ...db.options,
        save: async (before, after) => {
          await db.options.save(before, after)
          if (refuse && after.rows.includes('bad')) throw new Error('violates foreign key constraint')
        },
        final: (cause) => cause instanceof Error && /constraint/.test(cause.message),
        onRefused: (cause) => refusals.push(cause instanceof Error ? cause.message : cause),
      },
      log('a'),
    )
    await writer.show(log('a', 'bad'))
    expect(refusals).toEqual(['violates foreign key constraint'])
    expect(writer.pending()).toBe(false)
    // Not reported as a pending failure, and the next edit is not held behind it.
    expect(db.settled.at(-1)).toBeUndefined()
    refuse = false
    await writer.show(log('a', 'bad', 'c'))
    expect(db.writes.at(-1)).toBe('a,bad -> a,bad,c')
  })

  it('counts every accepted edit, landed or not, so a read can tell it is stale', async () => {
    const db = database()
    const writer = createWriter(db.options)
    await writer.show(log('before-load'))
    expect(writer.edits()).toBe(0)
    writer.reset(log('a'))
    const mark = writer.edits()
    await writer.show(log('a', 'b'))
    // Landed and nothing pending, but a read taken before it is older than this.
    expect(writer.pending()).toBe(false)
    expect(writer.edits()).not.toBe(mark)
  })

  it('keeps retrying a failure that is not final', async () => {
    const db = database()
    const writer = started({ ...db.options, final: () => false }, log('a'))
    db.fail(true)
    await writer.show(log('a', 'b'))
    expect(writer.pending()).toBe(true)
  })
})
