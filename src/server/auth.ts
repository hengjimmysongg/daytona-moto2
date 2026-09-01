/**
 * Passwords and session tokens.
 *
 * Built on Web Crypto, which Node and every edge runtime have, so accounts
 * cost this project no dependency and no native build — the same reason the
 * database driver is chosen the way it is.
 *
 * Two rules the rest of the server relies on:
 *
 *   - A password is never stored, only a PBKDF2 derivation of it, salted per
 *     user so two people with the same password get different rows.
 *   - A token is never stored either. The database holds its SHA-256, so a
 *     leaked dump is a list of useless hashes rather than a set of live
 *     sessions.
 */

/**
 * OWASP's floor for PBKDF2-HMAC-SHA256. It costs about a tenth of a second
 * per sign-in, which is the point: it is the same tenth of a second for
 * every guess an attacker makes against a stolen row.
 */
const ITERATIONS = 210_000
const SALT_BYTES = 16
const KEY_BITS = 256

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Compare without leaking, through timing, how much of the value matched. */
function bytesMatch(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!
  return difference === 0
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/**
 * `pbkdf2$sha256$<iterations>$<salt>$<hash>`.
 *
 * The parameters travel with the hash so that raising the iteration count
 * later does not invalidate every existing password — an old row still
 * verifies against the count it was written with.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, hash, iterations, salt, expected] = stored.split('$')
  if (scheme !== 'pbkdf2' || hash !== 'sha256' || !iterations || !salt || !expected) return false
  const rounds = Number(iterations)
  if (!Number.isInteger(rounds) || rounds < 1) return false
  try {
    const actual = await derive(password, fromBase64(salt), rounds)
    return bytesMatch(actual, fromBase64(expected))
  } catch {
    // A malformed row is a failed sign-in, not a 500.
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

const TOKEN_BYTES = 32

/** How long a sign-in lasts. Long, because this is a log book, not a bank. */
export const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 90

/** 256 bits from the platform CSPRNG, URL-safe so it survives being pasted. */
export function newToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** What actually goes in the database, in place of the token itself. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ */
/* What counts as an email and a password                              */
/* ------------------------------------------------------------------ */

/**
 * Deliberately loose. The only address that is definitely deliverable is
 * one you have sent mail to, and this app never sends any — it is an
 * identifier. So this rejects what is obviously not an address and lets
 * the rest through, rather than turning away a valid oddity.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

export const MAX_EMAIL_LENGTH = 254
export const MIN_PASSWORD_LENGTH = 8
/** Long enough for any passphrase, short enough that hashing stays cheap. */
export const MAX_PASSWORD_LENGTH = 200

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The limits that apply to *any* credentials, including at sign-in: they
 * exist to bound what the server will spend work on, not to judge the
 * password.
 */
export function checkCredentialLimits(email: string, password: string): string | null {
  if (email.length > MAX_EMAIL_LENGTH) return 'That email address is too long.'
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `A password can be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  return null
}

/**
 * What we are willing to *create* an account with.
 *
 * Deliberately not applied at sign-in. A rule tightened later would
 * otherwise lock out every rider whose password predates it — the account
 * would still be theirs, and the form would refuse to even check it.
 */
export function checkCredentials(email: string, password: string): string | null {
  const limit = checkCredentialLimits(email, password)
  if (limit) return limit
  if (!EMAIL.test(email)) return 'That does not look like an email address.'
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}
