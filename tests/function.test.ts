/**
 * The Netlify adapter itself.
 *
 * The router is covered exhaustively in api.test.ts against a database that
 * is always there. What only the adapter can get wrong is the step before
 * that: reading the environment and opening a connection. That step runs
 * outside the router's error handling, so a database the site cannot reach
 * has to be turned into an answer here or it escapes as the host's own
 * opaque 500 — no JSON, no clue which of the two variables is wrong.
 */
import { afterEach, describe, expect, it } from 'vitest'
import handler, { config } from '../netlify/functions/api.mts'
import { resetDbCache } from '../src/server/db'

const KEY = 'test-key-1234567890'

const saved = { ...process.env }

afterEach(() => {
  resetDbCache()
  process.env = { ...saved }
})

function environment(overrides: Record<string, string | undefined>): void {
  delete process.env.NETLIFY_DEV
  delete process.env.GARAGE_ID
  process.env.TURSO_DATABASE_URL = ':memory:'
  process.env.TRACKER_API_KEY = KEY
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function get(path: string, key?: string): Request {
  return new Request(`https://example.test${path}`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  })
}

describe('the Netlify function', () => {
  it('mounts on /api/*', () => {
    expect(config.path).toBe('/api/*')
  })

  it('serves the API when the environment is complete', async () => {
    environment({})
    const response = await handler(get('/api/garage', KEY))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ bikes: [] })
  })

  it('refuses to serve when no API key is configured', async () => {
    environment({ TRACKER_API_KEY: undefined })
    const response = await handler(get('/api/garage'))
    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/TRACKER_API_KEY/)
  })

  it('answers a database it cannot reach with JSON, not an uncaught error', async () => {
    // Port 1 is never listening, which is the shape of a wrong
    // TURSO_DATABASE_URL or a database that has gone away.
    environment({ TURSO_DATABASE_URL: 'http://127.0.0.1:1/' })

    const response = await handler(get('/api/garage', KEY))

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect((await response.json()).error).toMatch(/TURSO_DATABASE_URL/)
  })

  it('does not put the credentials in the response when the database fails', async () => {
    environment({
      TURSO_DATABASE_URL: 'http://127.0.0.1:1/',
      TURSO_AUTH_TOKEN: 'sensitive-token-value',
    })

    const response = await handler(get('/api/garage', KEY))
    const body = await response.text()

    expect(body).not.toContain('sensitive-token-value')
    expect(body).not.toContain(KEY)
  })
})
