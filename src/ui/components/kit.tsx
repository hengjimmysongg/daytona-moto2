import type { ReactNode } from 'react'
import { useId } from 'react'
import { parseNumber } from '../../core/units'

/* ---------------------------------------------------------- layout */

export function Card({
  title,
  hint,
  action,
  flush,
  children,
}: {
  title?: string
  hint?: string
  action?: ReactNode
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className={flush ? 'card card--flush' : 'card'}>
      {(title || action) && (
        <div className="split" style={flush ? { padding: '14px 16px 0' } : undefined}>
          {title && <h2 className="card__title">{title}</h2>}
          {action}
        </div>
      )}
      {hint && (
        <p className="card__hint" style={flush ? { padding: '0 16px' } : undefined}>
          {hint}
        </p>
      )}
      {children}
    </section>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="section-label">{children}</h3>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------- fields */

/**
 * Props a labelled control needs. Spread them onto the input so the hint
 * reaches a screen reader as a *description* rather than being glued onto
 * the field's name — "Fork compression" is what the control is called,
 * "clicks out from fully closed" is a note about it.
 */
export interface ControlProps {
  id: string
  'aria-describedby'?: string
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (control: ControlProps) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ id, ...(hint ? { 'aria-describedby': hintId } : {}) })}
    </div>
  )
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  list,
  type = 'text',
  autoComplete,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  list?: string
  type?: 'text' | 'email' | 'password'
  /**
   * Worth setting on anything a password manager should fill. This is used
   * in gloves, on a phone, in a paddock — the keyboard the type picks and
   * the autofill the hint unlocks are not cosmetic there.
   */
  autoComplete?: string
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(control) => (
        <input
          {...control}
          type={type}
          value={value}
          placeholder={placeholder ?? ''}
          {...(list ? { list } : {})}
          {...(autoComplete ? { autoComplete } : {})}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}

/**
 * A numeric field that keeps what the rider typed while they are typing.
 *
 * Parsing on every keystroke and writing the parsed number back makes a
 * field impossible to clear and eats a half-typed `2.` — so the raw text is
 * held locally and only committed when it parses.
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: number | undefined) => void
  suffix?: string
  placeholder?: string
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(control) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            {...control}
            type="text"
            inputMode="decimal"
            value={value}
            placeholder={placeholder ?? ''}
            onChange={(event) => {
              const text = event.target.value
              if (text.trim() === '') {
                onChange(undefined)
                return
              }
              const parsed = parseNumber(text)
              if (parsed !== null) onChange(parsed)
            }}
          />
          {suffix && (
            <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              {suffix}
            </span>
          )}
        </div>
      )}
    </Field>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(control) => (
        <select {...control} value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/**
 * Maps between the canonical value a stepper stores and the number the
 * rider sees and types.
 *
 * Both directions live in one object on purpose. A control that formats bar
 * as psi but reads what you type back as bar will happily record 31 bar for
 * "31 psi", which is the sort of unit bug that only shows up once the data
 * is already wrong — so the type makes it impossible to supply one half.
 */
export interface Scale {
  toDisplay(canonical: number): string
  fromDisplay(displayed: number): number
  /** Canonical difference, rendered with a sign. */
  formatDelta(canonicalDelta: number): string
}

const IDENTITY_SCALE: Scale = {
  toDisplay: (value) => String(Math.round(value * 100) / 100),
  fromDisplay: (value) => value,
  formatDelta: (delta) => {
    const rounded = Math.round(Math.abs(delta) * 100) / 100
    return `${delta > 0 ? '+' : '−'}${rounded}`
  },
}

/**
 * The control for anything counted in clicks, turns or millimetres.
 *
 * Big buttons because this gets used in gloves, and a delta against the
 * previous session's value right under it because the number that matters
 * at the track is what changed, not what it is.
 */
export function Stepper({
  label,
  hint,
  value,
  step = 1,
  min = 0,
  max,
  baseline,
  unit,
  scale = IDENTITY_SCALE,
  onChange,
}: {
  label: string
  hint?: string
  value: number | undefined
  /** In canonical units, like every other number here. */
  step?: number
  min?: number
  max?: number | undefined
  baseline?: number | undefined
  unit?: string
  scale?: Scale
  onChange: (value: number | undefined) => void
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const show = scale.toDisplay
  const delta = value !== undefined && baseline !== undefined ? value - baseline : undefined

  const nudge = (direction: 1 | -1) => {
    const from = value ?? baseline ?? 0
    const next = Math.round((from + direction * step) * 1000) / 1000
    if (next < min) return
    if (max !== undefined && next > max) return
    onChange(next)
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          onClick={() => nudge(-1)}
          aria-label={`Decrease ${label}`}
          disabled={value !== undefined && value - step < min}
        >
          −
        </button>
        <input
          id={id}
          {...(hint ? { 'aria-describedby': hintId } : {})}
          type="text"
          inputMode="decimal"
          className="stepper__value"
          value={value === undefined ? '' : show(value)}
          placeholder={baseline === undefined ? '—' : show(baseline)}
          onChange={(event) => {
            const text = event.target.value
            if (text.trim() === '') {
              onChange(undefined)
              return
            }
            const parsed = parseNumber(text)
            if (parsed !== null) onChange(scale.fromDisplay(parsed))
          }}
        />
        <button
          type="button"
          className="stepper__btn"
          onClick={() => nudge(1)}
          aria-label={`Increase ${label}`}
          disabled={max !== undefined && value !== undefined && value + step > max}
        >
          +
        </button>
      </div>
      {delta !== undefined && delta !== 0 && (
        <div className="stepper__delta">
          {scale.formatDelta(delta)} {unit ?? ''} vs last session
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- display */

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}

export function Note({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'bad'
  children: ReactNode
}) {
  const glyph = tone === 'bad' ? '!' : tone === 'warn' ? '!' : tone === 'ok' ? '✓' : 'i'
  return (
    <div className={`note note--${tone}`}>
      <span className="note__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{children}</span>
    </div>
  )
}

export function Readout({
  label,
  value,
  large,
  trailing,
}: {
  label: ReactNode
  value: ReactNode
  large?: boolean
  trailing?: ReactNode
}) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={large ? 'readout__value readout__value--lg' : 'readout__value'}>
          {value}
        </span>
        {trailing}
      </span>
    </div>
  )
}

export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}
