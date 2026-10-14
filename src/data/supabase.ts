/**
 * The Supabase connection.
 *
 * Both values are meant to be public: the publishable key identifies the
 * project to a browser and grants nothing on its own. What a signed-in
 * rider may read and write is decided by row-level security in Postgres,
 * on every query, which is the only place that decision is safe to make.
 *
 * They are compiled in so a deployment needs no configuration to work, and
 * overridable so a fork can point at its own project without editing code.
 */

import { createClient } from '@supabase/supabase-js'
import { createMonitor } from './reachability.js'

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://mdmlutyqiqrfleztzhhz.supabase.co'

export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_3iSpqYBkDGdGizw9P-YpKw_ZMeY5Iv-'

/**
 * Where the sign-in is kept on this device. Spelled out rather than left to
 * the client's default -- which is this same name, so nobody is signed out
 * by it -- because signing out offline has to be able to clear it by hand.
 */
export const AUTH_STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`

/**
 * Watches every request the client makes, so the app can say "the database
 * is down" or "no signal" instead of passing on a bare "Failed to fetch".
 */
export const connection = createMonitor({
  // A read that goes all the way to Postgres, and that row-level security
  // answers with no rows: cheap, and it fails exactly when the log would.
  target: `${SUPABASE_URL}/rest/v1/bikes?select=id&limit=0`,
  headers: { apikey: SUPABASE_KEY },
  // Called through, not passed bare: `fetch` detached from `window` throws
  // "Illegal invocation" in some browsers.
  fetch: (input, init) => fetch(input, init),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
})

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: connection.fetch },
  auth: {
    storageKey: AUTH_STORAGE_KEY,
    // Keep the rider signed in across reloads and refresh the token in the
    // background: a log book that asks for a password every morning in the
    // paddock is a log book that stops getting filled in.
    persistSession: true,
    autoRefreshToken: true,
  },
})
