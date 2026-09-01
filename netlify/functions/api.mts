/**
 * The Netlify Function that serves the API.
 *
 * Deliberately thin: everything interesting lives in `src/server`, which
 * takes a `Request` and returns a `Response` and knows nothing about
 * Netlify. That keeps the whole API testable without a server, and keeps
 * this file to the one job only a host adapter can do — saying where it is
 * running.
 */

import type { Config } from '@netlify/functions'
import { serveApiRequest } from '../../src/server/handler.js'

export default function handler(request: Request): Promise<Response> {
  return serveApiRequest(request, {
    // `netlify dev` sets this. A deployed function never has it, so a
    // deployment with no key configured refuses to serve rather than
    // exposing a writable database.
    isLocal: Boolean(process.env.NETLIFY_DEV),
  })
}

export const config: Config = {
  path: '/api/*',
}
