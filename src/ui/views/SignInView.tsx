import { useState } from 'react'
import { Card, Note, TextField } from '../components/kit'
import type { Auth } from '../auth'

/**
 * The way in.
 *
 * The log lives in the database now, so there is nothing to show until we
 * know whose log it is. That makes this a gate rather than a panel tucked
 * inside the app — but it stays a short one: an address, a password, and
 * no third field anybody has to think about.
 */
export function SignInView({ auth }: { auth: Auth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')

  const ready = email.trim() !== '' && password !== '' && !auth.working

  const submit = () => {
    if (!ready) return
    const address = email.trim()
    if (mode === 'signup') void auth.signUp(address, password)
    else void auth.signIn(address, password)
    setPassword('')
  }

  return (
    <Card
      title={mode === 'signup' ? 'Create an account' : 'Sign in'}
      hint="Free. Your track days, sessions and tyres are yours — nobody else can read them."
    >
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
        <TextField
          label="Password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          {...(mode === 'signup' ? { hint: 'At least 6 characters.' } : {})}
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
        />

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
          {auth.working ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </Card>
  )
}
