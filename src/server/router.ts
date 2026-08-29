/**
 * The HTTP API.
 *
 * Plain `Request` in, plain `Response` out, with the database and the
 * credentials handed in — no framework, no globals, and nothing that needs
 * a server running to test it.
 *
 * Every route lives under `/api`. Units are canonical throughout: pressures
 * in bar, temperatures in °C, lengths in mm.
 */

import { z } from 'zod'
import type { Db } from './db'
import {
  deleteRow,
  deleteTrackDayCascade,
  getBike,
  getPreferences,
  getSession,
  getSnapshot,
  getTrackDay,
  getTyre,
  listBikes,
  listSessions,
  listTrackDays,
  listTyres,
  putSnapshot,
  saveBike,
  savePreferences,
  saveSession,
  saveTrackDay,
  saveTyre,
} from './repository'
import {
  bikeInput,
  buildBike,
  buildSession,
  buildTrackDay,
  buildTyre,
  formatIssues,
  preferencesInput,
  sessionInput,
  trackDayInput,
  tyreInput,
} from './validation'
import { defaultPreferences } from '../core/storage'
import type { GarageData } from '../core/types'

export interface ApiDeps {
  db: Db
  garageId: string
  /** The shared secret callers must present. */
  apiKey?: string | undefined
  /**
   * True on a developer's own machine. Without a key configured, a local
   * server is open and a deployed one refuses to serve — failing closed,
   * because the alternative is a writable database on a public URL.
   */
  isLocal?: boolean
  now?: () => number
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/**
 * The API is a machine interface guarded by a bearer token, so it is opened
 * to any origin on purpose — a script or another site can call it with the
 * key. The key is the boundary, not the origin.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS },
  })
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status)
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Compare without leaking how much of the key matched via timing. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  // A query parameter is handy for a quick browser check and no less safe
  // than a header once the connection is TLS, but it does end up in logs,
  // so the header is what the docs recommend.
  const fromQuery = new URL(request.url).searchParams.get('key')
  return fromQuery ?? null
}

function checkAuth(request: Request, deps: ApiDeps): Response | null {
  if (!deps.apiKey) {
    if (deps.isLocal) return null
    return fail(
      503,
      'This deployment has no API key configured, so it will not serve data. Set TRACKER_API_KEY in the site environment and redeploy.',
    )
  }
  const presented = bearer(request)
  if (!presented || !secretsMatch(presented, deps.apiKey)) {
    return fail(401, 'Missing or incorrect API key. Send it as: Authorization: Bearer <key>')
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export async function handleApiRequest(request: Request, deps: ApiDeps): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  // Tolerate being mounted at /api or at a function path.
  const apiIndex = segments.indexOf('api')
  const path = apiIndex === -1 ? segments : segments.slice(apiIndex + 1)
  const [collection, id, ...rest] = path

  if (rest.length > 0) return fail(404, `No route for /${path.join('/')}`)

  if (collection === 'health' || collection === undefined || collection === '') {
    return json({
      ok: true,
      service: 'track-day-log',
      authRequired: Boolean(deps.apiKey) || !deps.isLocal,
      routes: ROUTES,
    })
  }

  const denied = checkAuth(request, deps)
  if (denied) return denied

  const now = deps.now ?? (() => Date.now())

  try {
    switch (collection) {
      case 'garage':
        return await garageRoutes(request, deps, now)
      case 'bikes':
        return await bikeRoutes(request, deps, id, now)
      case 'track-days':
        return await trackDayRoutes(request, deps, id, now)
      case 'sessions':
        return await sessionRoutes(request, deps, id, url, now)
      case 'tyres':
        return await tyreRoutes(request, deps, id, now)
      case 'preferences':
        return await preferenceRoutes(request, deps)
      default:
        return fail(404, `Unknown collection "${collection}".`, { routes: ROUTES })
    }
  } catch (error) {
    if (error instanceof BadRequest) return fail(400, error.message, error.extra)
    // Anything else is a bug or an unreachable database; say so without
    // leaking internals to a caller who cannot act on them.
    console.error('API error', error)
    return fail(500, 'Something went wrong handling that request.')
  }
}

class BadRequest extends Error {
  constructor(
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new BadRequest('Request body is not valid JSON.')
  }
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new BadRequest('That request body is not valid.', { details: formatIssues(result.error) })
  }
  return result.data
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

async function garageRoutes(request: Request, deps: ApiDeps, now: () => number): Promise<Response> {
  const { db, garageId } = deps
  if (request.method === 'GET') return json(await getSnapshot(db, garageId))
  if (request.method === 'PUT') {
    const body = (await readJson(request)) as Partial<GarageData>
    if (!body || typeof body !== 'object' || !Array.isArray(body.sessions)) {
      throw new BadRequest('A garage snapshot needs bikes, trackDays, sessions and tyres arrays.')
    }
    const snapshot: GarageData = {
      version: 1,
      bikes: body.bikes ?? [],
      tyres: body.tyres ?? [],
      presets: [],
      trackDays: body.trackDays ?? [],
      sessions: body.sessions ?? [],
      preferences: body.preferences ?? defaultPreferences(),
      // Keep the browser's own stamp so it recognises its write coming back
      // and stops re-pushing; fall back to now for a hand-written body.
      updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : now(),
    }
    return json(await putSnapshot(db, garageId, snapshot, now()))
  }
  return methodNotAllowed(['GET', 'PUT'])
}

async function bikeRoutes(
  request: Request,
  deps: ApiDeps,
  id: string | undefined,
  now: () => number,
): Promise<Response> {
  const { db, garageId } = deps
  if (!id) {
    if (request.method === 'GET') return json(await listBikes(db, garageId))
    if (request.method === 'POST') {
      const input = parse(bikeInput, await readJson(request))
      return json(await saveBike(db, garageId, buildBike(input, undefined, now())), 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const existing = await getBike(db, garageId, id)
  if (request.method === 'GET') {
    return existing ? json(existing) : fail(404, `No bike with id "${id}".`)
  }
  if (request.method === 'PATCH' || request.method === 'PUT') {
    if (!existing) return fail(404, `No bike with id "${id}".`)
    const body = (await readJson(request)) as Record<string, unknown>
    const input = parse(bikeInput, { ...existing, ...body, id })
    return json(await saveBike(db, garageId, buildBike(input, existing, now())))
  }
  if (request.method === 'DELETE') {
    const removed = await deleteRow(db, garageId, 'bikes', id)
    return removed ? json({ deleted: id }) : fail(404, `No bike with id "${id}".`)
  }
  return methodNotAllowed(['GET', 'PATCH', 'DELETE'])
}

async function trackDayRoutes(
  request: Request,
  deps: ApiDeps,
  id: string | undefined,
  now: () => number,
): Promise<Response> {
  const { db, garageId } = deps
  if (!id) {
    if (request.method === 'GET') return json(await listTrackDays(db, garageId))
    if (request.method === 'POST') {
      const input = parse(trackDayInput, await readJson(request))
      const bikeId = await resolveBikeId(db, garageId, input.bikeId)
      return json(await saveTrackDay(db, garageId, buildTrackDay(input, bikeId, undefined, now())), 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const existing = await getTrackDay(db, garageId, id)
  if (request.method === 'GET') {
    return existing ? json(existing) : fail(404, `No track day with id "${id}".`)
  }
  if (request.method === 'PATCH' || request.method === 'PUT') {
    if (!existing) return fail(404, `No track day with id "${id}".`)
    const body = (await readJson(request)) as Record<string, unknown>
    const input = parse(trackDayInput, { ...existing, ...body, id })
    const bikeId = await resolveBikeId(db, garageId, input.bikeId ?? existing.bikeId)
    return json(await saveTrackDay(db, garageId, buildTrackDay(input, bikeId, existing, now())))
  }
  if (request.method === 'DELETE') {
    const removed = await deleteTrackDayCascade(db, garageId, id)
    return removed ? json({ deleted: id }) : fail(404, `No track day with id "${id}".`)
  }
  return methodNotAllowed(['GET', 'PATCH', 'DELETE'])
}

/**
 * A track day belongs to a bike. Rather than making every caller look one
 * up, an omitted bike is resolved when there is only one it could be.
 */
async function resolveBikeId(db: Db, garageId: string, given: string | undefined): Promise<string> {
  const bikes = await listBikes(db, garageId)
  if (given) {
    if (!bikes.some((bike) => bike.id === given)) {
      throw new BadRequest(`No bike with id "${given}".`, {
        availableBikes: bikes.map((bike) => ({ id: bike.id, name: bike.name })),
      })
    }
    return given
  }
  const only = bikes[0]
  if (bikes.length === 1 && only) return only.id
  throw new BadRequest(
    bikes.length === 0
      ? 'Add a bike before creating a track day: POST /api/bikes {"name":"..."}'
      : 'This garage has more than one bike, so bikeId is required.',
    { availableBikes: bikes.map((bike) => ({ id: bike.id, name: bike.name })) },
  )
}

async function sessionRoutes(
  request: Request,
  deps: ApiDeps,
  id: string | undefined,
  url: URL,
  now: () => number,
): Promise<Response> {
  const { db, garageId } = deps
  if (!id) {
    if (request.method === 'GET') {
      const trackDayId = url.searchParams.get('trackDayId')
      return json(await listSessions(db, garageId, trackDayId ? { trackDayId } : {}))
    }
    if (request.method === 'POST') {
      const input = parse(sessionInput, await readJson(request))
      const day = await getTrackDay(db, garageId, input.trackDayId)
      if (!day) throw new BadRequest(`No track day with id "${input.trackDayId}".`)
      const number = input.number ?? (await nextSessionNumber(db, garageId, input.trackDayId))
      return json(await saveSession(db, garageId, buildSession(input, number, undefined, now())), 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const existing = await getSession(db, garageId, id)
  if (request.method === 'GET') {
    return existing ? json(existing) : fail(404, `No session with id "${id}".`)
  }
  if (request.method === 'PATCH' || request.method === 'PUT') {
    if (!existing) return fail(404, `No session with id "${id}".`)
    const body = (await readJson(request)) as Record<string, unknown>
    const input = parse(sessionInput, {
      ...body,
      id,
      trackDayId: (body.trackDayId as string) ?? existing.trackDayId,
    })
    return json(
      await saveSession(db, garageId, buildSession(input, input.number ?? existing.number, existing, now())),
    )
  }
  if (request.method === 'DELETE') {
    const removed = await deleteRow(db, garageId, 'sessions', id)
    return removed ? json({ deleted: id }) : fail(404, `No session with id "${id}".`)
  }
  return methodNotAllowed(['GET', 'PATCH', 'DELETE'])
}

/** Sessions are numbered in the order they are run, per track day. */
async function nextSessionNumber(db: Db, garageId: string, trackDayId: string): Promise<number> {
  const sessions = await listSessions(db, garageId, { trackDayId })
  return sessions.reduce((highest, session) => Math.max(highest, session.number), 0) + 1
}

async function tyreRoutes(
  request: Request,
  deps: ApiDeps,
  id: string | undefined,
  now: () => number,
): Promise<Response> {
  const { db, garageId } = deps
  if (!id) {
    if (request.method === 'GET') return json(await listTyres(db, garageId))
    if (request.method === 'POST') {
      const input = parse(tyreInput, await readJson(request))
      return json(await saveTyre(db, garageId, buildTyre(input, undefined, now())), 201)
    }
    return methodNotAllowed(['GET', 'POST'])
  }

  const existing = await getTyre(db, garageId, id)
  if (request.method === 'GET') {
    return existing ? json(existing) : fail(404, `No tyre with id "${id}".`)
  }
  if (request.method === 'PATCH' || request.method === 'PUT') {
    if (!existing) return fail(404, `No tyre with id "${id}".`)
    const body = (await readJson(request)) as Record<string, unknown>
    const input = parse(tyreInput, { ...existing, ...body, id })
    return json(await saveTyre(db, garageId, buildTyre(input, existing, now())))
  }
  if (request.method === 'DELETE') {
    const removed = await deleteRow(db, garageId, 'tyres', id)
    return removed ? json({ deleted: id }) : fail(404, `No tyre with id "${id}".`)
  }
  return methodNotAllowed(['GET', 'PATCH', 'DELETE'])
}

async function preferenceRoutes(request: Request, deps: ApiDeps): Promise<Response> {
  const { db, garageId } = deps
  if (request.method === 'GET') return json(await getPreferences(db, garageId))
  if (request.method === 'PUT' || request.method === 'PATCH') {
    const input = parse(preferencesInput, await readJson(request))
    const current = await getPreferences(db, garageId)
    const merged = {
      pressureUnit: input.pressureUnit ?? current.pressureUnit,
      temperatureUnit: input.temperatureUnit ?? current.temperatureUnit,
      massUnit: input.massUnit ?? current.massUnit,
      targetHotPressure: {
        front: input.targetHotPressure?.front ?? current.targetHotPressure.front,
        rear: input.targetHotPressure?.rear ?? current.targetHotPressure.rear,
      },
    }
    return json(await savePreferences(db, garageId, merged))
  }
  return methodNotAllowed(['GET', 'PUT'])
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(
    JSON.stringify({ error: `Method not allowed. Try: ${allowed.join(', ')}` }, null, 2),
    { status: 405, headers: { ...JSON_HEADERS, ...CORS_HEADERS, allow: allowed.join(', ') } },
  )
}

/** Advertised by `GET /api/health`, so the API documents itself. */
export const ROUTES = [
  'GET    /api/health',
  'GET    /api/garage',
  'PUT    /api/garage',
  'GET    /api/bikes',
  'POST   /api/bikes            {"name":"Daytona 675R"}',
  'GET    /api/bikes/:id',
  'PATCH  /api/bikes/:id',
  'DELETE /api/bikes/:id',
  'GET    /api/track-days',
  'POST   /api/track-days       {"circuit":"Daytona","date":"2026-03-07"}',
  'GET    /api/track-days/:id',
  'PATCH  /api/track-days/:id',
  'DELETE /api/track-days/:id',
  'GET    /api/sessions[?trackDayId=]',
  'POST   /api/sessions         {"trackDayId":"day_…","tyres":{"front":{"coldPressure":2.14}}}',
  'GET    /api/sessions/:id',
  'PATCH  /api/sessions/:id',
  'DELETE /api/sessions/:id',
  'GET    /api/tyres',
  'POST   /api/tyres            {"axle":"front","model":{"make":"Pirelli","model":"SC1"}}',
  'GET    /api/tyres/:id',
  'PATCH  /api/tyres/:id',
  'DELETE /api/tyres/:id',
  'GET    /api/preferences',
  'PUT    /api/preferences',
]
