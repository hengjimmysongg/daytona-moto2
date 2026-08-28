# Track day log

A suspension and tyre pressure log book for track days, built to be used in
the paddock: on a phone, in gloves, with no signal, next to a hot bike.

It records what you ran, works out what to set next time, and — crucially —
keeps track of **what changed between sessions**, because that is the only
thing that makes a lap time mean anything.

```
npm install
npm run dev        # http://localhost:5173
npm test           # 117 tests over the calculators
npm run build      # static bundle in dist/
```

Everything is stored in your browser on your own device. Nothing is uploaded,
nothing needs an account, and the built bundle works offline.

---

## What it does

**Track days and sessions.** A day at a circuit, with a session for each time
you go out. Each session records the suspension setting, the tyres and their
pressures, the conditions, your lap time, and what the bike did.

Starting a new session copies the previous one's setup and cold pressures
forward, so you only record what you changed. That is the difference between a
log book that gets filled in and one that does not.

**Setup diffs.** Every session shows what changed since the last one, and what
that change does to the bike:

> Fork compression 12 → 10 clicks
> 2 clicks — firmer front, holds up under brakes, less compliance

If you changed more than one thing, it says so. Two changes in a session and
the lap time cannot tell you which one did the work.

**Tyre pressures.** You cannot set a hot pressure, only a cold one. So the app
takes the rise your tyres actually showed and works back to the cold pressure
that will land on your target hot pressure next time out, averaging the rise
across the day's sessions once there is more than one. It also flags a rise
big enough to mean the carcass is overworking, one small enough to mean the
tyre never came up to temperature, and a hot reading below the cold one, which
means a bad gauge or a leak rather than a setup problem.

There is a weather check for the other half of the problem: air temperature
moves pressure on its own, and a gain between the morning sighting laps and
the first session is often just the sun coming out.

**Sag.** Rider and free sag from the three measurements, checked against
windows that belong to the bike. Preload corrections come back in turns of
your adjuster, with the rear divided through the linkage motion ratio.

**Rider feedback.** Pick what the bike actually did — *front pushes wide on
entry*, *rear packs down over a series of bumps* — and get a ranked list of
things to try, each with the reasoning. A fix that answers two complaints
ranks above one that answers a single complaint, and an adjuster that two
complaints want moved in opposite directions is flagged rather than resolved
by guessing.

**Tyre life.** Track each carcass rather than each model, and "how many
sessions on this front?" becomes answerable.

---

## Conventions

Getting these backwards makes a log book worse than useless, so the app is
explicit about all of them and never stores a bare number without one.

| Thing | Recorded as | Which way |
| --- | --- | --- |
| Damping (compression, rebound) | clicks **out from fully closed** | fewer clicks = more damping = firmer |
| Preload | turns **in from fully soft** | more turns = more preload = less sag |
| Fork height | mm of tube showing above the top triple clamp | more showing = front end **lower** |
| Rear ride height | mm of shock/linkage rod length | more = rear **higher** |
| Fork oil height | mm down from the top of the compressed tube | **smaller** number = more oil = firmer at the end of the stroke |

Both damping and preload are counted from a hard stop you can find in the pit
lane without a manual, which is the whole reason for the convention.

Pressures are stored in bar, temperatures in °C, lengths in mm — always,
whatever units you have the app displaying. Conversion happens at the input
and at the display, never in a calculation. Suspension measurements are
millimetres everywhere and are not switchable; making them switchable would
buy nothing and invite a unit mix-up in the one place it would hurt most.

## How sag actually reads

Three measurements per end, at the same two points every time:

- **L1** fully extended, wheel off the ground
- **L2** bike on its own weight, nobody aboard → free sag = L1 − L2
- **L3** rider aboard in full kit → rider sag = L1 − L3

Rider sag is what preload sets. Free sag is the cross-check on the **spring**,
because preload only moves where the spring sits — it cannot change how stiff
it is. Wind in a lot of preload to reach the right rider sag and the bike will
barely settle on its own: little free sag, spring too soft. The opposite —
lots of free sag with preload backed right off — means it is too stiff.

That verdict only holds once rider sag is in its window, so the app tells you
when it is still provisional rather than letting you order springs off a
reading that has not settled yet.

## What it will not do

The advice is a starting point for a conversation with the bike, not a solver.
The same complaint can have several causes and the ranking reflects which is
most often the culprit, not a certainty. Two rules sit around all of it:

- change one thing at a time, or the next session teaches you nothing;
- sort the tyres and the sag out before chasing clickers, because almost every
  "the suspension is wrong" complaint on a track day turns out to be a
  pressure or a sag problem.

The bike templates and tyre pressures shipped here are plausible starting
points to be edited, not specifications. Adjuster ranges differ between model
years and between a stock cartridge and whatever the last owner fitted, and
the hot pressure that matters is the one on your tyre's data sheet.

---

## Layout

```
src/core/     the domain, with no UI in it
  units.ts      bar/psi/kPa, °C/°F, mm/in, kg/lb, and the canonical-unit rule
  types.ts      bikes, track days, sessions, tyres
  sag.ts        rider and free sag, spring-rate verdict, preload corrections
  tyres.ts      pressure rise, cold-pressure recommendations, wear reading
  setup.ts      adjuster conventions, setup diffs, range validation
  advice.ts     the handling-complaint catalogue and how it is ranked
  laptime.ts    parsing and formatting `1:52.34`
  storage.ts    the persisted document, import and export
src/data/     bike templates, circuits, tyre models — all editable defaults
src/ui/       React views; the only layer that knows what unit you read in
tests/        the calculators, the invertible conventions, the failure paths
```

The core has no React in it and takes its storage handle as an argument, so it
runs under Node and is tested without a DOM.
