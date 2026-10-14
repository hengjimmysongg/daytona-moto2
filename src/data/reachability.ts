/**
 * Whether the database can be reached, and if not, whose end the problem is.
 *
 * A free Supabase project is paused after a quiet week, and a paused project
 * fails in the least helpful way a browser allows: its gateway still answers
 * the CORS preflight, then sends the real response (521 for the API, 502 for
 * Auth) without CORS headers. The browser hides the status and reports a
 * bare "Failed to fetch" -- word for word what it reports with no signal at
 * all. Left alone, a rider in the pit lane is told "TypeError: Failed to
 * fetch" after a minute of retries, or is shown the sign-in form as if they
 * had been signed out.
 *
 * So every request the client makes passes through `fetch` here. A request
 * that cannot get through starts a short check that tells the two apart, and
 * the screen can say which it is within a second rather than a minute.
 *
 * Everything this touches -- fetch, the online flag, the clock -- is passed
 * in, which keeps it testable in Node and free of `window`.
 */

export type Reachability =
  /** Requests are getting through, or nothing has failed yet. */
  | 'ok'
  /** Supabase's edge answers, but the project behind it does not. */
  | 'down'
  /** Nothing can be reached from this device. */
  | 'offline'

/**
 * Statuses that mean the project is not serving, rather than that it refused
 * a particular request: bad gateway, unavailable (PostgREST says this while
 * its schema cache loads after a restore), gateway timeout, Cloudflare's
 * 520-530 range, and Supabase's own 540 "project paused" and 544 timeout.
 * A 500 is left out on purpose -- that is the database answering, with an
 * error worth showing as it is.
 */
export function isOutageStatus(status: number): boolean {
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status >= 520 && status <= 530) ||
    status === 540 ||
    status === 544
  )
}

export interface ProbeOptions {
  /**
   * What to ask. It should be the path the app's data actually takes -- a
   * cheap read through PostgREST -- so that a database still warming up
   * after a restore counts as down even while Auth is already answering.
   */
  target: string
  /** Sent with the readable request; the opaque one cannot carry headers. */
  headers?: Record<string, string>
  fetch: typeof fetch
  /** `navigator.onLine`, where there is one. */
  online: () => boolean
  /** How long one request may take before it counts as unanswered. */
  timeoutMs?: number
}

const PROBE_TIMEOUT_MS = 8000

/**
 * Find out which of the three states we are in, from scratch.
 *
 * First an ordinary request: a serving project answers it with CORS headers,
 * so any readable reply settles it. When that fails the browser will not say
 * why, so the same URL is asked again in `no-cors` mode. An opaque request
 * resolves whenever a server answers at all -- even with the 521 a paused
 * project sends -- and fails only when nothing could be reached.
 *
 * "Down" is the alarming answer, so it has to be earned. A paused project
 * refuses at once and every time; a weak signal is slow, or fails once and
 * then works. So a readable request that ran out of time means the
 * connection, and a quick refusal is only blamed on the project if it
 * happens again after the opaque request got through.
 *
 * A browser that one day refuses opaque responses outright would make a down
 * project read as `offline`. That is the safe way round to be wrong: the
 * rider is told to check their signal, not that their data has gone.
 */
export async function probe(options: ProbeOptions): Promise<Reachability> {
  if (!options.online()) return 'offline'
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS

  const ask = async (): Promise<Reachability | 'refused'> => {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const response = await options.fetch(options.target, {
        ...(options.headers ? { headers: options.headers } : {}),
        cache: 'no-store',
        signal,
      })
      return isOutageStatus(response.status) ? 'down' : 'ok'
    } catch {
      // Out of time is the connection; refused at once is CORS or nothing.
      return signal.aborted ? 'offline' : 'refused'
    }
  }

  const first = await ask()
  if (first !== 'refused') return first

  try {
    await options.fetch(options.target, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return 'offline'
  }

  // Something answered, so the network is there. Ask once more before
  // blaming the project: a paused one refuses again, a blip does not.
  const second = await ask()
  return second === 'refused' ? 'down' : second
}

export interface Monitor {
  /** A drop-in `fetch` for the Supabase client that reports as it goes. */
  fetch: typeof fetch
  state: () => Reachability
  /** True while a check is running. */
  checking: () => boolean
  /** Called whenever `state` or `checking` changes. Returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Run a check now, or join the one already running. */
  check: () => Promise<Reachability>
}

export interface MonitorOptions extends ProbeOptions {
  now?: () => number
  /**
   * How long any one request may go unanswered before it is given up on.
   * Signal that shows bars but carries nothing leaves a request hanging for
   * minutes, and the log's writes go one at a time, so one hung request
   * would hold every edit behind it and never say why.
   */
  requestTimeoutMs?: number
  /**
   * After a check that found a problem, failed requests within this window
   * do not start another. A refresh that retries eight times in a row should
   * cost one check, not eight.
   */
  quietMs?: number
}

const QUIET_MS = 5000
const REQUEST_TIMEOUT_MS = 20_000

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input)
}

/** The request's own signal, if any, plus a deadline. */
function withDeadline(signal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const deadline = AbortSignal.timeout(ms)
  if (!signal) return deadline
  // Older browsers lack `any`; keeping the caller's own signal matters more.
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, deadline]) : signal
}

export function createMonitor(options: MonitorOptions): Monitor {
  const now = options.now ?? Date.now
  const quietMs = options.quietMs ?? QUIET_MS
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const listeners = new Set<() => void>()

  let state: Reachability = 'ok'
  let running: Promise<Reachability> | null = null
  let lastProblem = -Infinity
  // Bumped by every request that gets a readable answer, outage or not. A
  // real request's answer is fresher and more specific than a probe's, so a
  // check must not overrule one that came back while it was running.
  let answered = 0

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const settle = (next: Reachability) => {
    // The quiet window is for an outage in progress, not for the next one.
    lastProblem = next === 'ok' ? -Infinity : now()
    if (next === state) return
    state = next
    notify()
  }

  const check = (): Promise<Reachability> => {
    if (running) return running
    const since = answered
    running = probe(options)
      .catch((): Reachability => 'offline')
      .then((result) => {
        running = null
        if (answered !== since) {
          // A real request was answered while this one was looking, and
          // has already said what state things are in.
          notify()
          return state
        }
        settle(result)
        // `checking` has flipped back even when the state has not.
        notify()
        return result
      })
    notify()
    return running
  }

  const watched: typeof fetch = async (input, init) => {
    let response: Response
    try {
      const own = init?.signal ?? (input instanceof Request ? input.signal : null)
      response = await options.fetch(input, {
        ...init,
        signal: withDeadline(own, requestTimeoutMs),
      })
    } catch (error) {
      // A request the app cancelled says nothing about the connection. One
      // that ran out of time does: it fails as a TimeoutError, not this.
      const aborted = error instanceof Error && error.name === 'AbortError'
      if (!aborted && now() - lastProblem >= quietMs) void check()
      throw error
    }
    answered += 1
    if (!isOutageStatus(response.status)) {
      // Readable at all means the project answered.
      settle('ok')
    } else if (!urlOf(input).includes('/auth/v1/')) {
      // An outage status from the data API is the project saying, through
      // its gateway, that it is not there. Not from Auth: Auth answers 504
      // when an email is slow to send, and a paused project's Auth replies
      // are unreadable anyway -- those reach the check above.
      settle('down')
    }
    return response
  }

  return {
    fetch: watched,
    state: () => state,
    checking: () => running !== null,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    check,
  }
}
