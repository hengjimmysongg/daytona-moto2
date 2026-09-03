# Track day log

A suspension and tyre pressure log book for track days, built to be used in
the paddock: on a phone, in gloves, next to a hot bike.

It records what you ran, works out what to set next time, and — crucially —
keeps track of **what changed between sessions**, because that is the only
thing that makes a lap time mean anything.

Sign up, and your track days are yours: a browser app on Vercel over a
Postgres database in Supabase, which also holds the accounts.

---

## How it is put together

A Vite/React app on **Vercel**, talking straight to **Supabase** — Postgres
for the data, Supabase Auth for the accounts. There is no server of our own
in between, and nothing to run: the browser holds a publishable key, and what
it may read and write is decided by row-level security inside Postgres.

```
browser  ──  Supabase Auth      sign up, sign in, refresh
         └─  PostgREST → Postgres, with RLS on every table
```

### The shape of the data

```
auth.users
  └── track_days          one day, one circuit, one bike
        └── sessions      one time out: setup, tyres, conditions, lap times
  ├── bikes               the machine, and what its adjusters can do
  ├── tyres               each carcass, so heat cycles are answerable
  └── preferences         units and target hot pressures
```

Every session's data points are **columns**, not a blob — each adjuster, each
pressure, each temperature — so the log is queryable in SQL, not only in this
app:

```sql
select date, circuit, number, best_lap,
       fork_compression, fork_rebound, fork_preload,
       shock_compression_low, shock_rebound, shock_preload,
       front_cold, front_warmer_temp, front_hot
from sessions s join track_days d on d.id = s.track_day_id
where best_lap is not null
order by best_lap;
```

What stays as `jsonb` is what nothing sorts on: a bike's adjuster ranges, its
sag windows, and the feedback list, which is genuinely a list.

### Who can read what

Every row carries its owner. Row-level security is enabled on all five
tables, with the same policy on each:

```sql
using (auth.uid() = user_id) with check (auth.uid() = user_id)
```

`using` decides what you can see, `with check` what you can write — without
the second, a signed-in rider could write a row owned by somebody else. One
rider reaching another's track day is therefore not a bug this code could
have; it is something the database refuses.

Signing up is free and open to anyone. There is no rate limit in front of it,
which is worth knowing before the URL is shared widely.

### Running it

```
npm install
npm run dev            # http://localhost:5173
npm test               # 129 tests
npm run build          # static client into dist/
```

The Supabase URL and publishable key are compiled in (`src/data/supabase.ts`),
so there is nothing to configure. Point a fork at another project by setting
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — see `.env.example`. Both
are public values by design; the key identifies the project to a browser and
grants nothing on its own.

### Deploying

Any static host will do, since the build is just files. On Vercel:

```bash
npx vercel link
npx vercel deploy --prod
```

`vercel.json` carries the build command, the output directory and the SPA
rewrite, so there is nothing else to fill in. Connecting the GitHub repo in
the Vercel dashboard is worth doing once — it redeploys on every push.

### The API you get for free

Supabase exposes the tables over PostgREST, under the same row-level
security, so the log is reachable from anything that can send JSON — no
endpoint of ours in between:

```bash
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_KEY" -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' | jq -r .access_token)

curl "$SUPABASE_URL/rest/v1/sessions?select=*&order=number" \
  -H "apikey: $SUPABASE_KEY" -H "Authorization: Bearer $TOKEN"
```

### Exports

A session, a track day, or the whole log, as CSV — one row per session,
every recorded data point a column, in the units you set. That is the shape
that sorts and filters, which is how you find what the quick sessions had in
common. **Garage → Export backup** is the other kind: the whole log as JSON.


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
windows that belong to the bike. The correction comes back as a direction and
a distance to close — "add preload until rider sag comes down 7.5 mm, then
measure again" — rather than a turn count, which would need the collar's
thread pitch and the linkage ratio, two numbers that get guessed more often
than measured.

**Rider feedback.** Pick what the bike actually did — *front pushes wide on
entry*, *rear packs down over a series of bumps* — and get a ranked list of
things to try, each with the reasoning. A fix that answers two complaints
ranks above one that answers a single complaint, and an adjuster that two
complaints want moved in opposite directions is flagged rather than resolved
by guessing.

**Tyre life.** Track each carcass rather than each model, and "how many
sessions on this front?" becomes answerable. Sessions and heat cycles are
editable too, and add to what the log counts — a carcass usually arrives with
cycles already on it.

**Exports.** A session, a whole track day, or the season, as CSV — one row
per session, every recorded data point a column, in the units you set. That
is the shape that sorts and filters, which is how you find out what the
quick sessions had in common. **Garage → Export backup** is the other kind:
the whole document as JSON, to import somewhere else.

**Accounts.** Free and open to anyone. The log is stored against your
account, so it is the same log on every device you sign in on — and it
survives a lost phone.

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
src/core/     the domain, with no UI and no database in it
  units.ts      bar/psi/kPa, °C/°F, mm/in, kg/lb, and the canonical-unit rule
  types.ts      bikes, track days, sessions, tyres
  sag.ts        rider and free sag, spring-rate verdict, preload corrections
  tyres.ts      pressure rise, cold-pressure recommendations, wear reading
  setup.ts      adjuster conventions, setup diffs, range validation
  advice.ts     the handling-complaint catalogue and how it is ranked
  laptime.ts    parsing and formatting `1:52.34`
  storage.ts    the document shape, import and export
  csv.ts        the log as a sheet: one row per session, in the rider's units
src/data/     the outside world
  supabase.ts   the connection, and the two public values it needs
  rows.ts       Postgres rows to domain objects and back
  presets.ts    bike templates, circuits, tyre models — editable defaults
src/ui/       React views
  auth.ts       who is signed in, over Supabase Auth
  store.ts      the log, read and written straight to Postgres
tests/        the calculators, the CSV, the conventions that are easy to
              invert, and the failure paths
```

The core has no React and no SQL in it, which is why the calculators are
tested without either. `store.ts` is the only place that writes: it diffs the
document against the last one the database confirmed and sends just the rows
that moved, so editing one clicker is one `UPDATE`.
