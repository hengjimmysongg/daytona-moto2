import type { RangeStatus, SagWindow } from '../../core/sag'
import { statusFor } from '../../core/sag'
import { Badge, Readout } from './kit'

/** Sag to the tenth of a millimetre, which is as fine as a tape reads. */
export function formatSag(mm: number): string {
  return `${(Math.round(mm * 10) / 10).toFixed(1)} mm`
}

/** Not named `window`: that shadows the global inside a module and breaks
 *  anything that reaches for it, React Refresh included. */
export function formatSagWindow([min, max]: SagWindow): string {
  return `${min}–${max} mm`
}

export function SagStatusBadge({ status }: { status: RangeStatus }) {
  if (status === 'ok') return <Badge tone="ok">In window</Badge>
  return <Badge tone="warn">{status === 'low' ? 'Too little' : 'Too much'}</Badge>
}

/** One sag number against its window, when the bike gives it one. */
export function SagReadout({
  label,
  mm,
  target,
  large,
}: {
  label: string
  mm: number
  target?: SagWindow | undefined
  large?: boolean
}) {
  return (
    <Readout
      label={target ? `${label} · target ${formatSagWindow(target)}` : label}
      value={formatSag(mm)}
      {...(large ? { large } : {})}
      {...(target ? { trailing: <SagStatusBadge status={statusFor(mm, target)} /> } : {})}
    />
  )
}
