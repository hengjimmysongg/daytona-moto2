import { useState } from 'react'
import { Badge, Card, EmptyState, Field, Note, SelectField, TextField } from '../components/kit'
import { fmtDate, fmtPressure, fmtPressureDelta, fmtTemp, todayIso } from '../format'
import { formatLapTime } from '../../core/laptime'
import { newId } from '../../core/id'
import { cloneSetup, diffSetups, summariseDiff } from '../../core/setup'
import { pressureRise } from '../../core/tyres'
import {
  reconcileCurrentSetup,
  sessionsForDay,
  setBikeCurrentSetup,
  trackDaysByDate,
} from '../../core/storage'
import { csvFilename, trackDayCsv } from '../../core/csv'
import { downloadCsv } from '../download'
import { CIRCUITS, describeTyre } from '../../data/presets'
import type { Axle, Bike, GarageData, Session, TrackDay } from '../../core/types'
import type { Garage } from '../store'

export function TrackDayListView({
  garage,
  onOpen,
}: {
  garage: Garage
  onOpen: (dayId: string) => void
}) {
  const { data, update } = garage
  const [creating, setCreating] = useState(false)
  const days = trackDaysByDate(data)

  if (data.bikes.length === 0) {
    return (
      <Card>
        <EmptyState title="Add a bike first">
          <p>
            A track day belongs to a machine, and the app needs to know what its adjusters can do
            before it can check a setup. Head to Garage.
          </p>
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      {creating ? (
        <NewTrackDayForm
          data={data}
          onCancel={() => setCreating(false)}
          onCreate={(day) => {
            update((current) => ({ ...current, trackDays: [...current.trackDays, day] }))
            setCreating(false)
            onOpen(day.id)
          }}
        />
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 14 }}
          onClick={() => setCreating(true)}
        >
          New track day
        </button>
      )}

      <Card flush>
        {days.length === 0 ? (
          <EmptyState title="No track days yet">
            <p>Start one when you get to the circuit.</p>
          </EmptyState>
        ) : (
          <ul className="list">
            {days.map((day) => {
              const sessions = sessionsForDay(data, day.id)
              const best = sessions
                .map((session) => session.bestLap)
                .filter((lap): lap is number => lap !== undefined)
                .sort((a, b) => a - b)[0]
              return (
                <li key={day.id}>
                  <button type="button" className="list__item" onClick={() => onOpen(day.id)}>
                    <div className="list__head">
                      <span className="list__title">{day.circuit}</span>
                      <span className="mono muted">{best ? formatLapTime(best) : ''}</span>
                    </div>
                    <div className="list__meta">
                      {fmtDate(day.date)} · {sessions.length}{' '}
                      {sessions.length === 1 ? 'session' : 'sessions'}
                      {day.layout ? ` · ${day.layout}` : ''}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

function NewTrackDayForm({
  data,
  onCreate,
  onCancel,
}: {
  data: GarageData
  onCreate: (day: TrackDay) => void
  onCancel: () => void
}) {
  const [circuit, setCircuit] = useState('')
  const [date, setDate] = useState(todayIso())
  const [bikeId, setBikeId] = useState(data.bikes[0]?.id ?? '')

  return (
    <Card title="New track day">
      <TextField
        label="Circuit"
        value={circuit}
        onChange={setCircuit}
        placeholder="Daytona International Speedway"
        list="circuit-suggestions"
      />
      <datalist id="circuit-suggestions">
        {CIRCUITS.map((entry) => (
          <option key={entry.name} value={entry.name} />
        ))}
      </datalist>
      <Field label="Date">
        {(control) => (
          <input
            {...control}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>
      {data.bikes.length > 1 && (
        <SelectField
          label="Bike"
          value={bikeId}
          options={data.bikes.map((bike) => ({ value: bike.id, label: bike.name }))}
          onChange={setBikeId}
        />
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={circuit.trim() === ''}
          onClick={() =>
            onCreate({
              id: newId('day'),
              bikeId,
              date,
              circuit: circuit.trim(),
              createdAt: Date.now(),
            })
          }
        >
          Create
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

export function TrackDayDetailView({
  garage,
  dayId,
  onOpenSession,
  onBack,
}: {
  garage: Garage
  dayId: string
  onOpenSession: (sessionId: string) => void
  onBack: () => void
}) {
  const { data, update } = garage
  const day = data.trackDays.find((candidate) => candidate.id === dayId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (!day) {
    return (
      <Card>
        <EmptyState title="That track day is gone">
          <button type="button" className="btn" onClick={onBack}>
            Back to track days
          </button>
        </EmptyState>
      </Card>
    )
  }

  const sessions = sessionsForDay(data, day.id)
  const bike = data.bikes.find((candidate) => candidate.id === day.bikeId)

  const addSession = () => {
    const previous = sessions[sessions.length - 1]
    const now = Date.now()
    const session: Session = {
      id: newId('session'),
      trackDayId: day.id,
      number: (previous?.number ?? 0) + 1,
      startedAt: now,
      // Carry conditions and setup forward. A session almost always starts
      // from where the last one finished; the first of a day starts from what
      // the bike is currently set to, so a setup is never re-typed from blank.
      conditions: previous ? { ...previous.conditions } : {},
      setup: previous
        ? { fork: { ...previous.setup.fork }, shock: { ...previous.setup.shock } }
        : bike?.currentSetup
          ? cloneSetup(bike.currentSetup)
          : { fork: {}, shock: {} },
      tyres: {
        front: carryTyre(previous?.tyres.front),
        rear: carryTyre(previous?.tyres.rear),
      },
      feedback: [],
      createdAt: now,
      updatedAt: now,
    }
    update((current) => {
      const next = { ...current, sessions: [...current.sessions, session] }
      // The new session is now the bike's latest, so it defines "current".
      return bike ? setBikeCurrentSetup(next, bike.id, session.setup) : next
    })
    onOpenSession(session.id)
  }

  return (
    <>
      <Card
        title={day.circuit}
        hint={`${fmtDate(day.date)}${day.layout ? ` · ${day.layout}` : ''}${
          bike ? ` · ${bike.name}` : ''
        }`}
        action={
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            All days
          </button>
        }
      >
        <button type="button" className="btn btn--primary btn--block" onClick={addSession}>
          {sessions.length === 0 ? 'Start first session' : `Start session ${sessions.length + 1}`}
        </button>
        {sessions.length > 0 && (
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
            The new session starts from the last one&rsquo;s setup and cold pressures, so you only
            record what you changed.
          </p>
        )}
      </Card>

      <Card flush>
        {sessions.length === 0 ? (
          <EmptyState title="No sessions yet" />
        ) : (
          <ul className="list">
            {sessions.map((session, index) => (
              <li key={session.id}>
                <SessionRow
                  session={session}
                  previous={index > 0 ? sessions[index - 1] : undefined}
                  bike={bike}
                  data={data}
                  onClick={() => onOpenSession(session.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DayTyresCard day={day} data={data} update={update} />

      <Card title="Track day notes">
        <Field label="Notes">
          {(control) => (
            <textarea
              {...control}
              value={day.notes ?? ''}
              placeholder="Who you rode with, what the surface was like, anything to remember for next time…"
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  trackDays: current.trackDays.map((candidate) =>
                    candidate.id === day.id ? { ...candidate, notes: event.target.value } : candidate,
                  ),
                }))
              }
            />
          )}
        </Field>

        <div className="btn-row" style={{ marginTop: 14, marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn--sm"
            disabled={sessions.length === 0}
            onClick={() => downloadCsv(trackDayCsv(data, day.id), csvFilename([day.date, day.circuit]))}
          >
            Export day (CSV)
          </button>
        </div>

        {confirmingDelete ? (
          <>
            <Note tone="bad">
              This deletes the track day and all {sessions.length} of its sessions. There is no undo.
            </Note>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  update((current) => {
                    const next = {
                      ...current,
                      trackDays: current.trackDays.filter((candidate) => candidate.id !== day.id),
                      sessions: current.sessions.filter((session) => session.trackDayId !== day.id),
                    }
                    return day.bikeId ? reconcileCurrentSetup(next, day.bikeId) : next
                  })
                  onBack()
                }}
              >
                Delete track day
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete track day
          </button>
        )}
      </Card>
    </>
  )
}

function DayTyresCard({
  day,
  data,
  update,
}: {
  day: TrackDay
  data: GarageData
  update: Garage['update']
}) {
  const setTyre = (axle: Axle, tyreId: string) =>
    update((current) => ({
      ...current,
      trackDays: current.trackDays.map((candidate) =>
        candidate.id === day.id
          ? {
              ...candidate,
              ...(axle === 'front'
                ? { frontTyreId: tyreId || undefined }
                : { rearTyreId: tyreId || undefined }),
            }
          : candidate,
      ),
    }))

  return (
    <Card
      title="Tyres"
      hint="Fitted for the whole day. Cold and hot pressures are still recorded on each session."
    >
      {data.tyres.length === 0 ? (
        <Note>
          Add tyres in the Tyres tab, then choose the front and rear fitted for the day here.
        </Note>
      ) : (
        <div className="grid grid--two">
          <DayTyreField axle="front" day={day} data={data} onChange={(id) => setTyre('front', id)} />
          <DayTyreField axle="rear" day={day} data={data} onChange={(id) => setTyre('rear', id)} />
        </div>
      )}
    </Card>
  )
}

function DayTyreField({
  axle,
  day,
  data,
  onChange,
}: {
  axle: Axle
  day: TrackDay
  data: GarageData
  onChange: (tyreId: string) => void
}) {
  const selectedId = axle === 'front' ? day.frontTyreId : day.rearTyreId
  // Retired tyres stay selectable only if they are the one already fitted, so
  // an old day still reads right without offering a dead carcass for a new one.
  const options = data.tyres.filter(
    (tyre) => tyre.axle === axle && (!tyre.retired || tyre.id === selectedId),
  )
  return (
    <SelectField
      label={axle === 'front' ? 'Front' : 'Rear'}
      value={selectedId ?? ''}
      options={[
        { value: '', label: 'Not set' },
        ...options.map((tyre) => ({
          value: tyre.id,
          label: `${tyre.label ? `${tyre.label} — ` : ''}${describeTyre(tyre.model)}`,
        })),
      ]}
      onChange={onChange}
    />
  )
}

function SessionRow({
  session,
  previous,
  bike,
  data,
  onClick,
}: {
  session: Session
  previous: Session | undefined
  bike: Bike | undefined
  data: GarageData
  onClick: () => void
}) {
  const prefs = data.preferences
  const changes = previous ? diffSetups(previous.setup, session.setup, bike) : []
  const frontRise = pressureRise(session.tyres.front)
  const rearRise = pressureRise(session.tyres.rear)

  return (
    <button type="button" className="list__item" onClick={onClick}>
      <div className="list__head">
        <span className="list__title">Session {session.number}</span>
        <span className="mono" style={{ fontWeight: 650 }}>
          {formatLapTime(session.bestLap)}
        </span>
      </div>
      <div className="list__meta">
        {previous ? summariseDiff(changes) : 'Baseline setup'}
        {session.conditions.trackTemp !== undefined
          ? ` · track ${fmtTemp(session.conditions.trackTemp, prefs)}`
          : ''}
      </div>
      <div className="list__meta">
        F {fmtPressure(session.tyres.front.coldPressure, prefs)}
        {frontRise !== undefined ? ` → ${fmtPressure(session.tyres.front.hotPressure, prefs)} (${fmtPressureDelta(frontRise, prefs, false)})` : ''}
        {' · '}
        R {fmtPressure(session.tyres.rear.coldPressure, prefs)}
        {rearRise !== undefined ? ` → ${fmtPressure(session.tyres.rear.hotPressure, prefs)} (${fmtPressureDelta(rearRise, prefs, false)})` : ''}
      </div>
      {session.feedback.length > 0 && (
        <div style={{ marginTop: 7 }}>
          <Badge tone="warn">
            {session.feedback.length} {session.feedback.length === 1 ? 'note' : 'notes'} from the bike
          </Badge>
        </div>
      )}
    </button>
  )
}

/**
 * Carry a tyre run forward: same cold pressure and warmer set point, hot
 * reading cleared. The fitted carcass is a track-day choice now, so it is not
 * carried here — it comes from the day.
 */
function carryTyre(previous: Session['tyres']['front'] | undefined): Session['tyres']['front'] {
  if (!previous) return {}
  const next: Session['tyres']['front'] = {}
  if (previous.coldPressure !== undefined) next.coldPressure = previous.coldPressure
  if (previous.warmerTemp !== undefined) next.warmerTemp = previous.warmerTemp
  return next
}
