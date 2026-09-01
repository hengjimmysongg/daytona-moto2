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
npm run setup          # writes .env for the database, if you want one
npm run dev            # the app on http://localhost:5173
npm test               # 170 tests
npm run build          # static client into dist/
```

`npm run setup` is safe to re-run: it keeps every value already in `.env` and
only fills in what is missing. It never prints a secret, only whether one is
set. `npm run check:env` reports what is still needed and exits non-zero if
anything is, which makes it usable in CI.

`npm run dev` is the whole app. The client is local-first, so it works with no
API behind it at all — the server only matters once you want the log on a
second device. To run both halves the way a host does:

```
npm run dev:vercel     # vercel dev, both halves on :3000
npm run dev:netlify    # netlify dev, both halves on :8888
```

Each wants that host's CLI, and `vercel dev` wants a linked project. Neither is
needed to work on the app: `npm run dev:api` serves the functions and SQLite on
:9999 and the Vite dev server proxies `/api` there, so `npm run dev` beside it
gives you the same two halves with no account anywhere.

Locally the database is a plain SQLite file at `./data/tracker.db`. You can
open it with `sqlite3` while the app is running.

---

## Deploying

It deploys to **Vercel** or to **Netlify**. Both configurations are in the
repo, neither gets in the other's way, and the application code is the same
either side — each host gets a file that does nothing but say where it is
running.

### The simplest deployment has no database at all

The client is local-first. Every edit is written to the browser, and the API
only matters once you want the same log on a second device. So deploying with
no database is a supported outcome rather than a broken one: leave
`TURSO_DATABASE_URL` unset, deploy, and you get the whole app with its log
kept in the browser. Nothing calls `/api`, because the browser only syncs
once somebody signs in, and `/api` says it is unconfigured if anything else
asks.

There are no accounts in that shape either, since there is nowhere to keep
one. It is the app for one rider on one phone.

What you give up is the log being in two places, and a log that lives in one
browser is one cleared site setting away from gone — so **Garage → Export backup**
is the backup, and worth doing after a track day.

The rest of this section is for when you do want it in two places.

### The one constraint worth understanding

A serverless function runs in a container that is thrown away, with a
filesystem to match: read-only where it is not temporary. A SQLite file
written inside one is gone by the next request and invisible to every other
instance running at the same time. So the file cannot live *in* the function.

The fix is not to give up SQLite, it is to put it somewhere durable. [Turso]
runs libSQL — SQLite, the same engine and the same SQL — and speaks it over
HTTP. The application code does not change: the same driver reads a local
file in development and a hosted database in production, chosen by a URL.

Forget to set it and the API says so. A deployment pointed at a `file:`
database refuses to serve and names the variables it wants, rather than
appearing to save a session and losing it on the next request.

[Turso]: https://turso.tech

### 1. Create the database

```bash
npm i -g @tursodatabase/turso-cli   # or: brew install tursodatabase/tap/turso
turso auth signup
turso db create trackday
turso db show trackday --url        # → libsql://trackday-you.turso.io
turso db tokens create trackday     # → the auth token
```

Put both into `.env`, then check what is left:

```bash
npm run setup        # writes them into .env
npm run check:env    # says what is still needed
```

`.env` is local-only and is never uploaded, so the host needs its own copy of
these two values. That is most of what step 2 is.

### 2a. Vercel

Either import the repository at [vercel.com/new](https://vercel.com/new), or
from the command line:

```bash
npx vercel login
npx vercel link                                    # creates and links the project
npx vercel env add TURSO_DATABASE_URL production   # each reads its value from stdin
npx vercel env add TURSO_AUTH_TOKEN production
npx vercel deploy --prod
```

`vercel.json` already carries the framework, the build command, the output
directory and two rewrites — `/api/*` to the function, everything else to
`index.html` so a deep link or a refresh lands on the app. Nothing to fill in
but those variables, which can also be set under *Project Settings →
Environment Variables*. Add them to the *Preview* environment too if you want
preview deployments to work; a preview with no key refuses to serve, by
design.

### 2b. Netlify

Either connect the repository at [app.netlify.com](https://app.netlify.com) →
*Add new site → Import an existing project*, or from the command line:

```bash
npx netlify login
npx netlify init                  # creates and links the site
npx netlify env:import .env       # pushes the variables to the site
npx netlify deploy --build --prod
```

`netlify.toml` already has the build command, the publish directory and the
functions directory. Variables can also be set in *Site configuration →
Environment variables*, or with `npx netlify env:set NAME "value"`.

### 3. Check it, then make an account

```bash
curl https://your-deployment/api/health
```

A healthy deployment answers `{"ok": true, …}` without signing in. A
misconfigured one answers 503 and says which variable is missing.

Then open the site, go to **Garage → Account**, and create one. Signing up
is free and open to anyone; the log on that device is adopted into the new
account on the first sync.

### Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | on a deployment | The libSQL database. Falls back to `file:./data/tracker.db`, which is only useful locally — a deployment pointed at a file refuses to serve. |
| `TURSO_AUTH_TOKEN` | on a deployment | Token for that database. |

That is the whole list. There is no shared secret to distribute any more:
who may read a garage is decided by who is signed in.

---

## Accounts

Anyone can sign up, and a rider's log is theirs. A user's id **is** their
garage id, which is why nothing in the query layer had to change to make the
log private: every table was already scoped by `garage_id`, and signing in
is just deciding which one this request may touch.

What that buys, and what it costs, stated plainly:

- **Passwords** are never stored. What is stored is PBKDF2-HMAC-SHA256 over
  the password, 210,000 rounds, salted per user, with the parameters written
  alongside the hash so they can be raised later without invalidating
  anybody's password.
- **Tokens** are never stored either — only their SHA-256. A dump of
  `auth_tokens` is a list of useless hashes, not a set of live sign-ins.
  They last 90 days.
- **A wrong password and an unknown address get the same answer**, so the
  sign-in form cannot be used to ask which addresses have accounts here.
- **Signup is open, and there is no rate limit.** That is what "anyone can
  sign up" means, and it is worth knowing before the URL is shared widely:
  nothing stops someone making accounts in bulk, and each signup costs a
  tenth of a second of CPU by design. For a rider's log shared with friends
  that is fine. For anything more public, put a rate limit in front of
  `/api/auth/*` before you advertise it.
- **An account is optional.** The app is local-first: it works with no
  account at all, and signing in is what makes the log survive a lost phone
  and turn up on the next device.

---

## The API

Everything under `/api`, JSON in and JSON out. Sign in once and send the
token it hands back as `Authorization: Bearer …`. `GET /api/health` needs no
token and lists every route.

**Units are canonical and not negotiable at this boundary**: pressures in
**bar**, temperatures in **°C**, lengths and sag in **mm**, weight in **kg**.
psi and °F are a browser display preference. A cold pressure of `31` is
rejected with a message pointing out that 31 psi is about 2.14 bar.

```bash
API=https://your-deployment/api

# Sign up once (or /login if you already have an account); keep the token
TOKEN=$(curl -s -X POST $API/auth/signup -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct horse battery"}' \
  | sed -n 's/.*"token": "\([^"]*\)".*/\1/p')
AUTH="Authorization: Bearer $TOKEN"

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
| `/api/health` | `GET` (no token) |
| `/api/auth/signup`, `/api/auth/login` | `POST` (no token) — `{email, password}` → `{token, expiresAt, user}` |
| `/api/auth/me`, `/api/auth/logout` | `GET` · `POST` |
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

**Exports.** A session, a whole track day, or the season, as CSV — one row
per session, every recorded data point a column, in the units you set. That
is the shape that sorts and filters, which is how you find out what the
quick sessions had in common. **Garage → Export backup** is the other kind:
the whole document as JSON, to import somewhere else.

**Accounts.** Free, optional and open to anyone. The log lives in the
browser first and works with no account at all; signing in is what makes it
the same log on the next device, and what makes it survive a lost phone.

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
  csv.ts        the log as a sheet: one row per session, in the rider's units
src/server/   the API: Request in, Response out, no framework
  db.ts         the libSQL connection and the schema
  repository.ts rows to domain objects and back
  validation.ts what the API accepts, and the defaults it fills in
  auth.ts       password hashing and session tokens, over Web Crypto
  accounts.ts   users and tokens in the database; a user id is a garage id
  router.ts     the routes, and which garage this request may touch
  handler.ts    the API minus the host: environment, database, refusals
src/data/     bike templates, circuits, tyre models — all editable defaults
src/ui/       React views, plus the sync loop
api/          the Vercel function, which only says where it is running
netlify/      the Netlify function, which does the same
tests/        the calculators, the API against a real in-memory SQLite,
              the conventions that are easy to invert, and the failure paths
```

The core has no React and no SQL in it. The server takes a `Request` and
returns a `Response` with its database handed in, so the whole API is tested
against a real in-memory SQLite without a server running.

Both host adapters are four lines around `serveApiRequest`, which is why
there are two of them and no framework in either. Relative imports outside
`src/ui` carry their `.js` extension because that code is also run by Node
directly, unbundled, where the ESM resolver does not guess at extensions.
