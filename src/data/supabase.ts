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

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://mdmlutyqiqrfleztzhhz.supabase.co'

export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_3iSpqYBkDGdGizw9P-YpKw_ZMeY5Iv-'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // Keep the rider signed in across reloads and refresh the token in the
    // background: a log book that asks for a password every morning in the
    // paddock is a log book that stops getting filled in.
    persistSession: true,
    autoRefreshToken: true,
  },
})
