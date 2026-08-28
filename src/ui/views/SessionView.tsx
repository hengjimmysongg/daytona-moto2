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
import { diffSetups, fieldsInGroup, validateSetup } from '../../core/setup'
import { pressureRise, recommendFromHistory, allWearOptions, wearGuidance } from '../../core/tyres'
import { previousSession, sessionsForDay } from '../../core/storage'
import { describeTyre } from '../../data/presets'
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

  const changes = previous ? diffSetups(previous.setup, session.setup) : []
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

      <LapCard session={session} previous={previous} onChange={patch} />

      <SetupCard
        session={session}
        previous={previous}
        bike={bike}
        onChange={(setup) => patch({ setup })}
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

        {confirmingDelete ? (
          <>
            <Note tone="bad">This deletes session {session.number}. There is no undo.</Note>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  update((current) => ({
                    ...current,
                    sessions: current.sessions.filter((candidate) => candidate.id !== session.id),
                  }))
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

function LapCard({
  session,
  previous,
  onChange,
}: {
  session: Session
  previous: Session | undefined
  onChange: (changes: Partial<Session>) => void
}) {
  const [bestText, setBestText] = useState(
    session.bestLap === undefined ? '' : formatLapTime(session.bestLap),
  )
  const delta =
    session.bestLap !== undefined && previous?.bestLap !== undefined
      ? session.bestLap - previous.bestLap
      : undefined

  return (
    <Card title="Laps">
      <div className="grid grid--two">
        <Field label="Best lap" >
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="decimal"
              className="mono"
              placeholder="1:52.34"
              value={bestText}
              onChange={(event) => {
                const text = event.target.value
                setBestText(text)
                if (text.trim() === '') {
                  onChange({ bestLap: undefined })
                  return
                }
                const parsed = parseLapTime(text)
                if (parsed !== null) onChange({ bestLap: parsed })
              }}
            />
          )}
        </Field>
        <NumberField
          label="Laps"
          value={session.laps === undefined ? '' : String(session.laps)}
          onChange={(laps) => onChange({ laps })}
        />
      </div>
      {delta !== undefined && (
        <Readout
          label="Against last session"
          value={formatLapDelta(delta)}
          trailing={<Badge tone={delta < 0 ? 'ok' : delta > 0 ? 'warn' : 'muted'}>
            {delta < 0 ? 'Quicker' : delta > 0 ? 'Slower' : 'Level'}
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
      hint="Damping in clicks out from fully closed. Preload in turns in from fully soft."
    >
      <SectionLabel>Fork</SectionLabel>
      <SetupGroupFields
        group="fork"
        setup={session.setup}
        previousSetup={previous?.setup}
        bike={bike}
        onChange={onChange}
      />
      <SectionLabel>Shock</SectionLabel>
      <SetupGroupFields
        group="shock"
        setup={session.setup}
        previousSetup={previous?.setup}
        bike={bike}
        onChange={onChange}
      />
    </Card>
  )
}

function SetupGroupFields({
  group,
  setup,
  previousSetup,
  bike,
  onChange,
}: {
  group: 'fork' | 'shock'
  setup: SuspensionSetup
  previousSetup: SuspensionSetup | undefined
  bike: Bike | undefined
  onChange: (setup: SuspensionSetup) => void
}) {
  return (
    <div className="grid grid--two">
      {fieldsInGroup(group).map((field) => {
        const spec = bike ? field.adjuster?.(bike) : undefined
        return (
          <Stepper
            key={field.key}
            label={field.shortLabel}
            {...(field.convention ? { hint: field.convention } : {})}
            value={field.get(setup)}
            baseline={previousSetup ? field.get(previousSetup) : undefined}
            step={field.step}
            min={field.key === 'shock.rideHeight' || field.key === 'fork.height' ? -50 : 0}
            max={spec?.range}
            unit={field.unit}
            onChange={(value) => onChange(field.set(setup, value))}
          />
        )
      })}
    </div>
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
  const history = [...today]
    .filter((candidate) => candidate.number <= session.number)
    .sort((a, b) => b.number - a.number)
    .map((candidate) => candidate.tyres[axle])
  const recommendation = recommendFromHistory(history, target)

  const step = pressureStepBar(prefs)
  const wear = run.wear
  // Retired tyres stay in the data so old sessions still make sense, but
  // they are not offered for a new one.
  const fitted = data.tyres.filter(
    (tyre) => tyre.axle === axle && (!tyre.retired || tyre.id === run.tyreId),
  )

  return (
    <Card title={axle === 'front' ? 'Front tyre' : 'Rear tyre'}>
      <Field
        label="Tyre"
        hint={
          fitted.length === 0
            ? 'Add tyres in the Tyres tab to track sessions and heat cycles on each carcass.'
            : undefined
        }
      >
        {(control) => (
          <select
            {...control}
            value={run.tyreId ?? ''}
            onChange={(event) => {
              const chosen = fitted.find((tyre) => tyre.id === event.target.value)
              onChange({
                ...run,
                ...(chosen
                  ? { tyreId: chosen.id, model: chosen.model }
                  : { tyreId: undefined, model: undefined }),
              })
            }}
          >
            <option value="">Not recorded</option>
            {fitted.map((tyre) => (
              <option key={tyre.id} value={tyre.id}>
                {tyreLabel(tyre)}
              </option>
            ))}
          </select>
        )}
      </Field>

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

function tyreLabel(tyre: Tyre): string {
  const usage = tyre.sessions > 0 ? ` · ${tyre.sessions} sessions` : ''
  return `${tyre.label ? `${tyre.label} — ` : ''}${describeTyre(tyre.model)}${usage}`
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
