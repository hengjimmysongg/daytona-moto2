/**
 * The host adapter: what the API does with an environment, before any route
 * gets a look at the request.
 *
 * These are the failure paths a deployment actually hits — no database, no
 * key, the wrong key — plus the one that decides which half of the driver
 * gets loaded.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_URL, isRemoteUrl, readDbConfig, resetDbCache } from '../src/server/db'
import { serveApiRequest } from '../src/server/handler'

beforeEach(() => {
  resetDbCache()
})

/** An in-memory database, so a test never writes to ./data. */
const MEMORY = { TURSO_DATABASE_URL: ':memory:' }

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.test${path}`, { headers })
}

describe('isRemoteUrl', () => {
  it('recognises the schemes a hosted database is reached over', () => {
    expect(isRemoteUrl('libsql://trackday-you.turso.io')).toBe(true)
    expect(isRemoteUrl('https://trackday-you.turso.io')).toBe(true)
    expect(isRemoteUrl('LIBSQL://Trackday-You.turso.io')).toBe(true)
    expect(isRemoteUrl('wss://trackday-you.turso.io')).toBe(true)
  })

  it('treats a file and an in-memory database as local', () => {
    expect(isRemoteUrl(DEFAULT_LOCAL_URL)).toBe(false)
    expect(isRemoteUrl('file:./data/tracker.db')).toBe(false)
    expect(isRemoteUrl(':memory:')).toBe(false)
  })
})

describe('readDbConfig', () => {
  it('falls back to a local file, and omits an absent token', () => {
    expect(readDbConfig({})).toEqual({ url: DEFAULT_LOCAL_URL })
  })

  it('prefers the Turso variables and carries the token', () => {
    expect(readDbConfig({ TURSO_DATABASE_URL: 'libsql://x.turso.io', TURSO_AUTH_TOKEN: 't' })).toEqual({
      url: 'libsql://x.turso.io',
      authToken: 't',
    })
  })

  it('accepts DATABASE_URL for a host that sets that instead', () => {
    expect(readDbConfig({ DATABASE_URL: 'libsql://x.turso.io' })).toEqual({ url: 'libsql://x.turso.io' })
  })
})

describe('a deployment with nothing configured', () => {
  it('refuses to serve rather than writing to a filesystem it will lose', async () => {
    const response = await serveApiRequest(get('/api/bikes'), { isLocal: false, env: {} })
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toContain('TURSO_DATABASE_URL')
  })

  it('refuses the health check too, because it is not healthy', async () => {
    const response = await serveApiRequest(get('/api/health'), { isLocal: false, env: {} })
    expect(response.status).toBe(503)
  })

  it('refuses to serve a database it has, when the file is the deployment’s own', async () => {
    const response = await serveApiRequest(get('/api/health'), {
      isLocal: false,
      env: { TURSO_DATABASE_URL: 'file:./data/tracker.db' },
    })
    expect(response.status).toBe(503)
  })
})

describe('a developer machine', () => {
  it('serves a local file database, and asks who is calling', async () => {
    const response = await serveApiRequest(get('/api/bikes'), { isLocal: true, env: MEMORY })
    // Open to reach, closed to read: the log belongs to an account.
    expect(response.status).toBe(401)
    expect((await response.json()).error).toMatch(/sign in/i)
  })

  it('answers the health check without an account', async () => {
    const response = await serveApiRequest(get('/api/health'), { isLocal: true, env: MEMORY })
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })

  it('signs a rider up and then serves the log that belongs to them', async () => {
    const host = { isLocal: true, env: MEMORY }

    const created = await serveApiRequest(
      new Request('https://example.test/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'rider@example.test', password: 'correct horse battery' }),
      }),
      host,
    )
    expect(created.status).toBe(201)
    const { token, user } = await created.json()
    expect(user.email).toBe('rider@example.test')

    const bikes = await serveApiRequest(
      get('/api/bikes', { authorization: `Bearer ${token}` }),
      host,
    )
    expect(bikes.status).toBe(200)
    expect(await bikes.json()).toEqual([])
  })
})
