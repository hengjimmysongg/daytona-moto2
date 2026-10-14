import { useState } from 'react'
import { Note } from './components/kit'
import { AccountCard, GarageView } from './views/GarageView'
import { SagView } from './views/SagView'
import { SessionView } from './views/SessionView'
import { TrackDayDetailView, TrackDayListView } from './views/TrackDayView'
import { TyreView } from './views/TyreView'
import { SignInView } from './views/SignInView'
import { ResetPasswordView } from './views/ResetPasswordView'
import { useGarage, type Garage } from './store'
import { useAuth, type Auth } from './auth'
import { useConnection, type Connection } from './connection'

type Route =
  | { view: 'days' }
  | { view: 'day'; dayId: string }
  | { view: 'session'; sessionId: string }
  | { view: 'sag' }
  | { view: 'tyres' }
  | { view: 'garage' }

const TABS = [
  { key: 'days', glyph: '⏱', label: 'Track days' },
  { key: 'sag', glyph: '↕', label: 'Sag' },
  { key: 'tyres', glyph: '◎', label: 'Tyres' },
  { key: 'garage', glyph: '⚙', label: 'Garage' },
] as const

export function App() {
  const auth = useAuth()
  const garage = useGarage(auth.account?.id ?? null)
  const connection = useConnection()
  const [route, setRoute] = useState<Route>({ view: 'days' })

  // Shown on every screen, signed in or not: a down database is the reason
  // for whatever else is not working, so it goes first.
  const connectionNote = <ConnectionNote connection={connection} />

  // Nothing to show until we know whose log this is: the data lives in the
  // database, and which rows come back depends on who is asking.
  //
  // With a stored sign-in to refresh and no database to refresh it against,
  // this wait runs to half a minute, so say why rather than show nothing.
  if (auth.loading) {
    return (
      <div className="app">
        <header className="masthead">
          <h1 className="masthead__title">Track day log</h1>
        </header>
        <main>{connectionNote}</main>
      </div>
    )
  }

  // Back from a reset email: take a new password before anything else, even
  // though the recovery session would otherwise count as signed in.
  if (auth.recovering) {
    return (
      <div className="app">
        <header className="masthead">
          <h1 className="masthead__title">Track day log</h1>
        </header>
        <main>
          {connectionNote}
          <ResetPasswordView auth={auth} />
        </main>
      </div>
    )
  }

  if (!auth.account) {
    return (
      <div className="app">
        <header className="masthead">
          <h1 className="masthead__title">Track day log</h1>
          <p className="masthead__sub">Suspension and tyre pressures, session by session.</p>
        </header>
        <main>
          {connectionNote}
          {auth.unreachable ? (
            <Note>
              You are still signed in on this device. Your log opens by itself once{' '}
              {connection.state === 'offline' ? 'this device is back online' : 'the database answers again'}
              .{' '}
              {connection.state === 'ok' && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => window.location.reload()}
                >
                  Open it now
                </button>
              )}
            </Note>
          ) : (
            <SignInView auth={auth} />
          )}
        </main>
      </div>
    )
  }

  // Which tab lights up: a day and a session both belong to Track days.
  const tab: (typeof TABS)[number]['key'] =
    route.view === 'day' || route.view === 'session' ? 'days' : route.view

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__row">
          <h1 className="masthead__title">{titleFor(tab)}</h1>
          <SaveBadge garage={garage} />
        </div>
        <p className="masthead__sub">{subtitleFor(tab)}</p>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="tabs__item"
            aria-current={tab === entry.key ? 'page' : undefined}
            onClick={() => setRoute(entry.key === 'days' ? { view: 'days' } : { view: entry.key })}
          >
            <span className="tabs__glyph" aria-hidden="true">
              {entry.glyph}
            </span>
            {entry.label}
          </button>
        ))}
      </nav>

      <main>
        {connectionNote}
        {/* While the connection note is up it already says why; this one
            would only repeat it with less to go on. */}
        {garage.loadError && connection.state === 'ok' && (
          <Note tone="bad">
            Your log could not be loaded: {garage.loadError}. Nothing has been lost — this screen
            just does not know what is in there yet.{' '}
            <button
              type="button"
              className="btn btn--sm"
              onClick={garage.reload}
              disabled={garage.loading}
            >
              {garage.loading ? 'Trying…' : 'Try again'}
            </button>
          </Note>
        )}
        {garage.saveError &&
          (connection.state === 'ok' ? (
            <Note tone="bad">
              That change has not reached the database: {garage.saveError}. It is still on screen —
              edit anything, or{' '}
              <button
                type="button"
                className="btn btn--sm"
                onClick={garage.retrySave}
                disabled={garage.saving}
              >
                {garage.saving ? 'Trying…' : 'Try again'}
              </button>
            </Note>
          ) : (
            <Note tone="warn">
              Your latest changes are on screen but not saved yet. They are sent as soon as the
              database answers again — keep this page open until the badge says Saved.
            </Note>
          ))}
        {garage.saveRefused && (
          <Note tone="bad">
            The database turned down a change, so it was not saved: {garage.saveRefused}. The screen
            may now show something your log does not hold.{' '}
            <button type="button" className="btn btn--sm" onClick={garage.reload}>
              Reload my log
            </button>
          </Note>
        )}

        {garage.loaded ? (
          <Views route={route} setRoute={setRoute} garage={garage} auth={auth} />
        ) : (
          // Nothing real to show yet, and nothing here may be changed: an edit
          // to a stand-in empty log would overwrite the real one once sent.
          // Once something has gone wrong, signing out stays within reach.
          <>
            <Note>
              {garage.loadError || connection.state !== 'ok'
                ? 'Your log appears here once it has loaded. Until then there is nothing to ' +
                  'change, so nothing can be overwritten.'
                : 'Loading your log…'}
            </Note>
            {(garage.loadError || connection.state !== 'ok') && <AccountCard auth={auth} />}
          </>
        )}
      </main>
    </div>
  )
}

/** The section the rider is on, once there is a log to show. */
function Views({
  route,
  setRoute,
  garage,
  auth,
}: {
  route: Route
  setRoute: (route: Route) => void
  garage: Garage
  auth: Auth
}) {
  return (
    <>
      {route.view === 'days' && (
        <TrackDayListView
          garage={garage}
          onOpen={(dayId) => setRoute({ view: 'day', dayId })}
        />
      )}
      {route.view === 'day' && (
        <TrackDayDetailView
          garage={garage}
          dayId={route.dayId}
          onOpenSession={(sessionId) => setRoute({ view: 'session', sessionId })}
          onBack={() => setRoute({ view: 'days' })}
        />
      )}
      {route.view === 'session' && (
        <SessionView
          garage={garage}
          sessionId={route.sessionId}
          onBack={(dayId) => setRoute(dayId ? { view: 'day', dayId } : { view: 'days' })}
        />
      )}
      {route.view === 'sag' && <SagView garage={garage} />}
      {route.view === 'tyres' && <TyreView garage={garage} />}
      {route.view === 'garage' && <GarageView garage={garage} auth={auth} />}
    </>
  )
}

/**
 * Why nothing can load or save, when that is the case.
 *
 * The two causes look identical to the browser but mean very different
 * things to a rider: no signal is theirs to fix, and passes; a database that
 * is down is not theirs to fix, and needs whoever runs the app. A free
 * project pauses after a quiet week, so that is named as the likely reason.
 */
function ConnectionNote({ connection }: { connection: Connection }) {
  if (connection.state === 'ok') return null
  return (
    <div role="status">
      <Note tone={connection.state === 'down' ? 'bad' : 'warn'}>
        {connection.state === 'down'
          ? 'The database is not answering. It has most likely been paused after a quiet week, ' +
            'or is still starting back up. Nothing you have saved is lost. Whoever runs this app ' +
            'can resume it from the Supabase dashboard, and this page picks up again by itself ' +
            'once it is back.'
          : 'No connection. This device cannot reach the database from here, so nothing can ' +
            'load or save until it can — check the signal, or the Wi-Fi. Nothing you have saved ' +
            'is lost, and this page picks up again by itself.'}{' '}
        <button
          type="button"
          className="btn btn--sm"
          onClick={connection.check}
          disabled={connection.checking}
        >
          {connection.checking ? 'Checking…' : 'Check again'}
        </button>
      </Note>
    </div>
  )
}

/** Whether what is on screen has reached the database, and nothing more. */
function SaveBadge({ garage }: { garage: Garage }) {
  // A retry in progress says so before the failure it is retrying.
  if (garage.saving) return <span className="badge badge--muted">Saving…</span>
  if (garage.loading) return <span className="badge badge--muted">Loading…</span>
  if (garage.loadError && !garage.loaded) return <span className="badge badge--bad">Not loaded</span>
  if (garage.saveError || garage.saveRefused) {
    return <span className="badge badge--bad">Not saved</span>
  }
  return <span className="badge badge--ok">Saved</span>
}

function titleFor(tab: string): string {
  switch (tab) {
    case 'sag':
      return 'Sag'
    case 'tyres':
      return 'Tyres'
    case 'garage':
      return 'Garage'
    default:
      return 'Track days'
  }
}

function subtitleFor(tab: string): string {
  switch (tab) {
    case 'sag':
      return 'Rider sag sets preload. Free sag checks the spring.'
    case 'tyres':
      return 'Work back from the hot pressure you want.'
    case 'garage':
      return 'Bikes, units and backups.'
    default:
      return 'One change at a time.'
  }
}
