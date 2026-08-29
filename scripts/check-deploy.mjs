#!/usr/bin/env node
/**
 * Ask a deployed site whether it actually works.
 *
 * This is README step 5, done properly and without a key. `GET /api/health`
 * on its own is not the check it looks like: it answers before the auth
 * guard, and its `authRequired` is true on every deployment whether or not
 * a key was ever configured. A site that has been deployed but never given
 * its environment variables returns a perfectly healthy 200 there while
 * every real request fails.
 *
 * So the check that matters is what a *data* route says to a caller with no
 * credentials. Each answer names a different mistake:
 *
 *   401  the API is guarded and the key is configured — the deploy is good
 *   503  the site is missing TRACKER_API_KEY, or cannot reach the database
 *   200  the API is serving a writable database to anyone who asks
 *   html the /api route never reached the function
 *
 * Usage:
 *   node scripts/check-deploy.mjs https://your-site.netlify.app
 *   node scripts/check-deploy.mjs --from deploy-output.txt
 *
 * `--from` reads the URL out of the JSON `netlify deploy --json` prints,
 * which is how CI gets it without a human copying a link.
 */

import { pathToFileURL } from 'node:url'

const RETRIES = 5
const RETRY_DELAY_MS = 3000

/* ------------------------------------------------------------------ */
/* Finding the URL                                                     */
/* ------------------------------------------------------------------ */

/**
 * The last JSON object in a stream of build noise.
 *
 * `netlify deploy --json` prints its result after everything else it has to
 * say, so the object is found by scanning backwards rather than by assuming
 * the output is only JSON.
 */
export function findDeployUrl(text) {
  for (let start = text.lastIndexOf('{'); start !== -1; start = text.lastIndexOf('{', start - 1)) {
    const end = matchingBrace(text, start)
    if (end === -1) continue
    let parsed
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      continue
    }
    // A preview keeps its own permalink; production also reports the site's
    // own address, which is the one worth checking.
    const url = parsed?.url ?? parsed?.deploy_url ?? parsed?.deploy_ssl_url
    if (typeof url === 'string' && url.startsWith('http')) return url
  }
  return null
}

function matchingBrace(text, start) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth++
    else if (character === '}' && --depth === 0) return index
  }
  return -1
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

async function attempt(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', ...options })
  return { status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() }
}

function parseJson(body) {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** One line per check, so a CI log says which half of the site is wrong. */
function report(ok, name, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

async function checkClient(base) {
  const { status, type } = await attempt(base)
  return report(
    status === 200 && type.includes('text/html'),
    'the app is published',
    `GET / → ${status} ${type || '(no content-type)'}`,
  )
}

async function checkFunctionIsMounted(base) {
  const { status, type, body } = await attempt(`${base}/api/health`)
  const health = parseJson(body)

  if (type.includes('text/html')) {
    return report(false, 'the API reaches the function', 'GET /api/health returned the app, so /api/* never reached it')
  }
  if (status !== 200 || health?.ok !== true) {
    return report(false, 'the API reaches the function', `GET /api/health → ${status} ${body.slice(0, 200)}`)
  }
  return report(true, 'the API reaches the function', `${health.routes?.length ?? 0} routes advertised`)
}

async function checkGuarded(base) {
  const { status, body } = await attempt(`${base}/api/garage`)
  const error = parseJson(body)?.error ?? body.slice(0, 200)

  if (status === 401) {
    return report(true, 'the API is guarded and configured', 'an unauthenticated request is refused')
  }
  if (status === 200) {
    return report(false, 'the API is guarded and configured', 'the API served data with no key — TRACKER_API_KEY is not set')
  }
  if (status === 503 && /TRACKER_API_KEY/.test(error)) {
    return report(false, 'the API is guarded and configured', 'the site has no TRACKER_API_KEY, so it refuses to serve')
  }
  if (status === 503) {
    return report(false, 'the API is guarded and configured', `the database is unreachable — ${error}`)
  }
  return report(false, 'the API is guarded and configured', `unexpected ${status} — ${error}`)
}

/* ------------------------------------------------------------------ */

/** Every check against one site. Returns whether the deploy is serving. */
export async function runChecks(url, { retries = RETRIES, retryDelayMs = RETRY_DELAY_MS } = {}) {
  const base = url.replace(/\/+$/, '')
  console.log(`Checking ${base}\n`)

  // A deploy is not always answering the instant the CLI returns, so a
  // connection failure is worth another try or two. A *bad answer* is not —
  // it will still be bad in three seconds.
  for (let remaining = retries; ; remaining--) {
    try {
      await attempt(`${base}/api/health`)
      break
    } catch (error) {
      if (remaining <= 1) {
        console.log(`FAIL  the site answers — ${error.message}`)
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }

  // Every check runs even after one fails: two things are often wrong at
  // once just after a first deploy, and one report beats two round trips.
  const results = [await checkClient(base), await checkFunctionIsMounted(base), await checkGuarded(base)]

  if (results.every(Boolean)) {
    console.log('\nThe deploy is serving. Open the site, go to Garage → Sync and paste the key.')
    return true
  }

  console.log(
    '\nSet the site variables under Site configuration → Environment variables' +
      ' (or `npx netlify env:import .env`), then deploy again. See the README, "Deploying to Netlify".',
  )
  return false
}

async function main() {
  const args = process.argv.slice(2)
  let base = args.find((argument) => argument.startsWith('http')) ?? null

  const fromIndex = args.indexOf('--from')
  if (fromIndex !== -1) {
    const { readFileSync } = await import('node:fs')
    base = findDeployUrl(readFileSync(args[fromIndex + 1], 'utf8'))
    if (!base) {
      console.error('Could not find a deploy URL in that output. Was the deploy run with --json?')
      process.exit(1)
    }
  }

  if (!base) {
    console.error('Usage: node scripts/check-deploy.mjs <url>   (or --from <netlify deploy --json output>)')
    process.exit(1)
  }

  if (!(await runChecks(base))) process.exit(1)
}

// Importable for tests; only a direct run performs the checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
