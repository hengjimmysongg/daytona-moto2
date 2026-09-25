/**
 * The fork and shock stepper grid, shared by the session editor and a bike's
 * current-setup editor.
 *
 * Every adjuster is shown in the unit and direction set for that bike, so the
 * same grid reads in clicks on one machine and turns on another. `previousSetup`
 * is optional: pass it in a session to show what each value is changing from;
 * leave it out when editing a bike's standing setup, where there is no "before".
 */

import { SectionLabel, Stepper } from './kit'
import { adjusterConvention, adjusterStep, adjusterUnit, fieldsInGroup } from '../../core/setup'
import type { Bike, SuspensionSetup } from '../../core/types'

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
        const convention = adjusterConvention(field, bike)
        // A range of 0 means "not told yet", so it must not clamp the stepper.
        const max = spec && spec.range > 0 ? spec.range : undefined
        return (
          <Stepper
            key={field.key}
            label={field.shortLabel}
            {...(convention ? { hint: convention } : {})}
            value={field.get(setup)}
            baseline={previousSetup ? field.get(previousSetup) : undefined}
            step={adjusterStep(field, bike)}
            min={field.key === 'shock.rideHeight' || field.key === 'fork.height' ? -50 : 0}
            {...(max !== undefined ? { max } : {})}
            unit={adjusterUnit(field, bike)}
            onChange={(value) => onChange(field.set(setup, value))}
          />
        )
      })}
    </div>
  )
}

export function SetupSteppers({
  setup,
  bike,
  previousSetup,
  onChange,
}: {
  setup: SuspensionSetup
  bike?: Bike
  previousSetup?: SuspensionSetup
  onChange: (setup: SuspensionSetup) => void
}) {
  return (
    <>
      <SectionLabel>Fork</SectionLabel>
      <SetupGroupFields
        group="fork"
        setup={setup}
        previousSetup={previousSetup}
        bike={bike}
        onChange={onChange}
      />
      <SectionLabel>Shock</SectionLabel>
      <SetupGroupFields
        group="shock"
        setup={setup}
        previousSetup={previousSetup}
        bike={bike}
        onChange={onChange}
      />
    </>
  )
}
