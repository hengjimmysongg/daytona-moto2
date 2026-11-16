import { useState } from 'react'
import {
  Badge,
  Card,
  EmptyState,
  Note,
  NumberField,
  Readout,
  SelectField,
} from '../components/kit'
import {
  analyseSagForBike,
  describePreloadChange,
  SagError,
  type RangeStatus,
  type SagMeasurement,
  type SagResult,
} from '../../core/sag'
import type { Axle, Bike, SagReading } from '../../core/types'
import type { Garage } from '../store'

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

      {(['front', 'rear'] as const).map((axle) => (
        <AxleSag
          key={axle}
          axle={axle}
          bike={bike}
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

      <Card>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Set rider sag with preload first. Free sag is what tells you whether the spring itself is
          right, and it only means anything once rider sag is in its window.
        </p>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

function AxleSag({
  axle,
  bike,
  onChange,
}: {
  axle: Axle
  bike: Bike
  onChange: (reading: SagReading) => void
}) {
  const reading = bike.sagReadings?.[axle] ?? {}
  const measurement = toMeasurement(reading)
  const set = (key: keyof SagReading, value: number | undefined) => {
    const next = { ...reading }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }
  let result: SagResult | null = null
  let error: string | null = null

  if (measurement) {
    try {
      result = analyseSagForBike(bike, axle, measurement)
    } catch (caught) {
      error = caught instanceof SagError ? caught.message : String(caught)
    }
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
          <Readout
            label={`Rider sag · target ${formatWindow(result.riderSagTarget)}`}
            value={`${round(result.riderSag)} mm`}
            large
            trailing={<StatusBadge status={result.riderSagStatus} />}
          />
          {result.freeSag !== undefined && result.freeSagTarget && (
            <Readout
              label={`Free sag · target ${formatWindow(result.freeSagTarget)}`}
              value={`${round(result.freeSag)} mm`}
              trailing={<StatusBadge status={result.freeSagStatus ?? 'ok'} />}
            />
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

function StatusBadge({ status }: { status: RangeStatus }) {
  if (status === 'ok') return <Badge tone="ok">In window</Badge>
  return <Badge tone="warn">{status === 'low' ? 'Too little' : 'Too much'}</Badge>
}

function toMeasurement({ extended, bikeOnly, withRider }: SagReading): SagMeasurement | null {
  if (extended === undefined || withRider === undefined) return null
  return bikeOnly === undefined ? { extended, withRider } : { extended, bikeOnly, withRider }
}

/** Not named `window`: that shadows the global inside this module and
 *  breaks anything that reaches for it, React Refresh included. */
function formatWindow([min, max]: readonly [number, number]): string {
  return `${min}–${max} mm`
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}
