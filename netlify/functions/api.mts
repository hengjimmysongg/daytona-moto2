/**
 * The Netlify Function that serves the API.
 *
 * Deliberately thin: everything interesting lives in `src/server`, which
 * takes a `Request` and returns a `Response` and knows nothing about
 * Netlify. That keeps the whole API testable without a server, and keeps
 * this file to the one job only a host adapter can do — reading the
 * environment.
 */

import type { Config } from '@netlify/functions'
import { getDb } from '../../src/server/db'
import { handleApiRequest } from '../../src/server/router'

export default async function handler(request: Request): Promise<Response> {
  let db
  try {
    db = await getDb(process.env)
  } catch (error) {
    // A misconfigured or unreachable database is the likeliest thing to be
    // wrong just after a deploy, and it is the one failure that happens
    // before the router can turn anything into JSON. Left alone it surfaces
    // as the host's opaque 500, which says nothing about what to fix. The
    // detail goes to the function log, where the database URL and token are
    // already visible to whoever can read it; the response says only that
    // the database is the problem.
    console.error('database unavailable', error)
    return new Response(
      JSON.stringify({
        error:
          'The database is unavailable. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the site environment.',
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
    )
  }

  return handleApiRequest(request, {
    db,
    garageId: process.env.GARAGE_ID ?? 'default',
    apiKey: process.env.TRACKER_API_KEY,
    // `netlify dev` sets this. A deployed function never has it, so a
    // deployment with no key configured refuses to serve rather than
    // exposing a writable database.
    isLocal: Boolean(process.env.NETLIFY_DEV),
  })
}

export const config: Config = {
  path: '/api/*',
}
