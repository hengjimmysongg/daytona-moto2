import { useState } from 'react'
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  Field,
  Note,
  NumberField,
  Readout,
  SectionLabel,
  SelectField,
  Stepper,
} from '../components/kit'
import {
  fmtPressure,
  fmtPressureDelta,
  pressureScale,
  pressureStepBar,
  tempFromInput,
  tempInputValue,
} from '../format'
import { formatLapDelta, formatLapTime, parseLapTime } from '../../core/laptime'
import { buildAdvice, FEEDBACK_CATALOGUE, PHASES } from '../../core/advice'
import { diffSetups, validateSetup } from '../../core/setup'
import { pressureRise, recommendFromHistory, allWearOptions, wearGuidance } from '../../core/tyres'
import {
  latestSessionForBike,
  previousSession,
  reconcileCurrentSetup,
  sessionsForDay,
  setBikeCurrentSetup,
} from '../../core/storage'
import { csvFilename, sessionCsv } from '../../core/csv'
import { downloadCsv } from '../download'
import { describeTyre } from '../../data/presets'
import { SetupSteppers } from '../components/SetupSteppers'
import type {
  Axle,
  Bike,
  GarageData,
  Preferences,
  Session,
  SuspensionSetup,
  TrackCondition,
  Tyre,
  TyreRun,
  TyreWear,
} from '../../core/types'
import type { Garage } from '../store'

export function SessionView({
  garage,
  sessionId,
  onBack,
}: {
  garage: Garage
  sessionId: string
  onBack: (dayId?: string) => void
}) {
  const { data, update } = garage
  const session = data.sessions.find((candidate) => candidate.id === sessionId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (!session) {
    return (
      <Card>
        <EmptyState title="That session is gone">
          <button type="button" className="btn" onClick={() => onBack()}>
            Back
          </button>
        </EmptyState>
      </Card>
    )
  }

  const day = data.trackDays.find((candidate) => candidate.id === session.trackDayId)
  const bike = data.bikes.find((candidate) => candidate.id === day?.bikeId)
  const previous = previousSession(data, session)

  const patch = (changes: Partial<Session>) =>
    update((current) => ({
      ...current,
      sessions: current.sessions.map((candidate) =>
        candidate.id === session.id
          ? { ...candidate, ...changes, updatedAt: Date.now() }
          : candidate,
      ),
    }))

  // A setup change is the bike's newest word on what it is set to, so mirror it
  // into the bike's current setup — but only when this is the bike's latest
  // session, so editing an older session never rewrites what is "current".
  const onSetup = (setup: SuspensionSetup) =>
    update((current) => {
      const next = {
        ...current,
        sessions: current.sessions.map((candidate) =>
          candidate.id === session.id ? { ...candidate, setup, updatedAt: Date.now() } : candidate,
        ),
      }
      return bike && latestSessionForBike(next, bike.id)?.id === session.id
        ? setBikeCurrentSetup(next, bike.id, setup)
        : next
    })

  const changes = previous ? diffSetups(previous.setup, session.setup, bike) : []
  const warnings = bike ? validateSetup(bike, session.setup) : []

  return (
    <>
      <Card
        title={`Session ${session.number}`}
        hint={day ? `${day.circuit}${bike ? ` · ${bike.name}` : ''}` : undefined}
        action={
          <button type="button" className="btn btn--ghost" onClick={() => onBack(session.trackDayId)}>
            Done
          </button>
        }
      >
        <ConditionsFields
          session={session}
          prefs={data.preferences}
          onChange={(conditions) => patch({ conditions })}
        />
      </Card>

      {/* Keyed so switching session remounts the lap fields, which hold
          what the rider is mid-way through typing. */}
      <LapCard key={session.id} session={session} previous={previous} onChange={patch} />

      <SetupCard
        session={session}
        previous={previous}
        bike={bike}
        onChange={onSetup}
      />

      {changes.length > 0 && (
        <Card title="Changed since last session">
          {changes.map((change) => (
            <div key={change.field.key} className="suggestion">
              <div className="suggestion__action">{change.summary}</div>
              {change.effect && <div className="suggestion__why">{change.effect}</div>}
            </div>
          ))}
          {changes.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <Note tone="warn">
                {changes.length} things changed at once. Whatever the lap time does, you will not
                know which change did it.
              </Note>
            </div>
          )}
        </Card>
      )}

      {warnings.length > 0 && (
        <Card title="Check these">
          {warnings.map((warning) => (
            <Note key={warning.key} tone="bad">
              {warning.message}
            </Note>
          ))}
        </Card>
      )}

      <TyreCard
        axle="front"
        session={session}
        data={data}
        onChange={(front) => patch({ tyres: { ...session.tyres, front } })}
      />
      <TyreCard
        axle="rear"
        session={session}
        data={data}
        onChange={(rear) => patch({ tyres: { ...session.tyres, rear } })}
      />

      <FeedbackCard session={session} onChange={(feedback) => patch({ feedback })} />

      <Card title="Notes">
        <Field label="What you did between sessions">
          {(control) => (
            <textarea
              {...control}
              value={session.changesMade ?? ''}
              placeholder="New front tyre, dropped the forks 2 mm, checked chain…"
              onChange={(event) => patch({ changesMade: event.target.value })}
            />
          )}
        </Field>
        <Field label="Anything else">
          {(control) => (
            <textarea
              {...control}
              value={session.notes ?? ''}
              placeholder="Traffic, red flag, how the bike felt in your own words…"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          )}
        </Field>

        <div className="btn-row" style={{ marginTop: 14, marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              const day = data.trackDays.find((candidate) => candidate.id === session.trackDayId)
              downloadCsv(
                sessionCsv(data, session.id),
                csvFilename([day?.date, day?.circuit, `session ${session.number}`]),
              )
            }}
          >
            Export session (CSV)
          </button>
        </div>

        {confirmingDelete ? (
          <>
            <Note tone="bad">This deletes session {session.number}. There is no undo.</Note>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  update((current) => {
                    const next = {
                      ...current,
                      sessions: current.sessions.filter((candidate) => candidate.id !== session.id),
                    }
                    return bike ? reconcileCurrentSetup(next, bike.id) : next
                  })
                  onBack(session.trackDayId)
                }}
              >
                Delete session
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
            Delete session
          </button>
        )}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */

function ConditionsFields({
  session,
  prefs,
  onChange,
}: {
  session: Session
  prefs: Preferences
  onChange: (conditions: Session['conditions']) => void
}) {
  const { conditions } = session
  return (
    <>
      <div className="grid grid--two">
        <NumberField
          label="Air temp"
          value={tempInputValue(conditions.ambientTemp, prefs)}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) =>
            onChange({
              ...conditions,
              ...(value === undefined
                ? { ambientTemp: undefined }
                : { ambientTemp: tempFromInput(value, prefs) }),
            })
          }
        />
        <NumberField
          label="Track temp"
          value={tempInputValue(conditions.trackTemp, prefs)}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) =>
            onChange({
              ...conditions,
              ...(value === undefined
                ? { trackTemp: undefined }
                : { trackTemp: tempFromInput(value, prefs) }),
            })
          }
        />
      </div>
      <SelectField
        label="Conditions"
        value={conditions.condition ?? 'dry'}
        options={[
          { value: 'dry', label: 'Dry' },
          { value: 'damp', label: 'Damp' },
          { value: 'wet', label: 'Wet' },
          { value: 'mixed', label: 'Mixed' },
        ]}
        onChange={(condition) => onChange({ ...conditions, condition: condition as TrackCondition })}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */

/**
 * A lap time, typed the way a rider writes one.
 *
 * The text the rider is typing is held locally and only committed when it
 * parses, so a half-typed `1:5` is not thrown away or read as five seconds.
 */
function LapTimeField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: number | undefined
  onChange: (seconds: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : formatLapTime(value))

  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(control) => (
        <input
          {...control}
          type="text"
          inputMode="decimal"
          className="mono"
          placeholder="1:52.34"
          value={text}
          onChange={(event) => {
            const typed = event.target.value
            setText(typed)
            if (typed.trim() === '') {
              onChange(undefined)
              return
            }
            const parsed = parseLapTime(typed)
            if (parsed !== null) onChange(parsed)
          }}
        />
      )}
    </Field>
  )
}

function LapCard({
  session,
  previous,
  onChange,
}: {
  session: Session
  previous: Session | undefined
  onChange: (changes: Partial<Session>) => void
}) {
  const bestDelta =
    session.bestLap !== undefined && previous?.bestLap !== undefined
      ? session.bestLap - previous.bestLap
      : undefined
  const averageDelta =
    session.averageLap !== undefined && previous?.averageLap !== undefined
      ? session.averageLap - previous.averageLap
      : undefined

  return (
    <Card
      title="Laps"
      hint="One quick lap says what the bike can do. The average says what it did all session, which is the number a setup change has to move."
    >
      <div className="grid grid--two">
        <LapTimeField
          label="Fastest lap"
          value={session.bestLap}
          onChange={(bestLap) => onChange({ bestLap })}
        />
        <LapTimeField
          label="Average lap"
          hint="Your representative pace"
          value={session.averageLap}
          onChange={(averageLap) => onChange({ averageLap })}
        />
      </div>
      <NumberField
        label="Laps"
        value={session.laps === undefined ? '' : String(session.laps)}
        onChange={(laps) => onChange({ laps })}
      />

      {bestDelta !== undefined && (
        <Readout
          label="Fastest, against last session"
          value={formatLapDelta(bestDelta)}
          trailing={<Badge tone={bestDelta < 0 ? 'ok' : bestDelta > 0 ? 'warn' : 'muted'}>
            {bestDelta < 0 ? 'Quicker' : bestDelta > 0 ? 'Slower' : 'Level'}
          </Badge>}
        />
      )}
      {averageDelta !== undefined && (
        <Readout
          label="Average, against last session"
          value={formatLapDelta(averageDelta)}
          trailing={<Badge tone={averageDelta < 0 ? 'ok' : averageDelta > 0 ? 'warn' : 'muted'}>
            {averageDelta < 0 ? 'Quicker' : averageDelta > 0 ? 'Slower' : 'Level'}
          </Badge>}
        />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function SetupCard({
  session,
  previous,
  bike,
  onChange,
}: {
  session: Session
  previous: Session | undefined
  bike: Bike | undefined
  onChange: (setup: SuspensionSetup) => void
}) {
  return (
    <Card
      title="Suspension"
      hint="Each adjuster uses the unit and direction set for this bike in the Garage."
    >
      <SetupSteppers
        setup={session.setup}
        bike={bike}
        previousSetup={previous?.setup}
        onChange={onChange}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ */

function TyreCard({
  axle,
  session,
  data,
  onChange,
}: {
  axle: Axle
  session: Session
  data: GarageData
  onChange: (run: TyreRun) => void
}) {
  const prefs = data.preferences
  const run = session.tyres[axle]
  const rise = pressureRise(run)
  const target = prefs.targetHotPressure[axle]

  // Everything run on this axle today, newest first, so the recommendation
  // can average the rise across the day rather than trusting one reading.
  const today = sessionsForDay(data, session.trackDayId)
  const previousRuns = [...today]
    .filter((candidate) => candidate.number <= session.number)
    .sort((a, b) => b.number - a.number)
    .map((candidate) => candidate.tyres[axle])
  const recommendation = recommendFromHistory(previousRuns, target)

  const step = pressureStepBar(prefs)
  const wear = run.wear
  const day = data.trackDays.find((candidate) => candidate.id === session.trackDayId)
  const fitted = fittedTyre(data, day, axle)

  return (
    <Card title={axle === 'front' ? 'Front tyre' : 'Rear tyre'}>
      <Readout label="Fitted" value={fitted ? fittedName(fitted) : 'Not set'} />
      <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 12px' }}>
        The carcass is fitted for the whole day — set it on the track day.
      </p>

      <div className="grid grid--two">
        <Stepper
          label="Cold, set in the pits"
          value={run.coldPressure}
          step={step}
          min={0}
          max={4}
          scale={pressureScale(prefs)}
          unit={prefs.pressureUnit}
          onChange={(coldPressure) => onChange({ ...run, coldPressure })}
        />
        <Stepper
          label="Hot, straight off track"
          value={run.hotPressure}
          step={step}
          min={0}
          max={4}
          scale={pressureScale(prefs)}
          unit={prefs.pressureUnit}
          onChange={(hotPressure) => onChange({ ...run, hotPressure })}
        />
      </div>

      <div className="grid grid--two">
        <NumberField
          label="Warmer set point"
          value={tempInputValue(run.warmerTemp, prefs)}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) =>
            onChange({
              ...run,
              ...(value === undefined
                ? { warmerTemp: undefined }
                : { warmerTemp: tempFromInput(value, prefs) }),
            })
          }
        />
        <NumberField
          label="Surface temp on return"
          value={tempInputValue(run.surfaceTemp, prefs)}
          suffix={`°${prefs.temperatureUnit}`}
          onChange={(value) =>
            onChange({
              ...run,
              ...(value === undefined
                ? { surfaceTemp: undefined }
                : { surfaceTemp: tempFromInput(value, prefs) }),
            })
          }
        />
      </div>

      {rise !== undefined && (
        <Readout label="Pressure rise" value={fmtPressureDelta(rise, prefs)} />
      )}
      <Readout label="Target hot" value={fmtPressure(target, prefs)} />

      {recommendation && (
        <div style={{ marginTop: 12 }}>
          <Readout
            label="Set cold next time out"
            value={fmtPressure(recommendation.coldPressure, prefs)}
            large
            trailing={
              <Badge tone={Math.abs(recommendation.change) < step / 2 ? 'ok' : 'warn'}>
                {Math.abs(recommendation.change) < step / 2
                  ? 'No change'
                  : fmtPressureDelta(recommendation.change, prefs, false)}
              </Badge>
            }
          />
          <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
            From a {fmtPressureDelta(recommendation.rise, prefs)} rise over{' '}
            {recommendation.basedOnSessions}{' '}
            {recommendation.basedOnSessions === 1 ? 'session' : 'sessions'} today.
          </p>
          {recommendation.warnings.map((warning) => (
            <div key={warning} style={{ marginTop: 8 }}>
              <Note tone="warn">{warning}</Note>
            </div>
          ))}
        </div>
      )}

      <SelectField
        label="How it looks"
        value={wear ?? ''}
        options={[
          { value: '', label: 'Not checked' },
          ...allWearOptions().map((option) => ({ value: option.wear, label: option.label })),
        ]}
        onChange={(value) =>
          onChange({ ...run, ...(value === '' ? { wear: undefined } : { wear: value as TyreWear }) })
        }
      />
      {wear && <WearAdvice wear={wear} />}
    </Card>
  )
}

/** The tyre fitted for a day on one axle, if one is set. */
function fittedTyre(data: GarageData, day: GarageData['trackDays'][number] | undefined, axle: Axle): Tyre | undefined {
  const id = axle === 'front' ? day?.frontTyreId : day?.rearTyreId
  return id ? data.tyres.find((tyre) => tyre.id === id) : undefined
}

function fittedName(tyre: Tyre): string {
  return `${tyre.label ? `${tyre.label} — ` : ''}${describeTyre(tyre.model)}`
}

function WearAdvice({ wear }: { wear: TyreWear }) {
  const guidance = wearGuidance(wear)
  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        {guidance.meaning}
      </p>
      {guidance.actions.map((action) => (
        <div key={action} className="suggestion">
          <div className="suggestion__action">{action}</div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FeedbackCard({
  session,
  onChange,
}: {
  session: Session
  onChange: (feedback: string[]) => void
}) {
  const selected = new Set(session.feedback)
  const plan = buildAdvice(session.feedback)

  const toggle = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next])
  }

  return (
    <>
      <Card
        title="What did the bike do?"
        hint="Pick what you actually felt. The suggestions below follow from it."
      >
        {PHASES.map((phase) => {
          const items = FEEDBACK_CATALOGUE.filter((item) => item.phase === phase.phase)
          if (items.length === 0) return null
          return (
            <div key={phase.phase}>
              <SectionLabel>{phase.label}</SectionLabel>
              <div className="chips">
                {items.map((item) => (
                  <Chip
                    key={item.code}
                    pressed={selected.has(item.code)}
                    onClick={() => toggle(item.code)}
                  >
                    {item.label}
                  </Chip>
                ))}
              </div>
            </div>
          )
        })}
      </Card>

      {plan.suggestions.length > 0 && (
        <Card title="What to try" hint="Ranked. Take the top one, and only the top one.">
          {plan.conflicts.map((conflict) => (
            <Note key={conflict.fieldKey} tone="warn">
              {conflict.message}
            </Note>
          ))}
          {plan.suggestions.map((suggestion) => (
            <div key={`${suggestion.fieldKey}:${suggestion.direction}`} className="suggestion">
              <div className="split">
                <span className="suggestion__action">{suggestion.action}</span>
                <Badge
                  tone={
                    suggestion.confidence === 'high'
                      ? 'ok'
                      : suggestion.confidence === 'medium'
                        ? 'muted'
                        : 'warn'
                  }
                >
                  {suggestion.votes > 1 ? `${suggestion.votes} symptoms` : suggestion.confidence}
                </Badge>
              </div>
              <div className="suggestion__why">{suggestion.rationale}</div>
              <div className="suggestion__from">From: {suggestion.from.join('; ')}</div>
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            {plan.notes.map((note) => (
              <Note key={note}>{note}</Note>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
