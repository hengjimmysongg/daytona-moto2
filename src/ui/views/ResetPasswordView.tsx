import { useState } from 'react'
import { Card, Note, TextField } from '../components/kit'
import type { Auth } from '../auth'

/**
 * Setting a new password, after following the link from a reset email.
 *
 * The rider arrives here already on a recovery session — `auth.recovering` is
 * what routed them here rather than into the app — so all this has to do is
 * take a new password, twice, and hand it to Supabase. On success the session
 * becomes an ordinary one and the app opens behind it.
 */
export function ResetPasswordView({ auth }: { auth: Auth }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const mismatch = confirm !== '' && password !== confirm
  const ready = !auth.working && password.length >= 6 && password === confirm

  const submit = () => {
    if (!ready) return
    void auth.updatePassword(password)
  }

  return (
    <Card title="Set a new password" hint="Pick a new password for your account.">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 6 characters."
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••"
        />

        {mismatch && (
          <div style={{ marginBottom: 10 }}>
            <Note tone="warn">Those two do not match yet.</Note>
          </div>
        )}
        {auth.error && (
          <div style={{ marginBottom: 10 }}>
            <Note tone="bad">{auth.error}</Note>
          </div>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={!ready}>
          {auth.working ? 'Working…' : 'Update password'}
        </button>
      </form>
    </Card>
  )
}
