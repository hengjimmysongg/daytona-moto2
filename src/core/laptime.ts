/**
 * Lap times.
 *
 * Riders write a lap time as `1:52.34` and read it back the same way, but
 * every comparison the app makes wants seconds. These convert between the
 * two and accept the shapes a lap time gets typed in as: with a colon, with
 * a full stop for the minute separator, or as plain seconds off a transponder
 * printout.
 */

/** Seconds, or null if the text is not a lap time. */
export function parseLapTime(input: string): number | null {
  const text = input.trim()
  if (text === '') return null

  // A colon always separates minutes: `1:52.34`, `1:52`.
  const withColon = /^(\d+):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text)
  if (withColon) return fromParts(withColon[1] as string, withColon[2] as string, withColon[3])

  // A dot is ambiguous, so the number of parts decides. Three parts can only
  // be minutes: `1.52.34`. Two parts is seconds and a fraction — `58.70` is
  // a lap under a minute, not fifty-eight minutes.
  const dotted = /^(\d+)\.(\d{1,2})\.(\d{1,3})$/.exec(text)
  if (dotted) return fromParts(dotted[1] as string, dotted[2] as string, dotted[3])

  // Plain seconds, as a transponder prints them: `112.34`, `52.3`.
  const plain = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(text)
  if (plain) return Number(plain[1]) + fractionToSeconds(plain[2])

  return null
}

function fromParts(minutes: string, seconds: string, fraction: string | undefined): number | null {
  const secondsValue = Number(seconds)
  // A seconds field over 59 is a typo, not a time.
  if (secondsValue > 59) return null
  return Number(minutes) * 60 + secondsValue + fractionToSeconds(fraction)
}

function fractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0
  return Number(fraction) / 10 ** fraction.length
}

/** Seconds as `1:52.34`, or `52.34` for a lap under a minute. */
export function formatLapTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  const restText = rest.toFixed(2).padStart(5, '0')
  return minutes > 0 ? `${minutes}:${restText}` : restText
}

/** Signed gap between two laps, as `-0.34` / `+1.02`. */
export function formatLapDelta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  const rounded = Number(seconds.toFixed(2))
  if (rounded === 0) return '0.00'
  const sign = rounded > 0 ? '+' : '−'
  return `${sign}${Math.abs(rounded).toFixed(2)}`
}
