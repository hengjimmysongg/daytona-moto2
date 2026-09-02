import { useState } from 'react'
import { Note } from './components/kit'
import { GarageView } from './views/GarageView'
import { SagView } from './views/SagView'
import { SessionView } from './views/SessionView'
import { TrackDayDetailView, TrackDayListView } from './views/TrackDayView'
import { TyreView } from './views/TyreView'
import { SignInView } from './views/SignInView'
import { useGarage, type Garage } from './store'
import { useAuth } from './auth'

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
  const [route, setRoute] = useState<Route>({ view: 'days' })

  // Nothing to show until we know whose log this is: the data lives in the
  // database, and which rows come back depends on who is asking.
  if (auth.loading) {
    return (
      <div className="app">
        <header className="masthead">
          <h1 className="masthead__title">Track day log</h1>
        </header>
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
          <SignInView auth={auth} />
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
        {garage.error && (
          <Note tone="bad">
            That change has not reached the database: {garage.error}. It is still on screen — check
            your connection and edit anything to try again.
          </Note>
        )}

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
      </main>
    </div>
  )
}

/** Whether what is on screen has reached the database, and nothing more. */
function SaveBadge({ garage }: { garage: Garage }) {
  if (garage.error) return <span className="badge badge--bad">Not saved</span>
  if (garage.loading) return <span className="badge badge--muted">Loading…</span>
  if (garage.saving) return <span className="badge badge--muted">Saving…</span>
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
