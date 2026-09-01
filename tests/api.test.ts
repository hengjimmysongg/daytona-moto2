import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, migrate, type Db } from '../src/server/db'
import { handleApiRequest, type ApiDeps } from '../src/server/router'
import { getSnapshot } from '../src/server/repository'

const KEY = 'test-key-1234567890'

let db: Db

beforeEach(async () => {
  // A real SQLite database, in memory: same engine and same SQL as the
  // deployed one, so the schema is genuinely exercised.
  db = await createDb({ url: ':memory:' })
  await migrate(db)
})

function deps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return { db, garageId: 'default', apiKey: KEY, now: () => 1_700_000_000_000, ...overrides }
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  overrides: Partial<ApiDeps> = {},
): Promise<{ status: number; body: any }> {
  const request = new Request(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${overrides.apiKey === null ? '' : KEY}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await handleApiRequest(request, deps(overrides))
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function seedBike(name = 'Daytona 675R') {
  const created = await call('POST', '/api/bikes', { name })
  return created.body.id as string
}

async function seedDay(circuit = 'Daytona International Speedway') {
  const created = await call('POST', '/api/track-days', { circuit })
  return created.body.id as string
}

/* ------------------------------------------------------------------ */

describe('health', () => {
  it('answers without a key and lists its routes', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/health'),
      deps(),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.routes.join('\n')).toContain('POST   /api/sessions')
  })
})

describe('auth', () => {
  it('rejects a request with no key', async () => {
    const response = await handleApiRequest(new Request('https://example.test/api/bikes'), deps())
    expect(response.status).toBe(401)
  })

  it('rejects a wrong key', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/bikes', {
        headers: { authorization: 'Bearer nope' },
      }),
      deps(),
    )
    expect(response.status).toBe(401)
  })

  it('accepts the key as a query parameter, for a quick browser check', async () => {
    const response = await handleApiRequest(
      new Request(`https://example.test/api/bikes?key=${KEY}`),
      deps(),
    )
    expect(response.status).toBe(200)
  })

  it('refuses to serve a deployment that has no key configured', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/bikes'),
      deps({ apiKey: undefined, isLocal: false }),
    )
    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/TRACKER_API_KEY/)
  })

  it('is open on a developer’s own machine', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/bikes'),
      deps({ apiKey: undefined, isLocal: true }),
    )
    expect(response.status).toBe(200)
  })
})

describe('bikes', () => {
  it('creates one from just a name, filling in the rest', async () => {
    const created = await call('POST', '/api/bikes', { name: 'Daytona 675R' })
    expect(created.status).toBe(201)
    expect(created.body.id).toMatch(/^bike_/)
    expect(created.body.fork.compression.range).toBeGreaterThan(0)
    expect(created.body.sagTargets.frontRider).toEqual([30, 35])
  })

  it('rejects one with no name, saying so in words a caller can act on', async () => {
    const created = await call('POST', '/api/bikes', {})
    expect(created.status).toBe(400)
    expect(created.body.details[0].field).toBe('name')
    expect(created.body.details[0].message).toMatch(/needs a name/)
    // An empty string is just as useless as a missing one.
    const empty = await call('POST', '/api/bikes', { name: '' })
    expect(empty.body.details[0].message).toMatch(/needs a name/)
  })

  it('lists, reads, patches and deletes', async () => {
    const id = await seedBike()
    expect((await call('GET', '/api/bikes')).body).toHaveLength(1)
    expect((await call('GET', `/api/bikes/${id}`)).body.name).toBe('Daytona 675R')

    const patched = await call('PATCH', `/api/bikes/${id}`, { riderWeightKg: 82 })
    expect(patched.status).toBe(200)
    expect(patched.body.riderWeightKg).toBe(82)
    // A patch that mentions one field must not blank out the others.
    expect(patched.body.name).toBe('Daytona 675R')

    expect((await call('DELETE', `/api/bikes/${id}`)).status).toBe(200)
    expect((await call('GET', `/api/bikes/${id}`)).status).toBe(404)
  })

  it('round-trips the adjuster specs through the JSON columns', async () => {
    const id = await seedBike()
    await call('PATCH', `/api/bikes/${id}`, {
      shock: {
        motionRatio: 2.9,
        compressionLow: { range: 30, unit: 'clicks' },
        rebound: { range: 30, unit: 'clicks' },
        preload: { range: 12, unit: 'turns', mmPerTurn: 1.5 },
      },
    })
    const read = await call('GET', `/api/bikes/${id}`)
    expect(read.body.shock.motionRatio).toBe(2.9)
    expect(read.body.shock.preload.mmPerTurn).toBe(1.5)
  })
})

describe('track days', () => {
  it('picks the bike when there is only one it could be', async () => {
    const bikeId = await seedBike()
    const created = await call('POST', '/api/track-days', { circuit: 'Daytona' })
    expect(created.status).toBe(201)
    expect(created.body.bikeId).toBe(bikeId)
    expect(created.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('says what to do first when the garage is empty', async () => {
    const created = await call('POST', '/api/track-days', { circuit: 'Daytona' })
    expect(created.status).toBe(400)
    expect(created.body.error).toMatch(/Add a bike before/)
  })

  it('requires a bike when the choice is ambiguous', async () => {
    await seedBike('one')
    await seedBike('two')
    const created = await call('POST', '/api/track-days', { circuit: 'Daytona' })
    expect(created.status).toBe(400)
    expect(created.body.error).toMatch(/more than one bike/)
    expect(created.body.availableBikes).toHaveLength(2)
  })

  it('rejects a bike id that does not exist', async () => {
    await seedBike()
    const created = await call('POST', '/api/track-days', { circuit: 'D', bikeId: 'nope' })
    expect(created.status).toBe(400)
    expect(created.body.error).toMatch(/No bike with id/)
  })

  it('rejects a malformed date', async () => {
    await seedBike()
    const created = await call('POST', '/api/track-days', { circuit: 'D', date: '7 March' })
    expect(created.status).toBe(400)
    expect(created.body.details[0].message).toMatch(/YYYY-MM-DD/)
  })

  it('takes its sessions with it when deleted', async () => {
    await seedBike()
    const dayId = await seedDay()
    await call('POST', '/api/sessions', { trackDayId: dayId })
    expect((await call('GET', '/api/sessions')).body).toHaveLength(1)

    expect((await call('DELETE', `/api/track-days/${dayId}`)).status).toBe(200)
    expect((await call('GET', '/api/sessions')).body).toHaveLength(0)
  })
})

describe('sessions', () => {
  it('numbers a new session after the last one on that day', async () => {
    await seedBike()
    const dayId = await seedDay()
    expect((await call('POST', '/api/sessions', { trackDayId: dayId })).body.number).toBe(1)
    expect((await call('POST', '/api/sessions', { trackDayId: dayId })).body.number).toBe(2)
    expect((await call('POST', '/api/sessions', { trackDayId: dayId, number: 7 })).body.number).toBe(7)
    expect((await call('POST', '/api/sessions', { trackDayId: dayId })).body.number).toBe(8)
  })

  it('stores a whole session and reads it back unchanged', async () => {
    await seedBike()
    const dayId = await seedDay()
    const created = await call('POST', '/api/sessions', {
      trackDayId: dayId,
      bestLap: 112.34,
      laps: 9,
      conditions: { ambientTemp: 22, trackTemp: 35, condition: 'dry' },
      setup: {
        fork: { compression: 12, rebound: 10, preload: 4, height: 5 },
        shock: { compressionLow: 12, rebound: 10, rideHeight: 2 },
        sag: { frontRider: 32, rearRider: 27 },
      },
      tyres: {
        front: { coldPressure: 2.14, hotPressure: 2.41, wear: 'graining' },
        rear: { coldPressure: 1.79, hotPressure: 2.03 },
      },
      feedback: ['front-push-entry', 'slow-steering'],
      changesMade: 'Dropped the forks 2 mm',
    })
    expect(created.status).toBe(201)

    const read = await call('GET', `/api/sessions/${created.body.id}`)
    expect(read.body.bestLap).toBe(112.34)
    expect(read.body.setup.fork.compression).toBe(12)
    expect(read.body.setup.shock.rideHeight).toBe(2)
    expect(read.body.setup.sag.frontRider).toBe(32)
    expect(read.body.tyres.front.hotPressure).toBeCloseTo(2.41, 10)
    expect(read.body.tyres.front.wear).toBe('graining')
    expect(read.body.feedback).toEqual(['front-push-entry', 'slow-steering'])
    expect(read.body.changesMade).toBe('Dropped the forks 2 mm')
  })

  it('catches a psi value typed into a pressure field', async () => {
    await seedBike()
    const dayId = await seedDay()
    const created = await call('POST', '/api/sessions', {
      trackDayId: dayId,
      tyres: { front: { coldPressure: 31 } },
    })
    expect(created.status).toBe(400)
    expect(JSON.stringify(created.body)).toMatch(/psi/)
  })

  it('refuses a session on a track day that does not exist', async () => {
    const created = await call('POST', '/api/sessions', { trackDayId: 'nope' })
    expect(created.status).toBe(400)
    expect(created.body.error).toMatch(/No track day/)
  })

  it('filters by track day', async () => {
    await seedBike()
    const first = await seedDay('Daytona')
    const second = await seedDay('Barber')
    await call('POST', '/api/sessions', { trackDayId: first })
    await call('POST', '/api/sessions', { trackDayId: second })

    expect((await call('GET', '/api/sessions')).body).toHaveLength(2)
    const filtered = await call('GET', `/api/sessions?trackDayId=${second}`)
    expect(filtered.body).toHaveLength(1)
    expect(filtered.body[0].trackDayId).toBe(second)
  })

  it('merges a patch into the setup rather than replacing it', async () => {
    await seedBike()
    const dayId = await seedDay()
    const created = await call('POST', '/api/sessions', {
      trackDayId: dayId,
      setup: { fork: { compression: 12, rebound: 10 } },
    })
    const patched = await call('PATCH', `/api/sessions/${created.body.id}`, {
      setup: { fork: { compression: 10 } },
    })
    expect(patched.body.setup.fork.compression).toBe(10)
    expect(patched.body.setup.fork.rebound).toBe(10)
  })
})

describe('tyres', () => {
  it('creates, lists and retires', async () => {
    const created = await call('POST', '/api/tyres', {
      axle: 'front',
      model: { make: 'Pirelli', model: 'Diablo Superbike', compound: 'SC1', slick: true },
      label: 'Set B',
    })
    expect(created.status).toBe(201)
    expect(created.body.model.slick).toBe(true)

    const retired = await call('PATCH', `/api/tyres/${created.body.id}`, { retired: true })
    expect(retired.body.retired).toBe(true)
    expect((await call('GET', '/api/tyres')).body).toHaveLength(1)
  })

  it('rejects an axle that is not front or rear', async () => {
    const created = await call('POST', '/api/tyres', {
      axle: 'middle',
      model: { make: 'Pirelli', model: 'SC1' },
    })
    expect(created.status).toBe(400)
  })
})

describe('preferences', () => {
  it('starts from the defaults and merges a partial update', async () => {
    expect((await call('GET', '/api/preferences')).body.pressureUnit).toBe('psi')
    const updated = await call('PUT', '/api/preferences', { pressureUnit: 'bar' })
    expect(updated.body.pressureUnit).toBe('bar')
    expect(updated.body.temperatureUnit).toBe('F')
    expect((await call('GET', '/api/preferences')).body.pressureUnit).toBe('bar')
  })
})

describe('garage snapshot', () => {
  it('round-trips everything the client holds', async () => {
    await seedBike()
    const dayId = await seedDay()
    await call('POST', '/api/sessions', { trackDayId: dayId, bestLap: 112.34 })

    const snapshot = await call('GET', '/api/garage')
    expect(snapshot.body.bikes).toHaveLength(1)
    expect(snapshot.body.sessions).toHaveLength(1)

    const pushed = await call('PUT', '/api/garage', snapshot.body)
    expect(pushed.status).toBe(200)
    expect(pushed.body.sessions[0].bestLap).toBe(112.34)
  })

  it('deletes rows the incoming document no longer has', async () => {
    await seedBike()
    const dayId = await seedDay()
    await call('POST', '/api/sessions', { trackDayId: dayId })
    const snapshot = (await call('GET', '/api/garage')).body

    const pushed = await call('PUT', '/api/garage', { ...snapshot, sessions: [] })
    expect(pushed.body.sessions).toEqual([])
    expect((await call('GET', '/api/sessions')).body).toEqual([])
  })

  it('rejects a body that is not a snapshot', async () => {
    const pushed = await call('PUT', '/api/garage', { nonsense: true })
    expect(pushed.status).toBe(400)
  })
})

describe('garage isolation', () => {
  it('keeps one garage’s rows out of another', async () => {
    await seedBike('mine')
    const other = await handleApiRequest(
      new Request('https://example.test/api/bikes', {
        headers: { authorization: `Bearer ${KEY}` },
      }),
      deps({ garageId: 'someone-else' }),
    )
    expect(await other.json()).toEqual([])
    expect((await getSnapshot(db, 'default')).bikes).toHaveLength(1)
  })
})

describe('routing', () => {
  it('404s an unknown collection and suggests what exists', async () => {
    const response = await call('GET', '/api/wheels')
    expect(response.status).toBe(404)
    expect(response.body.routes).toBeTruthy()
  })

  it('405s a method a route does not have', async () => {
    const response = await call('DELETE', '/api/garage')
    expect(response.status).toBe(405)
  })

  it('answers a CORS preflight', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/sessions', { method: 'OPTIONS' }),
      deps(),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('rejects a body that is not JSON', async () => {
    const response = await handleApiRequest(
      new Request('https://example.test/api/bikes', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: '{ not json',
      }),
      deps(),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/not valid JSON/)
  })
})
