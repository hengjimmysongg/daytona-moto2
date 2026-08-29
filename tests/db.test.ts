import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb, readDbConfig, resetDbCache, DEFAULT_LOCAL_URL } from '../src/server/db'

afterEach(() => {
  resetDbCache()
})

describe('readDbConfig', () => {
  it('prefers the Turso URL, then DATABASE_URL, then the local file', () => {
    expect(readDbConfig({ TURSO_DATABASE_URL: 'libsql://a.turso.io' }).url).toBe('libsql://a.turso.io')
    expect(readDbConfig({ DATABASE_URL: 'libsql://b.turso.io' }).url).toBe('libsql://b.turso.io')
    expect(readDbConfig({}).url).toBe(DEFAULT_LOCAL_URL)
  })

  it('omits the auth token rather than passing it as undefined', () => {
    expect(readDbConfig({ TURSO_DATABASE_URL: 'libsql://a.turso.io' })).toEqual({
      url: 'libsql://a.turso.io',
    })
    expect(readDbConfig({ TURSO_DATABASE_URL: 'libsql://a.turso.io', TURSO_AUTH_TOKEN: 't' })).toEqual({
      url: 'libsql://a.turso.io',
      authToken: 't',
    })
  })
})

describe('getDb', () => {
  const memory = { TURSO_DATABASE_URL: ':memory:' }

  it('reuses one connection and migrates once', async () => {
    const first = await getDb(memory)
    const second = await getDb(memory)
    expect(second).toBe(first)
  })

  it('shares one migration between concurrent first requests', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => getDb(memory)))
    expect(new Set(all).size).toBe(1)
  })

  it('opens a new connection when the configuration changes', async () => {
    const first = await getDb(memory)
    const second = await getDb({ TURSO_DATABASE_URL: ':memory:', TURSO_AUTH_TOKEN: 'different' })
    expect(second).not.toBe(first)
  })

  /**
   * The failure that only shows up once the database is over a network.
   *
   * The first request into a cold container runs the schema against a hosted
   * database that may still be waking, which is exactly when a call is most
   * likely to fail. A rejected migration held in the cache would then be
   * re-served to every later request for the life of that container: a site
   * broken for as long as the container lives, against a database that
   * recovered seconds after the deploy.
   *
   * A local file cannot show this — libSQL opens it eagerly, so the failure
   * happens before anything is cached. It takes the transport a deployment
   * actually uses, so this speaks just enough of the HTTP protocol to fail
   * once and then serve the schema.
   */
  it('retries a failed migration instead of serving the failure for ever', async () => {
    let healthy = false
    let migrations = 0

    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        if (!healthy) {
          response.writeHead(503).end()
          return
        }
        migrations += 1
        const results = JSON.parse(body).requests.map((step: { type: string }) => ({
          type: 'ok',
          response:
            step.type === 'execute'
              ? {
                  type: 'execute',
                  result: { cols: [], rows: [], affected_row_count: 0, last_insert_rowid: null },
                }
              : { type: step.type },
        }))
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ baton: null, base_url: null, results }))
      })
    })

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      const config = { TURSO_DATABASE_URL: `http://127.0.0.1:${port}` }

      // The blip, on the first request into a cold container.
      await expect(getDb(config)).rejects.toThrow()

      // The database comes back. Nothing about the configuration changed, so
      // a cached rejection would still be sitting in front of it.
      healthy = true
      await expect(getDb(config)).resolves.toBeTruthy()
      expect(migrations).toBeGreaterThan(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
