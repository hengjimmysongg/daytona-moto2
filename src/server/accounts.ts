/**
 * Accounts, in the database.
 *
 * A user's id is also their garage id. That is the whole of the ownership
 * model: every row in every other table already carries a `garage_id`, so
 * signing in is nothing more than working out which garage this request is
 * allowed to touch.
 */

import { newId } from '../core/id.js'
import { hashPassword, hashToken, newToken, normaliseEmail, verifyPassword, TOKEN_TTL_MS } from './auth.js'
import type { Db } from './db.js'

export interface User {
  id: string
  email: string
  createdAt: number
}

export interface SignedIn {
  user: User
  token: string
  expiresAt: number
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    createdAt: Number(row.created_at),
  }
}

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const result = await db.execute({
    sql: 'SELECT id, email, created_at FROM users WHERE email = ?',
    args: [normaliseEmail(email)],
  })
  const row = result.rows[0]
  return row ? toUser(row as unknown as Record<string, unknown>) : undefined
}

/** `undefined` when the address is already taken. */
export async function createUser(
  db: Db,
  email: string,
  password: string,
  now: number,
): Promise<User | undefined> {
  const address = normaliseEmail(email)
  const user: User = { id: newId('user'), email: address, createdAt: now }
  try {
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      args: [user.id, address, await hashPassword(password), now],
    })
  } catch (error) {
    // The UNIQUE index on email is what actually decides this, rather than a
    // check-then-insert that two simultaneous signups could both pass.
    if (String(error).includes('UNIQUE')) return undefined
    throw error
  }
  return user
}

/**
 * The user this password belongs to, or `undefined`.
 *
 * A missing account and a wrong password are the same answer on purpose:
 * telling them apart turns the sign-in form into a way to ask which email
 * addresses have accounts.
 */
export async function authenticate(db: Db, email: string, password: string): Promise<User | undefined> {
  const result = await db.execute({
    sql: 'SELECT id, email, password_hash, created_at FROM users WHERE email = ?',
    args: [normaliseEmail(email)],
  })
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return undefined
  const ok = await verifyPassword(password, String(row.password_hash))
  return ok ? toUser(row) : undefined
}

export async function issueToken(db: Db, user: User, now: number): Promise<SignedIn> {
  const token = newToken()
  const expiresAt = now + TOKEN_TTL_MS
  await db.execute({
    sql: 'INSERT INTO auth_tokens (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [await hashToken(token), user.id, now, expiresAt],
  })
  return { user, token, expiresAt }
}

/** The signed-in user for a token, if it is real and still current. */
export async function userForToken(db: Db, token: string, now: number): Promise<User | undefined> {
  const result = await db.execute({
    sql: `SELECT users.id, users.email, users.created_at, auth_tokens.expires_at
            FROM auth_tokens
            JOIN users ON users.id = auth_tokens.user_id
           WHERE auth_tokens.token_hash = ?`,
    args: [await hashToken(token)],
  })
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return undefined
  if (Number(row.expires_at) <= now) {
    // Expired: clear it out on the way past, so the table does not grow a
    // tail of dead rows that nothing ever looks at again.
    await revokeToken(db, token)
    return undefined
  }
  return toUser(row)
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM auth_tokens WHERE token_hash = ?',
    args: [await hashToken(token)],
  })
}
