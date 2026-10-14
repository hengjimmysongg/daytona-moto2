import { describe, expect, it } from 'vitest'
import { createMonitor, isOutageStatus, probe, type MonitorOptions } from '../src/data/reachability'

const URL = 'https://ref.supabase.co'
const TARGET = `${URL}/rest/v1/bikes?select=id&limit=0`

/**
 * A fetch that behaves the way a browser does in each case. `cors` is what an
 * ordinary request gets: a readable status, or a TypeError when the reply was
 * blocked or never came. `opaque` is what a no-cors request gets: it resolves
 * whenever any server answered, and fails only when none did.
 */
function browser(cors: number | 'blocked' | 'unreachable', opaque = cors !== 'unreachable') {
  const calls: { url: string; mode?: RequestMode }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, ...(init?.mode ? { mode: init.mode } : {}) })
    if (init?.mode === 'no-cors') {
      if (!opaque) throw new TypeError('Failed to fetch')
      return new Response(null, { status: 200 })
    }
    if (typeof cors !== 'number') throw new TypeError('Failed to fetch')
    return new Response('{}', { status: cors })
  }
  return { fetch, calls }
}

/** A readable request that never answers until its signal gives up. */
function hangsUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}

function options(fetch: typeof globalThis.fetch, extra: Partial<MonitorOptions> = {}): MonitorOptions {
  return { target: TARGET, headers: { apikey: 'publishable' }, fetch, online: () => true, ...extra }
}

describe('isOutageStatus', () => {
  it('counts gateway and paused-project statuses as an outage', () => {
    for (const status of [502, 503, 504, 520, 521, 522, 530, 540, 544]) {
      expect(isOutageStatus(status), String(status)).toBe(true)
    }
  })

  it('leaves the database answering, even with an error, alone', () => {
    for (const status of [0, 200, 201, 204, 400, 401, 403, 404, 409, 500, 501, 531]) {
      expect(isOutageStatus(status), String(status)).toBe(false)
    }
  })
})

describe('probe', () => {
  it('is offline without asking anything when the device says so', async () => {
    const { fetch, calls } = browser(200)
    expect(await probe(options(fetch, { online: () => false }))).toBe('offline')
    expect(calls).toEqual([])
  })

  it('is ok when the health check answers', async () => {
    const { fetch, calls } = browser(200)
    expect(await probe(options(fetch))).toBe('ok')
    expect(calls).toEqual([{ url: TARGET }])
  })

  it('is down when the health check answers with an outage status it can read', async () => {
    expect(await probe(options(browser(503).fetch))).toBe('down')
    expect(await probe(options(browser(540).fetch))).toBe('down')
  })

  it('is down when the reply is blocked every time but an opaque request gets through', async () => {
    // A paused project: 521 with no CORS headers, so the browser hides it.
    const { fetch, calls } = browser('blocked')
    expect(await probe(options(fetch))).toBe('down')
    expect(calls).toEqual([{ url: TARGET }, { url: TARGET, mode: 'no-cors' }, { url: TARGET }])
  })

  it('is ok when the readable request only failed once — a blip, not a pause', async () => {
    let readable = 0
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 })
      readable += 1
      if (readable === 1) throw new TypeError('Failed to fetch')
      return new Response('[]', { status: 200 })
    }
    expect(await probe(options(fetch))).toBe('ok')
  })

  it('blames the connection, not the project, when the readable request runs out of time', async () => {
    // A weak signal: the slow request times out, and a quick opaque one would
    // have got through — that must not read as "paused".
    const fetch: typeof globalThis.fetch = (_input, init) =>
      init?.mode === 'no-cors' ? Promise.resolve(new Response(null)) : hangsUntilAborted(init)
    expect(await probe(options(fetch, { timeoutMs: 10 }))).toBe('offline')
  })

  it('is offline when nothing can be reached either way', async () => {
    expect(await probe(options(browser('unreachable').fetch))).toBe('offline')
  })

  it('reads a probe that times out as unanswered', async () => {
    const hang: typeof globalThis.fetch = (_input, init) => hangsUntilAborted(init)
    expect(await probe(options(hang, { timeoutMs: 10 }))).toBe('offline')
  })

  it('sends the key with the readable request', async () => {
    let headers: HeadersInit | undefined
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      headers = init?.headers
      return new Response('[]', { status: 200 })
    }
    await probe(options(fetch))
    expect(headers).toEqual({ apikey: 'publishable' })
  })
})

describe('createMonitor', () => {
  it('starts ok and passes responses straight through', async () => {
    const monitor = createMonitor(options(browser(200).fetch))
    expect(monitor.state()).toBe('ok')
    const response = await monitor.fetch(`${URL}/rest/v1/bikes`)
    expect(response.status).toBe(200)
    expect(monitor.state()).toBe('ok')
  })

  it('goes down on a readable outage status without probing', async () => {
    const { fetch, calls } = browser(521)
    const monitor = createMonitor(options(fetch))
    const response = await monitor.fetch(`${URL}/rest/v1/bikes`)
    expect(response.status).toBe(521)
    expect(monitor.state()).toBe('down')
    expect(calls).toHaveLength(1)
  })

  it('rethrows a failed request and works out which end the problem is', async () => {
    const monitor = createMonitor(options(browser('blocked').fetch))
    await expect(monitor.fetch(`${URL}/rest/v1/bikes`)).rejects.toThrow('Failed to fetch')
    expect(await monitor.check()).toBe('down')
    expect(monitor.state()).toBe('down')
  })

  it('tells a dead connection from a down project', async () => {
    const monitor = createMonitor(options(browser('unreachable').fetch))
    await expect(monitor.fetch(`${URL}/rest/v1/bikes`)).rejects.toThrow()
    expect(await monitor.check()).toBe('offline')
  })

  it('runs one check for a burst of failures, not one each', async () => {
    const { fetch, calls } = browser('blocked')
    const monitor = createMonitor(options(fetch))
    const token = `${URL}/auth/v1/token`
    await Promise.allSettled([monitor.fetch(token), monitor.fetch(token), monitor.fetch(token)])
    await monitor.check()
    // Three failed requests, then one probe: readable, opaque, readable again.
    expect(calls.filter((call) => call.url === TARGET)).toHaveLength(3)
  })

  it('stays quiet for a while after finding a problem, then looks again', async () => {
    let clock = 0
    const { fetch, calls } = browser('blocked')
    const monitor = createMonitor(options(fetch, { now: () => clock, quietMs: 5000 }))
    const probes = () => calls.filter((call) => call.url === TARGET && call.mode).length

    await monitor.fetch(`${URL}/auth/v1/token`).catch(() => undefined)
    await monitor.check()
    expect(probes()).toBe(1)

    clock = 4000
    await monitor.fetch(`${URL}/auth/v1/token`).catch(() => undefined)
    await monitor.check() // the explicit one still runs
    expect(probes()).toBe(2)

    clock = 4500
    await monitor.fetch(`${URL}/auth/v1/token`).catch(() => undefined)
    expect(monitor.checking()).toBe(false)

    clock = 10_000
    await monitor.fetch(`${URL}/auth/v1/token`).catch(() => undefined)
    expect(monitor.checking()).toBe(true)
  })

  it('does not treat a request the app cancelled as a connection problem', async () => {
    const abort: typeof globalThis.fetch = async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    const monitor = createMonitor(options(abort))
    await expect(monitor.fetch(`${URL}/rest/v1/bikes`)).rejects.toThrow()
    expect(monitor.checking()).toBe(false)
    expect(monitor.state()).toBe('ok')
  })

  it('comes back to ok as soon as a request gets an ordinary answer', async () => {
    let status: number | 'blocked' = 'blocked'
    const fetch: typeof globalThis.fetch = (input, init) => browser(status).fetch(input, init)
    const monitor = createMonitor(options(fetch))
    await monitor.check()
    expect(monitor.state()).toBe('down')

    status = 401 // the database refusing a request is the database answering
    await monitor.fetch(`${URL}/rest/v1/bikes`)
    expect(monitor.state()).toBe('ok')
  })

  it('tells subscribers when the state or the checking flag changes', async () => {
    const monitor = createMonitor(options(browser('blocked').fetch))
    const seen: string[] = []
    const unsubscribe = monitor.subscribe(() => seen.push(`${monitor.state()}${monitor.checking() ? '…' : ''}`))
    await monitor.check()
    expect(seen).toContain('ok…')
    expect(seen.at(-1)).toBe('down')

    unsubscribe()
    const before = seen.length
    await monitor.check()
    expect(seen).toHaveLength(before)
  })

  it('starts looking again at once after a recovery, not after the quiet window', async () => {
    let clock = 0
    let status: number | 'blocked' = 'blocked'
    const fetch: typeof globalThis.fetch = (input, init) => browser(status).fetch(input, init)
    const monitor = createMonitor(options(fetch, { now: () => clock, quietMs: 5000 }))
    await monitor.check()
    expect(monitor.state()).toBe('down')

    clock = 1000
    status = 200
    await monitor.fetch(`${URL}/rest/v1/bikes`)
    expect(monitor.state()).toBe('ok')

    clock = 2000 // inside the old window
    status = 'blocked'
    await monitor.fetch(`${URL}/rest/v1/bikes`).catch(() => undefined)
    expect(monitor.checking()).toBe(true)
  })

  it('does not let a slow check overrule a request that got through while it ran', async () => {
    let release: (() => void) | undefined
    let slow = true
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === TARGET && slow) {
        // The probe's first request: held until the app's own request is back.
        await new Promise<void>((resolve) => {
          release = resolve
        })
        slow = false
        throw new TypeError('Failed to fetch')
      }
      if (String(input) === TARGET) return init?.mode === 'no-cors' ? new Response(null) : Promise.reject(new TypeError('x'))
      return new Response('[]', { status: 200 })
    }
    const monitor = createMonitor(options(fetch))
    const looking = monitor.check()
    await monitor.fetch(`${URL}/rest/v1/sessions`) // gets through meanwhile
    release?.()
    expect(await looking).toBe('ok')
    expect(monitor.state()).toBe('ok')
  })

  it('gives up on a request that hangs, and starts a check', async () => {
    let probes = 0
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (String(input) !== TARGET) return hangsUntilAborted(init)
      probes += 1
      return browser('unreachable').fetch(input, init)
    }
    const monitor = createMonitor(options(fetch, { requestTimeoutMs: 20 }))
    await expect(monitor.fetch(`${URL}/rest/v1/sessions`)).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(probes).toBeGreaterThan(0)
    expect(monitor.state()).toBe('offline')
  })

  it('still lets the caller cancel its own request', async () => {
    const fetch: typeof globalThis.fetch = (_input, init) => hangsUntilAborted(init)
    const monitor = createMonitor(options(fetch, { requestTimeoutMs: 60_000 }))
    const controller = new AbortController()
    const request = monitor.fetch(`${URL}/rest/v1/bikes`, { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toThrow()
    expect(monitor.checking()).toBe(false)
  })

  it('does not read an outage status from Auth as the project being down', async () => {
    // GoTrue answers 504 when an email is slow to send; the data is fine.
    const monitor = createMonitor(options(browser(504).fetch))
    await monitor.fetch(`${URL}/auth/v1/recover`, { method: 'POST' })
    expect(monitor.state()).toBe('ok')
    await monitor.fetch(`${URL}/rest/v1/bikes`)
    expect(monitor.state()).toBe('down')
  })

  it('keeps an outage a real request reported over a check that timed out meanwhile', async () => {
    // A project failing slowly: the app's request gets a readable 504 while
    // the probe's own request runs out of time, which on its own would read
    // as "No connection". The real answer is fresher and more specific.
    const fetch: typeof globalThis.fetch = (input, init) =>
      String(input) === TARGET
        ? hangsUntilAborted(init)
        : Promise.resolve(new Response('{}', { status: 504 }))
    const monitor = createMonitor(options(fetch, { timeoutMs: 30 }))
    const looking = monitor.check()
    await monitor.fetch(`${URL}/rest/v1/sessions`)
    expect(monitor.state()).toBe('down')
    expect(await looking).toBe('down')
    expect(monitor.state()).toBe('down')
  })

  it('applies a timed-out check when nothing else was heard meanwhile', async () => {
    const fetch: typeof globalThis.fetch = (_input, init) => hangsUntilAborted(init)
    const monitor = createMonitor(options(fetch, { timeoutMs: 10 }))
    expect(await monitor.check()).toBe('offline')
    expect(monitor.state()).toBe('offline')
  })

  it('never leaves a check hanging if the probe itself throws', async () => {
    const monitor = createMonitor(
      options(browser(200).fetch, {
        online: () => {
          throw new Error('no navigator')
        },
      }),
    )
    expect(await monitor.check()).toBe('offline')
    expect(monitor.checking()).toBe(false)
  })
})
