/**
 * The Vercel Function that serves the API.
 *
 * The twin of `netlify/functions/api.mts`, and just as thin: `src/server`
 * does the work, and this file only says where it is running.
 *
 * Vercel routes `/api/*` here through the rewrite in `vercel.json`, which
 * leaves the request's own URL intact — so the router sees the path the
 * caller asked for, not the file that answered it. Each method is exported
 * by name because that is how Vercel recognises a handler written against
 * the web's `Request` and `Response` rather than Node's own.
 */

import { serveApiRequest } from '../src/server/handler.js'

function handle(request: Request): Promise<Response> {
  return serveApiRequest(request, {
    // `VERCEL` is set in every Vercel environment, and `VERCEL_ENV` is
    // "development" only under `vercel dev` — a deployment is always
    // "production" or "preview". So this is false wherever the URL is
    // public, and the API fails closed there without a key.
    isLocal: !process.env.VERCEL || process.env.VERCEL_ENV === 'development',
  })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
