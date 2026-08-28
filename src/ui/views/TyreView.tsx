import { useState } from 'react'
import {
  Badge,
  Card,
  EmptyState,
  Note,
  NumberField,
  Readout,
  SectionLabel,
  SelectField,
  TextField,
} from '../components/kit'
import {
  fmtPressure,
  fmtPressureDelta,
  fmtTemp,
  pressureFromInput,
  tempFromInput,
} from '../format'
import {
  ambientAdjustedPressure,
  recommendColdPressure,
  tyreUsage,
} from '../../core/tyres'
import { newId } from '../../core/id'
import { describeTyre, TYRE_MODELS } from '../../data/presets'
import type { Axle, Preferences, Tyre } from '../../core/types'
import type { Garage } from '../store'

export function TyreView({ garage }: { garage: Garage }) {
  const { data, update } = garage
  const prefs = data.preferences

  return (
    <>
      <ColdPressurePlanner prefs={prefs} />
      <AmbientCard prefs={prefs} />

      <Card
        title="Tyres"
        hint="Tracking each carcass separately is what makes “how many sessions on this front?” answerable."
        flush
      >
        {data.tyres.length === 0 ? (
          <EmptyState title="No tyres recorded">
            <p>Add one below, then pick it in a session to start counting.</p>
          </EmptyState>
        ) : (
          <ul className="list">
            {data.tyres.map((tyre) => {
              const usage = tyreUsage(data.sessions, tyre.id)
              return (
                <li key={tyre.id} className="list__item" style={{ cursor: 'default' }}>
                  <div className="list__head">
                    <span className="list__title">
                      {tyre.label ? `${tyre.label} — ` : ''}
                      {describeTyre(tyre.model)}
                    </span>
                    <Badge tone={tyre.retired ? 'muted' : usage.sessions >= 8 ? 'warn' : 'ok'}>
                      {tyre.retired ? 'Retired' : `${usage.sessions} sessions`}
                    </Badge>
                  </div>
                  <div className="list__meta">
                    {tyre.axle === 'front' ? 'Front' : 'Rear'} · {usage.heatCycles} heat{' '}
                    {usage.heatCycles === 1 ? 'cycle' : 'cycles'}
                  </div>
                  <div className="btn-row" style={{ marginTop: 9 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          tyres: current.tyres.map((candidate) =>
                            candidate.id === tyre.id
                              ? { ...candidate, retired: !candidate.retired }
                              : candidate,
                          ),
                        }))
                      }
                    >
                      {tyre.retired ? 'Put back in service' : 'Retire'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          tyres: current.tyres.filter((candidate) => candidate.id !== tyre.id),
                        }))
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
          <AddTyreForm
            onAdd={(tyre) => update((current) => ({ ...current, tyres: [...current.tyres, tyre] }))}
          />
        </div>
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The standalone version of the calculation the session screen does
 * automatically — for working out a starting pressure with numbers from a
 * notebook, or someone else's bike.
 */
function ColdPressurePlanner({ prefs }: { prefs: Preferences }) {
  const [axle, setAxle] = useState<Axle>('front')
  const [cold, setCold] = useState('')
  const [hot, setHot] = useState('')

  const target = prefs.targetHotPressure[axle]
  const coldValue = toBar(cold, prefs)
  const hotValue = toBar(hot, prefs)
  const result =
    coldValue !== undefined && hotValue !== undefined
      ? recommendColdPressure({ ranCold: coldValue, measuredHot: hotValue, targetHot: target })
      : undefined

  return (
    <Card
      title="Cold pressure planner"
      hint="You cannot set a hot pressure, only a cold one. Measure what the tyre did, and this works back to the cold pressure that lands on your target."
    >
      <SelectField
        label="Axle"
        value={axle}
        options={[
          { value: 'front', label: 'Front' },
          { value: 'rear', label: 'Rear' },
        ]}
        onChange={setAxle}
      />
      <div className="grid grid--two">
        <NumberField
          label="Cold you set"
          value={cold}
          suffix={prefs.pressureUnit}
          onChange={(value) => setCold(value === undefined ? '' : String(value))}
        />
        <NumberField
          label="Hot coming in"
          value={hot}
          suffix={prefs.pressureUnit}
          onChange={(value) => setHot(value === undefined ? '' : String(value))}
        />
      </div>

      <Readout label="Target hot" value={fmtPressure(target, prefs)} />
      {result && (
        <>
          <Readout label="Rise" value={fmtPressureDelta(result.rise, prefs)} />
          <Readout label="Set cold next time" value={fmtPressure(result.coldPressure, prefs)} large />
          <Readout label="Change" value={fmtPressureDelta(result.change, prefs)} />
          {result.warnings.map((warning) => (
            <div key={warning} style={{ marginTop: 8 }}>
              <Note tone="warn">{warning}</Note>
            </div>
          ))}
        </>
      )}
      {!result && (
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
          Set the target hot pressure for each axle in Garage. Take it from your tyre&rsquo;s data
          sheet.
        </p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Air temperature moves pressure on its own. Riders lose time chasing a
 * "mystery" gain between the morning sighting laps and the first session
 * that is only the sun coming out.
 */
function AmbientCard({ prefs }: { prefs: Preferences }) {
  const [setPressure, setSetPressure] = useState('')
  const [setAmbient, setSetAmbient] = useState('')
  const [nowAmbient, setNowAmbient] = useState('')

  const pressure = toBar(setPressure, prefs)
  const from = toTemp(setAmbient, prefs)
  const to = toTemp(nowAmbient, prefs)
  const expected =
    pressure !== undefined && from !== undefined && to !== undefined
      ? ambientAdjustedPressure(pressure, from, to)
      : undefined

  return (
    <Card
      title="Weather check"
      hint="What the gauge should read now for a tyre you set earlier and have not ridden."
    >
      <NumberField
        label="Pressure you set"
        value={setPressure}
        suffix={prefs.pressureUnit}
        onChange={(value) => setSetPressure(value === undefined ? '' : String(value))}
      />
      <div className="grid grid--two">
        <NumberField
          label="Air temp then"
          value={setAmbient}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) => setSetAmbient(value === undefined ? '' : String(value))}
        />
        <NumberField
          label="Air temp now"
          value={nowAmbient}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) => setNowAmbient(value === undefined ? '' : String(value))}
        />
      </div>
      {expected !== undefined && pressure !== undefined && (
        <>
          <Readout label="Gauge should read" value={fmtPressure(expected, prefs)} large />
          <Readout label="From the weather alone" value={fmtPressureDelta(expected - pressure, prefs)} />
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
            Anything beyond this came from riding. Air temp moved from{' '}
            {fmtTemp(toTemp(setAmbient, prefs), prefs)} to {fmtTemp(toTemp(nowAmbient, prefs), prefs)}.
          </p>
        </>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function AddTyreForm({ onAdd }: { onAdd: (tyre: Tyre) => void }) {
  const [axle, setAxle] = useState<Axle>('front')
  const [modelKey, setModelKey] = useState(describeTyre(TYRE_MODELS[0]))
  const [label, setLabel] = useState('')

  return (
    <>
      <SectionLabel>Add a tyre</SectionLabel>
      <div className="grid grid--two">
        <SelectField
          label="Axle"
          value={axle}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'rear', label: 'Rear' },
          ]}
          onChange={setAxle}
        />
        <SelectField
          label="Model"
          value={modelKey}
          options={TYRE_MODELS.map((model) => ({
            value: describeTyre(model),
            label: describeTyre(model),
          }))}
          onChange={setModelKey}
        />
      </div>
      <TextField
        label="Label"
        hint="Optional — something to tell two of the same tyre apart."
        value={label}
        onChange={setLabel}
        placeholder="Set B"
      />
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => {
          const model = TYRE_MODELS.find((candidate) => describeTyre(candidate) === modelKey)
          if (!model) return
          onAdd({
            id: newId('tyre'),
            axle,
            model,
            ...(label.trim() ? { label: label.trim() } : {}),
            sessions: 0,
            heatCycles: 0,
            createdAt: Date.now(),
          })
          setLabel('')
        }}
      >
        Add tyre
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ */

function toBar(text: string, prefs: Preferences): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? pressureFromInput(value, prefs) : undefined
}

function toTemp(text: string, prefs: Preferences): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? tempFromInput(value, prefs) : undefined
}
