import { useState } from 'react'
import {
  Badge,
  Card,
  EmptyState,
  NumberField,
  SectionLabel,
  SelectField,
  TextField,
} from '../components/kit'
import { tyreUsage } from '../../core/tyres'
import { newId } from '../../core/id'
import { describeTyre, TYRE_MODELS } from '../../data/presets'
import type { Axle, Tyre } from '../../core/types'
import type { Garage } from '../store'

export function TyreView({ garage }: { garage: Garage }) {
  const { data, update } = garage

  const edit = (id: string, change: Partial<Tyre>) =>
    update((current) => ({
      ...current,
      tyres: current.tyres.map((tyre) => (tyre.id === id ? { ...tyre, ...change } : tyre)),
    }))

  return (
    <>
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
              // What the rider recorded by hand, plus what this log has seen.
              // A tyre usually arrives with cycles already on it, and the
              // sessions here only ever add to that.
              const sessions = tyre.sessions + usage.sessions
              const heatCycles = tyre.heatCycles + usage.heatCycles
              return (
                <li key={tyre.id} className="list__item" style={{ cursor: 'default' }}>
                  <div className="list__head">
                    <span className="list__title">
                      {tyre.label ? `${tyre.label} — ` : ''}
                      {describeTyre(tyre.model)}
                    </span>
                    <Badge tone={tyre.retired ? 'muted' : sessions >= 8 ? 'warn' : 'ok'}>
                      {tyre.retired ? 'Retired' : `${sessions} sessions`}
                    </Badge>
                  </div>
                  <div className="list__meta">
                    {tyre.axle === 'front' ? 'Front' : 'Rear'} · {heatCycles} heat{' '}
                    {heatCycles === 1 ? 'cycle' : 'cycles'}
                  </div>

                  <div className="grid grid--two" style={{ marginTop: 10 }}>
                    <NumberField
                      label="Sessions before this log"
                      hint={
                        usage.sessions > 0
                          ? `${usage.sessions} more logged here — ${sessions} in total`
                          : 'Cycles the carcass arrived with.'
                      }
                      value={tyre.sessions === 0 ? '' : String(tyre.sessions)}
                      onChange={(value) => edit(tyre.id, { sessions: Math.max(0, value ?? 0) })}
                      placeholder="0"
                    />
                    <NumberField
                      label="Heat cycles before this log"
                      hint={
                        usage.heatCycles > 0
                          ? `${usage.heatCycles} more logged here — ${heatCycles} in total`
                          : 'Warmer cycles from days you did not log.'
                      }
                      value={tyre.heatCycles === 0 ? '' : String(tyre.heatCycles)}
                      onChange={(value) => edit(tyre.id, { heatCycles: Math.max(0, value ?? 0) })}
                      placeholder="0"
                    />
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
