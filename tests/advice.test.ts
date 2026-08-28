import { describe, expect, it } from 'vitest'
import { buildAdvice, FEEDBACK_BY_CODE, FEEDBACK_CATALOGUE, feedbackByPhase } from '../src/core/advice'
import { SETUP_FIELDS_BY_KEY } from '../src/core/setup'

describe('the catalogue', () => {
  it('has unique codes', () => {
    const codes = FEEDBACK_CATALOGUE.map((item) => item.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives every complaint at least one thing to try', () => {
    for (const item of FEEDBACK_CATALOGUE) {
      expect(item.suggestions.length, item.code).toBeGreaterThan(0)
    }
  })

  it('only points at fields the app actually knows how to show', () => {
    const extra = new Set(['tyre.front.pressure', 'tyre.rear.pressure', 'sag'])
    for (const item of FEEDBACK_CATALOGUE) {
      for (const suggestion of item.suggestions) {
        const known = SETUP_FIELDS_BY_KEY.has(suggestion.fieldKey) || extra.has(suggestion.fieldKey)
        expect(known, `${item.code} → ${suggestion.fieldKey}`).toBe(true)
      }
    }
  })

  it('files every complaint under a phase you can pick from', () => {
    const phases = new Set(FEEDBACK_CATALOGUE.map((item) => item.phase))
    for (const phase of phases) {
      expect(feedbackByPhase(phase).length).toBeGreaterThan(0)
    }
  })
})

describe('buildAdvice', () => {
  it('has nothing to say about nothing', () => {
    const plan = buildAdvice([])
    expect(plan.suggestions).toEqual([])
    expect(plan.notes).toEqual([])
  })

  it('ignores codes it does not recognise', () => {
    expect(buildAdvice(['not-a-real-complaint']).suggestions).toEqual([])
  })

  it('leads with firmer fork compression for a diving front end', () => {
    const plan = buildAdvice(['front-dive'])
    const top = plan.suggestions[0]!
    expect(top.fieldKey).toBe('fork.compression')
    // Damping is stored as clicks out from closed, so firmer is a lower number.
    expect(top.direction).toBe('decrease')
    expect(top.action).toMatch(/firmer/)
    expect(top.confidence).toBe('high')
  })

  it('ranks a fix that answers two complaints above one that answers a single complaint', () => {
    const plan = buildAdvice(['slow-steering', 'front-push-entry'])
    expect(plan.suggestions[0]!.votes).toBe(2)
    const twoVoteKeys = plan.suggestions.filter((s) => s.votes === 2).map((s) => s.fieldKey)
    expect(twoVoteKeys).toContain('fork.height')
    expect(twoVoteKeys).toContain('shock.rideHeight')
    expect(plan.suggestions[0]!.from).toHaveLength(2)
  })

  it('promotes a suggestion to the highest confidence any complaint gave it', () => {
    const plan = buildAdvice(['slow-steering', 'front-push-entry'])
    // slow-steering rates fork.height medium; front-push-entry rates it high.
    const forkHeight = plan.suggestions.find((s) => s.fieldKey === 'fork.height')!
    expect(forkHeight.confidence).toBe('high')
  })

  it('flags an adjuster two complaints want moved opposite ways', () => {
    const plan = buildAdvice(['front-dive', 'front-harsh-braking'])
    expect(plan.conflicts.map((c) => c.fieldKey)).toContain('fork.compression')
    expect(plan.conflicts[0]!.message).toMatch(/opposite directions/)
  })

  it('does not invent a conflict when everything pulls the same way', () => {
    expect(buildAdvice(['slow-steering']).conflicts).toEqual([])
  })

  it('always says to change one thing at a time', () => {
    expect(buildAdvice(['rear-squat']).notes.join(' ')).toMatch(/one thing at a time/i)
  })

  it('pushes back when everything is reported at once', () => {
    const plan = buildAdvice(['front-dive', 'rear-squat', 'headshake', 'slow-steering'])
    expect(plan.notes.join(' ')).toMatch(/lot of complaints/i)
  })

  it('records which complaints produced each suggestion', () => {
    const plan = buildAdvice(['rear-pump'])
    const label = FEEDBACK_BY_CODE.get('rear-pump')!.label
    expect(plan.suggestions[0]!.from).toEqual([label])
  })
})
