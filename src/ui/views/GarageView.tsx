import { useRef, useState } from 'react'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  NumberField,
  Note,
  Readout,
  SectionLabel,
  SelectField,
  TextField,
} from '../components/kit'
import { fmtMass, pressureFromInput, pressureInputValue, todayIso } from '../format'
import { downloadCsv, downloadFile } from '../download'
import { csvFilename, garageCsv } from '../../core/csv'
import { exportGarage, importGarage, suggestExportFilename } from '../../core/storage'
import { massFromKg, massToKg } from '../../core/units'
import { BIKE_TEMPLATES } from '../../data/presets'
import type { Bike, GarageData, Preferences } from '../../core/types'
import type { Garage } from '../store'
import type { Sync } from '../sync'

export function GarageView({ garage, sync }: { garage: Garage; sync: Sync }) {
  const { data, update, replace } = garage
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = data.bikes.find((bike) => bike.id === editingId)

  if (editing) {
    return (
      <BikeEditor
        bike={editing}
        prefs={data.preferences}
        onChange={(next) =>
          update((current) => ({
            ...current,
            bikes: current.bikes.map((bike) => (bike.id === next.id ? next : bike)),
          }))
        }
        onDelete={() => {
          update((current) => ({
            ...current,
            bikes: current.bikes.filter((bike) => bike.id !== editing.id),
          }))
          setEditingId(null)
        }}
        onDone={() => setEditingId(null)}
      />
    )
  }

  return (
    <>
      <Card
        title="Bikes"
        hint="Recording what each adjuster can actually do lets the app catch an impossible setting before it goes in the log."
        flush
      >
        {data.bikes.length === 0 ? (
          <EmptyState title="No bikes yet">
            <p>Start from a template below and correct the numbers to match your machine.</p>
          </EmptyState>
        ) : (
          <ul className="list">
            {data.bikes.map((bike) => (
              <li key={bike.id}>
                <button type="button" className="list__item" onClick={() => setEditingId(bike.id)}>
                  <div className="list__head">
                    <span className="list__title">{bike.name}</span>
                    <span className="muted">Edit</span>
                  </div>
                  <div className="list__meta">
                    {[bike.make, bike.model].filter(Boolean).join(' ') || 'No make recorded'}
                    {bike.riderWeightKg
                      ? ` · rider ${fmtMass(bike.riderWeightKg, data.preferences)}`
                      : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
          <SectionLabel>Add from a template</SectionLabel>
          <div className="stack">
            {BIKE_TEMPLATES.map((template) => (
              <button
                key={template.key}
                type="button"
                className="btn btn--block"
                style={{ textAlign: 'left' }}
                onClick={() => {
                  const bike = template.build()
                  update((current) => ({ ...current, bikes: [...current.bikes, bike] }))
                  setEditingId(bike.id)
                }}
              >
                <div style={{ fontWeight: 650 }}>{template.name}</div>
                <div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                  {template.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <UnitsCard
        prefs={data.preferences}
        onChange={(preferences) => update((current) => ({ ...current, preferences }))}
      />

      <AccountCard sync={sync} />

      <DataCard data={data} onReplace={replace} />
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * The server side of the log.
 *
 * An account is offered, never demanded. The app is local-first and the
 * paddock has no signal, so signing in is what makes the log survive a lost
 * phone and turn up on the next device — not what makes it work.
 */
function AccountCard({ sync }: { sync: Sync }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')

  const submit = async () => {
    const address = email.trim()
    if (address === '' || password === '') return
    const ok = mode === 'signup' ? await sync.signUp(address, password) : await sync.signIn(address, password)
    // Never leave a password sitting in a form field on a phone that gets
    // handed around a paddock.
    if (ok) {
      setEmail('')
      setPassword('')
    } else {
      setPassword('')
    }
  }

  if (sync.account) {
    return (
      <Card
        title="Account"
        hint="Your log is saved on this device first and copied to your account when there is a signal."
      >
        <Readout label="Signed in as" value={sync.account.email} />
        <Readout label="Status" value={SYNC_LABELS[sync.state]} />
        {sync.lastSyncedAt && (
          <Readout label="Last synced" value={new Date(sync.lastSyncedAt).toLocaleTimeString()} />
        )}

        {sync.message && (
          <div style={{ marginTop: 10 }}>
            <Note tone={sync.state === 'unauthorised' ? 'bad' : 'warn'}>{sync.message}</Note>
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={sync.syncNow}>
            Sync now
          </button>
          <button type="button" className="btn btn--danger" onClick={sync.signOut}>
            Sign out
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
          Signing out leaves this device’s copy of the log alone. It stays here.
        </p>
      </Card>
    )
  }

  return (
    <Card
      title="Account"
      hint="Free, and only needed to keep the log across devices. Everything works without one — the log is kept in this browser."
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
        {...(mode === 'signup' ? { hint: 'At least 8 characters.' } : {})}
        value={password}
        onChange={setPassword}
        placeholder="••••••••"
      />

      {sync.authError && (
        <div style={{ marginBottom: 10 }}>
          <Note tone="bad">{sync.authError}</Note>
        </div>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={sync.signingIn || email.trim() === '' || password === ''}
        onClick={() => void submit()}
      >
        {sync.signingIn ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>
        Not signed in. Everything still works — the log is kept in this browser, and you can export
        a backup below.
      </p>
    </Card>
  )
}

const SYNC_LABELS: Record<Sync['state'], string> = {
  disabled: 'On this device only',
  offline: 'Offline — will sync later',
  syncing: 'Syncing…',
  synced: 'Synced',
  unauthorised: 'Signed out — sign in again',
  error: 'Sync failed',
}

/* ------------------------------------------------------------------ */

function UnitsCard({
  prefs,
  onChange,
}: {
  prefs: Preferences
  onChange: (prefs: Preferences) => void
}) {
  return (
    <Card
      title="Units and targets"
      hint="Everything is stored the same way underneath, so switching units never changes a recorded number."
    >
      <div className="grid grid--two">
        <SelectField
          label="Pressure"
          value={prefs.pressureUnit}
          options={[
            { value: 'psi', label: 'psi' },
            { value: 'bar', label: 'bar' },
            { value: 'kPa', label: 'kPa' },
          ]}
          onChange={(pressureUnit) => onChange({ ...prefs, pressureUnit })}
        />
        <SelectField
          label="Temperature"
          value={prefs.temperatureUnit}
          options={[
            { value: 'C', label: '°C' },
            { value: 'F', label: '°F' },
          ]}
          onChange={(temperatureUnit) => onChange({ ...prefs, temperatureUnit })}
        />
        <SelectField
          label="Rider weight"
          value={prefs.massUnit}
          options={[
            { value: 'lb', label: 'lb' },
            { value: 'kg', label: 'kg' },
          ]}
          onChange={(massUnit) => onChange({ ...prefs, massUnit })}
        />
      </div>

      <SectionLabel>Target hot pressures</SectionLabel>
      <Note>
        This is the number the app works backwards from. Take it from your tyre&rsquo;s data sheet
        rather than the defaults here — hot pressure is what the manufacturer specifies, and it is
        what decides how the carcass works.
      </Note>
      <div className="grid grid--two">
        <NumberField
          label="Front"
          value={pressureInputValue(prefs.targetHotPressure.front, prefs)}
          suffix={prefs.pressureUnit}
          onChange={(value) =>
            value !== undefined &&
            onChange({
              ...prefs,
              targetHotPressure: {
                ...prefs.targetHotPressure,
                front: pressureFromInput(value, prefs),
              },
            })
          }
        />
        <NumberField
          label="Rear"
          value={pressureInputValue(prefs.targetHotPressure.rear, prefs)}
          suffix={prefs.pressureUnit}
          onChange={(value) =>
            value !== undefined &&
            onChange({
              ...prefs,
              targetHotPressure: {
                ...prefs.targetHotPressure,
                rear: pressureFromInput(value, prefs),
              },
            })
          }
        />
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function DataCard({
  data,
  onReplace,
}: {
  data: GarageData
  onReplace: (data: GarageData) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const download = () => {
    downloadFile(exportGarage(data), suggestExportFilename(), 'application/json')
  }

  const downloadSheet = () => {
    downloadCsv(garageCsv(data), csvFilename(['track-day-log', todayIso()]))
  }

  return (
    <Card
      title="Your data"
      hint="Everything lives on this device only. Nothing is uploaded, and nothing needs a signal."
    >
      <Readout label="Bikes" value={data.bikes.length} />
      <Readout label="Track days" value={data.trackDays.length} />
      <Readout label="Sessions" value={data.sessions.length} />
      <Readout label="Tyres" value={data.tyres.length} />

      {message && (
        <div style={{ marginTop: 12 }}>
          <Note tone={message.tone}>{message.text}</Note>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={download}>
          Export backup
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Import backup
        </button>
        <button type="button" className="btn" onClick={downloadSheet} disabled={data.sessions.length === 0}>
          Every session (CSV)
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
        A phone is a bad place to keep a season of setup work. Export after a track day and put the
        file somewhere that will survive losing it.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try {
            const imported = importGarage(await file.text())
            onReplace(imported)
            setMessage({
              tone: 'ok',
              text: `Imported ${imported.sessions.length} sessions across ${imported.trackDays.length} track days.`,
            })
          } catch (error) {
            setMessage({
              tone: 'bad',
              text: error instanceof Error ? error.message : String(error),
            })
          }
        }}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function BikeEditor({
  bike,
  prefs,
  onChange,
  onDelete,
  onDone,
}: {
  bike: Bike
  prefs: Preferences
  onChange: (bike: Bike) => void
  onDelete: () => void
  onDone: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const weightValue =
    bike.riderWeightKg === undefined
      ? ''
      : String(Math.round(massFromKg(bike.riderWeightKg, prefs.massUnit)))

  return (
    <>
      <Card
        title={bike.name}
        action={
          <button type="button" className="btn btn--ghost" onClick={onDone}>
            Done
          </button>
        }
      >
        <TextField label="Name" value={bike.name} onChange={(name) => onChange({ ...bike, name })} />
        <div className="grid grid--two">
          <TextField
            label="Make"
            value={bike.make ?? ''}
            onChange={(make) => onChange({ ...bike, make })}
          />
          <TextField
            label="Model"
            value={bike.model ?? ''}
            onChange={(model) => onChange({ ...bike, model })}
          />
        </div>
        <NumberField
          label="Rider weight, in full kit"
          hint="The weight sag is measured at — boots, leathers, helmet, back protector."
          value={weightValue}
          suffix={prefs.massUnit}
          onChange={(value) =>
            onChange({
              ...bike,
              ...(value === undefined
                ? { riderWeightKg: undefined }
                : { riderWeightKg: massToKg(value, prefs.massUnit) }),
            })
          }
        />
      </Card>

      <Card
        title="Fork"
        hint="Ranges are counted from fully closed for damping, and fully soft for preload."
      >
        <div className="grid grid--two">
          <NumberField
            label="Compression range"
            value={String(bike.fork.compression.range)}
            suffix="clicks"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                fork: { ...bike.fork, compression: { ...bike.fork.compression, range } },
              })
            }
          />
          <NumberField
            label="Rebound range"
            value={String(bike.fork.rebound.range)}
            suffix="clicks"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                fork: { ...bike.fork, rebound: { ...bike.fork.rebound, range } },
              })
            }
          />
          <NumberField
            label="Preload range"
            value={String(bike.fork.preload.range)}
            suffix="turns"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                fork: { ...bike.fork, preload: { ...bike.fork.preload, range } },
              })
            }
          />
          <NumberField
            label="Preload thread pitch"
            hint="mm of preload per turn"
            value={
              bike.fork.preload.mmPerTurn === undefined ? '' : String(bike.fork.preload.mmPerTurn)
            }
            suffix="mm/turn"
            onChange={(mmPerTurn) =>
              onChange({
                ...bike,
                fork: { ...bike.fork, preload: { ...bike.fork.preload, mmPerTurn } },
              })
            }
          />
        </div>
      </Card>

      <Card title="Shock">
        <div className="grid grid--two">
          <NumberField
            label="Low-speed compression range"
            value={String(bike.shock.compressionLow.range)}
            suffix="clicks"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                shock: { ...bike.shock, compressionLow: { ...bike.shock.compressionLow, range } },
              })
            }
          />
          <NumberField
            label="Rebound range"
            value={String(bike.shock.rebound.range)}
            suffix="clicks"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                shock: { ...bike.shock, rebound: { ...bike.shock.rebound, range } },
              })
            }
          />
          <NumberField
            label="Preload range"
            value={String(bike.shock.preload.range)}
            suffix="turns"
            onChange={(range) =>
              range !== undefined &&
              onChange({
                ...bike,
                shock: { ...bike.shock, preload: { ...bike.shock.preload, range } },
              })
            }
          />
          <NumberField
            label="Preload thread pitch"
            hint="mm of preload per turn"
            value={
              bike.shock.preload.mmPerTurn === undefined
                ? ''
                : String(bike.shock.preload.mmPerTurn)
            }
            suffix="mm/turn"
            onChange={(mmPerTurn) =>
              onChange({
                ...bike,
                shock: { ...bike.shock, preload: { ...bike.shock.preload, mmPerTurn } },
              })
            }
          />
        </div>
        <NumberField
          label="Linkage motion ratio"
          hint="Rear wheel travel divided by shock stroke. Typically 2.5–3.0 on a sportbike, and it is what turns a wanted change in rear sag into turns of the collar."
          value={bike.shock.motionRatio === undefined ? '' : String(bike.shock.motionRatio)}
          onChange={(motionRatio) => onChange({ ...bike, shock: { ...bike.shock, motionRatio } })}
        />
      </Card>

      <Card title="Sag windows" hint="What this bike is judged against, in mm of wheel travel.">
        <div className="grid grid--two">
          <SagWindowField
            label="Front rider sag"
            window={bike.sagTargets.frontRider}
            onChange={(frontRider) =>
              onChange({ ...bike, sagTargets: { ...bike.sagTargets, frontRider } })
            }
          />
          <SagWindowField
            label="Front free sag"
            window={bike.sagTargets.frontFree}
            onChange={(frontFree) =>
              onChange({ ...bike, sagTargets: { ...bike.sagTargets, frontFree } })
            }
          />
          <SagWindowField
            label="Rear rider sag"
            window={bike.sagTargets.rearRider}
            onChange={(rearRider) =>
              onChange({ ...bike, sagTargets: { ...bike.sagTargets, rearRider } })
            }
          />
          <SagWindowField
            label="Rear free sag"
            window={bike.sagTargets.rearFree}
            onChange={(rearFree) =>
              onChange({ ...bike, sagTargets: { ...bike.sagTargets, rearFree } })
            }
          />
        </div>
      </Card>

      <Card title="Notes">
        <Field label="Anything worth remembering about this bike">
          {(control) => (
            <textarea
              {...control}
              value={bike.notes ?? ''}
              placeholder="Spring rates, who last serviced the suspension, which way the ride height rod is measured…"
              onChange={(event) => onChange({ ...bike, notes: event.target.value })}
            />
          )}
        </Field>

        {confirmingDelete ? (
          <>
            <Note tone="bad">
              Deleting this bike keeps its track days and sessions, but they will no longer have a
              machine attached.
            </Note>
            <div className="btn-row">
              <button type="button" className="btn btn--danger" onClick={onDelete}>
                Delete {bike.name}
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
            Delete bike
          </button>
        )}
      </Card>
    </>
  )
}

function SagWindowField({
  label,
  window: range,
  onChange,
}: {
  label: string
  window: [number, number]
  onChange: (window: [number, number]) => void
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${label} minimum`}
          value={String(range[0])}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) onChange([value, range[1]])
          }}
        />
        <span className="muted">to</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${label} maximum`}
          value={String(range[1])}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (Number.isFinite(value)) onChange([range[0], value])
          }}
        />
        <Badge tone="muted">mm</Badge>
      </div>
    </div>
  )
}
