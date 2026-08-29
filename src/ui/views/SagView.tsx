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
import type { Axle, Bike } from '../../core/types'
import type { Garage } from '../store'

type Draft = { extended: string; bikeOnly: string; withRider: string }

const EMPTY_DRAFT: Draft = { extended: '', bikeOnly: '', withRider: '' }

export function SagView({ garage }: { garage: Garage }) {
  const { data } = garage
  const [bikeId, setBikeId] = useState<string>(data.bikes[0]?.id ?? '')
  const bike = data.bikes.find((candidate) => candidate.id === bikeId) ?? data.bikes[0]

  const [front, setFront] = useState<Draft>(EMPTY_DRAFT)
  const [rear, setRear] = useState<Draft>(EMPTY_DRAFT)

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

      <AxleSag axle="front" bike={bike} draft={front} onChange={setFront} />
      <AxleSag axle="rear" bike={bike} draft={rear} onChange={setRear} />

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
  draft,
  onChange,
}: {
  axle: Axle
  bike: Bike
  draft: Draft
  onChange: (draft: Draft) => void
}) {
  const measurement = toMeasurement(draft)
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
          value={draft.extended}
          suffix="mm"
          onChange={(value) => onChange({ ...draft, extended: value === undefined ? '' : String(value) })}
        />
        <NumberField
          label="L2 bike only"
          value={draft.bikeOnly}
          suffix="mm"
          onChange={(value) => onChange({ ...draft, bikeOnly: value === undefined ? '' : String(value) })}
        />
        <NumberField
          label="L3 with rider"
          value={draft.withRider}
          suffix="mm"
          onChange={(value) => onChange({ ...draft, withRider: value === undefined ? '' : String(value) })}
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

function toMeasurement(draft: Draft): SagMeasurement | null {
  const extended = Number(draft.extended)
  const withRider = Number(draft.withRider)
  if (draft.extended === '' || draft.withRider === '') return null
  if (!Number.isFinite(extended) || !Number.isFinite(withRider)) return null

  const measurement: SagMeasurement = { extended, withRider }
  const bikeOnly = Number(draft.bikeOnly)
  if (draft.bikeOnly !== '' && Number.isFinite(bikeOnly)) measurement.bikeOnly = bikeOnly
  return measurement
}

/** Not named `window`: that shadows the global inside this module and
 *  breaks anything that reaches for it, React Refresh included. */
function formatWindow([min, max]: readonly [number, number]): string {
  return `${min}–${max} mm`
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1)
}
