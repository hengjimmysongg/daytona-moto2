import { useState } from 'react'
import { Card, EmptyState, Note, NumberField, Readout, SelectField } from '../components/kit'
import { formatSag, SagReadout } from '../components/sag'
import { fmtDate } from '../format'
import {
  analyseSagForBike,
  describePreloadChange,
  isSagRecorded,
  recordedFor,
  recordSag,
  SagError,
  type SagMeasurement,
  type SagResult,
  type SagResults,
} from '../../core/sag'
import { sessionsForBike } from '../../core/storage'
import type { Axle, Bike, GarageData, SagReading, Session } from '../../core/types'
import type { Garage } from '../store'

const AXLES = ['front', 'rear'] as const

type Check = { result: SagResult | null; error: string | null }

export function SagView({ garage }: { garage: Garage }) {
  const { data, update } = garage
  const [bikeId, setBikeId] = useState<string>(data.bikes[0]?.id ?? '')
  const bike = data.bikes.find((candidate) => candidate.id === bikeId) ?? data.bikes[0]

  if (!bike) {
    return (
      <Card>
        <EmptyState title="Add a bike first">
          <p>Sag is judged against windows that belong to a particular machine.</p>
        </EmptyState>
      </Card>
    )
  }

  const checks = { front: checkFor(bike, 'front'), rear: checkFor(bike, 'rear') }
  const results: SagResults = {
    ...(checks.front.result ? { front: checks.front.result } : {}),
    ...(checks.rear.result ? { rear: checks.rear.result } : {}),
  }

  return (
    <>
      <Card
        title="How to measure"
        hint="Three numbers per end, all taken at the same two points. Get someone to hold the bike upright — a paddock stand under the swingarm changes the answer."
      >
        <Readout label="L1 — fully extended" value="Wheel off the ground" />
        <Readout label="L2 — bike only" value="On its own wheels, nobody on it" />
        <Readout label="L3 — with rider" value="Full kit, feet up, riding position" />
        <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          Front: measure along the fork tube, or from the axle to a fixed point on the bottom
          triple clamp. Rear: from the rear axle to a mark on the tail. Bounce the suspension and
          let it settle before each reading, and take the same point every time — sag is a
          difference, so a consistent reference matters more than where you put it.
        </p>
      </Card>

      {data.bikes.length > 1 && (
        <Card>
          <SelectField
            label="Bike"
            value={bike.id}
            options={data.bikes.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            onChange={setBikeId}
          />
        </Card>
      )}

      {AXLES.map((axle) => (
        <AxleSag
          key={axle}
          axle={axle}
          bike={bike}
          check={checks[axle]}
          onChange={(reading) =>
            // Readings belong to the bike, so they are saved and synced like
            // everything else rather than held by this screen and lost the
            // moment the rider looks at another tab.
            update((current) => ({
              ...current,
              bikes: current.bikes.map((candidate) =>
                candidate.id === bike.id
                  ? {
                      ...candidate,
                      sagReadings: { ...candidate.sagReadings, [axle]: reading },
                    }
                  : candidate,
              ),
            }))
          }
        />
      ))}

      {Object.keys(results).length > 0 && (
        <RecordCard
          data={data}
          bike={bike}
          results={results}
          onRecord={(session) =>
            update((current) => ({
              ...current,
              sessions: current.sessions.map((candidate) =>
                candidate.id === session.id
                  ? {
                      ...candidate,
                      setup: { ...candidate.setup, sag: recordSag(candidate.setup.sag, results) },
                      updatedAt: Date.now(),
                    }
                  : candidate,
              ),
            }))
          }
        />
      )}

      <Card>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Set rider sag with preload first. Free sag is what tells you whether the spring itself is
          right, and it only means anything once rider sag is in its window.
        </p>
      </Card>
    </>
  )
}

function checkFor(bike: Bike, axle: Axle): Check {
  const measurement = toMeasurement(bike.sagReadings?.[axle] ?? {})
  if (!measurement) return { result: null, error: null }
  try {
    return { result: analyseSagForBike(bike, axle, measurement), error: null }
  } catch (caught) {
    return { result: null, error: caught instanceof SagError ? caught.message : String(caught) }
  }
}

/* ------------------------------------------------------------------ */

function AxleSag({
  axle,
  bike,
  check,
  onChange,
}: {
  axle: Axle
  bike: Bike
  check: Check
  onChange: (reading: SagReading) => void
}) {
  const reading = bike.sagReadings?.[axle] ?? {}
  const { result, error } = check
  const set = (key: keyof SagReading, value: number | undefined) => {
    const next = { ...reading }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }

  const title = axle === 'front' ? 'Front' : 'Rear'

  return (
    <Card title={title} hint="Millimetres.">
      <div className="grid">
        <NumberField
          label="L1 extended"
          value={reading.extended === undefined ? '' : String(reading.extended)}
          suffix="mm"
          onChange={(value) => set('extended', value)}
        />
        <NumberField
          label="L2 bike only"
          value={reading.bikeOnly === undefined ? '' : String(reading.bikeOnly)}
          suffix="mm"
          onChange={(value) => set('bikeOnly', value)}
        />
        <NumberField
          label="L3 with rider"
          value={reading.withRider === undefined ? '' : String(reading.withRider)}
          suffix="mm"
          onChange={(value) => set('withRider', value)}
        />
      </div>

      {error && <Note tone="bad">{error}</Note>}

      {result && (
        <>
          <SagReadout label="Rider sag" mm={result.riderSag} target={result.riderSagTarget} large />
          {result.freeSag !== undefined && result.freeSagTarget && (
            <SagReadout label="Free sag" mm={result.freeSag} target={result.freeSagTarget} />
          )}

          <div style={{ marginTop: 14 }}>
            {describePreloadChange(result) && (
              <Note tone="warn">{describePreloadChange(result)}</Note>
            )}
            {result.springVerdict !== 'unknown' && result.springVerdict !== 'ok' && (
              <Note tone={result.springVerdictReliable ? 'bad' : 'info'}>
                {result.springVerdict === 'too-soft'
                  ? 'Spring looks too soft for this rider.'
                  : 'Spring looks too stiff for this rider.'}
                {!result.springVerdictReliable && ' Provisional — set rider sag first.'}
              </Note>
            )}
            {result.springVerdict === 'ok' && result.springVerdictReliable && (
              <Note tone="ok">Spring rate suits the rider.</Note>
            )}
            {result.notes.map((note) => (
              <p key={note} className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
                {note}
              </p>
            ))}
          </div>
        </>
      )}

      {!result && !error && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Enter L1 and L3 for a rider sag reading. Add L2 to check the spring rate as well.
        </p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Log the check against a session, so the session shows what the bike was
 * actually sitting at when it ran rather than only what the clickers said.
 */
function RecordCard({
  data,
  bike,
  results,
  onRecord,
}: {
  data: GarageData
  bike: Bike
  results: SagResults
  onRecord: (session: Session) => void
}) {
  const sessions = sessionsForBike(data, bike.id)
  const [chosenId, setChosenId] = useState('')
  // Newest first, so the usual case — sag checked before the next session
  // goes out — needs no choosing at all.
  const session = sessions.find((candidate) => candidate.id === chosenId) ?? sessions[0]

  if (!session) {
    return (
      <Card title="Log this check">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Add a session to a track day on {bike.name} to record sag against it.
        </p>
      </Card>
    )
  }

  const label = (candidate: Session) => {
    const day = data.trackDays.find((entry) => entry.id === candidate.trackDayId)
    return day
      ? `Session ${candidate.number} · ${day.circuit} · ${fmtDate(day.date)}`
      : `Session ${candidate.number}`
  }

  const recorded = isSagRecorded(session.setup.sag, results)
  const measured = AXLES.filter((axle) => results[axle])
  const replacing = measured.some(
    (axle) => Object.keys(recordedFor(session.setup.sag, axle)).length > 0,
  )

  return (
    <Card title="Log this check" hint="Saves rider and free sag to a session's setup.">
      {sessions.length > 1 && (
        <SelectField
          label="Session"
          value={session.id}
          options={sessions.map((candidate) => ({ value: candidate.id, label: label(candidate) }))}
          onChange={setChosenId}
        />
      )}

      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        {measured.map((axle) => describe(axle, results[axle] as SagResult)).join(' · ')}
        {measured.length === 1 &&
          ` · the ${measured[0] === 'front' ? 'rear' : 'front'} is left as the session has it`}
      </p>

      {recorded ? (
        <Note tone="ok">Recorded on {label(session)}.</Note>
      ) : (
        <>
          {replacing && (
            <Note tone="warn">This replaces the sag already recorded on that session.</Note>
          )}
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => onRecord(session)}
          >
            Record to session {session.number}
          </button>
        </>
      )}
    </Card>
  )
}

function describe(axle: Axle, result: SagResult): string {
  const end = axle === 'front' ? 'Front' : 'Rear'
  const free = result.freeSag === undefined ? '' : `, free ${formatSag(result.freeSag)}`
  return `${end}: rider ${formatSag(result.riderSag)}${free}`
}

function toMeasurement({ extended, bikeOnly, withRider }: SagReading): SagMeasurement | null {
  if (extended === undefined || withRider === undefined) return null
  return bikeOnly === undefined ? { extended, withRider } : { extended, bikeOnly, withRider }
}
