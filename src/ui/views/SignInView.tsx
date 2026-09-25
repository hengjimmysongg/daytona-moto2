import { useState } from 'react'
import { Card, Note, TextField } from '../components/kit'
import type { Auth } from '../auth'

type Mode = 'signup' | 'signin' | 'reset'

/**
 * The way in.
 *
 * The log lives in the database now, so there is nothing to show until we
 * know whose log it is. That makes this a gate rather than a panel tucked
 * inside the app — but it stays a short one: an address, a password, and
 * no third field anybody has to think about. A forgotten password gets its
 * own path: email a link instead, and set a new one on the way back.
 */
export function SignInView({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('signup')

  const hasEmail = email.trim() !== ''
  // Resetting only needs the address; signing up or in also needs a password.
  const ready = !auth.working && hasEmail && (mode === 'reset' || password !== '')

  const submit = () => {
    if (!ready) return
    const address = email.trim()
    if (mode === 'signup') void auth.signUp(address, password)
    else if (mode === 'signin') void auth.signIn(address, password)
    else void auth.resetPassword(address)
    setPassword('')
  }

  const title =
    mode === 'signup' ? 'Create an account' : mode === 'signin' ? 'Sign in' : 'Reset your password'
  const hint =
    mode === 'reset'
      ? 'Enter your email and we’ll send a link to set a new password.'
      : 'Free. Your track days, sessions and tyres are yours — nobody else can read them.'
  const label =
    auth.working
      ? 'Working…'
      : mode === 'signup'
        ? 'Create account'
        : mode === 'signin'
          ? 'Sign in'
          : 'Send reset link'

  return (
    <Card title={title} hint={hint}>
      {mode !== 'reset' && (
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={mode === 'signup' ? 'btn btn--primary' : 'btn'}
            aria-pressed={mode === 'signup'}
            onClick={() => setMode('signup')}
          >
            Create account
          </button>
          <button
            type="button"
            className={mode === 'signin' ? 'btn btn--primary' : 'btn'}
            aria-pressed={mode === 'signin'}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
        />
        {mode !== 'reset' && (
          <TextField
            label="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            {...(mode === 'signup' ? { hint: 'At least 6 characters.' } : {})}
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
          />
        )}

        {auth.error && (
          <div style={{ marginBottom: 10 }}>
            <Note tone="bad">{auth.error}</Note>
          </div>
        )}
        {auth.notice && (
          <div style={{ marginBottom: 10 }}>
            <Note tone="ok">{auth.notice}</Note>
          </div>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={!ready}>
          {label}
        </button>
      </form>

      <div style={{ marginTop: 10, textAlign: 'center' }}>
        {mode === 'reset' ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        ) : (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMode('reset')}>
            Forgot your password?
          </button>
        )}
      </div>
    </Card>
  )
}
