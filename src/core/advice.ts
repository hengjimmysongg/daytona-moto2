/**
 * Turning what the rider felt into something to try.
 *
 * This is a catalogue of the handling complaints riders actually report,
 * each with the adjustments a suspension tech would reach for first. It is
 * a starting point for a conversation with the bike, not a solver: the same
 * complaint can have several causes, and the ranking here reflects which is
 * most often the culprit, not a certainty.
 *
 * Two rules the tool enforces around it:
 *
 *   - Change one thing at a time, or the next session teaches you nothing.
 *   - Sort the tyres and the sag out before chasing clickers. Almost every
 *     "the suspension is wrong" complaint on a track day turns out to be a
 *     pressure or a sag problem.
 *
 * Directions are expressed against the values as this app stores them
 * (damping in clicks *out* from closed, preload in turns *in* from soft), so
 * `direction: 'decrease'` on a damping field means firmer. Each suggestion
 * also carries the instruction in words, which is what the UI shows.
 */

import type { Axle } from './types.js'

export type CornerPhase = 'braking' | 'entry' | 'mid' | 'exit' | 'straight' | 'general'

export type Confidence = 'high' | 'medium' | 'low'

export interface Suggestion {
  /** A key from `SETUP_FIELDS`, or `tyre.front.pressure` / `tyre.rear.pressure`. */
  fieldKey: string
  /** Which way the stored number moves. */
  direction: 'increase' | 'decrease'
  /** What to actually do, in the words you would say in the pit box. */
  action: string
  /** Why this is expected to help. */
  rationale: string
  confidence: Confidence
}

export interface FeedbackItem {
  code: string
  label: string
  phase: CornerPhase
  axle?: Axle
  description: string
  suggestions: Suggestion[]
}

/** Firmer damping means *fewer* clicks out from closed. */
function damping(
  fieldKey: string,
  firmer: boolean,
  name: string,
  amount: string,
  rationale: string,
  confidence: Confidence = 'medium',
): Suggestion {
  return {
    fieldKey,
    direction: firmer ? 'decrease' : 'increase',
    action: firmer
      ? `Wind ${name} in ${amount} (firmer)`
      : `Wind ${name} out ${amount} (softer)`,
    rationale,
    confidence,
  }
}

function preload(
  fieldKey: string,
  more: boolean,
  name: string,
  amount: string,
  rationale: string,
  confidence: Confidence = 'medium',
): Suggestion {
  return {
    fieldKey,
    direction: more ? 'increase' : 'decrease',
    action: more ? `Add ${amount} of ${name}` : `Remove ${amount} of ${name}`,
    rationale,
    confidence,
  }
}

function geometry(
  fieldKey: string,
  direction: 'increase' | 'decrease',
  action: string,
  rationale: string,
  confidence: Confidence = 'medium',
): Suggestion {
  return { fieldKey, direction, action, rationale, confidence }
}

function pressure(
  axle: Axle,
  up: boolean,
  rationale: string,
  confidence: Confidence = 'medium',
): Suggestion {
  return {
    fieldKey: `tyre.${axle}.pressure`,
    direction: up ? 'increase' : 'decrease',
    action: `${up ? 'Raise' : 'Lower'} ${axle} cold pressure one small step (about 0.05 bar / 1 psi)`,
    rationale,
    confidence,
  }
}

export const FEEDBACK_CATALOGUE: FeedbackItem[] = [
  /* -------------------------------------------------- braking / entry */
  {
    code: 'front-dive',
    label: 'Front dives too far or bottoms under braking',
    phase: 'braking',
    axle: 'front',
    description:
      'The fork runs out of travel at the end of the braking zone, and the bike feels like it is standing on its nose.',
    suggestions: [
      damping('fork.compression', true, 'fork compression', '1–2 clicks', 'Holds the fork up through the stroke without changing how it sits at rest.', 'high'),
      preload('fork.preload', true, 'fork preload', 'half a turn', 'Starts the fork higher in its travel so there is more left to use.'),
      geometry('fork.oilHeight', 'decrease', 'Raise the oil level 5–10 mm (less air space)', 'Makes the last part of the stroke progressively firmer — the classic fix for bottoming that a clicker cannot reach.', 'low'),
    ],
  },
  {
    code: 'front-harsh-braking',
    label: 'Front is harsh and skips over bumps in the braking zone',
    phase: 'braking',
    axle: 'front',
    description: 'The front deflects off bumps instead of following the surface, and the bars kick back at you.',
    suggestions: [
      damping('fork.compression', false, 'fork compression', '1–2 clicks', 'Lets the fork move over the bump instead of resisting it.', 'high'),
      pressure('front', false, 'A front tyre that is over-pressured cannot absorb anything and passes every bump straight through.'),
      damping('fork.rebound', false, 'fork rebound', '1 click', 'If the fork cannot recover between bumps it rides lower and lower and feels harsher each time.'),
    ],
  },
  {
    code: 'front-push-entry',
    label: 'Front pushes wide on entry — the bike will not turn',
    phase: 'entry',
    axle: 'front',
    description: 'You have to keep adding lean or bar pressure to make the apex, and the front feels like it is running on.',
    suggestions: [
      geometry('fork.height', 'increase', 'Raise the forks 2–3 mm through the clamps (front lower)', 'Steepens the steering geometry and puts more load on the front tyre so it bites.', 'high'),
      geometry('shock.rideHeight', 'increase', 'Add 1–2 mm of rear ride height', 'Same effect from the other end: transfers weight forward and quickens the steering.'),
      pressure('front', false, 'Too much front pressure shrinks the contact patch and is a very common cause of entry push.'),
    ],
  },
  {
    code: 'front-tuck',
    label: 'Front tucks or folds going in',
    phase: 'entry',
    axle: 'front',
    description: 'The front loses grip abruptly as you trail the brake in. Treat this one carefully.',
    suggestions: [
      damping('fork.compression', true, 'fork compression', '1–2 clicks', 'Stops the fork collapsing into its stroke, which is what takes the geometry past the tyre.', 'high'),
      preload('fork.preload', true, 'fork preload', 'half a turn', 'Keeps the front higher so the tyre is not asked to work at a bad angle.'),
      pressure('front', true, 'A front that is under-pressured rolls under on turn-in and lets go without warning.', 'low'),
    ],
  },
  {
    code: 'front-chatter',
    label: 'Front chatters mid-corner',
    phase: 'mid',
    axle: 'front',
    description: 'A rapid vibration through the bars at full lean, usually building through the corner.',
    suggestions: [
      damping('fork.compression', false, 'fork compression', '1–2 clicks', 'Chatter is usually the front being too stiff to follow the surface at lean.', 'medium'),
      pressure('front', false, 'High front pressure is the single most common chatter cause and the quickest thing to rule out.', 'high'),
      preload('fork.preload', false, 'fork preload', 'half a turn', 'Less preload lets the front settle into its stroke and damp the oscillation.'),
    ],
  },
  {
    code: 'no-front-feel',
    label: 'No feel or feedback from the front',
    phase: 'general',
    axle: 'front',
    description: 'The front is not doing anything wrong, but it is not telling you anything either, so you cannot commit.',
    suggestions: [
      pressure('front', false, 'Dropping pressure gets the carcass working and is where feel comes from.', 'high'),
      damping('fork.compression', false, 'fork compression', '2 clicks', 'A fork that barely moves cannot report what the tyre is doing.'),
      preload('fork.preload', false, 'fork preload', 'half a turn', 'Sitting a little deeper in the stroke gives the fork somewhere to work.', 'low'),
    ],
  },

  /* -------------------------------------------------- mid corner */
  {
    code: 'mid-vague',
    label: 'Bike feels vague or wallowy mid-corner',
    phase: 'mid',
    description: 'The bike moves around under you at lean and never quite settles on a line.',
    suggestions: [
      damping('shock.rebound', true, 'shock rebound', '1–2 clicks', 'Too little rebound lets the rear spring back and keep oscillating.', 'high'),
      damping('fork.rebound', true, 'fork rebound', '1–2 clicks', 'Same at the front: controls the spring instead of letting it float.'),
      { fieldKey: 'sag', direction: 'decrease', action: 'Re-check sag at both ends before anything else', rationale: 'A wallowing bike is very often simply riding too low in its travel.', confidence: 'medium' },
    ],
  },
  {
    code: 'slow-steering',
    label: 'Steering is slow — the bike feels lazy turning in',
    phase: 'entry',
    description: 'It takes real effort to get the bike to change direction, especially in the fast changes.',
    suggestions: [
      geometry('shock.rideHeight', 'increase', 'Add 2 mm of rear ride height', 'Raising the rear steepens the rake and shortens trail, which is what makes a bike turn quickly.', 'high'),
      geometry('fork.height', 'increase', 'Raise the forks 2–3 mm through the clamps (front lower)', 'The same geometry change from the front end.'),
    ],
  },
  {
    code: 'falls-in',
    label: 'Bike falls into corners and feels nervous',
    phase: 'entry',
    description: 'It drops onto its side faster than you asked and needs holding up mid-corner.',
    suggestions: [
      geometry('shock.rideHeight', 'decrease', 'Take 2 mm out of the rear ride height', 'Slackens the geometry and lengthens trail, which calms the turn-in.', 'high'),
      geometry('fork.height', 'decrease', 'Drop the forks 2–3 mm in the clamps (front higher)', 'The same change made at the front end.'),
    ],
  },
  {
    code: 'mid-bumps',
    label: 'Bike deflects off bumps at full lean',
    phase: 'mid',
    description: 'Mid-corner bumps push the bike off line rather than being absorbed.',
    suggestions: [
      damping('shock.compressionLow', false, 'shock low-speed compression', '2 clicks', 'Lets the rear follow the surface at lean instead of hopping over it.', 'medium'),
      damping('fork.compression', false, 'fork compression', '2 clicks', 'Same at the front.'),
      pressure('rear', false, 'Pressure that is too high stops the carcass absorbing anything.', 'low'),
    ],
  },

  /* -------------------------------------------------- exit */
  {
    code: 'rear-squat',
    label: 'Rear squats and the bike runs wide on the throttle',
    phase: 'exit',
    axle: 'rear',
    description: 'As you pick up the throttle the rear sits down, the front goes light and the bike drifts wide.',
    suggestions: [
      damping('shock.compressionLow', true, 'shock low-speed compression', '1–2 clicks', 'Low-speed compression is exactly the circuit that controls squat under drive.', 'high'),
      geometry('shock.rideHeight', 'increase', 'Add 1–2 mm of rear ride height', 'Starts the rear higher so squatting does not take the geometry out of range.'),
      preload('shock.preload', true, 'shock preload', 'half a turn', 'Holds the rear up in its travel, but re-check rear sag afterwards.', 'low'),
    ],
  },
  {
    code: 'rear-spin',
    label: 'Rear spins up on exit',
    phase: 'exit',
    axle: 'rear',
    description: 'The rear lights up under acceleration rather than driving off the corner.',
    suggestions: [
      pressure('rear', false, 'Lower rear pressure puts more carcass on the ground and is the first thing to try for drive grip.', 'high'),
      damping('shock.compressionLow', false, 'shock low-speed compression', '1–2 clicks', 'Letting the rear squat a little loads the tyre and finds mechanical grip.'),
      geometry('shock.rideHeight', 'decrease', 'Take 1–2 mm out of the rear ride height', 'A rear that is too high spins because the load is not going through the tyre.', 'low'),
    ],
  },
  {
    code: 'rear-pump',
    label: 'Rear packs down over a series of bumps',
    phase: 'exit',
    axle: 'rear',
    description: 'Over repeated bumps the rear gets progressively lower and harsher until it is skipping.',
    suggestions: [
      damping('shock.rebound', false, 'shock rebound', '2 clicks', 'Packing down is the classic symptom of too much rebound: the shock cannot extend between bumps.', 'high'),
      damping('shock.compressionHigh', false, 'shock high-speed compression', 'a quarter turn', 'Lets the sharp hits through so less energy has to be given back.', 'low'),
    ],
  },
  {
    code: 'rear-kick',
    label: 'Rear kicks over kerbs and sharp bumps',
    phase: 'exit',
    axle: 'rear',
    description: 'A sharp hit throws the rear up rather than absorbing it.',
    suggestions: [
      damping('shock.compressionHigh', false, 'shock high-speed compression', 'a quarter to half a turn', 'High-speed compression is the circuit sharp-edged hits actually use.', 'high'),
      damping('shock.rebound', false, 'shock rebound', '1 click', 'Lets the rear recover before the next hit.'),
    ],
  },
  {
    code: 'wheelie',
    label: 'Excessive wheelie spoiling the drive',
    phase: 'exit',
    description: 'The front comes up far enough on exit that you have to shut off.',
    suggestions: [
      geometry('shock.rideHeight', 'decrease', 'Take 2 mm out of the rear ride height', 'Lowering the rear moves weight forward and keeps the front down under drive.', 'medium'),
      damping('shock.compressionLow', true, 'shock low-speed compression', '1 click', 'Less squat keeps the geometry from working against you.', 'low'),
    ],
  },

  /* -------------------------------------------------- stability */
  {
    code: 'headshake',
    label: 'Headshake on acceleration or over bumps',
    phase: 'straight',
    description: 'The bars shake as the front goes light — usually on the exit of a bumpy corner or over a crest.',
    suggestions: [
      geometry('fork.height', 'decrease', 'Drop the forks 2–3 mm in the clamps (front higher)', 'Lengthens trail, which is what makes a front end self-centre instead of oscillating.', 'high'),
      geometry('shock.rideHeight', 'decrease', 'Take 1–2 mm out of the rear ride height', 'Same geometry change from the rear.'),
      damping('fork.rebound', true, 'fork rebound', '1 click', 'Stops the fork topping out and unloading the front tyre.', 'low'),
    ],
  },
  {
    code: 'unstable-braking',
    label: 'Bike weaves or feels unstable under hard braking',
    phase: 'braking',
    description: 'The back end moves around and the bike will not sit still in a straight-line braking zone.',
    suggestions: [
      damping('shock.rebound', true, 'shock rebound', '1–2 clicks', 'A rear that extends too fast as the load leaves it unsettles the whole bike.', 'high'),
      damping('fork.compression', true, 'fork compression', '1 click', 'Keeps the front from collapsing and taking the geometry with it.'),
    ],
  },
  {
    code: 'rear-hop',
    label: 'Rear hops or chatters on downshifts',
    phase: 'braking',
    axle: 'rear',
    description: 'The rear skips sideways as you go down the box into a slow corner.',
    suggestions: [
      damping('shock.rebound', false, 'shock rebound', '1–2 clicks', 'Too much rebound holds the rear compressed and light, so it skips. Let it extend.', 'high'),
      preload('shock.preload', false, 'shock preload', 'half a turn', 'Getting the rear to settle onto the tyre helps it stay planted.', 'low'),
    ],
  },
]

export const FEEDBACK_BY_CODE: ReadonlyMap<string, FeedbackItem> = new Map(
  FEEDBACK_CATALOGUE.map((item) => [item.code, item]),
)

export function feedbackByPhase(phase: CornerPhase): FeedbackItem[] {
  return FEEDBACK_CATALOGUE.filter((item) => item.phase === phase)
}

export const PHASES: { phase: CornerPhase; label: string }[] = [
  { phase: 'braking', label: 'Braking' },
  { phase: 'entry', label: 'Turn in' },
  { phase: 'mid', label: 'Mid corner' },
  { phase: 'exit', label: 'Exit' },
  { phase: 'straight', label: 'Straights' },
  { phase: 'general', label: 'General' },
]

/* ------------------------------------------------------------------ */
/* Putting a plan together                                             */
/* ------------------------------------------------------------------ */

export interface RankedSuggestion extends Suggestion {
  /** Complaints that led to this suggestion. */
  from: string[]
  /** How many selected complaints point at it. */
  votes: number
}

export interface Conflict {
  fieldKey: string
  message: string
}

export interface AdvicePlan {
  suggestions: RankedSuggestion[]
  conflicts: Conflict[]
  notes: string[]
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }

/**
 * Merge the suggestions for everything the rider reported into one ranked
 * list, and flag where they pull against each other.
 *
 * A suggestion that answers two different complaints is more likely to be
 * the real problem, so votes rank above confidence. Where two complaints
 * want the same adjuster moved in opposite directions there is no single
 * answer, and saying so is more honest than picking one.
 */
export function buildAdvice(codes: ReadonlyArray<string>): AdvicePlan {
  const merged = new Map<string, RankedSuggestion>()
  const directions = new Map<string, Set<'increase' | 'decrease'>>()

  for (const code of codes) {
    const item = FEEDBACK_BY_CODE.get(code)
    if (!item) continue
    for (const suggestion of item.suggestions) {
      const key = `${suggestion.fieldKey}:${suggestion.direction}`
      const existing = merged.get(key)
      if (existing) {
        existing.votes += 1
        existing.from.push(item.label)
        if (CONFIDENCE_WEIGHT[suggestion.confidence] > CONFIDENCE_WEIGHT[existing.confidence]) {
          existing.confidence = suggestion.confidence
        }
      } else {
        merged.set(key, { ...suggestion, from: [item.label], votes: 1 })
      }
      const seen = directions.get(suggestion.fieldKey) ?? new Set()
      seen.add(suggestion.direction)
      directions.set(suggestion.fieldKey, seen)
    }
  }

  const suggestions = [...merged.values()].sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes
    return CONFIDENCE_WEIGHT[b.confidence] - CONFIDENCE_WEIGHT[a.confidence]
  })

  const conflicts: Conflict[] = []
  for (const [fieldKey, dirs] of directions) {
    if (dirs.size > 1) {
      conflicts.push({
        fieldKey,
        message:
          'Two of the things you reported want this adjuster moved in opposite directions. Decide which one is costing you more time and fix that first — or look at the spring rate and sag, which is often what is behind a complaint that pulls both ways.',
      })
    }
  }

  const notes: string[] = []
  if (suggestions.length > 0) {
    notes.push('Change one thing at a time. Two changes in one session and the lap time tells you nothing.')
    notes.push('Check tyre pressures and sag first — they explain more handling complaints than clickers do.')
  }
  if (codes.length > 3) {
    notes.push(
      'That is a lot of complaints at once. Work on the one that is costing the most lap time and re-assess: fixing one thing often makes several others go away.',
    )
  }

  return { suggestions, conflicts, notes }
}
