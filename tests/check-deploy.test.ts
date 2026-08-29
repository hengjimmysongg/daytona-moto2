/**
 * The post-deploy check, run against the real function.
 *
 * Each case stands up the actual Netlify handler behind the same request
 * chain a deployed site has — static files first, `/api/*` to the function,
 * everything else falling back to index.html — in one of the states a
 * deploy can land in, and asserts the checker reaches the right verdict.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import handler from '../netlify/functions/api.mts'
import { resetDbCache } from '../src/server/db'
import { findDeployUrl, runChecks } from '../scripts/check-deploy.mjs'

const KEY = 'test-key-1234567890'
const saved = { ...process.env }

let server: Server | undefined

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve))
  server = undefined
  resetDbCache()
  process.env = { ...saved }
})

/** A site serving the built client and the function, as Netlify would. */
async function site(environment: Record<string, string | undefined>): Promise<string> {
  delete process.env.NETLIFY_DEV
  process.env.TURSO_DATABASE_URL = ':memory:'
  process.env.TRACKER_API_KEY = KEY
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'https://example.test')
    if (url.pathname.startsWith('/api')) {
      handler(new Request(url, { method: request.method ?? 'GET' }))
        .then(async (answer) => {
          response.writeHead(answer.status, Object.fromEntries(answer.headers))
          response.end(await answer.text())
        })
        .catch(() => response.writeHead(500).end())
      return
    }
    // The SPA catch-all.
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>log</title>')
  })

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

async function check(base: string): Promise<{ passed: boolean; out: string }> {
  const lines: string[] = []
  const log = console.log
  console.log = (...parts: unknown[]) => void lines.push(parts.join(' '))
  try {
    const passed = await runChecks(base, { retries: 1, retryDelayMs: 0 })
    return { passed, out: lines.join('\n') }
  } finally {
    console.log = log
  }
}

describe('findDeployUrl', () => {
  it('takes the URL out of the last JSON object in a noisy build log', () => {
    const output = [
      'Building site...',
      '{"not":"the deploy result"}',
      'Deploying...',
      '{"site_id":"abc","deploy_url":"https://branch--site.netlify.app","url":"https://site.netlify.app"}',
    ].join('\n')
    expect(findDeployUrl(output)).toBe('https://site.netlify.app')
  })

  it('falls back to the deploy permalink when there is no site URL', () => {
    expect(findDeployUrl('{"deploy_url":"https://d--site.netlify.app"}')).toBe('https://d--site.netlify.app')
  })

  it('returns null when there is no JSON to find', () => {
    expect(findDeployUrl('Deploy failed with an error')).toBeNull()
  })
})

describe('the post-deploy check', () => {
  it('passes a site with its variables set', async () => {
    const result = await check(await site({}))
    expect(result.out).toContain('ok    the app is published')
    expect(result.out).toContain('ok    the API reaches the function')
    expect(result.out).toContain('ok    the API is guarded and configured')
    expect(result.passed).toBe(true)
  })

  it('catches a site deployed without TRACKER_API_KEY', async () => {
    const result = await check(await site({ TRACKER_API_KEY: undefined }))
    expect(result.out).toContain('FAIL  the API is guarded and configured')
    expect(result.out).toMatch(/no TRACKER_API_KEY/)
    expect(result.passed).toBe(false)
  })

  it('catches a site whose database is unreachable', async () => {
    const result = await check(await site({ TURSO_DATABASE_URL: 'http://127.0.0.1:1/' }))
    expect(result.out).toMatch(/database is unreachable/)
    expect(result.passed).toBe(false)
  })

  it('catches an API key left open to the world', async () => {
    const result = await check(await site({ TRACKER_API_KEY: undefined, NETLIFY_DEV: 'true' }))
    expect(result.out).toMatch(/served data with no key/)
    expect(result.passed).toBe(false)
  })
})
