import { useState } from 'react'
import { Note } from './components/kit'
import { GarageView } from './views/GarageView'
import { SagView } from './views/SagView'
import { SessionView } from './views/SessionView'
import { TrackDayDetailView, TrackDayListView } from './views/TrackDayView'
import { TyreView } from './views/TyreView'
import { useGarage } from './store'
import { useSync, type SyncState } from './sync'

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
  const garage = useGarage()
  const sync = useSync(garage.data, garage.replace)
  const [route, setRoute] = useState<Route>({ view: 'days' })

  // Which tab lights up: a day and a session both belong to Track days.
  const tab: (typeof TABS)[number]['key'] =
    route.view === 'day' || route.view === 'session' ? 'days' : route.view

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__row">
          <h1 className="masthead__title">{titleFor(tab)}</h1>
          <SyncBadge state={sync.state} />
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
            Your data could not be read or saved: {garage.error}. Changes may not survive a reload.
          </Note>
        )}
        {!garage.persistent && (
          <Note tone="warn">
            This browser will not let the app store anything, so the log is only held in memory and
            will be lost when you close the tab. Export a backup before you do.
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
        {route.view === 'garage' && <GarageView garage={garage} sync={sync} />}
      </main>
    </div>
  )
}

/** A word on whether the log has reached the server, and nothing more. */
function SyncBadge({ state }: { state: SyncState }) {
  if (state === 'disabled') return null
  const look: Record<Exclude<SyncState, 'disabled'>, { tone: string; label: string }> = {
    syncing: { tone: 'muted', label: 'Syncing…' },
    synced: { tone: 'ok', label: 'Synced' },
    offline: { tone: 'muted', label: 'Offline' },
    unauthorised: { tone: 'bad', label: 'Key rejected' },
    error: { tone: 'warn', label: 'Sync failed' },
  }
  const { tone, label } = look[state]
  return <span className={`badge badge--${tone}`}>{label}</span>
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
