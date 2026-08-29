# Track day log

A suspension and tyre pressure log book for track days, built to be used in
the paddock: on a phone, in gloves, with no signal, next to a hot bike.

It records what you ran, works out what to set next time, and — crucially —
keeps track of **what changed between sessions**, because that is the only
thing that makes a lap time mean anything.

There are two halves: a browser app that keeps working with no network, and a
small HTTP API over a SQLite database, so a log can be kept across devices and
written to by anything that can send JSON.

```
npm install
npm run setup          # writes .env, generating the API key
npm run dev:netlify    # the whole site on http://localhost:8888
npm test               # 159 tests
npm run build          # static client into dist/
```

`npm run setup` is safe to re-run: it keeps every value already in `.env` and
only fills in what is missing. It never prints a secret, only whether one is
set. `npm run check:env` reports what is still needed and exits non-zero if
anything is, which makes it usable in CI.

If `netlify dev` cannot start (it downloads a Deno runtime for edge functions,
which this app does not use), run the two halves separately instead — the Vite
dev server proxies `/api` to the functions server:

```
npm run dev:api        # functions + SQLite on :9999
npm run dev            # client on :5173
```

Locally the database is a plain SQLite file at `./data/tracker.db`. You can
open it with `sqlite3` while the app is running.

---

## Deploying to Netlify

### The one constraint worth understanding

A Netlify Function runs in a container that is thrown away, with a filesystem
to match. A SQLite file written inside one is gone by the next request and
invisible to every other instance running at the same time. So the file cannot
live *in* the function.

The fix is not to give up SQLite, it is to put it somewhere durable. [Turso]
runs libSQL — SQLite, the same engine and the same SQL — and speaks it over
HTTP. The application code does not change: the same driver reads a local file
in development and a hosted database in production, chosen by a URL.

[Turso]: https://turso.tech

### Steps

1. **Create the database.**

   ```bash
   npm i -g @tursodatabase/turso-cli   # or: brew install tursodatabase/tap/turso
   turso auth signup
   turso db create trackday
   turso db show trackday --url        # → libsql://trackday-you.turso.io
   turso db tokens create trackday     # → the auth token
   ```

2. **Create the site** — either connect this repository at
   [app.netlify.com](https://app.netlify.com) → *Add new site → Import an
   existing project*, or from the command line:

   ```bash
   npx netlify login
   npx netlify init          # creates and links the site
   ```

   `netlify.toml` already has the build command, the publish directory and the
   functions directory, so there is nothing to fill in.

3. **Set the environment variables.** `.env` is local-only and is never
   uploaded, so the site needs its own copy. Put the Turso values into `.env`,
   check it, then import the lot:

   ```bash
   npm run check:env                 # says what is still missing
   npx netlify env:import .env       # pushes them to the site
   ```

   Or set them one at a time in *Site configuration → Environment variables*,
   or with `npx netlify env:set NAME "value"`.

4. **Deploy.**

   ```bash
   npx netlify deploy --build --prod
   ```

5. **Check it, then connect the app.**

   ```bash
   npm run check:deploy https://your-site.netlify.app
   ```

   `curl .../api/health` is the tempting check and not a sufficient one: it
   answers before the auth guard, so a site that was deployed and never given
   its variables returns a healthy `200` there while every real request fails.
   The script asks a data route instead, which distinguishes the states a
   deploy actually lands in — guarded and working, missing `TRACKER_API_KEY`,
   unable to reach the database, or serving the garage to anyone who asks.

   Then open the site, go to **Garage → Sync**, and paste the
   `TRACKER_API_KEY`. The browser stores it and syncs from then on.

### Deploying from CI

`.github/workflows/deploy.yml` does step 4 on every push, so it only has to
happen by hand the first time. It needs two repository secrets, under
*Settings → Secrets and variables → Actions*:

| Secret | Where to find it |
| --- | --- |
| `NETLIFY_AUTH_TOKEN` | [app.netlify.com](https://app.netlify.com) → *User settings → Applications* |
| `NETLIFY_SITE_ID` | *Site configuration → General → Site information* (the API ID) |

A push to the default branch goes to production; any other branch gets its own
preview URL. The test suite runs first either way, so a red test cannot deploy,
and step 5 runs afterwards against the URL that was just deployed, so a deploy
that uploaded cleanly but cannot serve fails the build rather than passing it.

The variables below are deliberately *not* set by the workflow. They belong to
the site rather than to the build — the function reads them at request time,
long after the build has finished — so they stay in the Netlify UI.

### Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `TRACKER_API_KEY` | on a deployment | The shared secret every `/api` call must present. Without it a **deployed** API refuses to serve at all; locally it is optional and the API is open. |
| `TURSO_DATABASE_URL` | on a deployment | The libSQL database. Falls back to `file:./data/tracker.db`, which is only useful locally. |
| `TURSO_AUTH_TOKEN` | on a deployment | Token for that database. |
| `GARAGE_ID` | no | Which garage rows belong to. Defaults to `default`; set it to keep two separate logs in one database. |

### About that key

It is a shared secret, not an account system, and the README would rather say
so than imply otherwise. Whoever holds it can read and write the garage,
through the browser or through the API. That is a reasonable fit for one
rider's log book and a bad fit for anything else. The deployed API fails
closed when the key is missing, because the alternative — a writable database
on a public URL — is worse than an app that will not start.

---

## The API

Everything under `/api`, JSON in and JSON out, authenticated with
`Authorization: Bearer $TRACKER_API_KEY`. `GET /api/health` needs no key and
lists every route.

**Units are canonical and not negotiable at this boundary**: pressures in
**bar**, temperatures in **°C**, lengths and sag in **mm**, weight in **kg**.
psi and °F are a browser display preference. A cold pressure of `31` is
rejected with a message pointing out that 31 psi is about 2.14 bar.

```bash
API=https://your-site.netlify.app/api
AUTH="Authorization: Bearer $TRACKER_API_KEY"

# A bike needs only a name; the adjuster ranges and sag windows are filled in
curl -X POST $API/bikes -H "$AUTH" -H 'content-type: application/json' \
  -d '{"name":"Daytona 675R","make":"Triumph","riderWeightKg":82}'

# The bike is inferred when the garage only has one
curl -X POST $API/track-days -H "$AUTH" -H 'content-type: application/json' \
  -d '{"circuit":"Daytona International Speedway","date":"2026-03-07"}'

# A session is numbered automatically, after the last one on that day
curl -X POST $API/sessions -H "$AUTH" -H 'content-type: application/json' \
  -d '{
    "trackDayId": "day_…",
    "bestLap": 112.34,
    "conditions": { "ambientTemp": 22, "trackTemp": 35, "condition": "dry" },
    "setup": { "fork": { "compression": 12, "rebound": 10 } },
    "tyres": { "front": { "coldPressure": 2.14, "hotPressure": 2.41 } },
    "feedback": ["front-push-entry"]
  }'

curl "$API/sessions?trackDayId=day_…" -H "$AUTH"
```

| Route | Methods |
| --- | --- |
| `/api/health` | `GET` (no key) |
| `/api/bikes`, `/api/bikes/:id` | `GET` `POST` · `GET` `PATCH` `DELETE` |
| `/api/track-days`, `/api/track-days/:id` | `GET` `POST` · `GET` `PATCH` `DELETE` |
| `/api/sessions`, `/api/sessions/:id` | `GET` `POST` · `GET` `PATCH` `DELETE` |
| `/api/tyres`, `/api/tyres/:id` | `GET` `POST` · `GET` `PATCH` `DELETE` |
| `/api/preferences` | `GET` `PUT` |
| `/api/garage` | `GET` `PUT` — the whole document, used by the browser to sync |

`PATCH` merges: a body naming one field leaves the rest alone. Deleting a
track day deletes its sessions with it. `GET /api/sessions` takes an optional
`?trackDayId=`.

### How the browser and the server stay in step

The app is local-first. Every edit is written to `localStorage` first, so a
track day in a field with no signal works exactly as it always did; the server
is somewhere the log is *also* kept. When there is a network and a key, the
newer of the two documents wins whole.

That is a blunt rule and it is the honest one for a single rider's log book:
it is not a multi-writer merge, and two devices editing the same day at once
will keep whichever synced last. A row inserted through the REST API is picked
up by the browser on its next sync.

### The schema is worth querying

Every adjuster and every pressure is its own column, which is the point of
putting a log book in a database rather than a JSON blob:

```sql
SELECT s.number, s.best_lap, s.fork_compression,
       ROUND(s.front_hot - s.front_cold, 3) AS rise, d.circuit
FROM sessions s JOIN track_days d ON d.id = s.track_day_id
ORDER BY s.best_lap;
```

What stays as JSON is what nothing sorts or filters on: a bike's adjuster
ranges, its sag windows, and the list of feedback codes, which is genuinely a
list.

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
src/core/     the domain, with no UI and no database in it
  units.ts      bar/psi/kPa, °C/°F, mm/in, kg/lb, and the canonical-unit rule
  types.ts      bikes, track days, sessions, tyres
  sag.ts        rider and free sag, spring-rate verdict, preload corrections
  tyres.ts      pressure rise, cold-pressure recommendations, wear reading
  setup.ts      adjuster conventions, setup diffs, range validation
  advice.ts     the handling-complaint catalogue and how it is ranked
  laptime.ts    parsing and formatting `1:52.34`
  storage.ts    the persisted document, import and export
src/server/   the API: Request in, Response out, no framework
  db.ts         the libSQL connection and the schema
  repository.ts rows to domain objects and back
  validation.ts what the API accepts, and the defaults it fills in
  router.ts     the routes and the bearer-token check
src/data/     bike templates, circuits, tyre models — all editable defaults
src/ui/       React views, plus the sync loop
netlify/      the function, a thin adapter that only reads the environment
tests/        the calculators, the API against a real in-memory SQLite,
              the conventions that are easy to invert, and the failure paths
```

The core has no React and no SQL in it. The server takes a `Request` and
returns a `Response` with its database handed in, so the whole API is tested
against a real in-memory SQLite without a server running.
