/**
 * Accounts.
 *
 * The things that have to be true for a log book that anyone can sign up
 * for: a password is never stored, a token is never stored, one rider
 * cannot reach another's garage, and a sign-in form cannot be used to ask
 * who has an account here.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, migrate, type Db } from '../src/server/db'
import { handleApiRequest } from '../src/server/router'
import {
  authenticate,
  createUser,
  issueToken,
  revokeToken,
  userForToken,
} from '../src/server/accounts'
import {
  checkCredentials,
  hashPassword,
  hashToken,
  newToken,
  normaliseEmail,
  verifyPassword,
} from '../src/server/auth'

const NOW = 1_700_000_000_000
let db: Db

beforeEach(async () => {
  db = await createDb({ url: ':memory:' })
  await migrate(db)
})

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await handleApiRequest(
    new Request(`https://example.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { db, now: () => NOW },
  )
  return { status: response.status, body: (await response.json()) as any }
}

/* ------------------------------------------------------------------ */

describe('passwords', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('correct horse batter', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('never contains the password, and salts so two alike are not equal', async () => {
    const a = await hashPassword('same password')
    const b = await hashPassword('same password')
    expect(a).not.toContain('same password')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same password', b)).toBe(true)
  })

  it('carries its own parameters, so they can be raised later', async () => {
    const stored = await hashPassword('correct horse battery')
    expect(stored.startsWith('pbkdf2$sha256$210000$')).toBe(true)
    expect(stored.split('$')).toHaveLength(5)
  })

  it('treats a malformed row as a failed sign-in, not a crash', async () => {
    expect(await verifyPassword('anything', '')).toBe(false)
    expect(await verifyPassword('anything', 'bcrypt$x$y')).toBe(false)
    expect(await verifyPassword('anything', 'pbkdf2$sha256$0$c2FsdA==$aGFzaA==')).toBe(false)
  })
})

describe('credential rules', () => {
  it('wants something that looks like an address and a long enough password', () => {
    expect(checkCredentials('rider@example.test', 'correct horse')).toBeNull()
    expect(checkCredentials('not-an-address', 'correct horse')).toMatch(/email/)
    expect(checkCredentials('rider@example.test', 'short')).toMatch(/8 characters/)
    expect(checkCredentials('rider@example.test', 'x'.repeat(201))).toMatch(/at most/)
  })

  it('treats an address as the same address whatever the case', () => {
    expect(normaliseEmail('  Rider@Example.TEST ')).toBe('rider@example.test')
  })
})

describe('tokens', () => {
  it('are long, random and URL-safe', () => {
    const token = newToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(newToken()).not.toBe(token)
  })

  it('are stored only as a hash, so a dump is not a set of sign-ins', async () => {
    const user = await createUser(db, 'rider@example.test', 'correct horse battery', NOW)
    const { token } = await issueToken(db, user!, NOW)
    const rows = await db.execute('SELECT token_hash FROM auth_tokens')
    expect(rows.rows).toHaveLength(1)
    expect(String(rows.rows[0]!.token_hash)).not.toBe(token)
    expect(String(rows.rows[0]!.token_hash)).toBe(await hashToken(token))
  })

  it('stop working when revoked, and when they expire', async () => {
    const user = await createUser(db, 'rider@example.test', 'correct horse battery', NOW)
    const { token, expiresAt } = await issueToken(db, user!, NOW)

    expect((await userForToken(db, token, NOW))?.id).toBe(user!.id)
    expect(await userForToken(db, token, expiresAt + 1)).toBeUndefined()

    const { token: fresh } = await issueToken(db, user!, NOW)
    await revokeToken(db, fresh)
    expect(await userForToken(db, fresh, NOW)).toBeUndefined()
  })
})

describe('the users table', () => {
  it('refuses a second account on one address, whatever the case', async () => {
    expect(await createUser(db, 'rider@example.test', 'correct horse battery', NOW)).toBeTruthy()
    expect(await createUser(db, 'RIDER@example.test', 'another password', NOW)).toBeUndefined()
  })

  it('authenticates against the stored hash', async () => {
    await createUser(db, 'rider@example.test', 'correct horse battery', NOW)
    expect(await authenticate(db, 'rider@example.test', 'correct horse battery')).toBeTruthy()
    expect(await authenticate(db, 'rider@example.test', 'wrong')).toBeUndefined()
    expect(await authenticate(db, 'nobody@example.test', 'correct horse battery')).toBeUndefined()
  })
})

describe('signing up over HTTP', () => {
  it('creates the account and hands back a token that works', async () => {
    const created = await post('/api/auth/signup', {
      email: 'Rider@Example.test',
      password: 'correct horse battery',
    })
    expect(created.status).toBe(201)
    expect(created.body.user.email).toBe('rider@example.test')
    expect(created.body.expiresAt).toBeGreaterThan(NOW)
    expect(await userForToken(db, created.body.token, NOW)).toBeTruthy()
  })

  it('never returns the password or its hash', async () => {
    const created = await post('/api/auth/signup', {
      email: 'rider@example.test',
      password: 'correct horse battery',
    })
    expect(JSON.stringify(created.body)).not.toContain('correct horse battery')
    expect(JSON.stringify(created.body)).not.toContain('pbkdf2')
  })

  it('says the address is taken rather than silently making a second garage', async () => {
    await post('/api/auth/signup', { email: 'rider@example.test', password: 'correct horse battery' })
    const again = await post('/api/auth/signup', {
      email: 'rider@example.test',
      password: 'a different password',
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/already has an account/)
  })

  it('rejects a password too short to be worth hashing', async () => {
    const created = await post('/api/auth/signup', { email: 'rider@example.test', password: 'short' })
    expect(created.status).toBe(400)
    expect(created.body.error).toMatch(/8 characters/)
  })
})

describe('signing in over HTTP', () => {
  beforeEach(async () => {
    await post('/api/auth/signup', { email: 'rider@example.test', password: 'correct horse battery' })
  })

  it('hands back a fresh token', async () => {
    const in1 = await post('/api/auth/login', {
      email: 'rider@example.test',
      password: 'correct horse battery',
    })
    expect(in1.status).toBe(200)
    expect(await userForToken(db, in1.body.token, NOW)).toBeTruthy()
  })

  it('answers a wrong password and an unknown address identically', async () => {
    const wrongPassword = await post('/api/auth/login', {
      email: 'rider@example.test',
      password: 'not it',
    })
    const noSuchUser = await post('/api/auth/login', {
      email: 'nobody@example.test',
      password: 'not it',
    })
    expect(wrongPassword.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(wrongPassword.body.error).toBe(noSuchUser.body.error)
  })

  it('signs out, and the token stops working', async () => {
    const { body } = await post('/api/auth/login', {
      email: 'rider@example.test',
      password: 'correct horse battery',
    })
    const out = await post('/api/auth/logout', {}, { authorization: `Bearer ${body.token}` })
    expect(out.status).toBe(200)
    expect(await userForToken(db, body.token, NOW)).toBeUndefined()
  })

  it('reports who is signed in', async () => {
    const { body } = await post('/api/auth/login', {
      email: 'rider@example.test',
      password: 'correct horse battery',
    })
    const me = await handleApiRequest(
      new Request('https://example.test/api/auth/me', {
        headers: { authorization: `Bearer ${body.token}` },
      }),
      { db, now: () => NOW },
    )
    expect(me.status).toBe(200)
    expect((await me.json()).user.email).toBe('rider@example.test')

    const anonymous = await handleApiRequest(
      new Request('https://example.test/api/auth/me'),
      { db, now: () => NOW },
    )
    expect(anonymous.status).toBe(401)
  })
})
